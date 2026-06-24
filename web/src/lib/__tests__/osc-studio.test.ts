import { describe, expect, it } from "vitest";
import {
  cardPreview,
  importOscStudioProfile,
  renderOscTemplate,
  type HardwareSnapshot,
  type OscStudioCard,
} from "../osc-studio";

const fixedNow = new Date("2026-06-24T12:34:56.000Z");

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
