import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { useGreyPrefs } from "@/lib/grey-prefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  OTP_MAIL_TOS,
  buildOtpMailSetConfig,
  canEnableOtpMail,
  parseOtpMailConfig,
  type OtpMailTls,
} from "@/lib/otp-mail-ui";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function OtpMailCard() {
  const { t } = useTranslation();
  const { prefs, isLoading } = useGreyPrefs();
  const greyEnabled = prefs?.greyEnabled === true;

  const [host, setHost] = useState("");
  const [port, setPort] = useState(993);
  const [tls, setTls] = useState<OtpMailTls>("imaps");
  const [username, setUsername] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [markSeen, setMarkSeen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [tosAcceptedAt, setTosAcceptedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "clear" | "tos" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const enableAllowed = canEnableOtpMail(greyEnabled, tosAcceptedAt);

  useEffect(() => {
    let alive = true;
    void ipc
      .call("otpMail.getConfig", {})
      .then((raw) => {
        if (!alive) return;
        const cfg = parseOtpMailConfig(raw);
        setHost(cfg.host);
        setPort(cfg.port);
        setTls(cfg.tls);
        setUsername(cfg.username);
        setMarkSeen(cfg.markSeen);
        setEnabled(cfg.enabled);
        setPasswordSaved(cfg.passwordSaved);
        setTosAcceptedAt(cfg.tosAcceptedAt);
        setPasswordDraft("");
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  async function persist(opts?: { tosAcceptedAt?: string; enabled?: boolean }) {
    const tos = opts?.tosAcceptedAt ?? tosAcceptedAt;
    const nextEnabled = opts?.enabled ?? enabled;
    const payload = buildOtpMailSetConfig({
      enabled: nextEnabled === true && canEnableOtpMail(greyEnabled, tos),
      host,
      port,
      tls,
      username,
      password: passwordDraft,
      markSeen,
      tosAcceptedAt: tos,
    });
    const result = await ipc.call<Record<string, unknown>, { passwordSaved?: boolean }>(
      "otpMail.setConfig",
      payload,
    );
    setPasswordDraft("");
    setPasswordSaved(result.passwordSaved === true);
    if (typeof tos === "string" && tos.length > 0) {
      setTosAcceptedAt(tos);
    }
    if (opts?.enabled !== undefined) {
      setEnabled(opts.enabled);
    }
    return result;
  }

  async function onSave() {
    setError(null);
    setTestNote(null);
    setBusy("save");
    try {
      await persist();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setError(null);
    setTestNote(null);
    setBusy("test");
    try {
      const result = await ipc.call<Record<string, never>, { ok?: boolean; inboxExists?: boolean }>(
        "otpMail.test",
        {},
      );
      setTestNote(
        result.inboxExists
          ? t("otpMail.testOk", { defaultValue: "IMAP login succeeded; INBOX exists." })
          : t("otpMail.testNoInbox", { defaultValue: "IMAP login succeeded; INBOX was not found." }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onClear() {
    setError(null);
    setTestNote(null);
    setBusy("clear");
    try {
      await ipc.call("otpMail.clear", {});
      setPasswordDraft("");
      setPasswordSaved(false);
      setEnabled(false);
      setHost("");
      setUsername("");
      setPort(993);
      setTls("imaps");
      setMarkSeen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onAcceptTos() {
    if (tosAcceptedAt) return;
    const at = new Date().toISOString();
    setError(null);
    setBusy("tos");
    try {
      await persist({ tosAcceptedAt: at, enabled: false });
    } catch (e) {
      setTosAcceptedAt(null);
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const fieldClass =
    "flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]";

  return (
    <div className="unity-panel border border-[hsl(var(--border))] p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[12px] font-medium">
            {t("otpMail.title", { defaultValue: "Email OTP helper" })}
          </div>
          <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
            {t("otpMail.desc", {
              defaultValue:
                "Reads the VRChat email OTP from your IMAP inbox and fills the login prompt. Off by default. Not auto-login.",
            })}
          </div>
        </div>
        <label className="flex items-center gap-2 select-none shrink-0">
          <span className="font-mono text-[11px] uppercase tracking-wider">
            {enableAllowed && enabled
              ? t("settings.experimental.toggleOn", { defaultValue: "ON" })
              : t("settings.experimental.toggleOff", { defaultValue: "OFF" })}
          </span>
          <input
            type="checkbox"
            checked={enableAllowed && enabled}
            disabled={!enableAllowed || isLoading || !loaded || busy !== null}
            onChange={(e) => setEnabled(e.target.checked)}
            className={cn(
              "w-4 h-4",
              enableAllowed ? "cursor-pointer" : "cursor-not-allowed",
              "border border-[hsl(var(--border-strong))]",
            )}
          />
        </label>
      </div>

      <p className="text-[10.5px] text-[hsl(var(--muted-foreground))] font-mono border-l-2 border-[hsl(var(--warning,var(--border-strong)))] pl-2 leading-relaxed">
        {t("grey.tos.otpMail", { defaultValue: OTP_MAIL_TOS })}
      </p>

      <label className="flex items-center gap-2 text-[11px] select-none">
        <input
          type="checkbox"
          checked={Boolean(tosAcceptedAt)}
          disabled={Boolean(tosAcceptedAt) || !loaded || busy !== null}
          onChange={(e) => {
            if (e.target.checked) void onAcceptTos();
          }}
          className="w-4 h-4 cursor-pointer border border-[hsl(var(--border-strong))]"
        />
        {t("otpMail.understand", { defaultValue: "I understand" })}
      </label>

      {!greyEnabled ? (
        <p className="text-[10.5px] text-[hsl(var(--muted-foreground))] font-mono">
          {t("grey.disabled", {
            defaultValue: "Optional helpers are off. Enable the master switch above first.",
          })}
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className={fieldClass}>
          {t("otpMail.host", { defaultValue: "IMAP host" })}
          <Input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={busy !== null}
            placeholder="imap.example.com"
          />
        </label>
        <label className={fieldClass}>
          {t("otpMail.port", { defaultValue: "Port" })}
          <Input
            type="number"
            inputMode="numeric"
            value={port}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPort(Number.isFinite(n) && n > 0 ? Math.trunc(n) : 993);
            }}
            disabled={busy !== null}
          />
        </label>
        <label className={fieldClass}>
          {t("otpMail.tls", { defaultValue: "TLS" })}
          <select
            value={tls}
            onChange={(e) => setTls(e.target.value === "starttls" ? "starttls" : "imaps")}
            disabled={busy !== null}
            className={cn(
              "flex h-8 w-full rounded-[var(--radius-sm)]",
              "border border-[hsl(var(--border-strong))]",
              "bg-[hsl(var(--input))] px-3 py-1",
              "text-[13px] text-[hsl(var(--foreground))]",
              "focus-visible:border-[hsl(var(--primary))] focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <option value="imaps">imaps</option>
            <option value="starttls">starttls</option>
          </select>
        </label>
        <label className={fieldClass}>
          {t("otpMail.username", { defaultValue: "Mailbox username" })}
          <Input
            type="text"
            autoComplete="username"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy !== null}
          />
        </label>
      </div>

      <label className={fieldClass}>
        {t("otpMail.password", { defaultValue: "Mailbox app password" })}
        <Input
          type="password"
          name="imap-app-password"
          autoComplete="off"
          value={passwordDraft}
          onChange={(e) => setPasswordDraft(e.target.value)}
          disabled={busy !== null}
          placeholder={
            passwordSaved
              ? t("otpMail.passwordKeep", { defaultValue: "Leave blank to keep saved" })
              : ""
          }
        />
      </label>

      <p className="text-[10.5px] font-mono text-[hsl(var(--muted-foreground))]">
        {passwordSaved
          ? t("otpMail.passwordSaved", { defaultValue: "Mailbox app password saved" })
          : t("otpMail.passwordMissing", { defaultValue: "Mailbox app password missing" })}
      </p>

      <label className="flex items-center gap-2 text-[11px] select-none">
        <input
          type="checkbox"
          checked={markSeen}
          onChange={(e) => setMarkSeen(e.target.checked)}
          disabled={busy !== null}
          className="w-4 h-4 cursor-pointer border border-[hsl(var(--border-strong))]"
        />
        {t("otpMail.markSeen", { defaultValue: "Mark OTP mail as seen (default off)" })}
      </label>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="tonal" onClick={() => void onSave()} disabled={!loaded || busy !== null}>
          {t("otpMail.save", { defaultValue: "Save" })}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onTest()} disabled={!loaded || busy !== null}>
          {t("otpMail.test", { defaultValue: "Test" })}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onClear()} disabled={!loaded || busy !== null}>
          {t("otpMail.clear", { defaultValue: "Clear" })}
        </Button>
      </div>

      {testNote ? (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">{testNote}</p>
      ) : null}
      {error ? <p className="text-[11px] text-[hsl(var(--destructive))]">{error}</p> : null}
    </div>
  );
}
