import { useEffect, useState } from "react";

const UI_PREF_CHANGED_EVENT = "vrcsm:ui-pref-changed";

export function readUiPrefBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  return raw === "true";
}

export function writeUiPrefBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, String(value));
  window.dispatchEvent(
    new CustomEvent(UI_PREF_CHANGED_EVENT, {
      detail: { key, value },
    }),
  );
}

export function readUiPrefString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw;
}

export function writeUiPrefString(key: string, value: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
  window.dispatchEvent(
    new CustomEvent(UI_PREF_CHANGED_EVENT, {
      detail: { key, value },
    }),
  );
}

export function useUiPrefString(key: string, fallback: string) {
  const [value, setValue] = useState<string>(() => readUiPrefString(key, fallback));

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setValue(readUiPrefString(key, fallback));
    };
    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: string }>).detail;
      if (detail?.key !== key) return;
      setValue(detail.value ?? fallback);
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(UI_PREF_CHANGED_EVENT, handleCustom as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(UI_PREF_CHANGED_EVENT, handleCustom as EventListener);
    };
  }, [fallback, key]);

  const update = (next: string | ((current: string) => string)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      writeUiPrefString(key, resolved);
      return resolved;
    });
  };

  return [value, update] as const;
}

export function useUiPrefBoolean(key: string, fallback: boolean) {
  const [value, setValue] = useState<boolean>(() => readUiPrefBoolean(key, fallback));

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) {
        return;
      }
      setValue(readUiPrefBoolean(key, fallback));
    };

    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: boolean }>).detail;
      if (detail?.key !== key) {
        return;
      }
      setValue(Boolean(detail.value));
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(UI_PREF_CHANGED_EVENT, handleCustom as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(UI_PREF_CHANGED_EVENT, handleCustom as EventListener);
    };
  }, [fallback, key]);

  const update = (next: boolean | ((current: boolean) => boolean)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      writeUiPrefBoolean(key, resolved);
      return resolved;
    });
  };

  return [value, update] as const;
}
