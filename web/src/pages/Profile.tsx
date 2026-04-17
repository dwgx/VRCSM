import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ExternalLink, Globe2, LogIn, RefreshCcw, Shirt, Sword, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileCard, type VrcUserProfile, type VrcStatus } from "@/components/ProfileCard";
import { LoginForm } from "@/components/LoginForm";
import { ipc } from "@/lib/ipc";
import { useAuth } from "@/lib/auth-context";

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
  const { status } = useAuth();
  const [profile, setProfile] = useState<VrcUserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  function load() {
    if (!status.authed) return;
    setLoading(true);
    ipc
      .call<undefined, MyProfileResponse>("user.me", undefined)
      .then((res) => {
        if (res.profile) setProfile(res.profile);
        else if (res.error) toast.error(res.error);
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.authed]);

  async function handleSave(patch: Partial<VrcUserProfile>) {
    await ipc.call<UpdateProfileRequest, void>("user.updateProfile", {
      bio: patch.bio,
      statusDescription: patch.statusDescription,
      status: patch.status,
    });
    // Refresh
    load();
  }

  function openVrchat(url: string) {
    void ipc.call("shell.openUrl", { url });
  }

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
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCcw className={loading ? "animate-spin" : undefined} />
          {t("common.refresh")}
        </Button>
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

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>{t("profile.quickActions", { defaultValue: "VRChat Web Shortcuts" })}</CardTitle>
                <CardDescription>
                  {t("profile.quickActionsDesc", {
                    defaultValue:
                      "Open the official VRChat web panels directly from VRCSM for account, avatar, and world management.",
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => openVrchat(`https://vrchat.com/home/user/${profile.id}`)}
                >
                  <UserRound className="size-4" />
                  {t("profile.openProfileWeb", { defaultValue: "Open web profile" })}
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => openVrchat("https://vrchat.com/home/avatars")}
                >
                  <Shirt className="size-4" />
                  {t("profile.openAvatarManager", { defaultValue: "Open avatar manager" })}
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => openVrchat("https://vrchat.com/home/worlds")}
                >
                  <Globe2 className="size-4" />
                  {t("profile.openWorldManager", { defaultValue: "Open world manager" })}
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => openVrchat("https://vrchat.com/home")}
                >
                  <ExternalLink className="size-4" />
                  {t("profile.openHomePortal", { defaultValue: "Open VRChat home" })}
                </Button>
              </CardContent>
            </Card>

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
                      "VRCSM keeps editing and switching local, while deeper creator and account actions can jump to the official web panel without leaving your current workflow.",
                  })}
                </div>
              </CardContent>
            </Card>
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
