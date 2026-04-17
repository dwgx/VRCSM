import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    minWidth: number;
  } | null>(null);
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
    }, 140);
  }

  function updateMenuPosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const minWidth = Math.max(Math.ceil(rect.width), 176);
    const left = Math.max(8, Math.round(rect.right - minWidth));
    setMenuPosition({
      top: Math.round(rect.bottom + 6),
      left,
      minWidth,
    });
  }

  useEffect(() => {
    if (!menuOpen) return;
    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    const handleLayout = () => {
      updateMenuPosition();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleLayout);
    window.addEventListener("scroll", handleLayout, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleLayout);
      window.removeEventListener("scroll", handleLayout, true);
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
      {menuOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div className="pointer-events-none fixed inset-0 z-[140]">
              <div
                className="absolute h-2"
                style={{
                  top: Math.max(0, menuPosition.top - 6),
                  left: menuPosition.left,
                  width: menuPosition.minWidth,
                }}
              />
              <div
                ref={menuRef}
                className="pointer-events-auto absolute rounded-[var(--radius-md)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-raised))] p-1 shadow-[0_10px_30px_rgba(0,0,0,0.28)]"
                style={{
                  top: menuPosition.top,
                  left: menuPosition.left,
                  minWidth: menuPosition.minWidth,
                }}
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
