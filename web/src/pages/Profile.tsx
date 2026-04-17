import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RefreshCcw, LogIn, Sword } from "lucide-react";
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
        <div className="flex flex-col gap-4 max-w-md">
          <ProfileCard
            user={profile}
            editable
            onSave={handleSave}
          />

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
