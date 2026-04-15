#include "../pch.h"

#include "AuthLoginWindow.h"

#include "StringUtil.h"

#include "../core/AuthStore.h"

namespace vrcsm::host
{

namespace
{
// Unique class name so re-launching doesn't collide with the main window
// class (registered by MainWindow).
constexpr wchar_t kClassName[] = L"VRCSM_AuthLoginWindow";
constexpr wchar_t kTitle[] = L"VRChat Login — VRCSM";
constexpr wchar_t kLoginUrl[] = L"https://vrchat.com/home/login";
// The popup is sized for VRChat's login layout at its native scale — the
// form is ~480px wide, plus chrome. Taller than the form so captcha +
// error banners don't push the sign-in button below the fold.
constexpr int kWindowWidth = 520;
constexpr int kWindowHeight = 740;
// Polling timer that acts as a safety net for SPA pushState routing,
// which neither NavigationCompleted nor (in some builds) SourceChanged
// reliably surfaces. One second strikes a balance: fast enough for
// "close automatically after login" to feel instant, slow enough that
// GetCookies callbacks don't pile up.
constexpr UINT_PTR kHarvestTimerId = 0x52ED;
constexpr UINT kHarvestTimerPeriodMs = 1000;

std::string CookieNameUtf8(ICoreWebView2Cookie* cookie)
{
    if (cookie == nullptr)
    {
        return {};
    }
    wil::unique_cotaskmem_string name;
    if (FAILED(cookie->get_Name(&name)) || name == nullptr)
    {
        return {};
    }
    return WideToUtf8(name.get());
}

std::string CookieValueUtf8(ICoreWebView2Cookie* cookie)
{
    if (cookie == nullptr)
    {
        return {};
    }
    wil::unique_cotaskmem_string value;
    if (FAILED(cookie->get_Value(&value)) || value == nullptr)
    {
        return {};
    }
    return WideToUtf8(value.get());
}

// VRChat's login waypoints all contain at least one of these substrings
// — so long as the user is on any of them, we know the session is not
// yet established and there's nothing to harvest. Once they land on
// `/home` or `/home/online` (no login bits) we try to pull cookies.
bool UrlStillInFlow(const std::wstring& url)
{
    return url.find(L"/login") != std::wstring::npos
        || url.find(L"twofactor") != std::wstring::npos
        || url.find(L"email-verify") != std::wstring::npos
        || url.find(L"password-reset") != std::wstring::npos;
}
} // namespace

bool AuthLoginWindow::Launch(HWND ownerHwnd, ICoreWebView2Environment* env, CompletionCallback callback)
{
    if (env == nullptr)
    {
        spdlog::warn("[auth] AuthLoginWindow::Launch called with null env");
        if (callback)
        {
            callback(false, "webview2_env_unavailable");
        }
        return false;
    }

    EnsureClassRegistered();

    HWND hwnd = CreatePopup(ownerHwnd);
    if (hwnd == nullptr)
    {
        spdlog::warn("[auth] AuthLoginWindow failed to create popup window");
        if (callback)
        {
            callback(false, "window_create_failed");
        }
        return false;
    }

    // Self-managed: the instance lives until WM_NCDESTROY deletes it.
    auto* window = new AuthLoginWindow(hwnd, ownerHwnd, env, std::move(callback));
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(window));

    // Disable the owner so the login popup acts as a modal dialog.
    if (ownerHwnd != nullptr)
    {
        EnableWindow(ownerHwnd, FALSE);
    }

    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);

    const HRESULT hr = env->CreateCoreWebView2Controller(
        hwnd,
        Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [window](HRESULT result, ICoreWebView2Controller* controller) noexcept -> HRESULT
            {
                return window->OnControllerCreated(result, controller);
            })
            .Get());

    if (FAILED(hr))
    {
        spdlog::warn("[auth] CreateCoreWebView2Controller failed hr=0x{:08X}",
            static_cast<uint32_t>(hr));
        window->Finish(false, "controller_create_failed");
        DestroyWindow(hwnd);
        return false;
    }

    return true;
}

