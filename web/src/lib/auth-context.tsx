import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { ipc, IpcError } from "./ipc";
import { resetAccountScopedCaches } from "./cache-ownership";
import { subscribePipelineEvent } from "./pipeline-events";
import type { AuthStatus } from "./types";

/**
 * Centralised VRChat auth state. Four IPC touch-points:
 *
 *   - `auth.status`        cheap "are we still logged in" probe
 *   - `auth.login`         native WinHTTP call to /api/1/auth/user with
 *                          HTTP Basic credentials, captures the `auth`
 *                          cookie, returns {status: "success" | "requires2FA"
 *                          | "error"}
 *   - `auth.verify2FA`     POST the TOTP / emailOtp code to
 *                          /api/1/auth/twofactorauth/<method>/verify,
 *                          merges `twoFactorAuth` into the cookie jar
 *   - `auth.logout`        drop persisted session + wipe cookies
 *
 * This is the v0.5.0 rewrite: no more second WebView2 popup, no more
 * "sign in on vrchat.com in our window and we'll watch the cookie jar".
 * The user hands VRCSM their password through a native React form, the
 * C++ side calls the real VRChat REST API, and the only thing we
 * persist is the resulting session cookie (DPAPI-encrypted at
 * `%LocalAppData%\VRCSM\session.dat`).
 *
 * The status poll still runs every 30s when the window is visible. A
 * 401 just means "not logged in" and we want the UI to reflect that
 * state immediately, not flap.
 */

export type TwoFactorMethod = "totp" | "emailOtp" | "otp";

interface LoginSuccessResult {
  status: "success";
  user: AuthStatus;
}

interface LoginTwoFactorResult {
  status: "requires2FA";
  twoFactorMethods: TwoFactorMethod[];
}

interface LoginErrorResult {
  status: "error";
  error: string;
  httpStatus?: number;
}

export type LoginResult =
  | LoginSuccessResult
  | LoginTwoFactorResult
  | LoginErrorResult;

interface VerifyTwoFactorSuccess {
  ok: true;
  user: AuthStatus;
}

interface VerifyTwoFactorFailure {
  ok: false;
  error: string;
  httpStatus?: number;
}

export type VerifyTwoFactorResult =
  | VerifyTwoFactorSuccess
  | VerifyTwoFactorFailure;

interface AuthLoginCompletedEvent {
  ok: boolean;
  error?: string;
  user?: AuthStatus;
}

export type PipelineState =
  | "stopped"
  | "connecting"
  | "connected"
  | "reconnecting";

interface AuthContextValue {
  status: AuthStatus;
  loading: boolean;
  error: string | null;
  pipelineState: PipelineState;
  /**
   * Call VRChat `/api/1/auth/user` with HTTP Basic auth. Resolves with
   * `status: "success"` once logged in (the context's own status is
   * updated automatically via the `auth.loginCompleted` event),
   * `"requires2FA"` when a TOTP / emailOtp code is needed, or
   * `"error"` with a human-readable reason the form can display.
   */
  login: (username: string, password: string) => Promise<LoginResult>;
  /**
   * Second leg of the 2FA flow. `method` matches one of the values from
   * `LoginResult.twoFactorMethods`; `code` is the 6-digit TOTP or
   * emailOtp digits the user typed.
   */
  verifyTwoFactor: (
    method: TwoFactorMethod,
    code: string,
  ) => Promise<VerifyTwoFactorResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const fallbackStatus: AuthStatus = {
  authed: false,
  userId: null,
  displayName: null,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>(fallbackStatus);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pipelineState, setPipelineState] = useState<PipelineState>("stopped");
  const pipelineRef = useRef(pipelineState);
  pipelineRef.current = pipelineState;
  const mountedRef = useRef(true);
  const statusRef = useRef<AuthStatus>(fallbackStatus);
  const statusReadyRef = useRef(false);

