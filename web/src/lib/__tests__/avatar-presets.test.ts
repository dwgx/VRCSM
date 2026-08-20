import { describe, expect, it } from "vitest";
import {
  AVATAR_PRESET_SCHEMA,
  AVATAR_PRESETS_STORAGE_KEY,
  applyAvatarPreset,
  createPreset,
  deletePreset,
  deserializeAvatarPreset,
  isAvatarMismatch,
  listPresetsForAvatar,
  loadAvatarPresets,
  looksLikeForeignShareCode,
  mergeLiveOscParams,
  oscAddressForParam,
  oscArgForValue,
  oscSendsForPreset,
  paramsFromLocalParameters,
  parseAvatarPreset,
  parseAvatarPresetStore,
  saveAvatarPresets,
  serializeAvatarPreset,
  serializeAvatarPresetStore,
  upsertPreset,
  type AvatarPreset,
} from "../avatar-presets";

const AVATAR_A = "avtr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AVATAR_B = "avtr_11111111-2222-3333-4444-555555555555";

function preset(partial: Partial<AvatarPreset> = {}): AvatarPreset {
  return {
    id: "preset-1",
    name: "Default look",
    avatarId: AVATAR_A,
    params: { GestureLeft: 2, MuteSelf: false },
    savedAt: "2026-08-20T12:00:00.000Z",
    ...partial,
  };
}

describe("serialize/deserialize", () => {
  it("round-trips the required shape", () => {
    const src = preset({
      params: { GestureLeft: 2, MuteSelf: true, Face: "smile", Blend: 0.25 },
    });
    const raw = serializeAvatarPreset(src);
    expect(deserializeAvatarPreset(raw)).toEqual(src);
    expect(JSON.parse(raw)).toEqual({
      id: src.id,
      name: src.name,
      avatarId: src.avatarId,
      params: src.params,
      savedAt: src.savedAt,
    });
  });

  it("rejects missing fields and nested param values", () => {
    expect(parseAvatarPreset({ name: "x", avatarId: AVATAR_A, params: {}, savedAt: "t" })).toBeNull();
    expect(parseAvatarPreset({ id: "1", avatarId: AVATAR_A, params: {}, savedAt: "t" })).toBeNull();
    expect(parseAvatarPreset({ id: "1", name: "x", params: {}, savedAt: "t" })).toBeNull();
    expect(
      parseAvatarPreset({
        id: "1",
        name: "x",
        avatarId: "wrld_not_an_avatar",
        params: { a: 1 },
        savedAt: "t",
      }),
    ).toBeNull();
    expect(
      parseAvatarPreset({
        id: "1",
        name: "x",
        avatarId: AVATAR_A,
        params: { nested: { v: 1 } },
        savedAt: "t",
      }),
    ).toEqual({
      id: "1",
      name: "x",
      avatarId: AVATAR_A,
      params: {},
      savedAt: "t",
    });
  });

  it("rejects AvatarSaver / ASM-style share codes", () => {
    expect(looksLikeForeignShareCode("ASM1-ABCDEF")).toBe(true);
    expect(looksLikeForeignShareCode("avtr_xxx:GestureLeft=1")).toBe(true);
    expect(deserializeAvatarPreset("ASM1-ABCDEF")).toBeNull();
    expect(deserializeAvatarPreset("not json at all")).toBeNull();
    expect(parseAvatarPresetStore("ASM1-ABCDEF")).toEqual([]);
  });

  it("parses a store blob and a keyed-by-avatarId bag", () => {
    const a = preset();
    const b = preset({ id: "preset-2", avatarId: AVATAR_B, name: "Other" });
    const store = serializeAvatarPresetStore([a, b]);
    expect(JSON.parse(store).schema).toBe(AVATAR_PRESET_SCHEMA);
    expect(parseAvatarPresetStore(store)).toEqual([a, b]);

    const keyed = JSON.stringify({
      schema: AVATAR_PRESET_SCHEMA,
      byAvatar: {
        [AVATAR_A]: [{ id: "k1", name: "Keyed", params: { x: 1 }, savedAt: "t" }],
      },
    });
    const fromKeyed = parseAvatarPresetStore(keyed);
    expect(fromKeyed).toHaveLength(1);
    expect(fromKeyed[0]).toMatchObject({
      id: "k1",
      name: "Keyed",
      avatarId: AVATAR_A,
      params: { x: 1 },
    });
  });
});