void AuthLoginWindow::EnsureClassRegistered()
{
    static bool registered = false;
    if (registered)
    {
        return;
    }

    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = &AuthLoginWindow::WndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    wc.lpszClassName = kClassName;
    RegisterClassExW(&wc);
    registered = true;
}

HWND AuthLoginWindow::CreatePopup(HWND owner)
{
    RECT ownerRect{};
    if (owner == nullptr || !GetWindowRect(owner, &ownerRect))
    {
        ownerRect.left = 0;
        ownerRect.top = 0;
        ownerRect.right = GetSystemMetrics(SM_CXSCREEN);
        ownerRect.bottom = GetSystemMetrics(SM_CYSCREEN);
    }
    const int ownerW = ownerRect.right - ownerRect.left;
    const int ownerH = ownerRect.bottom - ownerRect.top;
    const int x = ownerRect.left + (ownerW - kWindowWidth) / 2;
    const int y = ownerRect.top + (ownerH - kWindowHeight) / 2;

    return CreateWindowExW(
        WS_EX_DLGMODALFRAME,
        kClassName,
        kTitle,
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_CLIPCHILDREN,
        x, y, kWindowWidth, kWindowHeight,
        owner,
        nullptr,
        GetModuleHandleW(nullptr),
        nullptr);
}

