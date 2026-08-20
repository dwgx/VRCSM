import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OTP_MAIL_TOS,
  attachOtpMailSession,
  buildOtpMailSetConfig,
  canEnableOtpMail,
  digitsFromOtpPayload,
  digitsFromPollResult,
  isOtpHelperReady,
  parseOtpMailConfig,
  type OtpMailIpc,
} from "../otp-mail-ui";

type Call = { method: string; params: unknown };

function makeIpc(options: {
  config?: unknown;
  getConfigError?: Error;
  startError?: Error;
  poll?: unknown;
}): { ipc: OtpMailIpc; calls: Call[]; emit: (event: string, data: unknown) => void } {
  const calls: Call[] = [];
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const ipc: OtpMailIpc = {
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === "otpMail.getConfig") {
        if (options.getConfigError) throw options.getConfigError;
        return options.config;
      }
      if (method === "otpMail.start" && options.startError) throw options.startError;
      if (method === "otpMail.poll") return options.poll ?? { found: false };
      return { ok: true };
    },
    on: (event, handler) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
  };
  return {
    ipc,
    calls,
    emit: (event, data) => {
      listeners.get(event)?.forEach((handler) => handler(data));
    },
  };
}

const readyConfig = {
  enabled: true,
  host: "imap.example.com",
  port: 993,
  tls: "imaps",
  username: "user@example.com",
  passwordSaved: true,
  markSeen: false,
  tosAcceptedAt: "2026-08-20T00:00:00.000Z",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("parseOtpMailConfig", () => {
  it("defaults port 993 / imaps and never keeps a password field", () => {
    const cfg = parseOtpMailConfig({
      enabled: true,
      password: "should-not-surface",
      vrcPassword: "nope",
      passwordSaved: true,
    });
    expect(cfg.port).toBe(993);
    expect(cfg.tls).toBe("imaps");
    expect(cfg.enabled).toBe(true);
    expect(cfg.passwordSaved).toBe(true);
    expect(cfg).not.toHaveProperty("password");
    expect(cfg).not.toHaveProperty("vrcPassword");
  });
});

describe("isOtpHelperReady / canEnableOtpMail", () => {
  it("requires enabled and passwordSaved", () => {
    expect(isOtpHelperReady({ enabled: true, passwordSaved: true })).toBe(true);
    expect(isOtpHelperReady({ enabled: true, passwordSaved: false })).toBe(false);
    expect(isOtpHelperReady({ enabled: false, passwordSaved: true })).toBe(false);
  });

  it("enable toggle needs grey master and TOS timestamp", () => {
    expect(canEnableOtpMail(true, "2026-08-20T00:00:00.000Z")).toBe(true);
    expect(canEnableOtpMail(false, "2026-08-20T00:00:00.000Z")).toBe(false);
    expect(canEnableOtpMail(true, null)).toBe(false);
    expect(canEnableOtpMail(true, "")).toBe(false);
  });
});

describe("buildOtpMailSetConfig", () => {
  it("omits empty password and never sends VRChat credential keys", () => {
    const payload = buildOtpMailSetConfig({
      enabled: true,
      host: "imap.gmail.com",
      port: 993,
      tls: "imaps",
      username: "a@b.c",
      password: "",
      markSeen: false,
      tosAcceptedAt: "2026-08-20T00:00:00.000Z",
    });
    expect(payload).toEqual({
      enabled: true,
      host: "imap.gmail.com",
      port: 993,
      tls: "imaps",
      username: "a@b.c",
      markSeen: false,
      tosAcceptedAt: "2026-08-20T00:00:00.000Z",
    });
    expect(payload).not.toHaveProperty("password");
    expect(payload).not.toHaveProperty("vrcPassword");
    expect(payload).not.toHaveProperty("authPassword");
  });

  it("includes a non-empty IMAP password only as password", () => {
    const payload = buildOtpMailSetConfig({
      enabled: false,
      host: "imap.example.com",
      port: 993,
      tls: "starttls",
      username: "box",
      password: "app-secret",
      markSeen: true,
    });
    expect(payload.password).toBe("app-secret");
    expect(payload.tls).toBe("starttls");
    expect(payload.markSeen).toBe(true);
    expect(Object.keys(payload)).not.toContain("vrcPassword");
    expect(Object.keys(payload)).not.toContain("authPassword");
  });
});

describe("digitsFromOtpPayload / poll", () => {
  it("accepts a 6-digit code from the event payload", () => {
    expect(digitsFromOtpPayload({ code: "123456", remainingTtlSec: 40 })).toBe("123456");
    expect(digitsFromOtpPayload({ code: "12-34-56" })).toBe("123456");
    expect(digitsFromOtpPayload({ code: "12345" })).toBeNull();
    expect(digitsFromOtpPayload({ remainingTtlSec: 10 })).toBeNull();
  });

  it("reads poll hits and ignores found:false / missing code", () => {
    expect(digitsFromPollResult({ found: true, code: "654321" })).toBe("654321");
    expect(digitsFromPollResult({ found: false, code: "654321" })).toBeNull();
    expect(digitsFromPollResult({ code: null })).toBeNull();
    expect(digitsFromPollResult({ found: false })).toBeNull();
  });
});

describe("attachOtpMailSession", () => {
  it("starts IMAP when stage is email OTP and the helper is ready", async () => {
    const { ipc, calls } = makeIpc({ config: readyConfig });
    const session = await attachOtpMailSession({ ipc, onCode: vi.fn() });
    expect(session.ready).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["otpMail.getConfig", "otpMail.start"]);
    expect(calls[1]?.params).toEqual({});
    session.detach();
  });

  it("does not start IMAP when the helper is off", async () => {
    const { ipc, calls } = makeIpc({
      config: { ...readyConfig, enabled: false },
    });
    const session = await attachOtpMailSession({ ipc, onCode: vi.fn() });
    expect(session.ready).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(["otpMail.getConfig"]);
    session.detach();
    expect(calls.map((c) => c.method)).toEqual(["otpMail.getConfig"]);
  });

  it("does not start when password is missing", async () => {
    const { ipc, calls } = makeIpc({
      config: { ...readyConfig, passwordSaved: false },
    });
    const session = await attachOtpMailSession({ ipc, onCode: vi.fn() });
    expect(session.ready).toBe(false);
    expect(calls.some((c) => c.method === "otpMail.start")).toBe(false);
    session.detach();
  });

  it("fills the 6-digit code from otpMail.codeFound", async () => {
    const { ipc, emit } = makeIpc({ config: readyConfig });
    const onCode = vi.fn();
    const session = await attachOtpMailSession({ ipc, onCode });
    emit("otpMail.codeFound", { code: "847291", remainingTtlSec: 50 });
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledWith("847291");
    session.detach();
  });

  it("stops IMAP on detach (dialog close / method change)", async () => {
    const { ipc, calls } = makeIpc({ config: readyConfig });
    const session = await attachOtpMailSession({ ipc, onCode: vi.fn() });
    session.detach();
    expect(calls.filter((c) => c.method === "otpMail.stop")).toHaveLength(1);
    expect(calls.find((c) => c.method === "otpMail.stop")?.params).toEqual({});
    session.detach();
    expect(calls.filter((c) => c.method === "otpMail.stop")).toHaveLength(1);
  });

  it("polls as a fallback when the event is missed", async () => {
    vi.useFakeTimers();
    const { ipc, calls } = makeIpc({
      config: readyConfig,
      poll: { found: true, code: "112233" },
    });
    const onCode = vi.fn();
    const session = await attachOtpMailSession({ ipc, onCode, pollMs: 5_000 });
    expect(onCode).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onCode).toHaveBeenCalledWith("112233");
    expect(calls.some((c) => c.method === "otpMail.poll")).toBe(true);
    session.detach();
  });

  it("closes via auth.loginCompleted after submitOnce host verify", async () => {
    const { ipc, emit } = makeIpc({ config: readyConfig });
    const onLoginCompleted = vi.fn();
    const session = await attachOtpMailSession({
      ipc,
      onCode: vi.fn(),
      onLoginCompleted,
    });
    emit("auth.loginCompleted", { ok: true, user: { authed: true } });
    expect(onLoginCompleted).toHaveBeenCalledWith(true);
    emit("auth.loginCompleted", { ok: false, error: "nope" });
    expect(onLoginCompleted).toHaveBeenCalledWith(false);
    session.detach();
  });

  it("treats getConfig failure as helper off", async () => {
    const { ipc, calls } = makeIpc({
      getConfigError: new Error("grey_disabled"),
    });
    const session = await attachOtpMailSession({ ipc, onCode: vi.fn() });
    expect(session.ready).toBe(false);
    expect(calls.some((c) => c.method === "otpMail.start")).toBe(false);
  });
});

describe("TOS copy", () => {
  it("keeps the spec paragraph for grey.tos.otpMail", () => {
    expect(OTP_MAIL_TOS).toContain("never stores your VRChat password");
    expect(OTP_MAIL_TOS).toContain("OFF by default");
    expect(OTP_MAIL_TOS).toContain("Prefer TOTP");
  });
});
