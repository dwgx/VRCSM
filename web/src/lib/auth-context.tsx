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
import { ipc } from "./ipc";
import { invalidateThumbnails } from "./thumbnails";
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
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const s = await ipc.call<undefined, AuthStatus>("auth.status");
      if (mountedRef.current) {
        setStatus(s);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus(fallbackStatus);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      try {
        const result = await ipc.call<
          { username: string; password: string },
          LoginResult
        >("auth.login", { username, password });
        if (result.status === "success" && mountedRef.current) {
          setError(null);
          // The host also broadcasts `auth.loginCompleted`, but pushing
          // the status directly here shaves one round-trip off the UI
          // update so the badge flips the instant the user closes the
          // login dialog.
          setStatus(result.user);
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
    [],
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
          setError(null);
          setStatus(result.user);
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
    [],
  );

  const logout = useCallback(async () => {
    try {
      await ipc.call<undefined, { ok: boolean }>("auth.logout");
    } finally {
      // Drop memoised thumbnail URLs so private-avatar fetches that
      // succeeded while signed in aren't served back from cache after
      // the cookie is gone (the host will return null, but we want the
      // cards to re-ask and fall back to the procedural placeholder).
      invalidateThumbnails();
      if (mountedRef.current) {
        setStatus(fallbackStatus);
        setError(null);
      }
    }
  }, []);

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
      if (pipelineState !== "stopped") {
        void ipc.pipelineStop().catch(() => {});
        setPipelineState("stopped");
      }
      return;
    }
    void ipc.pipelineStart().catch(() => {});
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