describe("paramsFromLocalParameters / live OSC overlay", () => {
  it("maps LocalAvatarData defaults and skips junk", () => {
    expect(
      paramsFromLocalParameters([
        { name: "MuteSelf", value_type: "bool", default_value: true },
        { name: "/avatar/parameters/GestureLeft", value_type: "int", default_value: 2 },
        { name: "VRCFaceBlendH", value_type: "float", default_value: 0.5 },
        { name: "Note", value_type: "string", default_value: "hi" },
        { name: "", default_value: 1 },
        { name: "Bad", default_value: { nested: true } },
      ]),
    ).toEqual({
      MuteSelf: true,
      GestureLeft: 2,
      VRCFaceBlendH: 0.5,
      Note: "hi",
    });
  });

  it("lets live OSC overlay LocalAvatarData on matching names", () => {
    const base = paramsFromLocalParameters([
      { name: "MuteSelf", value_type: "bool", default_value: false },
      { name: "GestureLeft", value_type: "int", default_value: 0 },
    ]);
    const merged = mergeLiveOscParams(base, [
      { address: "/avatar/parameters/MuteSelf", args: [true] },
      { address: "/avatar/parameters/GestureLeft", args: [3] },
      { address: "/chatbox/input", args: ["nope"] },
      { address: "/avatar/parameters/NewFlag", args: [true] },
    ]);
    expect(merged).toEqual({
      MuteSelf: true,
      GestureLeft: 3,
      NewFlag: true,
    });
  });
});

describe("create / list / upsert / delete", () => {
  it("creates a named preset and refuses empty params or a non-avatar id", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    const made = createPreset({
      name: "  Sleep  ",
      avatarId: AVATAR_A,
      params: { MuteSelf: true },
      id: "p-sleep",
      now,
    });
    expect(made).toEqual({
      id: "p-sleep",
      name: "Sleep",
      avatarId: AVATAR_A,
      params: { MuteSelf: true },
      savedAt: now.toISOString(),
    });
    expect(createPreset({ name: "x", avatarId: "usr_nope", params: { a: 1 } })).toBeNull();
    expect(createPreset({ name: "x", avatarId: AVATAR_A, params: {} })).toBeNull();
  });

  it("lists by avatarId and upserts/deletes by id", () => {
    const a = preset();
    const b = preset({ id: "preset-2", avatarId: AVATAR_B, name: "Other" });
    const listed = listPresetsForAvatar([a, b], AVATAR_A);
    expect(listed).toEqual([a]);
    const updated = upsertPreset([a, b], { ...a, name: "Renamed", savedAt: "2026-08-21T00:00:00.000Z" });
    expect(updated[0].name).toBe("Renamed");
    expect(updated).toHaveLength(2);
    expect(deletePreset(updated, "preset-2").map((p) => p.id)).toEqual(["preset-1"]);
  });
});

describe("mismatch + OSC apply", () => {
  it("flags a different avtr_* and ignores empty/non-avatar current ids", () => {
    expect(isAvatarMismatch(preset(), AVATAR_B)).toBe(true);
    expect(isAvatarMismatch(preset(), AVATAR_A)).toBe(false);
    expect(isAvatarMismatch(preset(), "")).toBe(false);
    expect(isAvatarMismatch(preset(), "usr_someone")).toBe(false);
  });

  it("builds /avatar/parameters sends with tagged floats", () => {
    expect(oscAddressForParam("MuteSelf")).toBe("/avatar/parameters/MuteSelf");
    expect(oscArgForValue(1)).toEqual({ t: "f", v: 1 });
    expect(oscArgForValue(0.5)).toEqual({ t: "f", v: 0.5 });
    expect(oscArgForValue(true)).toBe(true);
    expect(oscArgForValue("smile")).toBe("smile");
    const sends = oscSendsForPreset(
      preset({ params: { MuteSelf: true, GestureLeft: 2 } }),
    );
    expect(sends).toEqual([
      { address: "/avatar/parameters/MuteSelf", args: [true] },
      { address: "/avatar/parameters/GestureLeft", args: [{ t: "f", v: 2 }] },
    ]);
  });

  it("applyAvatarPreset counts sent/failed without throwing", async () => {
    const calls: Array<{ address: string; args: unknown[] }> = [];
    const result = await applyAvatarPreset(
      preset({ params: { MuteSelf: true, GestureLeft: 1 } }),
      async (address, args) => {
        calls.push({ address, args });
        if (address.endsWith("GestureLeft")) return { ok: false };
        return { ok: true };
      },
    );
    expect(calls).toHaveLength(2);
    expect(result).toEqual({ sent: 1, skipped: 0, failed: 1 });
  });
});

describe("localStorage store", () => {
  it("reads and writes the ui-prefs key", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    const a = preset();
    saveAvatarPresets([a], storage);
    expect(mem.get(AVATAR_PRESETS_STORAGE_KEY)).toContain(AVATAR_PRESET_SCHEMA);
    expect(loadAvatarPresets(storage)).toEqual([a]);
    expect(loadAvatarPresets({ getItem: () => "not-json", setItem: () => {} })).toEqual([]);
  });
});
