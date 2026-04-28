import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink, Package, AlertTriangle } from "lucide-react";
import { ipc, IpcError } from "@/lib/ipc";
import { usePluginRegistry } from "@/lib/plugin-context";
import type { MarketPluginEntry } from "@/lib/types";

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

export default function PluginDetail() {
  const { t } = useTranslation();
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { plugins, refresh: refreshInstalled } = usePluginRegistry();
  const [entry, setEntry] = useState<MarketPluginEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const installed = plugins.find((p) => p.id === id) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const feed = await ipc.pluginMarketFeed(false);
      const match = feed.plugins.find((p) => p.id === id) ?? null;
      setEntry(match);
      setError(match ? null : t("plugins.detail.notFound"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);

  const install = async () => {
    if (!entry?.download) return;
    const permissionLines = permissionTokens(entry.permissions).map((token) => `- ${token}`).join("\n");
    if (!window.confirm(`Install ${entry.name}?\n\nManifest permissions:\n${permissionLines}`)) return;
    setBusy(true);
    try {
      await ipc.pluginInstall({ url: entry.download, sha256: entry.sha256 });
      await refreshInstalled();
    } catch (e) {
      const msg = e instanceof IpcError ? `${e.code}: ${e.message}` :
                  e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async () => {
    setBusy(true);
    try {
      await ipc.pluginUninstall(id);
      await refreshInstalled();
    } catch (e) {
      const msg = e instanceof IpcError ? `${e.code}: ${e.message}` :
                  e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-[hsl(var(--muted-foreground))]">
        {t("common.loading")}
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[12px] text-[hsl(var(--muted-foreground))]">
        <AlertTriangle className="size-8" />
        <span>{error ?? t("plugins.detail.notFound")}</span>
        <button
          type="button"
          onClick={() => nav("/plugins")}
          className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-[11px]"
        >
          {t("plugins.detail.backToMarket")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <button
        type="button"
        onClick={() => nav("/plugins")}
        className="inline-flex w-fit items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ArrowLeft className="size-3.5" />
        {t("plugins.detail.backToMarket")}
      </button>

      <header className="flex items-start gap-3">
        {entry.iconUrl ? (
          <img
            src={entry.iconUrl}
            alt=""
            width={64}
            height={64}
            className="rounded-[var(--radius-sm)] bg-[hsl(var(--canvas))]"
          />
        ) : (
          <div className="grid size-16 place-items-center rounded-[var(--radius-sm)] bg-[hsl(var(--canvas))]">
            <Package className="size-6 text-[hsl(var(--muted-foreground))]" />
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-[18px] font-semibold">{entry.name}</h1>
          <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
            <span className="font-mono">{entry.id}</span> · v{entry.version} · {entry.shape}
          </div>
          {entry.authorName ? (
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("plugins.detail.by")} {entry.authorUrl ? (
                <a href={entry.authorUrl} target="_blank" rel="noreferrer" className="text-[hsl(var(--primary))] hover:underline">
                  {entry.authorName}
                </a>
              ) : entry.authorName}
            </div>
          ) : null}
          {entry.homepage ? (
            <a
              href={entry.homepage}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-[hsl(var(--primary))] hover:underline"
            >
              {t("plugins.detail.homepage")}
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          {installed ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={uninstall}
                className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-[11px] hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
              >
                {busy ? t("common.loading") : t("plugins.detail.uninstall")}
              </button>
              {installed.bundled ? (
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {t("plugins.detail.bundledHint")}
                </span>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              disabled={busy || !entry.download}
              onClick={install}
              className="inline-flex items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--primary))] px-4 py-1.5 text-[12px] font-medium text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary)/0.9)] disabled:opacity-50"
            >
              {busy ? t("plugins.market.installing") : t("plugins.market.install")}
            </button>
          )}
        </div>
      </header>

      {entry.description ? (
        <section>
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {t("plugins.detail.description")}
          </h2>
          <p className="mt-1 whitespace-pre-wrap text-[13px]">{entry.description}</p>
        </section>
      ) : null}

      <section>
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          {t("plugins.detail.metadata")}
        </h2>
        <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-[hsl(var(--muted-foreground))]">{t("plugins.detail.hostMin")}</dt>
          <dd className="font-mono">{entry.hostMin}</dd>
          {entry.sha256 ? (
            <>
              <dt className="text-[hsl(var(--muted-foreground))]">{t("plugins.detail.sha256")}</dt>
              <dd className="truncate font-mono text-[10.5px]">{entry.sha256}</dd>
            </>
          ) : null}
          {entry.download ? (
            <>
              <dt className="text-[hsl(var(--muted-foreground))]">{t("plugins.detail.downloadUrl")}</dt>
              <dd className="truncate font-mono text-[10.5px]">{entry.download}</dd>
            </>
          ) : null}
          <dt className="text-[hsl(var(--muted-foreground))]">
            {t("plugins.detail.permissions", { defaultValue: "Permissions" })}
          </dt>
          <dd>
            <PermissionTokens permissions={installed?.permissions ?? entry.permissions} />
          </dd>
        </dl>
      </section>

      {error ? (
        <div className="mt-auto rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.45)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-[12px]">
          {error}
        </div>
      ) : null}

      {installed ? (
        <Link
          to={`/p/${encodeURIComponent(installed.id)}`}
          className="w-fit rounded-[var(--radius-sm)] border border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.15)] px-3 py-1.5 text-[12px] font-medium text-[hsl(var(--primary))]"
        >
          {t("plugins.detail.open")}
        </Link>
      ) : null}
    </div>
  );
}
