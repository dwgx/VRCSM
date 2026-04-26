import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BadgeCheck, Calendar, ExternalLink, Gamepad2, Globe2, Glasses, KeyRound, Languages, Link2, Loader2, LogIn, Mail, Monitor, RefreshCcw, Shield, ShieldCheck, Shirt, Sword, Users, LibraryBig, Orbit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileCard, type VrcUserProfile, type VrcStatus } from "@/components/ProfileCard";
import { LoginForm } from "@/components/LoginForm";
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/lib/auth-context";
import { useUiPrefBoolean } from "@/lib/ui-prefs";
import { useNavigate } from "react-router-dom";

interface MyProfileResponse {
  profile: VrcUserProfile | null;
  error?: string;
}

interface UpdateProfileRequest {
  bio?: string;
  statusDescription?: string;
  status?: VrcStatus;
  bioLinks?: string[];
  pronouns?: string;
  userIcon?: string;
  profilePicOverride?: string;
  tags?: string[];
}

function ProfileStatsStrip({ profile }: { profile: VrcUserProfile }) {
  const { t, i18n } = useTranslation();
  const joinedDate = profile.date_joined
    ? new Date(profile.date_joined).toLocaleDateString(i18n.resolvedLanguage ?? i18n.language, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  const joinedYearsAgo = profile.date_joined
    ? Math.floor((Date.now() - new Date(profile.date_joined).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;
  const languages = (profile.tags ?? []).filter((tag) => tag.startsWith("language_"));
  const ageVerified = profile.ageVerificationStatus === "verified";
  const trustTag = (profile.tags ?? []).find(
    (tag) => tag === "system_trust_veteran" || tag === "system_trust_trusted" || tag === "system_trust_known" || tag === "system_trust_basic",
  );
  const trustLabel = trustTag?.replace("system_trust_", "") ?? "visitor";

  const items: Array<{ icon: typeof Calendar; label: string; value: string; highlight?: boolean }> = [];
  if (joinedDate) {
    items.push({
      icon: Calendar,
      label: t("profile.stats.joined", { defaultValue: "Joined" }),
      value: joinedYearsAgo && joinedYearsAgo > 0
        ? t("profile.stats.joinedValue", {
            defaultValue: "{{date}} ({{years}}y)",
            date: joinedDate,
            years: joinedYearsAgo,
          })
        : joinedDate,
    });
  }
  items.push({
    icon: ShieldCheck,
    label: t("profile.stats.trust", { defaultValue: "Trust" }),
    value: trustLabel,
    highlight: trustTag === "system_trust_trusted" || trustTag === "system_trust_veteran",
  });
  if (profile.ageVerificationStatus) {
    items.push({
      icon: BadgeCheck,
      label: t("profile.stats.ageVerification", { defaultValue: "Age Verification" }),
      value: ageVerified
        ? t("profile.stats.ageVerified", { defaultValue: "Verified 18+" })
        : t("profile.stats.ageUnverified", { defaultValue: "Unverified" }),
      highlight: ageVerified,
    });
  }
  if (languages.length > 0) {
    items.push({
      icon: Languages,
      label: t("profile.stats.languages", { defaultValue: "Languages" }),
      value: languages.map((l) => l.replace("language_", "").toUpperCase()).join(" · "),
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, i) => (
        <div
          key={i}
          className={
            "rounded-[var(--radius-md)] border px-3 py-2 " +
            (item.highlight
              ? "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.05)]"
              : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))]")
          }
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
            <item.icon className="size-3.5" />
            {item.label}
          </div>
          <div className="mt-0.5 truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function LinkedAccountsCard({ profile }: { profile: VrcUserProfile }) {
  const { t } = useTranslation();

  const accounts: Array<{
    name: string;
    Icon: typeof Globe2;
    linked: boolean;
    id?: string;
  }> = [
    { name: "Steam", Icon: Gamepad2, linked: Boolean(profile.steamId), id: profile.steamId },
    { name: "Oculus", Icon: Glasses, linked: Boolean(profile.oculusId), id: profile.oculusId },
    { name: "Viveport", Icon: Monitor, linked: Boolean(profile.viveId), id: profile.viveId },
    { name: "Pico", Icon: Glasses, linked: Boolean(profile.picoId), id: profile.picoId },
    { name: "Google", Icon: Mail, linked: Boolean(profile.googleId), id: profile.googleId },
  ];

  const hasAnyField = profile.steamId !== undefined
    || profile.oculusId !== undefined
    || profile.googleId !== undefined
    || profile.picoId !== undefined
    || profile.viveId !== undefined
    || profile.hasEmail !== undefined;

  if (!hasAnyField) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4" />
          {t("profile.linkedAccounts", { defaultValue: "Linked Accounts" })}
        </CardTitle>
        <CardDescription>
          {t("profile.linkedAccountsDesc", {
            defaultValue: "Bound platforms and identity fields from the VRChat login session, displayed natively.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((acc) => (
          <div
            key={acc.name}
            className={
              "flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 " +
              (acc.linked
                ? "border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.05)]"
                : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))]")
            }
          >
            <acc.Icon className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-[hsl(var(--foreground))]">
                {acc.name}
              </div>
              {acc.linked ? (
                <div className="truncate text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                  {acc.id}
                </div>
              ) : (
                <button
                  type="button"
                  className="text-[10px] text-[hsl(var(--primary))] hover:underline"
                  onClick={() => void ipc.call("shell.openUrl", { url: "https://vrchat.com/home/profile" })}
                >
                  {t("profile.notLinked", { defaultValue: "Not linked" })} →
                </button>
              )}
            </div>
            <div
              className={
                "size-2 shrink-0 rounded-full " +
                (acc.linked ? "bg-[hsl(var(--success))]" : "bg-[hsl(var(--muted-foreground)/0.3)]")
              }
            />
          </div>
        ))}

        {/* Email row */}
        {profile.hasEmail !== undefined && (
          <div
            className={
              "flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 " +
              (profile.hasEmail
                ? "border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.05)]"
                : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))]")
            }
          >
            <Mail className="size-4 text-[hsl(var(--muted-foreground))]" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-[hsl(var(--foreground))]">Email</div>
              <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {profile.hasEmail
                  ? profile.emailVerified
                    ? t("profile.emailVerified", { defaultValue: "Verified" })
                    : t("profile.emailUnverified", { defaultValue: "Set but unverified" })
                  : t("profile.notLinked", { defaultValue: "Not linked" })}
              </div>
            </div>
            <div
              className={
                "size-2 shrink-0 rounded-full " +
                (profile.hasEmail ? "bg-[hsl(var(--success))]" : "bg-[hsl(var(--muted-foreground)/0.3)]")
              }
            />
          </div>
        )}
      </CardContent>
      <div className="border-t border-[hsl(var(--border)/0.4)] px-4 py-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void ipc.call("shell.openUrl", { url: "https://vrchat.com/home/profile" })}
          className="gap-1.5 text-[11px]"
        >
          <ExternalLink className="size-3" />
          {t("profile.manageOnVrchat", { defaultValue: "Manage on vrchat.com" })}
        </Button>
      </div>
    </Card>
  );
}

