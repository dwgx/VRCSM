import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LogIn, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";

/**
 * Toolbar chip for the VRChat session. When signed out it's a single
 * "Sign in" button that spawns the WebView2 login popup directly — the
 * user doesn't have to navigate anywhere first. When signed in, shows
 * the display name with a hover-to-reveal sign-out affordance.
 *
 * Pages read `useAuth()` to know whether to fetch friends / avatar
 * thumbnails; this chip is mostly a status indicator plus a shortcut
 * to the sign-in surface.
 */
export function AuthChip() {
  const { t } = useTranslation();
  const { status, loading, openLogin, logout } = useAuth();
  const [launching, setLaunching] = useState(false);

  if (loading && !status.authed) {
    return (
      <Badge variant="muted" className="h-6 rounded-[var(--radius-sm)] px-2.5">
        <User className="size-3.5" />
        {t("auth.checking")}
      </Badge>
    );
  }

  if (!status.authed) {
    return (
      <Button
        variant="tonal"
        size="sm"
        disabled={launching}
        onClick={async () => {
          setLaunching(true);
          try {
            const result = await openLogin();
            if (!result.ok && result.error && result.error !== "cancelled") {
              toast.error(
                t("auth.loginWindowFailed", {
                  error: result.error,
                  defaultValue: `Login window failed: ${result.error}`,
                }),
              );
            }
          } finally {
            setLaunching(false);
          }
        }}
      >
        <LogIn />
        {launching
          ? t("auth.opening", { defaultValue: "Opening…" })
          : t("auth.signIn")}
      </Button>
    );
  }

  return (
    <div className="group relative">
      <Badge
        variant="success"
        className="h-6 cursor-default rounded-[var(--radius-sm)] px-2.5"
      >
        <User className="size-3.5" />
        {status.displayName ?? t("auth.signedIn")}
      </Badge>
      <div className="pointer-events-none absolute right-0 top-full z-50 mt-1 w-max opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void logout().then(() => toast.success(t("auth.signedOut")));
          }}
        >
          <LogOut />
          {t("auth.signOut")}
        </Button>
      </div>
    </div>
  );
}
