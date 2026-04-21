import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LogIn, LogOut, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { LoginForm } from "./LoginForm";

export function AuthChip() {
  const { t } = useTranslation();
  const { status, loading, logout } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

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

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    updatePos();

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
      if (event.key === "Escape") setMenuOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePos);
    };
  }, [menuOpen, updatePos]);

  useEffect(() => () => clearCloseTimer(), []);

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
      onMouseEnter={() => {
        clearCloseTimer();
        setMenuOpen(true);
      }}
      onMouseLeave={queueClose}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
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
      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[176px] rounded-[var(--radius-md)] border border-[hsl(var(--border-strong))] bg-[hsl(var(--surface-raised))] p-1 shadow-[0_10px_30px_rgba(0,0,0,0.28)]"
          style={{ top: menuPos.top, right: menuPos.right }}
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
      )}
    </div>
  );
}