function AccountSecurityCard({ profile }: { profile: VrcUserProfile }) {
  const { t } = useTranslation();

  if (profile.twoFactorAuthEnabled === undefined && profile.allowAvatarCopying === undefined) {
    return null;
  }

  const items: Array<{ icon: typeof Shield; label: string; value: string; good: boolean }> = [];

  if (profile.twoFactorAuthEnabled !== undefined) {
    items.push({
      icon: KeyRound,
      label: t("profile.security.twoFactor", { defaultValue: "Two-Factor Auth" }),
      value: profile.twoFactorAuthEnabled
        ? t("common.enabled", { defaultValue: "Enabled" })
        : t("common.disabled", { defaultValue: "Disabled" }),
      good: profile.twoFactorAuthEnabled,
    });
  }

  if (profile.allowAvatarCopying !== undefined) {
    items.push({
      icon: Shield,
      label: t("profile.security.avatarCopying", { defaultValue: "Avatar Cloning" }),
      value: profile.allowAvatarCopying
        ? t("common.allowed", { defaultValue: "Allowed" })
        : t("common.blocked", { defaultValue: "Blocked" }),
      good: !profile.allowAvatarCopying,
    });
  }

  if (profile.hasLoggedInFromClient !== undefined) {
    items.push({
      icon: Globe2,
      label: t("profile.security.clientLogin", { defaultValue: "Game Client Login" }),
      value: profile.hasLoggedInFromClient
        ? t("common.yes", { defaultValue: "Yes" })
        : t("common.no", { defaultValue: "No" }),
      good: profile.hasLoggedInFromClient,
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, i) => (
        <div
          key={i}
          className={
            "rounded-[var(--radius-md)] border px-3 py-2 " +
            (item.good
              ? "border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.04)]"
              : "border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.04)]")
          }
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
            <item.icon className="size-3.5" />
            {item.label}
          </div>
          <div className="mt-0.5 truncate text-[13px] font-semibold text-[hsl(var(--foreground))]">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Profile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status } = useAuth();
  const [profile, setProfile] = useState<VrcUserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [showLiveContext, setShowLiveContext] = useUiPrefBoolean("vrcsm.layout.profile.context.visible", true);
  const retryTimerRef = useRef<number | null>(null);
  const loadAttemptRef = useRef(0);

  function clearRetryTimer() {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }

  function buildFallbackProfile(): VrcUserProfile | null {
    if (!status.authed) return null;
    const displayName =
      status.displayName?.trim() || t("profile.title", { defaultValue: "My Profile" });
    return {
      id: status.userId ?? "auth-pending",
      displayName,
      bio: "",
      bioLinks: [],
      tags: [],
      status: "offline",
      statusDescription: t("auth.checking", { defaultValue: "Checking session..." }),
      currentAvatarImageUrl: "",
      currentAvatarThumbnailImageUrl: "",
      profilePicOverride: "",
      currentAvatarName: "",
      currentAvatarId: "",
      worldName: "",
      worldId: "",
      location: "",
      last_login: "",
      last_activity: "",
      developerType: "",
    };
  }

  function scheduleRetry() {
    if (!status.authed || loadAttemptRef.current >= 3 || retryTimerRef.current !== null) {
      return;
    }
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      load(false);
    }, 900);
  }

  function load(forceToast = false) {
    if (!status.authed) {
      clearRetryTimer();
      loadAttemptRef.current = 0;
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    ipc
      .call<undefined, MyProfileResponse>("user.me", undefined)
      .then((res) => {
        if (res.profile) {
          clearRetryTimer();
          loadAttemptRef.current = 0;
          setProfile(res.profile);
          return;
        }

        loadAttemptRef.current += 1;
        setProfile((current) => current ?? buildFallbackProfile());
        if (res.error && (forceToast || loadAttemptRef.current >= 3)) {
          toast.error(res.error);
        }
        scheduleRetry();
      })
      .catch((e: unknown) => {
        loadAttemptRef.current += 1;
        setProfile((current) => current ?? buildFallbackProfile());
        if (forceToast || loadAttemptRef.current >= 3) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
        scheduleRetry();
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    clearRetryTimer();
    loadAttemptRef.current = 0;
    if (!status.authed) {
      setProfile(null);
      setLoading(false);
      return;
    }
    void load(false);
    return () => {
      clearRetryTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.authed, status.userId, status.displayName]);

  async function handleSave(patch: Partial<VrcUserProfile>) {
    const payload: UpdateProfileRequest = {};
    if (patch.bio !== undefined) payload.bio = patch.bio;
    if (patch.statusDescription !== undefined) payload.statusDescription = patch.statusDescription;
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.pronouns !== undefined) payload.pronouns = patch.pronouns;
    if (patch.userIcon !== undefined) payload.userIcon = patch.userIcon;
    if (patch.profilePicOverride !== undefined) payload.profilePicOverride = patch.profilePicOverride;
    if (patch.bioLinks !== undefined) payload.bioLinks = patch.bioLinks;
    if (patch.tags !== undefined) payload.tags = patch.tags;
    await ipc.call<UpdateProfileRequest, void>("user.updateProfile", payload);
    load();
  }

  const hasLiveContext = Boolean(
    profile?.currentAvatarId ||
    profile?.currentAvatarName ||
    profile?.worldId ||
    profile?.location,
  );

  if (!status.authed) {
    return (
      <div className="flex flex-col gap-4 animate-fade-in">
        <header>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("profile.title", { defaultValue: "My Profile" })}
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
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold leading-none tracking-tight">
            {t("profile.title", { defaultValue: "My Profile" })}
          </h1>
          <p className="mt-1.5 text-[12px] text-[hsl(var(--muted-foreground))]">
            {t("profile.subtitle", { defaultValue: "View and edit your VRChat profile information" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasLiveContext ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLiveContext((current) => !current)}
            >
              {showLiveContext
                ? t("common.hide", { defaultValue: "Hide" })
                : t("common.show", { defaultValue: "Show" })}{" "}
              {t("profile.liveContext", { defaultValue: "Live Context" })}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
            <RefreshCcw className={loading ? "animate-spin" : undefined} />
            {t("common.refresh")}
          </Button>
        </div>
      </header>

      {loading && !profile ? (
        <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-[hsl(var(--muted-foreground))]">
          <Loader2 className="size-4 animate-spin" />
          <span>{t("common.loading")}</span>
        </div>
      ) : profile ? (
        <div className="flex flex-col gap-4 max-w-4xl">
          <ProfileCard
            user={profile}
            editable
            onSave={handleSave}
          />

          <ProfileStatsStrip profile={profile} />
          <AccountSecurityCard profile={profile} />
          <LinkedAccountsCard profile={profile} />

          <div className={showLiveContext && hasLiveContext ? "grid gap-4 lg:grid-cols-[1.2fr_0.8fr]" : "grid gap-4"}>
            <Card>
              <CardHeader>
                <CardTitle>{t("profile.quickActions", { defaultValue: "Native Workspace" })}</CardTitle>
                <CardDescription>
                  {t("profile.quickActionsDesc", {
                    defaultValue:
                      "Jump into the native VRChat workspace for joinable friends, synced favorites, local collections, and recent worlds without leaving VRCSM.",
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <Button
                  variant="tonal"
                  className="h-auto justify-start whitespace-normal break-words py-2 text-left"
                  onClick={() => navigate("/vrchat")}
                >
                  <Orbit className="size-4" />
                  {t("profile.openNativeWorkspace", { defaultValue: "Open workspace" })}
                </Button>
                <Button
                  variant="outline"
                  className="h-auto justify-start whitespace-normal break-words py-2 text-left"
                  onClick={() => navigate("/friends")}
                >
                  <Users className="size-4" />
                  {t("nav.friends")}
                </Button>
                <Button
                  variant="outline"
                  className="h-auto justify-start whitespace-normal break-words py-2 text-left"
                  onClick={() => navigate("/avatars")}
                >
                  <Shirt className="size-4" />
                  {t("nav.avatars")}
                </Button>
                <Button
                  variant="outline"
                  className="h-auto justify-start whitespace-normal break-words py-2 text-left"
                  onClick={() => navigate("/worlds")}
                >
                  <Globe2 className="size-4" />
                  {t("nav.worlds")}
                </Button>
                <Button
                  variant="outline"
                  className="h-auto justify-start whitespace-normal break-words py-2 text-left"
                  onClick={() => navigate("/library")}
                >
                  <LibraryBig className="size-4" />
                  {t("nav.library")}
                </Button>
              </CardContent>
            </Card>

            {showLiveContext && hasLiveContext ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t("profile.liveContext", { defaultValue: "Live Context" })}</CardTitle>
                  <CardDescription>
                    {t("profile.liveContextDesc", {
                      defaultValue: "Important ids and current session targets for quick navigation.",
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-[11px]">
                  <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                      {t("profile.currentAvatar", { defaultValue: "Current avatar" })}
                    </div>
                    <div className="mt-1 break-all font-mono text-[hsl(var(--foreground))]">
                      {profile.currentAvatarId ?? profile.currentAvatarName ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                      {t("profile.currentWorld", { defaultValue: "Current world" })}
                    </div>
                    <div className="mt-1 break-all font-mono text-[hsl(var(--foreground))]">
                      {profile.worldId ?? profile.location ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-3 py-2 text-[hsl(var(--muted-foreground))]">
                    {t("profile.liveContextHint", {
                      defaultValue:
                        "Use these live ids as anchors for the native friends, avatars, worlds, and favorites workflows inside VRCSM.",
                    })}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* Avatar switcher hint */}
          <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2.5 text-[11px] text-[hsl(var(--muted-foreground))]">
            <div className="flex items-center gap-2 font-medium text-[hsl(var(--foreground))]">
              <Sword className="size-3.5" />
              {t("profile.switchAvatar", { defaultValue: "Switch Avatar" })}
            </div>
            <p className="mt-1 leading-relaxed">
              {t("profile.switchAvatarHint", {
                defaultValue:
                  "Go to the 'Avatars' page, select an avatar and click 'Switch to this avatar' to change it online. You must be signed in to VRChat.",
              })}
            </p>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("common.none")}
        </div>
      )}
    </div>
  );
}
