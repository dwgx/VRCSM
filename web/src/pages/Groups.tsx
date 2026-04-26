import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  Crown,
  ExternalLink,
  Loader2,
  LogIn,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoginForm } from "@/components/LoginForm";
import { useIpcQuery } from "@/hooks/useIpcQuery";
import { useQueryClient } from "@tanstack/react-query";
import { subscribePipelineEvent } from "@/lib/pipeline-events";
import { useAuth } from "@/lib/auth-context";
import { ipc } from "@/lib/ipc";
import type { WorkspaceGroup, WorkspaceGroupsResult } from "@/lib/types";
import { ThumbImage } from "@/components/ThumbImage";

function compareGroups(a: WorkspaceGroup, b: WorkspaceGroup): number {
  if (a.isRepresenting !== b.isRepresenting) return a.isRepresenting ? -1 : 1;
  if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
  return (b.onlineMemberCount ?? 0) - (a.onlineMemberCount ?? 0);
}

export default function Groups() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [filter, setFilter] = useState("");
  // Optimistic pending flag for representation toggles so the button
  // shows a spinner while the PUT round-trips to VRChat and the
  // groups.list refetch reconciles the new state.
  const [pendingRepresentId, setPendingRepresentId] = useState<string | null>(null);

  const query = useIpcQuery<undefined, WorkspaceGroupsResult>(
    "groups.list",
    undefined,
    {
      enabled: status.authed,
      staleTime: 120_000,
    },
  );

  // Pipeline events that change group membership/roles invalidate the
  // cache so the page reflects server state without a manual refresh.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!status.authed) return;
    const types = [
      "group-joined",
      "group-left",
      "group-role-updated",
      "group-member-updated",
    ] as const;
    const unsubs = types.map((t) =>
      subscribePipelineEvent(t, () => {
        void queryClient.invalidateQueries({ queryKey: ["groups.list"] });
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [status.authed, queryClient]);

  const groups = useMemo(() => {
    const list = [...(query.data?.groups ?? [])].sort(compareGroups);
    const f = filter.trim().toLowerCase();
    if (!f) return list;
    return list.filter((g) => {
      const haystack = `${g.name} ${g.shortCode ?? ""} ${g.description ?? ""}`.toLowerCase();
      return haystack.includes(f);
    });
  }, [query.data, filter]);

  const representing = groups.find((g) => g.isRepresenting) ?? null;
  const onlineTotal = useMemo(
    () => groups.reduce((sum, g) => sum + (g.onlineMemberCount ?? 0), 0),
    [groups],
  );

  async function toggleRepresent(group: WorkspaceGroup) {
    if (pendingRepresentId) return;
    const target = !group.isRepresenting;
    setPendingRepresentId(group.id);
    try {
      await ipc.groupsSetRepresented(group.id, target);
      // Optimistic client patch: VRChat says setting true on a new group
      // auto-unsets any prior representation, so mirror that here and
      // let the bg refetch reconcile if the server disagrees.
      queryClient.setQueryData<WorkspaceGroupsResult>(
        ["groups.list", undefined],
        (prev) =>
          prev
            ? {
                ...prev,
                groups: prev.groups.map((g) =>
                  g.id === group.id
                    ? { ...g, isRepresenting: target }
                    : target && g.isRepresenting
                      ? { ...g, isRepresenting: false }
                      : g,
                ),
              }
            : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ["groups.list"] });
      toast.success(
        target
          ? t("groups.nowRepresenting", {
              defaultValue: "Representing {{name}}",
              name: group.name,
            })
          : t("groups.stoppedRepresenting", {
              defaultValue: "Stopped representing {{name}}",
              name: group.name,
            }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        t("groups.representFailed", {
          defaultValue: "Failed to update representation: {{error}}",
          error: msg,
        }),
      );
    } finally {
      setPendingRepresentId(null);
    }
  }

  if (!status.authed) {
    return (
      <div className="flex flex-col gap-4 animate-fade-in">
        <header>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("nav.groups", { defaultValue: "Groups" })}
          </h1>
        </header>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{t("friends.signInRequired")}</CardTitle>
            <CardDescription>{t("friends.signInRequiredBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="tonal" onClick={() => setLoginOpen(true)}>
              <LogIn />
              {t("auth.signInWithVrchat", { defaultValue: "Sign in with VRChat" })}
            </Button>
          </CardContent>
        </Card>
        <LoginForm open={loginOpen} onOpenChange={setLoginOpen} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("nav.groups", { defaultValue: "Groups" })}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("groups.subtitle", {
              defaultValue: "Every VRChat group you belong to — sorted by your representative first, then by online activity.",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <Input
              placeholder={t("groups.filterPlaceholder", { defaultValue: "Filter groups…" })}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 pl-7 text-[12px] w-52"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} />
            {t("common.refresh")}
          </Button>
        </div>
      </header>

      {/* Stats strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("groups.stats.total", { defaultValue: "Your groups" })} value={String(groups.length)} icon={Users} />
        <StatCard
          label={t("groups.stats.online", { defaultValue: "Online members" })}
          value={String(onlineTotal)}
          icon={Users}
        />
        <StatCard
          label={t("groups.stats.representing", { defaultValue: "Representing" })}
          value={representing?.name ?? t("common.none")}
          icon={Crown}
          highlight={Boolean(representing)}
        />
      </div>

      {query.isPending ? (
        <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-[hsl(var(--muted-foreground))]">
          <Loader2 className="size-4 animate-spin" />
          <span>{t("common.loading")}</span>
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
            {filter
              ? t("groups.noMatch", { defaultValue: "No groups match '{{filter}}'.", filter })
              : t("groups.empty", { defaultValue: "You haven't joined any VRChat groups yet." })}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id} elevation="flat" className="overflow-hidden">
              <div className="relative h-[64px] w-full shrink-0">
                <ThumbImage
                  src={group.bannerUrl}
                  seedKey={group.id}
                  label={group.name}
                  className="h-full w-full rounded-none border-0 opacity-80"
                  aspect=""
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--surface))] to-transparent pointer-events-none" />
                {group.isRepresenting && (
                  <Badge variant="warning" className="absolute top-2 right-2 gap-1 z-10">
                    <Crown className="size-3" />
                    {t("groups.representing", { defaultValue: "Representing" })}
                  </Badge>
                )}
              </div>
              <CardContent className="relative -mt-6 flex flex-col gap-2 px-3 pt-0 pb-3">
                <div className="flex items-start gap-2">
                  <ThumbImage
                    src={group.iconUrl}
                    seedKey={group.id}
                    label={group.name}
                    className="size-10 shrink-0 border-2 border-[hsl(var(--surface))] shadow"
                    aspect=""
                  />
                  <div className="flex min-w-0 flex-1 flex-col pt-5">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
                        {group.name}
                      </span>
                      {group.isVerified && (
                        <BadgeCheck className="size-3.5 shrink-0 text-[hsl(var(--primary))]" />
                      )}
                    </div>
                    {group.shortCode && group.discriminator ? (
                      <span className="truncate text-[10.5px] font-mono text-[hsl(var(--muted-foreground))]">
                        {group.shortCode}.{group.discriminator}
                      </span>
                    ) : null}
                  </div>
                </div>
                {group.description && (
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                    {group.description}
                  </p>
                )}
                <div className="flex items-center gap-3 text-[10.5px] text-[hsl(var(--muted-foreground))]">
                  <span>
                    {t("groups.memberCount", {
                      defaultValue: "{{count}} member",
                      defaultValue_plural: "{{count}} members",
                      count: group.memberCount,
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
                    {t("groups.onlineCount", {
                      defaultValue: "{{count}} online",
                      count: group.onlineMemberCount,
                    })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant={group.isRepresenting ? "outline" : "tonal"}
                    disabled={pendingRepresentId !== null}
                    onClick={() => void toggleRepresent(group)}
                  >
                    {pendingRepresentId === group.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : group.isRepresenting ? (
                      <X className="size-3" />
                    ) : (
                      <Crown className="size-3" />
                    )}
                    {group.isRepresenting
                      ? t("groups.stopRepresenting", { defaultValue: "Stop representing" })
                      : t("groups.represent", { defaultValue: "Represent" })}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void ipc.call("shell.openUrl", {
                        url: `https://vrchat.com/home/group/${group.id}`,
                      })
                    }
                  >
                    <ExternalLink className="size-3" />
                    {t("groups.viewOnVrchat", { defaultValue: "Open on vrchat.com" })}
                  </Button>
                  {group.onlineMemberCount > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/vrchat?group=${encodeURIComponent(group.id)}`)}
                    >
                      {t("groups.seeOnline", { defaultValue: "See online" })}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  highlight = false,
}: {
  label: string;
  value: string;
  icon: typeof Users;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-[var(--radius-md)] border bg-[hsl(var(--surface-raised))] px-4 py-3 " +
        (highlight
          ? "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.05)]"
          : "border-[hsl(var(--border))]")
      }
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold text-[hsl(var(--foreground))] truncate">
        {value}
      </div>
    </div>
  );
}
