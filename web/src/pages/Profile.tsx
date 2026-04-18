import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Globe2, LogIn, RefreshCcw, Shirt, Sword, Users, LibraryBig, Orbit } from "lucide-react";
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
    await ipc.call<UpdateProfileRequest, void>("user.updateProfile", {
      bio: patch.bio,
      statusDescription: patch.statusDescription,
      status: patch.status,
    });
    // Refresh
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
        <div className="py-12 text-center text-[12px] text-[hsl(var(--muted-foreground))]">
          {t("common.loading")}
        </div>
      ) : profile ? (
        <div className="flex flex-col gap-4 max-w-4xl">
          <ProfileCard
            user={profile}
            editable
            onSave={handleSave}
          />

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
