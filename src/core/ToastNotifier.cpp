#include "../pch.h"

#include "ToastNotifier.h"

#include "Common.h"

#include <string>
#include <string_view>

#include <Windows.h>
#include <wrl/client.h>
#include <wrl/wrappers/corewrappers.h>
#include <windows.ui.notifications.h>
#include <windows.data.xml.dom.h>
#include <roapi.h>
#include <shobjidl_core.h>
#include <shlobj.h>
#include <propkey.h>
#include <propvarutil.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

// ─────────────────────────────────────────────────────────────────────────
// ToastNotifier — native Windows Action Center toasts for an *unpackaged*
// Win32 app via WinRT Windows.UI.Notifications (Approach A from
// docs/wave2-research/wave3-win-toast.md). No Windows App SDK, no Electron,
// no tray balloon.
//
// Unpackaged apps have no package identity, so:
//   1. The process must declare an AppUserModelID (AUMID) at startup via
//      SetCurrentProcessExplicitAppUserModelID.
//   2. A Start-menu .lnk carrying System.AppUserModel.ID == the same AUMID
//      must exist, or Windows silently drops every toast.
//   3. CreateToastNotifier must be called *WithId(AUMID)* — the
//      parameterless overload is for packaged apps only.
//
// All failure modes (notifications disabled by policy, RoActivateInstance
// failure, missing shortcut) are swallowed: this is a decorative side
// channel exactly like DiscordRpc, never a hard error to the rest of the app.
//
// ABI signatures below were read verbatim from the installed Windows SDK
// header (10.0.28000.0) windows.ui.notifications.h / windows.data.xml.dom.h:
//   IToastNotificationManagerStatics::{GetTemplateContent,CreateToastNotifierWithId}
//   IToastNotificationFactory::CreateToastNotification
//   IToastNotifier::Show
//   IXmlDocumentIO::LoadXml
// Nothing here is invented; the LoadXml-from-string path (research §4
// "Modern alternative") avoids the verbose DOM-mutation ABI.
// ─────────────────────────────────────────────────────────────────────────

using namespace Microsoft::WRL;
using namespace Microsoft::WRL::Wrappers;
using namespace ABI::Windows::UI::Notifications;
namespace XmlDom = ABI::Windows::Data::Xml::Dom;

namespace
{

// Stable AUMID, reused everywhere (process + shortcut). Matches the WiX
// Manufacturer "dwgx" + registry path Software\dwgx\VRCSM.
constexpr wchar_t kAumid[] = L"dwgx.VRCSM";
constexpr wchar_t kShortcutName[] = L"VRCSM.lnk";

// RAII for an HSTRING created from a wide string. CreateToastNotifierWithId
// etc. take HSTRINGs; HStringReference would dangle on a temporary, so we
// own the backing buffer for the duration of the call.
class ScopedHString
{
public:
    explicit ScopedHString(const std::wstring& s)
    {
        // WindowsCreateString copies the buffer, so `s` need not outlive us.
        if (FAILED(WindowsCreateString(s.c_str(),
                                       static_cast<UINT32>(s.size()),
                                       &m_handle)))
        {
            m_handle = nullptr;
        }
    }
    ~ScopedHString()
    {
        if (m_handle) WindowsDeleteString(m_handle);
    }
    ScopedHString(const ScopedHString&) = delete;
    ScopedHString& operator=(const ScopedHString&) = delete;

    HSTRING get() const { return m_handle; }
    bool valid() const { return m_handle != nullptr; }

private:
    HSTRING m_handle{nullptr};
};

// Create the Start-menu shortcut carrying System.AppUserModel.ID if it does
// not already exist. Idempotent + best-effort: mirrors the InstallShortcut
// pattern from Microsoft's desktop-toast sample. Returns S_OK if the
// shortcut exists or was created.
HRESULT CreateShortcutIfMissing()
{
    // %APPDATA%\Microsoft\Windows\Start Menu\Programs\VRCSM.lnk
    wil::unique_cotaskmem_string roaming;
    HRESULT hr = SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &roaming);
    if (FAILED(hr) || !roaming)
    {
        return FAILED(hr) ? hr : E_FAIL;
    }

    std::filesystem::path lnkPath(roaming.get());
    lnkPath /= L"Microsoft";
    lnkPath /= L"Windows";
    lnkPath /= L"Start Menu";
    lnkPath /= L"Programs";
    lnkPath /= kShortcutName;

    std::error_code ec;
    if (std::filesystem::exists(lnkPath, ec))
    {
        return S_OK; // already installed (MSI path or a previous run)
    }

    // Resolve our own exe path for the shortcut target.
    wchar_t exePath[MAX_PATH] = {};
    if (GetModuleFileNameW(nullptr, exePath, MAX_PATH) == 0)
    {
        return HRESULT_FROM_WIN32(GetLastError());
    }

