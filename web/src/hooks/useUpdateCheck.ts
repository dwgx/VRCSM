import { useState, useEffect } from "react";
import { ipc } from "@/lib/ipc";

export interface ReleaseInfo {
  version: string;
  url: string;
  publishedAt: string;
}

export function useUpdateCheck() {
  const [updateAvailable, setUpdateAvailable] = useState<ReleaseInfo | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        // First get current app version from host
        const appInfo = await ipc.call<undefined, { version: string }>("app.version");
        const currentVer = appInfo.version.replace(/^v/, "");

        // Fetch latest release from GitHub API
        const res = await fetch("https://api.github.com/repos/dwgx/VRCSM/releases/latest");
        if (!res.ok) throw new Error("Failed to fetch latest release");
        const data = await res.json();
        
        const latestVerStr = data.tag_name || "";
        const latestVer = latestVerStr.replace(/^v/, "");
        
        if (alive) {
          // simple string comparison, though semver parsing is robust, this works for x.y.z
          if (latestVer && latestVer !== currentVer) {
            setUpdateAvailable({
              version: latestVerStr,
              url: data.html_url,
              publishedAt: data.published_at
            });
          }
        }
      } catch (err) {
        console.warn("Update check failed:", err);
      } finally {
        if (alive) setChecking(false);
      }
    }
    
    check();
    return () => { alive = false; };
  }, []);

  return { updateAvailable, checking };
}
