import { beforeEach, describe, expect, it } from "vitest";
import {
  cardPreview,
  coerceOscValue,
  createOscProfile,
  deleteOscProfile,
  getActiveOscProfile,
  importOscStudioProfile,
  loadOscStudioProfiles,
  renameOscProfile,
  renderOscTemplate,
  saveOscStudioProfiles,
  setActiveOscProfile,
  setActiveProfileCards,
  type HardwareSnapshot,
  type OscStudioCard,
} from "../osc-studio";

const fixedNow = new Date("2026-06-24T12:34:56.000Z");

describe("coerceOscValue", () => {
  it("tags float values so a whole number keeps the OSC ',f' type", () => {
    // The bug this locks: parseFloat("1") === 1 serializes to a JSON integer
    // and the host would send it with ',i', which VRChat's float params drop.
    expect(coerceOscValue("float", "1")).toEqual({ t: "f", v: 1 });
    expect(coerceOscValue("float", "0.5")).toEqual({ t: "f", v: 0.5 });
  });

  it("leaves int/bool/string as bare primitives", () => {
    expect(coerceOscValue("int", "3")).toBe(3);
    expect(coerceOscValue("bool", "true")).toBe(true);
    expect(coerceOscValue("bool", "0")).toBe(false);
    expect(coerceOscValue("string", "hello")).toBe("hello");
  });

  it("returns null for unparseable numbers", () => {
    expect(coerceOscValue("float", "abc")).toBeNull();
    expect(coerceOscValue("int", "xyz")).toBeNull();
  });
});

describe("osc-studio templates", () => {
  it("renders clock tokens from the provided send-time date", () => {
    const rendered = renderOscTemplate("Clock {time.short} {date.iso}", { now: fixedNow });

    expect(rendered).toContain("56");
    expect(rendered).toContain("2026-06-24");
  });

  it("drops unavailable hardware segments instead of sending dashes", () => {
    const hardware: HardwareSnapshot = {
      telemetry: {
        generated_at: fixedNow.toISOString(),
        gpu: {
          temperature_c: 56,
          power_watts: 40.7,
        },
      },
    };

    const rendered = renderOscTemplate(
      "Thermal | CPU {cpu.tempC} {cpu.powerW} | GPU {gpu.tempC} {gpu.powerW} | Fan {gpu.fanPct}",
      { hardware, now: fixedNow },
    );

    expect(rendered).toBe("Thermal | GPU 56C 40.7W");
    expect(rendered).not.toContain("--");
    expect(rendered).not.toContain("CPU");
    expect(rendered).not.toContain("Fan");
  });

  it("does not treat a lone category label as a valid chatbox preview", () => {
    expect(renderOscTemplate("Thermal | CPU {cpu.tempC} | Fan {gpu.fanPct}", { now: fixedNow })).toBe("");
  });

  it("renders first detected fan sensor for thermal templates", () => {
    const hardware: HardwareSnapshot = {
      telemetry: {
        generated_at: fixedNow.toISOString(),
        fans: [
          {
            source: "aida64_shared_memory",
            id: "FGPU",
            name: "GPU Fan",
            sensor_type: "Fan",
            value: 1330,
            unit: "RPM",
          },
        ],
      },
    };

    expect(renderOscTemplate("Thermal | {fan.0}", { hardware, now: fixedNow })).toBe("Thermal | GPU Fan 1330RPM");
  });

  it("migrates old GPU fan percent templates to detected fan sensors", () => {
    const cards = importOscStudioProfile(JSON.stringify([
      {
        id: "thermal",
        kind: "sensor-temperature",
        title: "Thermal",
        group: "telemetry",
        enabled: true,
        address: "/chatbox/input",
        valueType: "string",
        value: "",
        template: "Thermal | GPU {gpu.tempC} | Fan {gpu.fanPct}",
      },
    ]));

    expect(cards[0].template).toBe("Thermal | GPU {gpu.tempC} | {fan.0}");
  });

  it("limits chatbox card previews to VRChat's visible chatbox length", () => {
    const card: OscStudioCard = {
      id: "long",
      kind: "chatbox-template",
      title: "Long",
      group: "chatbox",
      enabled: true,
      address: "/chatbox/input",
      valueType: "string",
      value: "",
      template: "x".repeat(200),
    };

    expect(cardPreview(card, { now: fixedNow })).toHaveLength(144);
  });
});

describe("osc-studio profiles", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("seeds a single Default profile on first load", () => {
    const state = loadOscStudioProfiles();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("Default");
    expect(state.activeProfileId).toBe(state.profiles[0].id);
    expect(state.profiles[0].cards.length).toBeGreaterThan(0);
  });

  it("migrates a legacy v4 single-card store into a Default profile", () => {
    const legacyCards = importOscStudioProfile(JSON.stringify([
      {
        id: "legacy",
        kind: "chatbox-template",
        title: "Legacy",
        group: "chatbox",
        enabled: true,
        address: "/chatbox/input",
        valueType: "string",
        value: "",
        template: "hi",
      },
    ]));
    localStorage.setItem("vrcsm.oscStudio.cards.v1", JSON.stringify({
      version: 4,
      cards: legacyCards,
      savedAt: fixedNow.toISOString(),
    }));

    const state = loadOscStudioProfiles();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0].name).toBe("Default");
    expect(state.profiles[0].cards.some((card) => card.id === "legacy")).toBe(true);
  });

  it("creates, switches, renames, and deletes profiles while keeping at least one", () => {
    let state = loadOscStudioProfiles();
    const defaultId = state.activeProfileId;

    state = createOscProfile(state, "Streaming");
    expect(state.profiles).toHaveLength(2);
    expect(getActiveOscProfile(state).name).toBe("Streaming");
    const streamingId = state.activeProfileId;

    state = renameOscProfile(state, streamingId, "Stream HUD");
    expect(state.profiles.find((p) => p.id === streamingId)?.name).toBe("Stream HUD");

    state = setActiveOscProfile(state, defaultId);
    expect(state.activeProfileId).toBe(defaultId);

    state = deleteOscProfile(state, streamingId);
    expect(state.profiles).toHaveLength(1);

    // Never drops the last remaining profile.
    state = deleteOscProfile(state, state.activeProfileId);
    expect(state.profiles).toHaveLength(1);
  });

  it("persists cards independently per profile across reloads", () => {
    let state = createOscProfile(loadOscStudioProfiles(), "Second");
    const secondId = state.activeProfileId;
    const card: OscStudioCard = {
      id: "second-only",
      kind: "chatbox-template",
      title: "Second only",
      group: "chatbox",
      enabled: true,
      address: "/chatbox/input",
      valueType: "string",
      value: "",
      template: "second",
    };
    state = setActiveProfileCards(state, [card]);
    saveOscStudioProfiles(state);

    const reloaded = loadOscStudioProfiles();
    const second = reloaded.profiles.find((p) => p.id === secondId);
    expect(second?.cards).toHaveLength(1);
    expect(second?.cards[0].id).toBe("second-only");
    // The Default profile still has its seeded cards.
    const other = reloaded.profiles.find((p) => p.id !== secondId);
    expect((other?.cards.length ?? 0)).toBeGreaterThan(1);
  });
});