  const commitStatus = useCallback((
    next: AuthStatus,
    options: { suppressCacheReset?: boolean } = {},
  ) => {
    const prev = statusRef.current;
    if (!options.suppressCacheReset && statusReadyRef.current) {
      const prevUserId = prev.userId ?? null;
      const nextUserId = next.userId ?? null;
      if (prev.authed && !next.authed) {
        resetAccountScopedCaches("auth-expired");
      } else if (prev.authed && next.authed && prevUserId && nextUserId && prevUserId !== nextUserId) {
        resetAccountScopedCaches("account-switch");
      }
    }
    statusRef.current = next;
    statusReadyRef.current = true;
    setStatus(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await ipc.call<undefined, AuthStatus>("auth.status");
      if (mountedRef.current) {
        commitStatus(s);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : String(e));
        // Only an authoritative auth-expired error means "you are logged out"
        // — commit the logged-out fallback (which wipes account caches). A
        // transient error (429/500/network) must NOT flip us to logged-out:
        // that would drop the pipeline + wipe caches and the refetch storm
        // feeds more 429s. Preserve the prior status on transient failures.
        if (e instanceof IpcError && e.isAuthExpired) {
          commitStatus(fallbackStatus);
        }
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [commitStatus]);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      try {
        const result = await ipc.call<
          { username: string; password: string },
          LoginResult
        >("auth.login", { username, password });
        if (result.status === "success" && mountedRef.current) {
          resetAccountScopedCaches("login");
          setError(null);
          // The host also broadcasts `auth.loginCompleted`, but pushing
          // the status directly here shaves one round-trip off the UI
          // update so the badge flips the instant the user closes the
          // login dialog.
          commitStatus(result.user, { suppressCacheReset: true });
        } else if (result.status === "error" && mountedRef.current) {
          setError(result.error);
        }
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mountedRef.current) setError(msg);
        return { status: "error", error: msg };
      }
    },
    [commitStatus],
  );

  const verifyTwoFactor = useCallback(
    async (
      method: TwoFactorMethod,
      code: string,
    ): Promise<VerifyTwoFactorResult> => {
      try {
        const result = await ipc.call<
          { method: TwoFactorMethod; code: string },
          VerifyTwoFactorResult
        >("auth.verify2FA", { method, code });
        if (result.ok && mountedRef.current) {
          resetAccountScopedCaches("login");
          setError(null);
          commitStatus(result.user, { suppressCacheReset: true });
        } else if (!result.ok && mountedRef.current) {
          setError(result.error);
        }
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mountedRef.current) setError(msg);
        return { ok: false, error: msg };
      }
    },
    [commitStatus],
  );

  const logout = useCallback(async () => {
    try {
      await ipc.call<undefined, { ok: boolean }>("auth.logout");
    } finally {
      resetAccountScopedCaches("logout");
      if (mountedRef.current) {
        commitStatus(fallbackStatus, { suppressCacheReset: true });
        setError(null);
      }
    }
  }, [commitStatus]);

  // Subscribe to the host-side login completion event. Success triggers
  // a status refresh so the AuthChip / Friends page update even when
  // the login came from somewhere other than the dialog (e.g. a
  // cookie-rehydrate on app launch).
  useEffect(() => {
    const unsubscribe = ipc.on<AuthLoginCompletedEvent>(
      "auth.loginCompleted",
      (event) => {
        if (!mountedRef.current) return;
        if (event.ok) {
          const current = statusRef.current;
          const eventUserId = event.user?.userId ?? null;
          if (!current.authed || !eventUserId || current.userId !== eventUserId) {
            resetAccountScopedCaches("login");
          }
          setError(null);
          void refresh();
        } else if (event.error && event.error !== "cancelled") {
          setError(event.error);
        }
      },
    );
    return unsubscribe;
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  // Pipeline WebSocket lifecycle — follows auth. Starts when the
  // session is live, stops on logout. Connection-state updates arrive
  // as `pipeline.state` events from the host thread.
  useEffect(() => {
    if (!status.authed) {
      if (pipelineRef.current !== "stopped") {
        void ipc.pipelineStop().catch((err) => { console.warn("[auth] pipelineStop failed:", err instanceof Error ? err.message : String(err)); });
        setPipelineState("stopped");
      }
      return;
    }
    void ipc.pipelineStart().catch((err) => { console.warn("[auth] pipelineStart failed:", err instanceof Error ? err.message : String(err)); });
  }, [status.authed]);

  useEffect(() => {
    const unsub = ipc.on<{ state: PipelineState; detail: string }>(
      "pipeline.state",
      (ev) => {
        if (mountedRef.current) setPipelineState(ev.state);
      },
    );
    return unsub;
  }, []);

  // VRChat pushes `user-update` whenever the *current* user's profile
  // changes (status, bio, language tags, avatar, …) — refetch our auth
  // status snapshot so the toolbar chip and Profile page reflect it
  // without waiting for the next 30s poll.
  useEffect(() => {
    if (!status.authed) return;
    const unsub = subscribePipelineEvent("user-update", () => {
      void refresh();
    });
    return unsub;
  }, [status.authed, refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      loading,
      error,
      pipelineState,
      login,
      verifyTwoFactor,
      logout,
      refresh,
    }),
    [status, loading, error, pipelineState, login, verifyTwoFactor, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
