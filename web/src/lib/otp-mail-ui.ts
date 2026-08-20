/** Email OTP helper UI helpers. IMAP secret never appears in parsed config. */

export const OTP_MAIL_TOS =
  "Email OTP helper is optional and OFF by default. VRCSM will store your mailbox host and app password with Windows DPAPI on this user account, then read unread mail only while the VRChat email-OTP prompt is open. It never stores your VRChat password in the IMAP config and never logs in to VRChat by itself. Automatically collecting login codes may violate VRChat’s Terms of Service or your email provider’s rules. Prefer TOTP. You can delete the saved mailbox secret at any time.";

export const OTP_MAIL_POLL_MS = 5_000;

export type OtpMailTls = "imaps" | "starttls";

export interface OtpMailConfig {
  enabled: boolean;
  host: string;
  port: number;
  tls: OtpMailTls;
  username: string;
  passwordSaved: boolean;
  markSeen: boolean;
  tosAcceptedAt: string | null;
}

export interface OtpMailSetConfigInput {
  enabled: boolean;
  host: string;
  port: number;
  tls: OtpMailTls;
  username: string;
  /** Empty / omitted keeps the previously saved IMAP secret. */
  password?: string;
  markSeen: boolean;
  tosAcceptedAt?: string | null;
}

export interface OtpMailIpc {
  call: (method: string, params?: unknown) => Promise<unknown>;
  on: (event: string, handler: (data: unknown) => void) => () => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseOtpMailConfig(raw: unknown): OtpMailConfig {
  const obj = asRecord(raw);
  const port = typeof obj.port === "number" && Number.isFinite(obj.port) && obj.port > 0
    ? Math.trunc(obj.port)
    : 993;
  const tos = typeof obj.tosAcceptedAt === "string" && obj.tosAcceptedAt.trim().length > 0
    ? obj.tosAcceptedAt
    : null;
  return {
    enabled: obj.enabled === true,
    host: typeof obj.host === "string" ? obj.host : "",
    port,
    tls: obj.tls === "starttls" ? "starttls" : "imaps",
    username: typeof obj.username === "string" ? obj.username : "",
    passwordSaved: obj.passwordSaved === true,
    markSeen: obj.markSeen === true,
    tosAcceptedAt: tos,
  };
}

export function isOtpHelperReady(config: Pick<OtpMailConfig, "enabled" | "passwordSaved">): boolean {
  return config.enabled === true && config.passwordSaved === true;
}

export function canEnableOtpMail(greyEnabled: boolean, tosAcceptedAt: string | null | undefined): boolean {
  return greyEnabled === true && typeof tosAcceptedAt === "string" && tosAcceptedAt.length > 0;
}

export function digitsFromOtpPayload(data: unknown): string | null {
  const obj = asRecord(data);
  if (typeof obj.code !== "string") return null;
  const digits = obj.code.replace(/\D/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export function digitsFromPollResult(raw: unknown): string | null {
  const obj = asRecord(raw);
  if (obj.found === false) return null;
  if (obj.code == null || obj.code === "") return null;
  return digitsFromOtpPayload(raw);
}

export function isAuthLoginCompletedOk(data: unknown): boolean {
  return asRecord(data).ok === true;
}

/**
 * Build `otpMail.setConfig` params. Empty password is omitted (host keeps the
 * previous secret). VRChat credential keys are never included.
 */
export function buildOtpMailSetConfig(input: OtpMailSetConfigInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    enabled: input.enabled === true,
    host: input.host,
    port: input.port,
    tls: input.tls,
    username: input.username,
    markSeen: input.markSeen === true,
  };
  if (typeof input.password === "string" && input.password.length > 0) {
    payload.password = input.password;
  }
  if (typeof input.tosAcceptedAt === "string" && input.tosAcceptedAt.length > 0) {
    payload.tosAcceptedAt = input.tosAcceptedAt;
  }
  return payload;
}

export interface AttachOtpMailSessionOptions {
  ipc: OtpMailIpc;
  onCode: (code: string) => void;
  onLoginCompleted?: (ok: boolean) => void;
  pollMs?: number;
}

export interface OtpMailSession {
  ready: boolean;
  detach: () => void;
}

/**
 * While LoginForm is on email OTP: start IMAP poll if the helper is enabled
 * and a mailbox secret is saved. Always stop on detach (close / method change).
 */
export async function attachOtpMailSession(opts: AttachOtpMailSessionOptions): Promise<OtpMailSession> {
  const { ipc, onCode, onLoginCompleted } = opts;
  const pollMs = opts.pollMs ?? OTP_MAIL_POLL_MS;
  const noop: OtpMailSession = { ready: false, detach: () => {} };

  let raw: unknown;
  try {
    raw = await ipc.call("otpMail.getConfig", {});
  } catch {
    return noop;
  }
  const config = parseOtpMailConfig(raw);
  if (!isOtpHelperReady(config)) {
    return noop;
  }

  const offCode = ipc.on("otpMail.codeFound", (data) => {
    const digits = digitsFromOtpPayload(data);
    if (digits) onCode(digits);
  });
  const offLogin = onLoginCompleted
    ? ipc.on("auth.loginCompleted", (data) => {
        onLoginCompleted(isAuthLoginCompletedOk(data));
      })
    : () => {};

  try {
    await ipc.call("otpMail.start", {});
  } catch {
    offCode();
    offLogin();
    return noop;
  }

  let stopped = false;
  const timer = window.setInterval(() => {
    if (stopped) return;
    void ipc
      .call("otpMail.poll", {})
      .then((hit) => {
        if (stopped) return;
        const digits = digitsFromPollResult(hit);
        if (digits) onCode(digits);
      })
      .catch(() => {});
  }, pollMs);

  return {
    ready: true,
    detach: () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      offCode();
      offLogin();
      void ipc.call("otpMail.stop", {}).catch(() => {});
    },
  };
}
