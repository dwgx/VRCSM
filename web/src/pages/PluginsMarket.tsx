import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Package, RefreshCw, CheckCircle2, AlertTriangle, Settings2 } from "lucide-react";
import { ipc, IpcError } from "@/lib/ipc";
import { usePluginRegistry } from "@/lib/plugin-context";
import type { MarketFeedDto, MarketPluginEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

function permissionTokens(permissions?: string[]): string[] {
  return permissions && permissions.length > 0 ? permissions : ["none"];
}

function PermissionTokens({ permissions }: { permissions?: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {permissionTokens(permissions).map((token) => (
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

export default function PluginsMarket() {
  const { t } = useTranslation();
  const { plugins: installed, refresh: refreshInstalled } = usePluginRegistry();
  const [feed, setFeed] = useState<MarketFeedDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [lastInstallError, setLastInstallError] = useState<string | null>(null);

  const load = useCallback(
    async (force: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await ipc.pluginMarketFeed(force);
        setFeed(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const installedIds = useMemo(() => new Set(installed.map((p) => p.id)), [installed]);

  const install = async (entry: MarketPluginEntry) => {
    if (!entry.download) return;
    const permissionLines = permissionTokens(entry.permissions).map((token) => `- ${token}`).join("\n");
    if (!window.confirm(`Install ${entry.name}?\n\nManifest permissions:\n${permissionLines}`)) return;
    setInstallingId(entry.id);
    setLastInstallError(null);
    try {
      await ipc.pluginInstall({
        url: entry.download,
        sha256: entry.sha256,
      });
      await refreshInstalled();
    } catch (e) {
      const msg =
        e instanceof IpcError ? `${e.code}: ${e.message}` :
        e instanceof Error ? e.message : String(e);
      setLastInstallError(msg);
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-semibold">{t("plugins.market.title")}</h1>
          <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("plugins.market.subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/plugins/installed"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-[12px] font-medium hover:bg-[hsl(var(--surface-raised))]"
          >
            <Settings2 className="size-3.5" />
            {t("plugins.installedLink")}
          </Link>
          <button
            type="button"
            onClick={() => { void load(true); }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-[12px] font-medium hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {t("plugins.market.refresh")}
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.06)] px-3 py-2.5 text-[12px]">
          <div className="flex items-center gap-2 font-medium text-[hsl(var(--destructive))]">
            <AlertTriangle className="size-4" />
            <span>{t("plugins.market.fetchError", { detail: error })}</span>
          </div>
          <div className="mt-1.5 pl-6 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
            {t("plugins.market.fetchErrorHint", {
              defaultValue:
                "The marketplace feed at dwgx.github.io/VRCSM/plugins.json is unreachable. Bundled plugins (Hello, VRChat Auto-Uploader) are still installed and work — open them from the sidebar. Only downloading new third-party plugins is blocked until the feed returns.",
            })}
            {" "}
            <Link to="/plugins/installed" className="underline hover:text-[hsl(var(--foreground))]">
              {t("plugins.installedLink")}
            </Link>
          </div>
        </div>
      ) : null}

      {lastInstallError ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.45)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-[12px]">
          <AlertTriangle className="size-4 text-[hsl(var(--destructive))]" />
          <span>{lastInstallError}</span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {feed?.plugins.map((entry) => {
          const isInstalled = installedIds.has(entry.id);
          const busy = installingId === entry.id;
          return (
            <article
              key={entry.id}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3"
            >
              <div className="flex items-start gap-2">
                {entry.iconUrl ? (
                  <img
                    src={entry.iconUrl}
                    alt=""
                    width={36}
                    height={36}
                    className="shrink-0 rounded-[var(--radius-sm)] bg-[hsl(var(--canvas))]"
                  />
                ) : (
                  <div className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[hsl(var(--canvas))]">
                    <Package className="size-4 text-[hsl(var(--muted-foreground))]" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/plugins/${encodeURIComponent(entry.id)}`}
                    className="block truncate text-[13px] font-semibold hover:text-[hsl(var(--primary))]"
                  >
                    {entry.name}
                  </Link>
                  <div className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
                    v{entry.version} · {entry.shape}
                    {entry.authorName ? ` · ${entry.authorName}` : ""}
                  </div>
                </div>
              </div>

              {entry.description ? (
                <p className="line-clamp-3 text-[12px] text-[hsl(var(--muted-foreground))]">
                  {entry.description}
                </p>
              ) : null}

              <PermissionTokens permissions={entry.permissions} />

              <div className="mt-auto flex items-center justify-between">
                <Link
                  to={`/plugins/${encodeURIComponent(entry.id)}`}
                  className="text-[11px] text-[hsl(var(--muted-foreground))] underline-offset-2 hover:text-[hsl(var(--foreground))] hover:underline"
                >
                  {t("plugins.market.details")}
                </Link>
                {isInstalled ? (
                  <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[hsl(var(--primary)/0.16)] px-2 py-0.5 text-[10.5px] text-[hsl(var(--primary))]">
                    <CheckCircle2 className="size-3" />
                    {t("plugins.market.installed")}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !entry.download}
                    onClick={() => { void install(entry); }}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[hsl(var(--primary))] px-3 py-1 text-[11px] font-medium text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary)/0.9)] disabled:opacity-50"
                  >
                    {busy ? t("plugins.market.installing") : t("plugins.market.install")}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {feed && feed.plugins.length === 0 && !loading ? (
        <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 py-6 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("plugins.market.empty")}
        </div>
      ) : null}
    </div>
  );
}
