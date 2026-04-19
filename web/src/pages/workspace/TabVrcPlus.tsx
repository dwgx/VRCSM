import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Crown, Sparkles, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { useAuth } from "@/lib/auth-context";
import type { AuthUserDetailsResult, AvatarHistoryResult, VrcSettingsReport } from "@/lib/types";
import { isJsonRecord, stringArrayField, scalarText, settingValueText } from "./workspace-utils";
import { SectionTitle } from "./WorkspaceCards";

/* ── regex matchers ─────────────────────────────────────────────────── */

const SUBSCRIPTION_RE = /support|subscription/i;
const MARKETPLACE_RE = /market|purchase|inventory|product|listing|balance|credit/i;

export default function TabVrcPlus() {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();

  /* ── Queries ────────────────────────────────────────────────────────── */

  const userQuery = useIpcQuery<undefined, AuthUserDetailsResult>(
    "auth.user",
    undefined,
    { enabled: authStatus.authed },
  );

  const settingsQuery = useIpcQuery<undefined, VrcSettingsReport>(
    "settings.readAll",
    undefined,
    { enabled: authStatus.authed },
  );

  const historyQuery = useIpcQuery<{ limit: number; offset: number }, AvatarHistoryResult>(
    "db.avatarHistory.list",
    { limit: 50, offset: 0 },
    { enabled: authStatus.authed },
  );

  /* ── Subscription Status ────────────────────────────────────────────── */

  const userRecord = useMemo(() => {
    const u = userQuery.data?.user;
    return isJsonRecord(u) ? u : null;
  }, [userQuery.data]);

  const userTags = useMemo(() => stringArrayField(userRecord, "tags"), [userRecord]);
  const isSupporter = useMemo(() => userTags.some((t) => t === "system_supporter"), [userTags]);

  const subscriptionSignals = useMemo(() => {
    if (!userRecord) return [];
    const out: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(userRecord)) {
      if (!SUBSCRIPTION_RE.test(key)) continue;
      const text = scalarText(value);
      if (text) out.push({ key, value: text });
    }
    return out;
  }, [userRecord]);

  const lastExpired = useMemo(() => {
    const entries = settingsQuery.data?.entries ?? [];
    const match = entries.find((e) => e.key === "LastExpiredSubscription");
    return settingValueText(match ?? null);
  }, [settingsQuery.data]);

  /* ── Marketplace Stats ──────────────────────────────────────────────── */

  const marketplaceSignals = useMemo(() => {
    if (!userRecord) return [];
    const out: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(userRecord)) {
      if (!MARKETPLACE_RE.test(key)) continue;
      const text = scalarText(value);
      if (text) out.push({ key, value: text });
    }
    return out;
  }, [userRecord]);

  /* ── Top Creators ───────────────────────────────────────────────────── */

  const topCreators = useMemo(() => {
    const items = historyQuery.data?.items ?? [];
    const counts = new Map<string, number>();
    for (const item of items) {
      const name = item.author_name?.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }, [historyQuery.data]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* ── Subscription Status ────────────────────────────────────────── */}
      <Card elevation="flat">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <Crown className="size-4 text-[hsl(var(--primary))]" />
            {t("vrchatWorkspace.subscriptionsTitle", { defaultValue: "Subscriptions" })}
          </CardTitle>
          <CardDescription className="text-[11px]">
            {t("vrchatWorkspace.subscriptionsBody", {
              defaultValue: "Supporter and subscription state inferred from the authenticated user payload.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Status badge */}
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[hsl(var(--border))] px-3 py-2">
              <span className="text-[12px] font-medium text-[hsl(var(--foreground))]">
                {t("vrchatWorkspace.subscriptionStatus", { defaultValue: "Status" })}
              </span>
              <Badge variant={isSupporter ? "success" : "muted"}>
                {isSupporter
                  ? t("vrchatWorkspace.subscriptionActive", { defaultValue: "Active" })
                  : t("vrchatWorkspace.subscriptionInactive", { defaultValue: "Inactive" })}
              </Badge>
            </div>

            {/* Subscription signals from user payload */}
            {subscriptionSignals.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                  {t("vrchatWorkspace.subscriptionSignals", { defaultValue: "Signals" })}
                </div>
                {subscriptionSignals.map(({ key }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1 text-[11px] hover:bg-[hsl(var(--surface-raised))]"
                  >
                    <span className="font-mono text-[hsl(var(--muted-foreground))]">{key}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {t("vrchatWorkspace.liveSignal", { defaultValue: "Live signal" })}
                    </Badge>
                  </div>
                ))}
              </div>
            )}

            {/* Last expired from VRC settings */}
            {lastExpired && (
              <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[hsl(var(--border))] px-3 py-2">
                <span className="text-[12px] text-[hsl(var(--muted-foreground))]">
                  {t("vrchatWorkspace.lastExpiredSubscription", { defaultValue: "Last expired" })}
                </span>
                <span className="text-[12px] font-medium text-[hsl(var(--foreground))]">{lastExpired}</span>
              </div>
            )}

            {subscriptionSignals.length === 0 && !lastExpired && !isSupporter && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {t("vrchatWorkspace.noSubscriptionSignals", {
                  defaultValue: "No dedicated subscription fields were exposed by this session.",
                })}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Marketplace Stats ──────────────────────────────────────────── */}
      <Card elevation="flat">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <Sparkles className="size-4 text-[hsl(var(--primary))]" />
            {t("vrchatWorkspace.marketplaceTitle", { defaultValue: "Marketplace" })}
          </CardTitle>
          <CardDescription className="text-[11px]">
            {t("vrchatWorkspace.marketplaceBody", {
              defaultValue: "Commerce-related fields exposed by the active VRChat session.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {marketplaceSignals.length === 0 ? (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("vrchatWorkspace.noMarketplaceSignals", {
                defaultValue: "No marketplace signals detected in the current session.",
              })}
            </p>
          ) : (
            <div className="space-y-1.5">
              {marketplaceSignals.map(({ key, value }) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-[11px] hover:bg-[hsl(var(--surface-raised))]"
                >
                  <span className="font-mono text-[hsl(var(--muted-foreground))]">{key}</span>
                  <span className="text-[hsl(var(--foreground))]">{value}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Top Creators ───────────────────────────────────────────────── */}
      <Card elevation="flat" className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <TrendingUp className="size-4 text-[hsl(var(--primary))]" />
            <SectionTitle
              title={t("vrchatWorkspace.topCreators", { defaultValue: "Top creators in local inventory" })}
              count={topCreators.length}
            />
          </CardTitle>
          <CardDescription className="text-[11px]">
            {t("vrchatWorkspace.inventoryBody", {
              defaultValue: "Most common avatar authors across your recent avatar history.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topCreators.length === 0 ? (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("vrchatWorkspace.noInventory", {
                defaultValue: "No persisted avatar history yet. Wear avatars or inspect them to let VRCSM build inventory.",
              })}
            </p>
          ) : (
            <div className="space-y-1.5">
              {topCreators.map(({ name, count }) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors hover:bg-[hsl(var(--surface-raised))]"
                >
                  <span className="text-[12px] font-medium text-[hsl(var(--foreground))]">{name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {t("vrchatWorkspace.inventoryCount", { defaultValue: "{{count}} avatars", count })}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
