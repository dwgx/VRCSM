#include "../pch.h"

#include "WebViewHost.h"

#include "IpcBridge.h"
#include "ScreenshotThumbs.h"
#include "StringUtil.h"
#include "UrlProtocol.h"
#include "VrchatPaths.h"

#include "../core/AvatarPreview.h"
#include "../core/Common.h"

#include "../core/plugins/PluginRegistry.h"

WebViewHost::WebViewHost()
    : m_ipcBridge(std::make_unique<IpcBridge>(*this))
{
}

WebViewHost::~WebViewHost() = default;

HRESULT WebViewHost::Initialize(HWND parent)
{
    m_parent = parent;

    try
    {
        const std::filesystem::path dataRoot = vrcsm::core::getAppDataRoot() / L"WebView2";
        std::filesystem::create_directories(dataRoot);

        return CreateCoreWebView2EnvironmentWithOptions(
            nullptr,
            dataRoot.c_str(),
            nullptr,
            Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                [this](HRESULT result, ICoreWebView2Environment* environment) noexcept -> HRESULT
                {
                    return OnEnvironmentCreated(result, environment);
                })
                .Get());
    }
    catch (...)
    {
        return wil::ResultFromCaughtException();
    }
}

void WebViewHost::Resize(RECT bounds) const
{
    if (m_controller != nullptr)
    {
        (void)m_controller->put_Bounds(bounds);
    }
}

void WebViewHost::PostMessageToWeb(const std::string& json, const std::string& targetPluginId) const
{
    if (m_webview == nullptr || m_parent == nullptr)
    {
        return;
    }

    // Marshal every call onto the UI thread unconditionally. Even
    // when the caller happens to already be on the UI thread, the
    // round-trip through PostMessage adds one cheap message-loop
    // iteration and keeps the semantics trivially consistent — we
    // don't have to reason about "was this the right thread?" at
    // every call site. Ownership of the heap payload transfers to
    // DeliverWebMessage on the receiving side.
    auto* payload = new WebPostPayload{json, targetPluginId};
    if (!PostMessageW(m_parent, WM_APP_POST_WEB_MESSAGE, 0, reinterpret_cast<LPARAM>(payload)))
    {
        delete payload;
    }
}

void WebViewHost::DeliverWebMessage(WebPostPayload* owned) const
{
    std::unique_ptr<WebPostPayload> guard(owned);
    if (m_webview == nullptr || guard == nullptr) return;

    const std::wstring message = Utf8ToWide(guard->json);

    // Plugin iframe path: route to the exact frame so the iframe's
    // chrome.webview message listener fires. PostWebMessageAsString on
    // the top-level ICoreWebView2 only delivers to the main frame, so
    // plugin iframes would never hear responses to their own calls.
    if (!guard->targetPluginId.empty())
    {
        const auto it = m_pluginFrames.find(guard->targetPluginId);
        if (it != m_pluginFrames.end() && it->second)
        {
            Microsoft::WRL::ComPtr<ICoreWebView2Frame2> frame2;
            if (SUCCEEDED(it->second.As(&frame2)) && frame2)
            {
                (void)frame2->PostWebMessageAsString(message.c_str());
                return;
            }
        }
        // Fall through to the main frame if the plugin iframe has
        // already been torn down between enqueue and delivery.
    }

    (void)m_webview->PostWebMessageAsString(message.c_str());
}

