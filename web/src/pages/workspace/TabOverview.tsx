/**
 * Overview tab — quick stats dashboard and navigation cards.
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Users,
  Shirt,
  Globe2,
  LibraryBig,
  UserCircle2,
  Compass,
  Shield,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { useAuth } from "@/lib/auth-context";
import type {
  FriendsListResult,
  WorkspaceGroupsResult,
  AuthUserDetailsResult,
} from "@/lib/types";
import { trustRank } from "@/lib/vrcFriends";
import { WorkspaceActionCard } from "./WorkspaceCards";
import { isJsonRecord, stringArrayField } from "./workspace-utils";

// ── Stat card ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: typeof Users;
  accent?: string;
}) {
  return (
    <Card elevation="flat">
      <CardContent className="flex items-center gap-3 p-3">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)]"
          style={{
            backgroundColor: accent
              ? `${accent}22`
              : "hsl(var(--primary) / 0.12)",
            color: accent ?? "hsl(var(--primary))",
          }}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
            {label}
          </div>
          <div className="text-[16px] font-semibold leading-tight text-[hsl(var(--foreground))]">
            {value}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Trust rank label ─────────────────────────────────────────────────────

function formatTrustRank(rank: string): string {
  switch (rank) {
    case "veteran":
      return "Trusted User";
    case "trusted":
      return "Known User";
    case "known":
      return "User";
    case "user":
      return "New User";
    case "new":
      return "New User";
    case "visitor":
      return "Visitor";
    case "troll":
      return "Nuisance";
    default:
      return rank;
  }
}

// ── Navigation card config ───────────────────────────────────────────────

interface NavCardDef {
  titleKey: string;
  descKey: string;
  icon: typeof Users;
  path: string;
}

const NAV_CARDS: NavCardDef[] = [
  {
    titleKey: "friends.title",
    descKey: "friends.subtitle",
    icon: Users,
    path: "/friends",
  },
  {
    titleKey: "avatars.title",
    descKey: "avatars.subtitle",
    icon: Shirt,
    path: "/avatars",
  },
  {
    titleKey: "nav.worlds",
    descKey: "vrchatWorkspace.groupsBody",
    icon: Globe2,
    path: "/worlds",
  },
  {
    titleKey: "nav.library",
    descKey: "library.subtitle",
    icon: LibraryBig,
    path: "/library",
  },
  {
    titleKey: "nav.profile",
    descKey: "profile.subtitle",
    icon: UserCircle2,
    path: "/profile",
  },
  {
    titleKey: "nav.dashboard",
    descKey: "dashboard.subtitle",
    icon: Compass,
    path: "/",
  },
];

// ── Main component ───────────────────────────────────────────────────────

export default function TabOverview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status: authStatus } = useAuth();

  const { data: friendsData } = useIpcQuery<undefined, FriendsListResult>(
    "friends.list",
    undefined as undefined,
    { enabled: authStatus.authed, staleTime: 30_000 },
  );

  const { data: groupsData } = useIpcQuery<undefined, WorkspaceGroupsResult>(
    "groups.list",
    undefined as undefined,
    { enabled: authStatus.authed, staleTime: 60_000 },
  );

  const { data: userDetails } = useIpcQuery<undefined, AuthUserDetailsResult>(
    "auth.user",
    undefined as undefined,
    { enabled: authStatus.authed, staleTime: 60_000 },
  );

  // Derive stats
  const onlineFriendsCount = (friendsData?.friends ?? []).filter(
    (f) => f.location && f.location !== "offline",
  ).length;

  const groupsCount = groupsData?.groups?.length ?? 0;

  const userPayload = userDetails?.user;
  const userTags = isJsonRecord(userPayload)
    ? stringArrayField(userPayload as Record<string, unknown>, "tags")
    : [];

  const rank = userTags.length > 0 ? trustRank(userTags) : null;
  const isVrcPlus = userTags.includes("system_supporter");

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Quick Stats */}
      <div>
        <h3 className="mb-3 text-[13px] font-semibold text-[hsl(var(--foreground))]">
          {t("vrchatWorkspace.title", { defaultValue: "VRChat Workspace" })}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label={t("friends.title", { defaultValue: "Friends" })}
            value={authStatus.authed ? String(onlineFriendsCount) : "--"}
            icon={Users}
            accent="#2BCF5C"
          />
          <StatCard
            label={t("vrchatWorkspace.groupsTitle", { defaultValue: "Groups" })}
            value={authStatus.authed ? String(groupsCount) : "--"}
            icon={Globe2}
            accent="#1778FF"
          />
          <StatCard
            label={t("friends.trust.label", { defaultValue: "Trust Rank" })}
            value={rank ? formatTrustRank(rank) : "--"}
            icon={Shield}
            accent="#8143E6"
          />
          <StatCard
            label="VRC+"
            value={
              !authStatus.authed
                ? "--"
                : isVrcPlus
                  ? t("vrchatWorkspace.subscriptionActive", { defaultValue: "Active" })
                  : t("vrchatWorkspace.subscriptionInactive", { defaultValue: "Inactive" })
            }
            icon={Sparkles}
            accent="#FFD000"
          />
        </div>
      </div>

      {/* Navigation Cards */}
      <div>
        <h3 className="mb-3 text-[13px] font-semibold text-[hsl(var(--foreground))]">
          {t("common.navigate", { defaultValue: "Navigate" })}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {NAV_CARDS.map((card) => (
            <WorkspaceActionCard
              key={card.path}
              icon={card.icon}
              title={t(card.titleKey, { defaultValue: card.titleKey })}
              body={t(card.descKey, { defaultValue: "" })}
              onClick={() => navigate(card.path)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
