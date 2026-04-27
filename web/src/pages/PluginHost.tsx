import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { usePluginRegistry } from "@/lib/plugin-context";

// PluginHost — renders an installed plugin's panel inside a sandboxed
// iframe whose origin is `plugin.<sanitised-id>.vrcsm`. The virtual
// host is mapped by the C++ WebViewHost::RefreshPluginMappings so the
// iframe fetches resources directly from the plugin's install
// directory via WebView2's SetVirtualHostNameToFolderMapping.
//
// Plugins call the host directly through chrome.webview.postMessage.
// WebViewHost tracks the originating plugin frame and IpcBridge routes
// everything through plugin.rpc so the permission gate sees the real
// plugin id. Keeping IPC at the frame/origin layer avoids trusting a
// parent-window relay that would lose caller identity.

function sanitiseForHostLabel(id: string): string {
  return id.replace(/\./g, "-");
}

export default function PluginHost() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { pluginId = "", "*": subpath = "" } = useParams<{ pluginId: string; "*": string }>();
  const { plugins, loading } = usePluginRegistry();

  const plugin = plugins.find((p) => p.id === pluginId) ?? null;

  const src = useMemo(() => {
    if (!plugin || !plugin.enabled || !plugin.virtualHost) return null;
    const entryRel = (plugin as unknown as { entry?: { panel?: string } }).entry?.panel || "index.html";
    const path = subpath || entryRel;
    const sep = path.includes("?") ? "&" : "?";
    const lang = encodeURIComponent(i18n.resolvedLanguage ?? i18n.language ?? "en");
    return `https://${plugin.virtualHost}/${path}${sep}lang=${lang}`;
  }, [i18n.language, i18n.resolvedLanguage, plugin, subpath]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-[hsl(var(--muted-foreground))]">
        {t("common.loading")}
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[12px] text-[hsl(var(--muted-foreground))]">
        <AlertTriangle className="size-8" />
        <span>{t("plugins.host.notInstalled", { id: pluginId })}</span>
        <button
          type="button"
          onClick={() => nav("/plugins/installed")}
          className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-[11px]"
        >
          {t("plugins.installed.title")}
        </button>
      </div>
    );
  }

  if (!plugin.enabled) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-[hsl(var(--muted-foreground))]">
        {t("plugins.host.disabled", { id: pluginId })}
      </div>
    );
  }

  if (!src) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-[hsl(var(--muted-foreground))]">
        {t("plugins.host.noPanel", { id: pluginId })}
      </div>
    );
  }

  const sanitisedLabel = sanitiseForHostLabel(plugin.id);
  return (
    <iframe
      key={pluginId /* recreate on nav to sibling plugin */}
      title={`plugin-${sanitisedLabel}`}
      src={src}
      className="h-full w-full border-0 bg-[hsl(var(--canvas))]"
      sandbox="allow-scripts allow-forms allow-same-origin"
    />
  );
}