void WebViewHost::ClearVrcCookies() const
{
    if (m_webview == nullptr)
    {
        return;
    }

    Microsoft::WRL::ComPtr<ICoreWebView2_2> webview2;
    if (FAILED(m_webview.As(&webview2)) || webview2 == nullptr)
    {
        return;
    }

    Microsoft::WRL::ComPtr<ICoreWebView2CookieManager> cookieManager;
    if (FAILED(webview2->get_CookieManager(&cookieManager)) || cookieManager == nullptr)
    {
        return;
    }

    // Enumerate every cookie and delete any that look auth-related,
    // regardless of domain/path. The old targeted DeleteCookiesWith
    // DomainAndPath calls silently no-op'd when VRChat shifted the
    // domain to `.vrchat.com` (wildcard) — which is exactly what was
    // happening in practice, so clicking "sign out" left the cookie
    // jar intact and the next "sign in" click auto-rehydrated the
    // session without prompting. Full enumeration is the only way to
    // be sure the user is actually signed out.
    (void)cookieManager->GetCookies(
        nullptr,
        Microsoft::WRL::Callback<ICoreWebView2GetCookiesCompletedHandler>(
            [cookieManager](HRESULT result, ICoreWebView2CookieList* list) noexcept -> HRESULT
            {
                if (FAILED(result) || list == nullptr)
                {
                    return S_OK;
                }
                UINT count = 0;
                if (FAILED(list->get_Count(&count)) || count == 0)
                {
                    return S_OK;
                }

                UINT deleted = 0;
                for (UINT i = 0; i < count; ++i)
                {
                    Microsoft::WRL::ComPtr<ICoreWebView2Cookie> cookie;
                    if (FAILED(list->GetValueAtIndex(i, &cookie)) || cookie == nullptr)
                    {
                        continue;
                    }
                    wil::unique_cotaskmem_string name;
                    if (FAILED(cookie->get_Name(&name)) || name == nullptr)
                    {
                        continue;
                    }
                    const std::wstring nameStr(name.get());
                    if (nameStr == L"auth" || nameStr == L"twoFactorAuth")
                    {
                        cookieManager->DeleteCookie(cookie.Get());
                        ++deleted;
                    }
                }
                spdlog::info("[auth] ClearVrcCookies removed {} cookie(s)", deleted);
                return S_OK;
            })
            .Get());
}

HRESULT WebViewHost::OnEnvironmentCreated(HRESULT result, ICoreWebView2Environment* environment)
{
    if (FAILED(result))
    {
        return result;
    }

    m_environment = environment;
    return m_environment->CreateCoreWebView2Controller(
        m_parent,
        Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [this](HRESULT controllerResult, ICoreWebView2Controller* controller) noexcept -> HRESULT
            {
                return OnControllerCreated(controllerResult, controller);
            })
            .Get());
}

HRESULT WebViewHost::OnControllerCreated(HRESULT result, ICoreWebView2Controller* controller)
{
    if (FAILED(result))
    {
        return result;
    }

    try
    {
        m_controller = controller;
        THROW_IF_FAILED(m_controller->get_CoreWebView2(&m_webview));
        ConfigureWebView();

        RECT bounds{};
        GetClientRect(m_parent, &bounds);
        Resize(bounds);

        return S_OK;
    }
    catch (...)
    {
        return wil::ResultFromCaughtException();
    }
}

