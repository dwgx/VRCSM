import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Link2, Shield, Users2, VolumeX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { useAuth } from "@/lib/auth-context";
import type { AuthUserDetailsResult, WorkspaceGroupsResult, WorkspaceModerationsResult } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { isJsonRecord, findScalarField, moderationLabel, moderationVariant } from "./workspace-utils";
import { SectionTitle } from "./WorkspaceCards";

/* ── provider definitions for the Account Links section ─────────────── */

const PROVIDERS = [
  { key: "steam", label: "Steam" },
  { key: "oculus", label: "Oculus" },
  { key: "meta", label: "Meta" },
  { key: "viveport", label: "Viveport" },
  { key: "pico", label: "Pico" },
  { key: "google", label: "Google" },
  { key: "email", label: "Email" },
] as const;

export default function TabSocial() {
  const { t } = useTranslation();
  const { status: authStatus } = useAuth();

  /* ── Groups ─────────────────────────────────────────────────────────── */

  const groupsQuery = useIpcQuery<undefined, WorkspaceGroupsResult>(
    "groups.list",
    undefined,
    { enabled: authStatus.authed },
  );

  const sortedGroups = useMemo(() => {
    const raw = groupsQuery.data?.groups ?? [];
    return [...raw].sort((a, b) => {
      if (a.isRepresenting !== b.isRepresenting) return a.isRepresenting ? -1 : 1;
      return (b.onlineMemberCount ?? 0) - (a.onlineMemberCount ?? 0);
    });
  }, [groupsQuery.data]);

  /* ── Blocks & Mutes ─────────────────────────────────────────────────── */

  const modsQuery = useIpcQuery<undefined, WorkspaceModerationsResult>(
    "moderations.list",
    undefined,
    { enabled: authStatus.authed },
  );

  const sortedModerations = useMemo(() => {
    const raw = modsQuery.data?.items ?? [];
    return [...raw].sort((a, b) => {
      const da = a.created ? new Date(a.created).getTime() : 0;
      const db = b.created ? new Date(b.created).getTime() : 0;
      return db - da;
    });
  }, [modsQuery.data]);

  const blockCount = useMemo(
    () => sortedModerations.filter((m) => (m.type || "").toLowerCase() === "block").length,
    [sortedModerations],
  );
  const muteCount = useMemo(
    () => sortedModerations.filter((m) => (m.type || "").toLowerCase() === "mute").length,
    [sortedModerations],
  );

  /* ── Account Links ──────────────────────────────────────────────────── */

  const userQuery = useIpcQuery<undefined, AuthUserDetailsResult>(
    "auth.user",
    undefined,
    { enabled: authStatus.authed },
  );

  const userRecord = useMemo(() => {
    const u = userQuery.data?.user;
    return isJsonRecord(u) ? u : null;
  }, [userQuery.data]);

  const providerLinks = useMemo(() => {
    if (!userRecord) return [];
    return PROVIDERS.map(({ key, label }) => {
      const found = findScalarField(userRecord, [key, `${key}Id`, `${key}_id`, `${key}Username`]);
      return { label, linked: !!found, value: found?.value ?? null };
    });
  }, [userRecord]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* ── Groups ─────────────────────────────────────────────────────── */}
      <Card elevation="flat">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <Users2 className="size-4 text-[hsl(var(--primary))]" />
            <SectionTitle
              title={t("vrchatWorkspace.groupsTitle", { defaultValue: "Groups" })}
              count={sortedGroups.length}
            />
          </CardTitle>
          <CardDescription className="text-[11px]">
            {t("vrchatWorkspace.groupsBody", {
              defaultValue: "Your VRChat groups from the signed-in session.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedGroups.length === 0 ? (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("vrchatWorkspace.noGroups", { defaultValue: "No groups were returned for this account." })}
            </p>
          ) : (
            <ScrollArea className="max-h-[320px]">
              <div className="space-y-1.5">
                {sortedGroups.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors hover:bg-[hsl(var(--surface-raised))]"
                  >
                    {g.iconUrl ? (
                      <img
                        src={g.iconUrl}
                        alt={g.name}
                        className="size-8 shrink-0 rounded-[var(--radius-sm)] object-cover"
                      />
                    ) : (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                        <Users2 className="size-3.5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] font-medium text-[hsl(var(--foreground))]">
                          {g.name}
                        </span>
                        {g.isRepresenting && (
                          <Badge variant="default" className="text-[9px] px-1.5 py-0">
                            {t("vrchatWorkspace.representing", { defaultValue: "Representing" })}
                          </Badge>
                        )}
                        {g.isVerified && (
                          <Badge variant="success" className="text-[9px] px-1.5 py-0">
                            {t("vrchatWorkspace.verified", { defaultValue: "Verified" })}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                        <span>{g.memberCount.toLocaleString()} members</span>
                        <span className="text-[hsl(var(--success))]">{g.onlineMemberCount} online</span>
                        {g.shortCode && (
                          <span className="font-mono">{g.shortCode}{g.discriminator ? `.${g.discriminator}` : ""}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* ── Blocks & Mutes ─────────────────────────────────────────────── */}
      <Card elevation="flat">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <Shield className="size-4 text-[hsl(var(--primary))]" />
            <SectionTitle
              title={t("vrchatWorkspace.blocksMutesTitle", { defaultValue: "Blocks & Mutes" })}
              count={sortedModerations.length}
            />
          </CardTitle>
          <CardDescription className="text-[11px]">
            {t("vrchatWorkspace.blocksMutesBody", {
              defaultValue: "Current player moderation entries pulled from your signed-in VRChat session.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedModerations.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <Badge variant="warning" className="gap-1">
                <Ban className="size-3" />
                {blockCount} {t("vrchatWorkspace.blocked", { defaultValue: "Blocked" })}
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <VolumeX className="size-3" />
                {muteCount} {t("vrchatWorkspace.muted", { defaultValue: "Muted" })}
              </Badge>
            </div>
          )}

          {sortedModerations.length === 0 ? (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {t("vrchatWorkspace.noModerations", {
                defaultValue: "No block or mute entries were returned for this account.",
              })}
            </p>
          ) : (
            <ScrollArea className="max-h-[280px]">
              <div className="space-y-1">
                {sortedModerations.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors hover:bg-[hsl(var(--surface-raised))]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={moderationVariant(m)} className="shrink-0 text-[10px]">
                        {moderationLabel(m, t)}
                      </Badge>
                      <span className="truncate text-[12px] text-[hsl(var(--foreground))]">
                        {m.targetDisplayName ?? m.targetUserId ?? "—"}
                      </span>
                    </div>
                    <span className="shrink-0 text-[10px] text-[hsl(var(--muted-foreground))]">
                      {formatDate(m.created)}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* ── Account Links ──────────────────────────────────────────────── */}
      <Card elevation="flat" className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <Link2 className="size-4 text-[hsl(var(--primary))]" />
            {t("vrchatWorkspace.accountLinkTitle", { defaultValue: "Account Links" })}
          </CardTitle>
          <CardDescription className="text-[11px]">
            {t("vrchatWorkspace.accountLinkBody", {
              defaultValue: "Linked platform and identity fields resolved from the signed-in VRChat session.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {providerLinks.map(({ label, linked, value }) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[hsl(var(--border))] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-[hsl(var(--foreground))]">{label}</div>
                  {linked && value && (
                    <div className="truncate text-[10px] text-[hsl(var(--muted-foreground))]">{value}</div>
                  )}
                </div>
                <Badge variant={linked ? "success" : "muted"} className="shrink-0 text-[10px]">
                  {linked
                    ? t("vrchatWorkspace.linked", { defaultValue: "Linked" })
                    : t("vrchatWorkspace.notLinked", { defaultValue: "Not linked" })}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
