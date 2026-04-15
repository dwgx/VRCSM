#include "../pch.h"

#include "WebViewHost.h"

#include "IpcBridge.h"
#include "StringUtil.h"

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
    if (m_webview == nullptr)
    {
        return;
    }

    const std::wstring payload = Utf8ToWide(json);
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
