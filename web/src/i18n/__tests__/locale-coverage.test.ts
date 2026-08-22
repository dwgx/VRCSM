import { describe, expect, it } from "vitest";

import en from "../locales/en.json";
import hi from "../locales/hi.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";
import ru from "../locales/ru.json";
import th from "../locales/th.json";
import zhCN from "../locales/zh-CN.json";

// en is the configured fallbackLng (see ../index.ts). Any key present in a
// content locale but missing from en would silently fall back to the raw key
// string at runtime. All seven locales must share the same leaf-key set, and
// {{placeholder}} names must match en so interpolations do not go blank.

type Json = Record<string, unknown>;

const LOCALES: { id: string; data: Json }[] = [
  { id: "zh-CN", data: zhCN as Json },
  { id: "ja", data: ja as Json },
  { id: "ko", data: ko as Json },
  { id: "ru", data: ru as Json },
  { id: "th", data: th as Json },
  { id: "hi", data: hi as Json },
];

/** Collect every leaf key path (dot-joined) from a nested locale object. */
function leafKeys(obj: Json, prefix = "", out: string[] = []): string[] {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      leafKeys(v as Json, path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

function flatten(obj: Json, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v as Json, path, out);
    } else {
      out[path] = String(v ?? "");
    }
  }
  return out;
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
}

describe("locale key coverage", () => {
  const enKeyList = leafKeys(en as Json);
  const enKeySet = new Set(enKeyList);
  const enFlat = flatten(en as Json);

  it("en (fallback locale) has every key present in zh-CN", () => {
    const missing = leafKeys(zhCN as Json).filter((k) => !enKeySet.has(k));
    expect({ missingCount: missing.length, sample: missing.slice(0, 25) }).toEqual({
      missingCount: 0,
      sample: [],
    });
  });

  it.each(LOCALES)("$id has every en key", ({ data }) => {
    const locKeys = new Set(leafKeys(data));
    const missing = enKeyList.filter((k) => !locKeys.has(k));
    expect({ missingCount: missing.length, sample: missing.slice(0, 25) }).toEqual({
      missingCount: 0,
      sample: [],
    });
  });

  it.each(LOCALES)("$id preserves {{placeholders}} from en", ({ data }) => {
    const loc = flatten(data);
    const drift = Object.keys(enFlat)
      .filter((k) => k in loc)
      .filter((k) => placeholders(enFlat[k]).join(",") !== placeholders(loc[k]).join(","))
      .slice(0, 25);
    expect(drift).toEqual([]);
  });

  it("grey.master.desc says the master switch is on by default", () => {
    expect(enFlat["grey.master.desc"]).toMatch(/On by default/i);
    expect(enFlat["grey.master.desc"]).not.toMatch(/Off by default/i);

    const staleOff: Record<string, string> = {
      "zh-CN": "默认关闭",
      ja: "既定はオフ",
      ko: "기본값 꺼짐",
      ru: "По умолчанию выкл",
      th: "ค่าเริ่มต้นปิด",
      hi: "डिफ़ॉल्ट बंद",
    };
    for (const { id, data } of LOCALES) {
      const desc = flatten(data)["grey.master.desc"];
      expect(desc, id).not.toContain(staleOff[id]);
    }
  });
});
