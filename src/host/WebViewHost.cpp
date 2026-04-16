#include "../pch.h"

#include "WebViewHost.h"

#include "IpcBridge.h"
#include "StringUtil.h"

#include "../core/AvatarPreview.h"

#include <KnownFolders.h>
#include <shlobj.h>

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
        const std::filesystem::path dataRoot = GetLocalAppDataPath() / L"VRCSM" / L"WebView2";
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

void WebViewHost::PostMessageToWeb(const std::string& json) const
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
    // every call site. Ownership of the heap string transfers to
    // DeliverWebMessage on the receiving side.
    auto* payload = new std::string(json);
    if (!PostMessageW(m_parent, WM_APP_POST_WEB_MESSAGE, 0, reinterpret_cast<LPARAM>(payload)))
    {
        delete payload;
    }
}

void WebViewHost::DeliverWebMessage(std::string* owned) const
{
    std::unique_ptr<std::string> guard(owned);
    if (m_webview == nullptr || guard == nullptr) return;

    const std::wstring payload = Utf8ToWide(*guard);
    (void)m_webview->PostWebMessageAsString(payload.c_str());
}

void WebViewHost::ClearVrcCookies() const
{
    if (m_webview == nullptr)
    {
        return;
    }

    auto webview2 = m_webview.try_query<ICoreWebView2_2>();
    if (webview2 == nullptr)
    {
        return;
    }

    wil::com_ptr<ICoreWebView2CookieManager> cookieManager;
    if (FAILED(webview2->get_CookieManager(cookieManager.put())) || cookieManager == nullptr)
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
                    wil::com_ptr<ICoreWebView2Cookie> cookie;
                    if (FAILED(list->GetValueAtIndex(i, cookie.put())) || cookie == nullptr)
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
                        cookieManager->DeleteCookie(cookie.get());
                        ++deleted;
                    }
                }
                spdlog::info("[auth] ClearVrcCookies removed {} cookie(s)", deleted);
                return S_OK;
            })
            .Get());
}

std::filesystem::path WebViewHost::GetLocalAppDataPath() const
{
    std::wstring buffer(static_cast<size_t>(MAX_PATH), L'\0');
    DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0)
    {
        throw std::runtime_error("LOCALAPPDATA is not set");
    }

    if (length >= buffer.size())
    {
        buffer.resize(static_cast<size_t>(length));
        length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer.data(), static_cast<DWORD>(buffer.size()));
        if (length == 0 || length >= buffer.size())
        {
            throw std::runtime_error("Failed to query LOCALAPPDATA");
        }
    }

    buffer.resize(static_cast<size_t>(length));
    return std::filesystem::path(buffer);
}

std::filesystem::path WebViewHost::GetExecutableDirectory() const
{
    std::wstring buffer(static_cast<size_t>(MAX_PATH), L'\0');
    DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0)
    {
        THROW_LAST_ERROR();
    }

    while (length >= buffer.size())
    {
        buffer.resize(buffer.size() * 2);
        length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (length == 0)
        {
            THROW_LAST_ERROR();
        }
    }

    buffer.resize(static_cast<size_t>(length));
    return std::filesystem::path(buffer).parent_path();
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
        THROW_IF_FAILED(m_controller->get_CoreWebView2(m_webview.put()));
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
    wil::com_ptr<ICoreWebView2Settings> settings;
    THROW_IF_FAILED(m_webview->get_Settings(settings.put()));

#if defined(_DEBUG)
    THROW_IF_FAILED(settings->put_AreDevToolsEnabled(TRUE));
#else
    THROW_IF_FAILED(settings->put_AreDevToolsEnabled(FALSE));
    THROW_IF_FAILED(settings->put_AreDefaultContextMenusEnabled(FALSE));
#endif
    THROW_IF_FAILED(settings->put_IsStatusBarEnabled(FALSE));
    THROW_IF_FAILED(settings->put_IsZoomControlEnabled(FALSE));

    const std::filesystem::path webDir = GetExecutableDirectory() / L"web";
    auto webview3 = m_webview.try_query<ICoreWebView2_3>();
    THROW_HR_IF_NULL(E_NOINTERFACE, webview3.get());
    THROW_IF_FAILED(webview3->SetVirtualHostNameToFolderMapping(
        L"app.vrcsm",
        webDir.c_str(),
        COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW));

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
    wil::unique_cotaskmem_string picturesPath;
    std::filesystem::path screenshotsDir;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Pictures, 0, nullptr, picturesPath.put())))
    {
        screenshotsDir = std::filesystem::path(picturesPath.get()) / L"VRChat";
    }
    if (!screenshotsDir.empty())
    {
        std::error_code ec;
        std::filesystem::create_directories(screenshotsDir, ec);
        THROW_IF_FAILED(webview3->SetVirtualHostNameToFolderMapping(
            L"screenshots.local",
            screenshotsDir.c_str(),
            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW));
    }

    EventRegistrationToken token{};
    THROW_IF_FAILED(m_webview->add_WebMessageReceived(
        Microsoft::WRL::Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) noexcept -> HRESULT
            {
                try
                {
                    wil::unique_cotaskmem_string message;
                    THROW_IF_FAILED(args->TryGetWebMessageAsString(&message));
                    m_ipcBridge->Dispatch(WideToUtf8(message.get()));
                    return S_OK;
                }
                catch (...)
                {
                    return wil::ResultFromCaughtException();
                }
            })
            .Get(),
        &token));

    THROW_IF_FAILED(m_webview->Navigate(L"https://app.vrcsm/index.html"));
}
