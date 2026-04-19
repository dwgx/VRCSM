import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { usePluginRegistry } from "@/lib/plugin-context";

// PluginHost — renders an installed plugin's panel inside a sandboxed
// iframe whose origin is `plugin.<sanitised-id>.vrcsm`. The virtual
// host is mapped by the C++ WebViewHost::RefreshPluginMappings so the
// iframe fetches resources directly from the plugin's install
// directory via WebView2's SetVirtualHostNameToFolderMapping.
//
// The postMessage relay is intentionally minimal: plugins call
// `window.parent.postMessage({__vrcsm:"ipc", id, method, params}, "*")`
// and we bounce the payload into ipc.pluginRpc which enforces the
// permission gate on the host side. Responses and events arrive at
// the host-level onMessage stream and are tagged with the originating
// plugin id so we only route replies back to the right iframe.
//
// Plugins CANNOT call chrome.webview directly from their own iframe
// because SetVirtualHostNameToFolderMapping is DENY_CORS — they must
// go through this relay, which in turn goes through plugin.rpc.

function sanitiseForHostLabel(id: string): string {
  return id.replace(/\./g, "-");
}

export default function PluginHost() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { pluginId = "", "*": subpath = "" } = useParams<{ pluginId: string; "*": string }>();
  const { plugins, loading } = usePluginRegistry();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pendingByOriginId = useRef<Map<string, { source: MessageEventSource | null; origin: string }>>(new Map());

  const plugin = plugins.find((p) => p.id === pluginId) ?? null;

  const src = useMemo(() => {
    if (!plugin || !plugin.enabled || !plugin.virtualHost) return null;
    const entryRel = (plugin as unknown as { entry?: { panel?: string } }).entry?.panel || "index.html";
    const path = subpath || entryRel;
    return `https://${plugin.virtualHost}/${path}`;
  }, [plugin, subpath]);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      // Only react to messages from our iframe. The source check is
      // belt-and-braces — WebView2 already isolates origins via
      // DENY_CORS, so a random window.top call from elsewhere would
      // never have a handle on this listener's postMessage stream.
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return;
      const data = ev.data as { __vrcsm?: string; id?: string; method?: string; params?: unknown };
      if (!data || data.__vrcsm !== "ipc" || typeof data.method !== "string") return;
      if (!pluginId) return;

      const localId = `${pluginId}:${data.id ?? Math.random().toString(36).slice(2)}`;
      pendingByOriginId.current.set(localId, { source: ev.source, origin: ev.origin });

      ipc.pluginRpc<unknown, unknown>(data.method, data.params)
        .then((result) => {
          const slot = pendingByOriginId.current.get(localId);
          if (!slot || !slot.source) return;
          (slot.source as Window).postMessage(
            { __vrcsm: "ipc-response", id: data.id, result },
            slot.origin,
          );
          pendingByOriginId.current.delete(localId);
        })
        .catch((err) => {
          const slot = pendingByOriginId.current.get(localId);
          if (!slot || !slot.source) return;
          (slot.source as Window).postMessage(
            {
              __vrcsm: "ipc-response",
              id: data.id,
              error: {
                code: (err && typeof err === "object" && "code" in err) ? (err as { code: string }).code : "plugin_rpc_failed",
                message: err instanceof Error ? err.message : String(err),
              },
            },
            slot.origin,
          );
          pendingByOriginId.current.delete(localId);
        });
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pluginId]);

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
      ref={iframeRef}
      key={pluginId /* recreate on nav to sibling plugin */}
      title={`plugin-${sanitisedLabel}`}
      src={src}
      className="h-full w-full border-0 bg-[hsl(var(--canvas))]"
      sandbox="allow-scripts allow-forms allow-same-origin"
    />
  );
}
