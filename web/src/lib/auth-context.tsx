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
import type { AuthStatus } from "./types";

/**
 * Centralised VRChat auth state for the app. Three IPC touch-points:
 *
 *   - `auth.status`            cheap "are we still logged in" probe
 *   - `auth.openLoginWindow`   ask the host to pop a WebView2 that
 *                              navigates to vrchat.com/home/login; the
 *                              host harvests cookies on success and
 *                              broadcasts `auth.loginCompleted`
 *   - `auth.logout`            drop persisted session + wipe cookies
 *
 * This is PLAN.md §4.2 Option A: VRChat's own web frontend drives the
 * entire login dance (password + 2FA + Steam OAuth + captcha + email
 * verify) and we just watch the cookie jar for the final `auth` cookie.
 * VRCSM never sees the user's password — the only thing we persist is
 * the session cookie, via DPAPI, under `%LocalAppData%\VRCSM\session.dat`.
 *
 * The status poll runs every 30s when the window is visible. It
 * intentionally does NOT retry on failure — a 401 just means "not logged
 * in" and we want the UI to show that state immediately, not flap.
 */

interface OpenLoginResult {
  ok: boolean;
  error?: string;
}

interface AuthLoginCompletedEvent {
  ok: boolean;
  error?: string;
  user?: AuthStatus;
}

interface AuthContextValue {
  status: AuthStatus;
  loading: boolean;
  error: string | null;
  /**
   * Opens the WebView2 login popup. Resolves as soon as the popup is
   * spawned — actual success is delivered asynchronously through the
   * `auth.loginCompleted` event and reflected in `status` once the
   * follow-up `refresh()` completes.
   */
  openLogin: () => Promise<OpenLoginResult>;
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

  const openLogin = useCallback(async (): Promise<OpenLoginResult> => {
    try {
      const result = await ipc.call<undefined, OpenLoginResult>(
        "auth.openLoginWindow",
      );
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (mountedRef.current) setError(msg);
      return { ok: false, error: msg };
    }
  }, []);

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
  // a status refresh so the AuthChip / Friends page update without the
  // user having to click again. Failure (other than plain cancellation)
  // surfaces in `error`.
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

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      loading,
      error,
      openLogin,
      logout,
      refresh,
    }),
    [status, loading, error, openLogin, logout, refresh],
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