LRESULT CALLBACK AuthLoginWindow::WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    auto* self = reinterpret_cast<AuthLoginWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));

    switch (msg)
    {
    case WM_SIZE:
        if (self != nullptr)
        {
            self->ResizeController();
        }
        return 0;
    case WM_TIMER:
        if (self != nullptr && wp == kHarvestTimerId)
        {
            self->OnHarvestTimer();
        }
        return 0;
    case WM_CLOSE:
        if (self != nullptr)
        {
            // The user dismissed the popup — report cancellation (Finish
            // is idempotent, so a prior success call stays a success).
            self->Finish(false, "cancelled");
        }
        DestroyWindow(hwnd);
        return 0;
    case WM_NCDESTROY:
        if (self != nullptr)
        {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            delete self;
        }
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

AuthLoginWindow::AuthLoginWindow(HWND hwnd, HWND owner, ICoreWebView2Environment* env, CompletionCallback callback)
    : m_hwnd(hwnd)
    , m_owner(owner)
    , m_env(env)
    , m_callback(std::move(callback))
{
}

AuthLoginWindow::~AuthLoginWindow()
{
    // Re-enable the owner window we disabled on show.
    if (m_owner != nullptr)
    {
        EnableWindow(m_owner, TRUE);
        SetForegroundWindow(m_owner);
    }

    // Close() tears down the browser and cancels pending callbacks so
    // the captured `this` in WRL callbacks won't fire after we're gone.
    if (m_controller != nullptr)
    {
        (void)m_controller->Close();
    }
}

HRESULT AuthLoginWindow::OnControllerCreated(HRESULT result, ICoreWebView2Controller* controller)
{
    if (FAILED(result) || controller == nullptr)
    {
        spdlog::warn("[auth] AuthLoginWindow controller creation failed hr=0x{:08X}",
            static_cast<uint32_t>(result));
        Finish(false, "controller_failed");
        PostMessageW(m_hwnd, WM_CLOSE, 0, 0);
        return result;
    }

    try
    {
        m_controller = controller;
        THROW_IF_FAILED(m_controller->get_CoreWebView2(m_webview.put()));
        ResizeController();

        wil::com_ptr<ICoreWebView2Settings> settings;
        THROW_IF_FAILED(m_webview->get_Settings(settings.put()));
        THROW_IF_FAILED(settings->put_IsStatusBarEnabled(FALSE));
        THROW_IF_FAILED(settings->put_IsZoomControlEnabled(FALSE));
#if defined(_DEBUG)
        THROW_IF_FAILED(settings->put_AreDevToolsEnabled(TRUE));
#else
        THROW_IF_FAILED(settings->put_AreDevToolsEnabled(FALSE));
#endif

        THROW_IF_FAILED(m_webview->add_NavigationCompleted(
            Microsoft::WRL::Callback<ICoreWebView2NavigationCompletedEventHandler>(
                [this](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) noexcept -> HRESULT
                {
                    return OnNavigationCompleted(sender, args);
                })
                .Get(),
            &m_navToken));

        // SPA pushState transitions (VRChat's React frontend does this after
        // a successful 2FA submit — it rewrites the URL to /home without a
        // real page load) fire SourceChanged but NOT NavigationCompleted.
        // Without this handler the popup would hang open forever on a
        // successful login.
        THROW_IF_FAILED(m_webview->add_SourceChanged(
            Microsoft::WRL::Callback<ICoreWebView2SourceChangedEventHandler>(
                [this](ICoreWebView2* sender, ICoreWebView2SourceChangedEventArgs* args) noexcept -> HRESULT
                {
                    return OnSourceChanged(sender, args);
                })
                .Get(),
            &m_sourceToken));

        // Safety net: even if both navigation events miss the transition
        // (different build of Edge, iframe-only update, whatever), poll the
        // cookie jar directly once a second. HarvestCookies is a no-op when
        // there's no `auth` cookie yet, so this is cheap.
        if (SetTimer(m_hwnd, kHarvestTimerId, kHarvestTimerPeriodMs, nullptr) != 0)
        {
            m_timerActive = true;
        }

        THROW_IF_FAILED(m_webview->Navigate(kLoginUrl));
        return S_OK;
    }
    catch (...)
    {
        const HRESULT hr = wil::ResultFromCaughtException();
        spdlog::warn("[auth] AuthLoginWindow webview init threw hr=0x{:08X}",
            static_cast<uint32_t>(hr));
        Finish(false, "webview_init_failed");
        PostMessageW(m_hwnd, WM_CLOSE, 0, 0);
        return hr;
    }
}

HRESULT AuthLoginWindow::OnNavigationCompleted(ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs*)
{
    ProbeUrlAndHarvest();
    return S_OK;
}

HRESULT AuthLoginWindow::OnSourceChanged(ICoreWebView2*, ICoreWebView2SourceChangedEventArgs*)
{
    // Fires on every URL change including pushState. Use the same URL
    // gate as NavigationCompleted so we skip intermediate login pages.
    ProbeUrlAndHarvest();
    return S_OK;
}

void AuthLoginWindow::ProbeUrlAndHarvest()
{
    if (m_finished || m_webview == nullptr)
    {
        return;
    }

    wil::unique_cotaskmem_string source;
    if (FAILED(m_webview->get_Source(&source)) || source == nullptr)
    {
        return;
    }

    const std::wstring url(source.get());
    if (UrlStillInFlow(url))
    {
        return;
    }

    spdlog::info("[auth] AuthLoginWindow URL settled, harvesting cookies: {}",
        WideToUtf8(url));
    HarvestCookies();
}

void AuthLoginWindow::OnHarvestTimer()
{
    if (m_finished)
    {
        return;
    }

    // The timer path deliberately skips the URL check — occasionally the
    // cookie jar is updated for a pushState transition the event handlers
    // didn't see, and this keeps us honest. HarvestCookies returns without
    // finishing when there is no `auth` cookie yet, so idle ticks cost
    // only one async call into the cookie manager.
    HarvestCookies();
}

void AuthLoginWindow::HarvestCookies()
{
    if (m_finished || m_webview == nullptr)
    {
        return;
    }

    auto webview2 = m_webview.try_query<ICoreWebView2_2>();
    if (webview2 == nullptr)
    {
        spdlog::warn("[auth] ICoreWebView2_2 unavailable; cannot access cookie manager");
        Finish(false, "webview2_interface_unavailable");
        PostMessageW(m_hwnd, WM_CLOSE, 0, 0);
        return;
    }

    wil::com_ptr<ICoreWebView2CookieManager> cookieManager;
    if (FAILED(webview2->get_CookieManager(cookieManager.put())) || cookieManager == nullptr)
    {
        spdlog::warn("[auth] get_CookieManager failed");
        Finish(false, "cookie_manager_unavailable");
        PostMessageW(m_hwnd, WM_CLOSE, 0, 0);
        return;
    }

    // Pull every cookie under this WebView2 profile, then filter by
    // name. Passing nullptr matches cookies across all hosts (vrchat.com
    // *and* api.vrchat.cloud) so we don't miss the ones VRChat sets on
    // the API subdomain at login time.
    const HRESULT hr = cookieManager->GetCookies(
        nullptr,
        Microsoft::WRL::Callback<ICoreWebView2GetCookiesCompletedHandler>(
            [this](HRESULT result, ICoreWebView2CookieList* list) noexcept -> HRESULT
            {
                return OnCookiesResolved(result, list);
            })
            .Get());

    if (FAILED(hr))
    {
        spdlog::warn("[auth] cookieManager->GetCookies returned hr=0x{:08X}",
            static_cast<uint32_t>(hr));
        Finish(false, "cookie_fetch_failed");
        PostMessageW(m_hwnd, WM_CLOSE, 0, 0);
    }
}

HRESULT AuthLoginWindow::OnCookiesResolved(HRESULT result, ICoreWebView2CookieList* list)
{
    if (m_finished)
    {
        return S_OK;
    }

    if (FAILED(result) || list == nullptr)
    {
        // Keep the window open — the user may still be clicking around
        // on `/home` before the session is actually established.
        return S_OK;
    }

    UINT count = 0;
    if (FAILED(list->get_Count(&count)) || count == 0)
    {
        return S_OK;
    }

    std::string authCookie;
    std::string twoFactorCookie;
    for (UINT i = 0; i < count; ++i)
    {
        wil::com_ptr<ICoreWebView2Cookie> cookie;
        if (FAILED(list->GetValueAtIndex(i, cookie.put())) || cookie == nullptr)
        {
            continue;
        }

        const std::string name = CookieNameUtf8(cookie.get());
        if (name == "auth")
        {
            authCookie = CookieValueUtf8(cookie.get());
        }
        else if (name == "twoFactorAuth")
        {
            twoFactorCookie = CookieValueUtf8(cookie.get());
        }
    }

    if (authCookie.empty())
    {
        // No auth cookie yet. Don't dismiss — the user might still be
        // signing in. The next NavigationCompleted event will re-probe.
        return S_OK;
    }

    auto& store = vrcsm::core::AuthStore::Instance();
    store.SetCookies(authCookie, twoFactorCookie);
    if (!store.Save())
    {
        spdlog::warn("[auth] AuthStore::Save failed after cookie harvest");
    }
    else
    {
        spdlog::info("[auth] AuthStore updated from WebView2 login ({} + {} bytes)",
            authCookie.size(), twoFactorCookie.size());
    }

    Finish(true, {});
    PostMessageW(m_hwnd, WM_CLOSE, 0, 0);
    return S_OK;
}

void AuthLoginWindow::ResizeController() const
{
    if (m_controller == nullptr)
    {
        return;
    }
    RECT bounds{};
    GetClientRect(m_hwnd, &bounds);
    (void)m_controller->put_Bounds(bounds);
}

void AuthLoginWindow::Finish(bool ok, const std::string& error)
{
    if (m_finished)
    {
        return;
    }
    m_finished = true;

    // Stop the safety-net poll as soon as we know the outcome — otherwise
    // a stray timer tick fired after WM_CLOSE but before WM_NCDESTROY
    // could issue another GetCookies against a shutting-down webview.
    if (m_timerActive)
    {
        KillTimer(m_hwnd, kHarvestTimerId);
        m_timerActive = false;
    }

    if (m_callback)
    {
        auto cb = std::move(m_callback);
        m_callback = nullptr;
        cb(ok, error);
    }
}

} // namespace vrcsm::host
