import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ipc } from "@/lib/ipc";
import type { Report } from "@/lib/types";

/**
 * A single app-wide scan result, shared across pages. Pages used to each
 * call `ipc.scan()` on mount which meant every sidebar navigation kicked
 * off a fresh filesystem walk. Now pages pull from this context and only
 * re-fetch when the user explicitly clicks Rescan in the title bar.
 */
interface ReportContextValue {
  report: Report | null;
  loading: boolean;
  error: string | null;
  /** Force a fresh scan, ignoring any in-flight request. */
  refresh: () => void;
  /** Lazy ensure — no-op if we already have a report or one is in flight. */
  ensure: () => void;
}

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);

  const run = useCallback(() => {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    setError(null);
    ipc
      .scan()
      .then((r) => {
        setReport(r);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      })
      .finally(() => {
        inflight.current = false;
        setLoading(false);
      });
  }, []);

  const refresh = useCallback(() => {
    // Clear any current report so consumers can show a fresh-loading state
    // if they want — but the most common pattern is "keep showing the old
    // data until the new one arrives" so we leave `report` untouched.
    run();
  }, [run]);

  const ensure = useCallback(() => {
    if (report || inflight.current) return;
    run();
  }, [report, run]);

  // Kick off the initial scan once, at mount.
  useEffect(() => {
    ensure();
  }, [ensure]);

  const value = useMemo<ReportContextValue>(
    () => ({ report, loading, error, refresh, ensure }),
    [report, loading, error, refresh, ensure],
  );

  return (
    <ReportContext.Provider value={value}>{children}</ReportContext.Provider>
  );
}

export function useReport(): ReportContextValue {
  const ctx = useContext(ReportContext);
  if (!ctx) {
    throw new Error("useReport must be used inside a <ReportProvider>");
  }
  return ctx;
}