void WebViewHost::ConfigureWebView()
{
    Microsoft::WRL::ComPtr<ICoreWebView2Settings> settings;
    THROW_IF_FAILED(m_webview->get_Settings(&settings));

#if defined(_DEBUG)
    THROW_IF_FAILED(settings->put_AreDevToolsEnabled(TRUE));
#else
    THROW_IF_FAILED(settings->put_AreDevToolsEnabled(FALSE));
    THROW_IF_FAILED(settings->put_AreDefaultContextMenusEnabled(FALSE));
#endif
    THROW_IF_FAILED(settings->put_IsStatusBarEnabled(FALSE));
    THROW_IF_FAILED(settings->put_IsZoomControlEnabled(FALSE));

    const std::filesystem::path webDir = vrcsm::core::getExecutableDirectory() / L"web";
    Microsoft::WRL::ComPtr<ICoreWebView2_3> webview3;
    THROW_IF_FAILED(m_webview.As(&webview3));
    THROW_HR_IF_NULL(E_NOINTERFACE, webview3.Get());
    THROW_IF_FAILED(webview3->SetVirtualHostNameToFolderMapping(
        L"app.vrcsm",
        webDir.c_str(),
        COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW));

    // Web resource integrity: if index.html is missing the installer was
    // tampered with or partially wiped. Log loud so the next navigation-error
    // handler below can show a useful message instead of WebView2's generic
    // ERR_FILE_NOT_FOUND page.
    {
        std::error_code ec;
        const auto indexPath = webDir / L"index.html";
        if (!std::filesystem::exists(indexPath, ec) || ec)
        {
            spdlog::error("[webview] web/index.html missing at {} — UI will not load",
                          WideToUtf8(indexPath.wstring()));
        }
    }

    // Second virtual host: `preview.local` → the preview-cache dir.
    // The AvatarPreview pipeline writes `<hash>.glb` files under
    // `%LocalAppData%\VRCSM\preview-cache`, and the React renderer
    // fetches them via `http://preview.local/<hash>.glb`. Mapping
    // them to a virtual host keeps the Three.js `useGLTF` call URL-
    // based (no file:// hackery) and sidesteps DownloadAcceptPolicy
    // quirks around loading binary assets off local disk.
    const auto previewDir = vrcsm::core::AvatarPreview::PreviewCacheDir();
    THROW_IF_FAILED(webview3->SetVirtualHostNameToFolderMapping(
        L"preview.local",
        previewDir.c_str(),
        COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW));

    // Third virtual host: `screenshots.local` → VRChat's Pictures folder.
    // Used by the Screenshots page to render thumbnails via plain
    // `<img src="https://screenshots.local/<relative>">` without shuttling
    // base64 blobs over IPC. The folder is read-only from the web side —
    // we only serve files, never write or delete via this host.
    const std::filesystem::path screenshotsDir = DetectPrimaryVrchatScreenshotRoot();
    if (!screenshotsDir.empty())
    {
        std::error_code ec;
        std::filesystem::create_directories(screenshotsDir, ec);
        THROW_IF_FAILED(webview3->SetVirtualHostNameToFolderMapping(
            L"screenshots.local",
            screenshotsDir.c_str(),
            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW));
    }

    // Fourth virtual host: `screenshot-thumbs.local` → generated JPEG
    // thumbnails on disk. Populated by ScreenshotThumbs::EnqueueBatch(),
    // which the Screenshots page triggers via the `screenshots.list` IPC
    // whenever it re-fetches the photo list. The frontend pulls tiny
    // (~30 KB) JPEGs for grid tiles instead of the 3-8 MB originals —
    // 10-20× faster first-paint on large libraries.
    const auto thumbsDir = vrcsm::host::ScreenshotThumbs::CacheDir();
    if (!thumbsDir.empty())
    {
        THROW_IF_FAILED(webview3->SetVirtualHostNameToFolderMapping(
            L"screenshot-thumbs.local",
            thumbsDir.c_str(),
            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW));
    }

    // Panel mappings for every currently-enabled plugin. Bundled
    // plugins mirror on startup (PluginStore::Reload runs at first
    // GetPluginStore() use, which happens here), so this includes
    // any ship-with-the-app plugins the user hasn't disabled.
    RefreshPluginMappings();

    EventRegistrationToken token{};
    THROW_IF_FAILED(m_webview->add_WebMessageReceived(
        Microsoft::WRL::Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) noexcept -> HRESULT
            {
                try
                {
                    wil::unique_cotaskmem_string message;
                    THROW_IF_FAILED(args->TryGetWebMessageAsString(&message));

                    // Thread the origin through so IpcBridge can gate
                    // management calls (install/uninstall/etc.) to the
                    // app.vrcsm SPA and route plugin-origin calls
                    // through plugin.rpc with a permission check. The
                    // get_Source API returns the frame URI (scheme +
                    // host + path), which is exactly what
                    // PluginRegistry::PluginIdFromOrigin expects.
                    wil::unique_cotaskmem_string source;
                    std::string originUri;
                    if (SUCCEEDED(args->get_Source(&source)) && source)
                    {
                        originUri = WideToUtf8(source.get());
                    }
                    else
                    {
                        originUri = "https://app.vrcsm/";
                    }

                    m_ipcBridge->DispatchFromOrigin(originUri, WideToUtf8(message.get()));
                    return S_OK;
                }
                catch (...)
                {
                    return wil::ResultFromCaughtException();
                }
            })
            .Get(),
        &token));

    // Plugin iframe tracking. Every time WebView2 creates a child
    // frame, subscribe to its own `WebMessageReceived` channel (which
    // the plugin's `chrome.webview.postMessage` hits when it runs
    // inside the iframe). The top-level `add_WebMessageReceived`
    // only fires for the main SPA frame — plugin iframes are entirely
    // invisible to it — so without this hook plugin→host IPC calls
    // appear to succeed but silently vanish.
    //
    // We also cache the frame by plugin id on the first message so
    // that response delivery can target `ICoreWebView2Frame2::Post
    // WebMessageAsString` (the top-level PostWebMessageAsString only
    // reaches the main frame, which is why the AutoUploader folder
    // picker hung on "Loading…" forever in v0.9.0).
    Microsoft::WRL::ComPtr<ICoreWebView2_4> webview4;
    if (SUCCEEDED(m_webview.As(&webview4)) && webview4)
    {
        EventRegistrationToken frameCreatedToken{};
        THROW_IF_FAILED(webview4->add_FrameCreated(
            Microsoft::WRL::Callback<ICoreWebView2FrameCreatedEventHandler>(
                [this](ICoreWebView2*, ICoreWebView2FrameCreatedEventArgs* args) noexcept -> HRESULT
                {
                    Microsoft::WRL::ComPtr<ICoreWebView2Frame> frame;
                    if (FAILED(args->get_Frame(&frame)) || !frame) return S_OK;

                    Microsoft::WRL::ComPtr<ICoreWebView2Frame2> frame2;
                    if (SUCCEEDED(frame.As(&frame2)) && frame2)
                    {
                        EventRegistrationToken fwmrToken{};
                        (void)frame2->add_WebMessageReceived(
                            Microsoft::WRL::Callback<ICoreWebView2FrameWebMessageReceivedEventHandler>(
                                [this, framePtr = frame](ICoreWebView2Frame*, ICoreWebView2WebMessageReceivedEventArgs* evArgs) noexcept -> HRESULT
                                {
                                    try
                                    {
                                        wil::unique_cotaskmem_string msg;
                                        if (FAILED(evArgs->TryGetWebMessageAsString(&msg)) || !msg) return S_OK;
                                        wil::unique_cotaskmem_string src;
                                        std::string originUri;
                                        if (SUCCEEDED(evArgs->get_Source(&src)) && src)
                                        {
                                            originUri = WideToUtf8(src.get());
                                        }
                                        if (originUri.empty()) return S_OK;

                                        // First message from a plugin iframe: stash
                                        // the frame ref so subsequent responses can
                                        // be routed to it via ICoreWebView2Frame2::
                                        // PostWebMessageAsString.
                                        const auto pid = vrcsm::core::plugins::PluginRegistry::PluginIdFromOrigin(originUri);
                                        if (pid && !pid->empty())
                                        {
                                            m_pluginFrames[*pid] = framePtr;
                                        }

                                        m_ipcBridge->DispatchFromOrigin(originUri, WideToUtf8(msg.get()));
                                        return S_OK;
                                    }
                                    catch (...)
                                    {
                                        return wil::ResultFromCaughtException();
                                    }
                                })
                                .Get(),
                            &fwmrToken);
                    }

                    EventRegistrationToken destroyedToken{};
                    (void)frame->add_Destroyed(
                        Microsoft::WRL::Callback<ICoreWebView2FrameDestroyedEventHandler>(
                            [this, weakFrame = frame.Get()](ICoreWebView2Frame*, IUnknown*) noexcept -> HRESULT
                            {
                                for (auto it = m_pluginFrames.begin(); it != m_pluginFrames.end();)
                                {
                                    if (it->second.Get() == weakFrame)
                                    {
                                        it = m_pluginFrames.erase(it);
                                    }
                                    else
                                    {
                                        ++it;
                                    }
                                }
                                return S_OK;
                            })
                            .Get(),
                        &destroyedToken);

                    return S_OK;
                })
                .Get(),
            &frameCreatedToken));
    }

    // Navigation self-heal: if a stray reload/replace sends the view to
    // a stale preview.local or plugin.*.vrcsm URL after a cache clear or
    // plugin uninstall, WebView2 shows its generic ERR_FILE_NOT_FOUND page
    // and the user is stuck. Watch NavigationCompleted, and on failure
    // bounce back to the SPA root so the app recovers automatically.
    EventRegistrationToken navToken{};
    THROW_IF_FAILED(m_webview->add_NavigationCompleted(
        Microsoft::WRL::Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) noexcept -> HRESULT
            {
                BOOL ok = FALSE;
                (void)args->get_IsSuccess(&ok);
                if (ok) return S_OK;

                COREWEBVIEW2_WEB_ERROR_STATUS status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
                (void)args->get_WebErrorStatus(&status);

                wil::unique_cotaskmem_string src;
                std::wstring currentUrl;
                if (sender && SUCCEEDED(sender->get_Source(&src)) && src)
                {
                    currentUrl = src.get();
                }

                constexpr std::wstring_view kRoot = L"https://app.vrcsm/";
                const bool alreadyAtRoot = currentUrl.rfind(kRoot.data(), 0, kRoot.size()) == 0
                    && currentUrl.find(L"index.html") != std::wstring::npos;

                spdlog::warn("[webview] navigation failed (status={}) at {} — self-healing",
                             static_cast<int>(status),
                             WideToUtf8(currentUrl));

                if (!alreadyAtRoot && sender)
                {
                    (void)sender->Navigate(L"https://app.vrcsm/index.html");
                }
                else if (sender)
                {
                    // Already at root and still failing — web/ is broken.
                    // Show a minimal inline page so the user sees a real
                    // message instead of the generic WebView2 error.
                    constexpr std::wstring_view kFallback =
                        L"<!doctype html><html><head><meta charset=\"utf-8\">"
                        L"<title>VRCSM</title></head>"
                        L"<body style=\"font-family:sans-serif;padding:2rem;background:#111;color:#ddd\">"
                        L"<h1>VRCSM UI resources are missing.</h1>"
                        L"<p>The <code>web/</code> folder next to <code>VRCSM.exe</code> is empty or corrupted. "
                        L"Reinstall the MSI or restore the folder, then relaunch.</p>"
                        L"</body></html>";
                    (void)sender->NavigateToString(kFallback.data());
                }
                return S_OK;
            })
            .Get(),
        &navToken));

    // If the process was launched via a vrcsm:// (or vrcx://) URL, the
    // initial route was parsed out of argv in main.cpp. Append it as a
    // query param so the React side can navigate once mounted.
    std::wstring initialUrl = L"https://app.vrcsm/index.html";
    const std::string initialRoute = vrcsm::host::GetInitialRouteFromArgs();
    if (!initialRoute.empty())
    {
        initialUrl += L"?initialRoute=";
        initialUrl += Utf8ToWide(initialRoute);
    }
    THROW_IF_FAILED(m_webview->Navigate(initialUrl.c_str()));
}