    ComPtr<IShellLinkW> shellLink;
    hr = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                          IID_PPV_ARGS(&shellLink));
    if (FAILED(hr)) return hr;

    shellLink->SetPath(exePath);

    ComPtr<IPropertyStore> propStore;
    hr = shellLink.As(&propStore);
    if (FAILED(hr)) return hr;

    PROPVARIANT pv;
    hr = InitPropVariantFromString(kAumid, &pv);
    if (FAILED(hr)) return hr;
    hr = propStore->SetValue(PKEY_AppUserModel_ID, pv);
    PropVariantClear(&pv);
    if (FAILED(hr)) return hr;
    hr = propStore->Commit();
    if (FAILED(hr)) return hr;

    ComPtr<IPersistFile> persistFile;
    hr = shellLink.As(&persistFile);
    if (FAILED(hr)) return hr;

    return persistFile->Save(lnkPath.c_str(), TRUE);
}

} // namespace

namespace vrcsm::core
{

std::string XmlEscape(const std::string& raw)
{
    std::string out;
    out.reserve(raw.size());
    for (const char c : raw)
    {
        switch (c)
        {
        case '&':  out += "&amp;";  break;
        case '<':  out += "&lt;";   break;
        case '>':  out += "&gt;";   break;
        case '"':  out += "&quot;"; break;
        case '\'': out += "&apos;"; break;
        default:   out += c;        break;
        }
    }
    return out;
}

std::string BuildToastXml(const ToastContent& content)
{
    // ToastText02: one bold heading line (id=1) + one wrapped body (id=2).
    std::string launchAttr;
    if (content.launchArg.has_value() && !content.launchArg->empty())
    {
        launchAttr = fmt::format(R"( launch="{}" activationType="foreground")",
                                 XmlEscape(*content.launchArg));
    }

    return fmt::format(
        "<toast{}>"
        "<visual>"
        "<binding template=\"ToastText02\">"
        "<text id=\"1\">{}</text>"
        "<text id=\"2\">{}</text>"
        "</binding>"
        "</visual>"
        "</toast>",
        launchAttr,
        XmlEscape(content.title),
        XmlEscape(content.body));
}

std::optional<ToastContent> FormatPipelineToast(const std::string& type,
                                                const nlohmann::json& content)
{
    // Treat content as untrusted: validate every access, never assume shape.
    if (!content.is_object())
    {
        return std::nullopt;
    }

    auto stringField = [&content](const char* key) -> std::optional<std::string> {
        auto it = content.find(key);
        if (it != content.end() && it->is_string() && !it->get<std::string>().empty())
        {
            return it->get<std::string>();
        }
        return std::nullopt;
    };

    if (type == "friend-online")
    {
        // { userId, user: { displayName, ... } }
        std::optional<std::string> displayName;
        auto userIt = content.find("user");
        if (userIt != content.end() && userIt->is_object())
        {
            auto nameIt = userIt->find("displayName");
            if (nameIt != userIt->end() && nameIt->is_string() &&
                !nameIt->get<std::string>().empty())
            {
                displayName = nameIt->get<std::string>();
            }
        }
        if (!displayName.has_value())
        {
            return std::nullopt; // a nameless "is now online" carries no signal
        }

        ToastContent out;
        out.kind = ToastKind::FriendOnline;
        out.title = *displayName;
        out.body = "is now online";
        if (auto userId = stringField("userId"))
        {
            out.launchArg = "vrcsm://user/" + *userId;
        }
        return out;
    }

    if (type == "notification" || type == "notification-v2")
    {
        // VRChat NotificationEntry. The inner `type` distinguishes invite
        // vs friendRequest; senderUsername is the human name.
        auto innerType = stringField("type");
        if (!innerType.has_value())
        {
            return std::nullopt;
        }

        const std::string sender = stringField("senderUsername").value_or("");
        const auto senderUserId = stringField("senderUserId");

        if (*innerType == "friendRequest")
        {
            ToastContent out;
            out.kind = ToastKind::FriendRequest;
            out.title = "Friend request";
            out.body = sender.empty() ? "New friend request"
                                      : fmt::format("Friend request from {}", sender);
            if (senderUserId)
            {
                out.launchArg = "vrcsm://user/" + *senderUserId;
            }
            return out;
        }

        if (*innerType == "invite")
        {
            ToastContent out;
            out.kind = ToastKind::Invite;
            out.title = "Invite";
            out.body = sender.empty() ? "New invite"
                                      : fmt::format("Invite from {}", sender);
            if (senderUserId)
            {
                out.launchArg = "vrcsm://user/" + *senderUserId;
            }
            return out;
        }

        return std::nullopt; // other notification types are not toast-worthy here
    }

    return std::nullopt;
}

bool ToastNotifier::EnsureSetup()
{
    HRESULT hr = SetCurrentProcessExplicitAppUserModelID(kAumid);
    if (FAILED(hr))
    {
        spdlog::warn("[toast] SetCurrentProcessExplicitAppUserModelID failed: {:#x}",
                     static_cast<unsigned>(hr));
    }

    hr = CreateShortcutIfMissing();
    if (FAILED(hr))
    {
        spdlog::warn("[toast] Start-menu shortcut setup failed: {:#x} — "
                     "toasts may not appear until a shortcut exists",
                     static_cast<unsigned>(hr));
        return false;
    }
    return true;
}

bool ToastNotifier::ShowToast(const std::wstring& title,
                              const std::wstring& body,
                              const std::optional<std::wstring>& launchArg)
{
    ToastContent c;
    c.kind = ToastKind::FriendOnline; // unused by ShowToast itself
    c.title = toUtf8(title);
    c.body = toUtf8(body);
    if (launchArg.has_value())
    {
        c.launchArg = toUtf8(*launchArg);
    }
    return ShowToast(c);
}

bool ToastNotifier::ShowToast(const ToastContent& content)
{
    // The host initializes COM as STA (OleInitialize in main.cpp). WinRT
    // toast creation works from an STA apartment; do not re-init here to
    // avoid an apartment clash on the calling thread (the Pipeline thread
    // may be MTA — RoGetActivationFactory works in either apartment for
    // these statics). We tolerate RPC_E_CHANGED_MODE by ignoring init.
    //
    // RoInitialize must be balanced: only when it actually takes (S_OK /
    // S_FALSE) do we own an init refcount that has to be released. A failure
    // such as RPC_E_CHANGED_MODE means a different apartment was already
    // initialized on this thread — we did NOT acquire a refcount, so we must
    // not call RoUninitialize. The guard is declared before every ComPtr so
    // it tears down last (after all WinRT interfaces are released).
    struct RoInitGuard
    {
        bool owned = false;
        ~RoInitGuard() { if (owned) RoUninitialize(); }
    } roGuard;
    {
        const HRESULT initHr = RoInitialize(RO_INIT_MULTITHREADED);
        roGuard.owned = SUCCEEDED(initHr); // S_OK or S_FALSE → we own the init
    }

    // 1. ToastNotificationManager statics.
    ComPtr<IToastNotificationManagerStatics> mgr;
    HRESULT hr = RoGetActivationFactory(
        HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotificationManager).Get(),
        IID_PPV_ARGS(&mgr));
    if (FAILED(hr))
    {
        spdlog::warn("[toast] no ToastNotificationManager: {:#x}", static_cast<unsigned>(hr));
        return false;
    }

