import React, { createContext, useContext, useEffect, useState } from "react";
import { ipc } from "@/lib/ipc";
import type { ProcessStatus } from "@/lib/types";

interface VrcProcessContextValue {
  status: ProcessStatus;
  loading: boolean;
}

const VrcProcessContext = createContext<VrcProcessContextValue | undefined>(undefined);

export function VrcProcessProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ProcessStatus>({ running: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initial fetch
    ipc
      .call<undefined, ProcessStatus>("process.vrcRunning", undefined)
      .then((s) => {
        setStatus(s);
        setLoading(false);
      })
      .catch((e) => {
        console.error("Failed to check VRC process status", e);
        setLoading(false);
      });

    // Subscribe to changes
    const unsubscribe = ipc.on<ProcessStatus>(
      "process.vrcStatusChanged",
      (evt) => {
        setStatus(evt);
      }
    );

    return () => unsubscribe();
  }, []);

  return (
    <VrcProcessContext.Provider value={{ status, loading }}>
      {children}
    </VrcProcessContext.Provider>
  );
}

export function useVrcProcess() {
  const context = useContext(VrcProcessContext);
  if (!context) {
    throw new Error("useVrcProcess must be used within a VrcProcessProvider");
  }
  return context;
}