void WebViewHost::RefreshPluginMappings() const
{
    if (m_webview == nullptr) return;

    Microsoft::WRL::ComPtr<ICoreWebView2_3> webview3;
    if (FAILED(m_webview.As(&webview3)) || webview3 == nullptr) return;

    // DENY_CORS: plugin iframes are isolated from each other and from
    // app.vrcsm. Cross-origin XHR/fetch between plugin.<x>.vrcsm and
    // app.vrcsm is blocked — plugins speak to the host only through
    // postMessage, which IpcBridge::DispatchFromOrigin gates.
    const auto mappings = vrcsm::core::plugins::PluginRegistry::Instance().EnabledPanelMappings();
    for (const auto& m : mappings)
    {
        const auto host = Utf8ToWide(m.virtualHost);
        std::error_code ec;
        if (!std::filesystem::is_directory(m.folder, ec))
        {
            spdlog::warn("[plugins] refresh: skipping '{}' — folder missing at {}",
                         m.virtualHost, vrcsm::core::toUtf8(m.folder.wstring()));
            continue;
        }
        HRESULT hr = webview3->SetVirtualHostNameToFolderMapping(
            host.c_str(),
            m.folder.c_str(),
            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
        if (FAILED(hr))
        {
            spdlog::warn("[plugins] SetVirtualHostNameToFolderMapping({}) hr=0x{:08x}",
                         m.virtualHost, static_cast<unsigned>(hr));
        }
    }
}

void WebViewHost::QuitForUpdate() const
{
    if (m_parent != nullptr && IsWindow(m_parent))
    {
        DestroyWindow(m_parent);
    }
    PostQuitMessage(0);
}