    // 2. Build the XML document by loading our generated string. XmlDocument
    //    is RoActivateInstance-able; query IXmlDocumentIO for LoadXml.
    ComPtr<IInspectable> xmlInspectable;
    hr = RoActivateInstance(
        HStringReference(RuntimeClass_Windows_Data_Xml_Dom_XmlDocument).Get(),
        &xmlInspectable);
    if (FAILED(hr)) return false;

    ComPtr<XmlDom::IXmlDocument> xmlDoc;
    hr = xmlInspectable.As(&xmlDoc);
    if (FAILED(hr)) return false;

    ComPtr<XmlDom::IXmlDocumentIO> xmlIo;
    hr = xmlDoc.As(&xmlIo);
    if (FAILED(hr)) return false;

    const std::wstring xml = toWide(BuildToastXml(content));
    ScopedHString xmlHstr(xml);
    if (!xmlHstr.valid()) return false;
    hr = xmlIo->LoadXml(xmlHstr.get());
    if (FAILED(hr))
    {
        spdlog::warn("[toast] LoadXml failed: {:#x}", static_cast<unsigned>(hr));
        return false;
    }

    // 3. Build the IToastNotification from the factory.
    ComPtr<IToastNotificationFactory> factory;
    hr = RoGetActivationFactory(
        HStringReference(RuntimeClass_Windows_UI_Notifications_ToastNotification).Get(),
        IID_PPV_ARGS(&factory));
    if (FAILED(hr)) return false;

    ComPtr<IToastNotification> toast;
    hr = factory->CreateToastNotification(xmlDoc.Get(), &toast);
    if (FAILED(hr)) return false;

    // 4. CreateToastNotifierWithId(AUMID) — REQUIRED for unpackaged apps.
    ComPtr<IToastNotifier> notifier;
    ScopedHString aumidHstr(kAumid);
    if (!aumidHstr.valid()) return false;
    hr = mgr->CreateToastNotifierWithId(aumidHstr.get(), &notifier);
    if (FAILED(hr))
    {
        spdlog::warn("[toast] CreateToastNotifierWithId failed: {:#x}",
                     static_cast<unsigned>(hr));
        return false;
    }

    hr = notifier->Show(toast.Get());
    if (FAILED(hr))
    {
        spdlog::warn("[toast] Show failed: {:#x}", static_cast<unsigned>(hr));
        return false;
    }
    return true;
}

} // namespace vrcsm::core
