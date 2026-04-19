import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ipc } from "@/lib/ipc";
import type { InstalledPluginDto } from "@/lib/types";

interface PluginRegistryState {
  plugins: InstalledPluginDto[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PluginRegistryState | null>(null);

export function PluginRegistryProvider({ children }: { children: ReactNode }) {
  const [plugins, setPlugins] = useState<InstalledPluginDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipc.pluginList();
      setPlugins(res.plugins);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<PluginRegistryState>(
    () => ({ plugins, loading, error, refresh }),
    [plugins, loading, error, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePluginRegistry(): PluginRegistryState {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("usePluginRegistry must be used within PluginRegistryProvider");
  }
  return v;
}

export function useInstalledPanelPlugins() {
  const { plugins } = usePluginRegistry();
  return useMemo(
    () =>
      plugins.filter(
        (p) => p.enabled && (p.shape === "panel" || p.shape === "app"),
      ),
    [plugins],
  );
}
