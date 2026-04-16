import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Lock, LogIn, Shield, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth, type TwoFactorMethod } from "@/lib/auth-context";

type Stage = "credentials" | "twofactor";

interface LoginFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Native VRChat login dialog. Two stages:
 *
 *   1. credentials — username + password, POSTed through the C++
 *      `auth.login` IPC. Result is either success (we close + toast),
 *      a 2FA challenge (we move to stage 2), or an error (we show it
 *      inline so the form can be retried without the dialog closing).
 *
 *   2. twofactor — the user enters the 6-digit TOTP / emailOtp code.
 *      `auth.verify2FA` merges the `twoFactorAuth` cookie and
 *      re-probes the session; on success we close the dialog and fire
 *      the "signed in" toast.
 *
 * Reset semantics: closing the dialog (or a fresh "signed out"
 * re-open) wipes local state so stale errors / half-typed codes don't
 * leak across sessions. Focus is pushed into the first input on
 * each stage transition so the keyboard path is uninterrupted.
 */
export function LoginForm({ open, onOpenChange }: LoginFormProps) {
  const { t } = useTranslation();
  const { login, verifyTwoFactor } = useAuth();

  const [stage, setStage] = useState<Stage>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<TwoFactorMethod>("totp");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Reset the form every time the dialog opens — we don't want a
  // previous "Invalid password" banner clinging to a fresh attempt.
  useEffect(() => {
    if (!open) return;
    setStage("credentials");
    setUsername("");
    setPassword("");
    setCode("");
    setMethod("totp");
    setSubmitting(false);
    setError(null);
    // Focus the username field — Radix' dialog handles initial focus,
    // but our refForwarding wrapper needs a nudge.
    window.setTimeout(() => usernameRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    if (stage === "twofactor") {
      window.setTimeout(() => codeRef.current?.focus(), 60);
    }
  }, [stage]);

  const onSubmitCredentials = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!username.trim() || !password) {
      setError(
        t("auth.missingCredentials", {
          defaultValue: "Enter your username and password.",
        }),
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(username.trim(), password);
      if (result.status === "success") {
        toast.success(t("auth.loginSuccess"));
        onOpenChange(false);
        return;
      }
      if (result.status === "requires2FA") {
        // Prefer TOTP over emailOtp when both are on offer — TOTP
        // fills in from authenticator apps and is the common case for
        // power users. The dropdown below lets the user override if
        // needed.
        const preferred: TwoFactorMethod = result.twoFactorMethods.includes("totp")
          ? "totp"
          : result.twoFactorMethods.includes("emailOtp")
            ? "emailOtp"
            : result.twoFactorMethods[0] ?? "totp";
        setMethod(preferred);
        setStage("twofactor");
        return;
      }
      // Error path.
      setError(result.error);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitTwoFactor = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const digits = code.trim();
    if (!/^\d{6}$/.test(digits)) {
      setError(
        t("auth.twoFactor.invalidCode", {
          defaultValue: "Enter the 6-digit code.",
        }),
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await verifyTwoFactor(method, digits);
      if (result.ok) {
        toast.success(t("auth.loginSuccess"));
        onOpenChange(false);
        return;
      }
      setError(result.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stage === "credentials" ? (
              <>
                <LogIn className="size-4 text-[hsl(var(--primary))]" />
                {t("auth.dialogTitle", {
                  defaultValue: "Sign in with VRChat",
                })}
              </>
            ) : (
              <>
                <Shield className="size-4 text-[hsl(var(--primary))]" />
                {t("auth.twoFactor.title", {
                  defaultValue: "Two-factor verification",
                })}
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {stage === "credentials"
              ? t("auth.dialogBody", {
                  defaultValue:
                    "VRCSM calls the VRChat REST API directly with WinHTTP. Your credentials never leave this machine — only the session cookie is kept, DPAPI-encrypted.",
                })
              : t("auth.twoFactor.body", {
                  defaultValue:
                    "VRChat asked for a two-factor code. Enter the 6-digit token from your authenticator app or the email VRChat just sent.",
                })}
          </DialogDescription>
        </DialogHeader>

        {stage === "credentials" ? (
          <form
            onSubmit={onSubmitCredentials}
            className="flex flex-col gap-3"
            noValidate
          >
            <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5">
                <User className="size-3" />
                {t("auth.usernameLabel", { defaultValue: "Username or email" })}
              </span>
              <Input
                ref={usernameRef}
                type="text"
                autoComplete="username"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                placeholder="user@example.com"
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5">
                <Lock className="size-3" />
                {t("auth.passwordLabel", { defaultValue: "Password" })}
              </span>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                placeholder="••••••••"
              />
            </label>

            {error ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.45)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-[11px] text-[hsl(var(--warn-foreground,var(--destructive)))]">
                {error}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="tonal" size="sm" disabled={submitting}>
                <LogIn />
                {submitting
                  ? t("auth.submitting", { defaultValue: "Signing in…" })
                  : t("auth.signIn")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            onSubmit={onSubmitTwoFactor}
            className="flex flex-col gap-3"
            noValidate
          >
            <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1.5">
                <Shield className="size-3" />
                {method === "emailOtp"
                  ? t("auth.twoFactor.emailLabel", {
                      defaultValue: "Email verification code",
                    })
                  : t("auth.twoFactor.totpLabel", {
                      defaultValue: "Authenticator code",
                    })}
              </span>
              <Input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                disabled={submitting}
                placeholder="123456"
                className="font-mono tracking-[0.35em]"
              />
            </label>

            {error ? (
              <div className="rounded-[var(--radius-sm)] border border-[hsl(var(--destructive)/0.45)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-[11px] text-[hsl(var(--warn-foreground,var(--destructive)))]">
                {error}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setStage("credentials");
                  setError(null);
                  setCode("");
                }}
                disabled={submitting}
              >
                {t("common.back")}
              </Button>
              <Button type="submit" variant="tonal" size="sm" disabled={submitting}>
                <Shield />
                {submitting
                  ? t("auth.twoFactor.verifying", {
                      defaultValue: "Verifying…",
                    })
                  : t("auth.twoFactor.verify", { defaultValue: "Verify" })}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
