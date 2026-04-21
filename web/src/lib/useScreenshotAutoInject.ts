import { useEffect } from "react";
import { ipc } from "./ipc";
import { readUiPrefBoolean } from "./ui-prefs";

const PREF_KEY = "vrcsm.screenshots.autoInject";

/**
 * Drives the C++-side screenshot watcher from the user's preference. The
 * watcher itself does the work — pulls the current radar snapshot and
 * injects it as PNG tEXt chunks the moment a new capture lands. This
 * hook just toggles the watcher process based on the saved preference.
 *
 * Mounted once at the app shell; restarts the watcher when the
 * preference flips (via the `vrcsm:ui-pref-changed` event ui-prefs
 * dispatches on writes).
 */
export function useScreenshotAutoInject() {
  useEffect(() => {
    const apply = () => {
      const enabled = readUiPrefBoolean(PREF_KEY, true);
      if (enabled) {
        void ipc.screenshotsWatcherStart().catch(() => {});
      } else {
        void ipc.screenshotsWatcherStop().catch(() => {});
      }
    };

    apply();

    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key === PREF_KEY) apply();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PREF_KEY) apply();
    };
    window.addEventListener("vrcsm:ui-pref-changed", handleCustom as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("vrcsm:ui-pref-changed", handleCustom as EventListener);
      window.removeEventListener("storage", handleStorage);
      void ipc.screenshotsWatcherStop().catch(() => {});
    };
  }, []);
}
