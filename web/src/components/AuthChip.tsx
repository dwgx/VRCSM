import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LogIn, LogOut, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { LoginForm } from "./LoginForm";

/**
 * Toolbar chip for the VRChat session. When signed out it's a single
 * "Sign in" button that opens the native LoginForm dialog. When
 * signed in, shows the display name with a click-to-toggle sign-out
 * menu so the action stays reachable while moving the pointer.
 *
 * Pages read `useAuth()` to know whether to fetch friends / avatar
 * thumbnails; this chip is mostly a status indicator plus a shortcut
 * to the sign-in surface.
 */
export function AuthChip() {
  const { t } = useTranslation();
  const { status, loading, logout } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function queueClose() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setMenuOpen(false);
    }, 220);
  }

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !containerRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      clearCloseTimer();
    };
  }, []);

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
      <>
        <Button
          variant="tonal"
          size="sm"
          onClick={() => setLoginOpen(true)}
        >
          <LogIn />
          {t("auth.signIn")}
        </Button>
        <LoginForm open={loginOpen} onOpenChange={setLoginOpen} />
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative z-20"
      onMouseEnter={() => {
        clearCloseTimer();
        setMenuOpen(true);
      }}
      onMouseLeave={queueClose}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        onFocus={() => {
          clearCloseTimer();
          setMenuOpen(true);
        }}
        className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--success)/0.45)] bg-[hsl(var(--success)/0.16)] px-2.5 text-[11px] font-medium tracking-wide text-[hsl(var(--success))] transition-colors hover:bg-[hsl(var(--success)/0.22)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <User className="size-3.5" />
        {status.displayName ?? t("auth.signedIn")}
      </button>
      {menuOpen ? (
        <>
          <div
            aria-hidden
            className="absolute right-0 top-full h-2 min-w-[176px]"
          />
          <div
            ref={menuRef}
            className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-[max(176px,100%)] rounded-[var(--radius-md)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-raised))] p-1 shadow-[0_10px_30px_rgba(0,0,0,0.28)]"
            onMouseEnter={clearCloseTimer}
            onMouseLeave={queueClose}
          >
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                clearCloseTimer();
                setMenuOpen(false);
                void logout().then(() => toast.success(t("auth.signedOut")));
              }}
            >
              <LogOut />
              {t("auth.signOut")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
