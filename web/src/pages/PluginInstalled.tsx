import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Package, Trash2, Power, PowerOff, ExternalLink, AlertTriangle } from "lucide-react";
import { ipc, IpcError } from "@/lib/ipc";
import { usePluginRegistry } from "@/lib/plugin-context";
import { pluginDisplayName } from "@/lib/plugin-i18n";
import { cn } from "@/lib/utils";

function PermissionTokens({ permissions }: { permissions?: string[] }) {
  const tokens = permissions && permissions.length > 0 ? permissions : ["none"];
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tokens.map((token) => (
        <span
          key={token}
          className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--muted-foreground))]"
        >
          {token}
        </span>
      ))}
    </div>
  );
}

export default function PluginInstalled() {
  const { t, i18n } = useTranslation();
  const { plugins, loading, refresh } = usePluginRegistry();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      const msg = e instanceof IpcError ? `${e.code}: ${e.message}` :
                  e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-semibold">{t("plugins.installed.title")}</h1>
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("plugins.installed.subtitle")}
          </p>
        </div>
        <Link
          to="/plugins"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-[12px] font-medium hover:bg-[hsl(var(--surface-raised))]"
        >
          <Package className="size-3.5" />
          {t("plugins.installed.openMarket")}
        </Link>
      </header>

      {error ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.45)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-[12px]">
          <AlertTriangle className="size-4 text-[hsl(var(--destructive))]" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="text-[12px] text-[hsl(var(--muted-foreground))]">{t("common.loading")}</div>
      ) : plugins.length === 0 ? (
        <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 py-8 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("plugins.installed.empty")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[hsl(var(--border))]">
          <table className="w-full text-[12px]">
            <thead className="bg-[hsl(var(--surface-raised))] text-left text-[10.5px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <tr>
                <th className="px-3 py-2">{t("plugins.installed.col.name")}</th>
                <th className="px-3 py-2">{t("plugins.installed.col.version")}</th>
                <th className="px-3 py-2">{t("plugins.installed.col.shape")}</th>
                <th className="px-3 py-2">{t("plugins.installed.col.status")}</th>
                <th className="px-3 py-2">{t("plugins.installed.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {plugins.map((p) => {
                const busy = busyId === p.id;
                const canOpen = p.enabled && (p.shape === "panel" || p.shape === "app");
                return (
                  <tr key={p.id} className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised)/0.5)]">
                    <td className="px-3 py-2">
                      <div className="font-medium">{pluginDisplayName(p, i18n.resolvedLanguage ?? i18n.language)}</div>
                      <div className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{p.id}</div>
                      <PermissionTokens permissions={p.permissions} />
                    </td>
                    <td className="px-3 py-2 font-mono">{p.version}</td>
                    <td className="px-3 py-2 uppercase text-[10.5px] tracking-wide text-[hsl(var(--muted-foreground))]">
                      {p.shape}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-[var(--radius-sm)] px-2 py-0.5 text-[10.5px]",
                          p.enabled
                            ? "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                            : "bg-[hsl(var(--muted-foreground)/0.16)] text-[hsl(var(--muted-foreground))]",
                        )}
                      >
                        {p.enabled ? t("plugins.installed.enabled") : t("plugins.installed.disabled")}
                      </span>
                      {p.bundled ? (
                        <span className="ml-1 rounded-[var(--radius-sm)] bg-[hsl(var(--muted-foreground)/0.12)] px-2 py-0.5 text-[10.5px] text-[hsl(var(--muted-foreground))]">
                          {t("plugins.installed.bundled")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {canOpen ? (
                          <Link
                            to={`/p/${encodeURIComponent(p.id)}`}
                            title={t("plugins.installed.open")}
                            className="inline-flex items-center rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1.5 hover:bg-[hsl(var(--surface-raised))]"
                          >
                            <ExternalLink className="size-3.5" />
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(p.id, () =>
                            p.enabled ? ipc.pluginDisable(p.id) : ipc.pluginEnable(p.id),
                          )}
                          title={p.enabled ? t("plugins.installed.disable") : t("plugins.installed.enable")}
                          className="inline-flex items-center rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1.5 hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
                        >
                          {p.enabled ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                        </button>
                        <button
                          type="button"
                          disabled={busy || p.bundled}
                          onClick={() => run(p.id, () => ipc.pluginUninstall(p.id))}
                          title={p.bundled ? t("plugins.installed.bundledHint") : t("plugins.installed.uninstall")}
                          className="inline-flex items-center rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--surface))] p-1.5 text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.08)] disabled:opacity-30"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
