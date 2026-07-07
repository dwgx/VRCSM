import { describe, expect, it } from "vitest";
import {
  extrapolatePosition,
  foldToAscii,
  mmss,
  oscMarquee,
  oscProgressBar,
  renderOscTemplate,
  type NowPlayingSnapshot,
} from "../osc-studio";

function makeSnapshot(overrides: Partial<NowPlayingSnapshot> = {}): NowPlayingSnapshot {
  return {
    active: true,
    title: "Song",
    artist: "Artist",
    album: "Album",
    status: "playing",
    app_id: "Spotify.exe",
    app_name: "Spotify",
    position_ms: 60_000,
    duration_ms: 200_000,
    position_at_ms: 1_000_000,
    playback_rate: 1,
    has_thumbnail: false,
    ...overrides,
  };
}

describe("mmss", () => {
  it("formats 0 as 0:00", () => {
    expect(mmss(0)).toBe("0:00");
  });
  it("formats sub-minute", () => {
    expect(mmss(5_000)).toBe("0:05");
  });
  it("formats m:ss and zero-pads seconds", () => {
    expect(mmss(83_000)).toBe("1:23");
    expect(mmss(200_000)).toBe("3:20");
  });
  it("formats over an hour as h:mm:ss", () => {
    expect(mmss(3_723_000)).toBe("1:02:03");
  });
  it("treats negative / non-finite as 0", () => {
    expect(mmss(-5_000)).toBe("0:00");
    expect(mmss(Number.NaN)).toBe("0:00");
  });
  it("floors partial seconds", () => {
    expect(mmss(1_999)).toBe("0:01");
  });
});

describe("oscProgressBar", () => {
  it("renders an empty bar at position 0", () => {
    expect(oscProgressBar(0, 100, 10)).toBe("▭▭▭▭▭▭▭▭▭▭");
  });
  it("renders a full bar at the end", () => {
    expect(oscProgressBar(100, 100, 10)).toBe("▬▬▬▬▬▬▬▬▬▬");
  });
  it("renders a half bar at the midpoint", () => {
    expect(oscProgressBar(50, 100, 10)).toBe("▬▬▬▬▬▭▭▭▭▭");
  });
  it("clamps pos > dur to a full bar", () => {
    expect(oscProgressBar(500, 100, 8)).toBe("▬▬▬▬▬▬▬▬");
  });
  it("returns all-empty when dur <= 0 (unknown length)", () => {
    expect(oscProgressBar(50, 0, 6)).toBe("▭▭▭▭▭▭");
    expect(oscProgressBar(50, -1, 6)).toBe("▭▭▭▭▭▭");
  });
  it("respects custom glyphs and width", () => {
    expect(oscProgressBar(50, 100, 4, "#", "-")).toBe("##--");
  });
  it("returns empty string for non-positive width", () => {
    expect(oscProgressBar(50, 100, 0)).toBe("");
  });
});

describe("oscMarquee", () => {
  it("returns text unchanged when it fits", () => {
    expect(oscMarquee("short", 10, 0)).toBe("short");
    expect(oscMarquee("exactly-10", 10, 5)).toBe("exactly-10");
  });
  it("windows a long string to the given width", () => {
    const out = oscMarquee("abcdefghijklmnop", 5, 0);
    expect(Array.from(out)).toHaveLength(5);
    expect(out).toBe("abcde");
  });
  it("advances the window with tick", () => {
    expect(oscMarquee("abcdefghijklmnop", 5, 2)).toBe("cdefg");
  });
  it("wraps around through a separator and stays width-wide", () => {
    const long = "abcdefghij"; // 10 chars, sep adds 7 → period 17
    const out = oscMarquee(long, 5, 16);
    expect(Array.from(out)).toHaveLength(5);
  });
  it("returns empty string for non-positive width", () => {
    expect(oscMarquee("abcdef", 0, 0)).toBe("");
  });
});

describe("extrapolatePosition", () => {
  const now = 1_030_000; // 30s after position_at_ms in the fixture

  it("advances while playing at rate 1", () => {
    const m = makeSnapshot({ position_ms: 60_000, position_at_ms: 1_000_000, status: "playing" });
    expect(extrapolatePosition(m, now)).toBe(90_000);
  });
  it("scales by playback_rate", () => {
    const m = makeSnapshot({ position_ms: 60_000, position_at_ms: 1_000_000, playback_rate: 2 });
    expect(extrapolatePosition(m, now)).toBe(120_000);
  });
  it("freezes when paused", () => {
    const m = makeSnapshot({ position_ms: 60_000, position_at_ms: 1_000_000, status: "paused" });
    expect(extrapolatePosition(m, now)).toBe(60_000);
  });
  it("freezes when stopped", () => {
    const m = makeSnapshot({ position_ms: 42_000, position_at_ms: 1_000_000, status: "stopped" });
    expect(extrapolatePosition(m, now)).toBe(42_000);
  });
  it("clamps to duration_ms when playing past the end", () => {
    const m = makeSnapshot({ position_ms: 199_000, duration_ms: 200_000, position_at_ms: 1_000_000 });
    // 199s + 30s = 229s → clamped to 200s
    expect(extrapolatePosition(m, now)).toBe(200_000);
  });
  it("floors at 0 for a negative extrapolation", () => {
    const m = makeSnapshot({ position_ms: 1_000, position_at_ms: 1_000_000, playback_rate: 1 });
    expect(extrapolatePosition(m, 990_000)).toBe(0);
  });
  it("does not cap when duration is unknown (0)", () => {
    const m = makeSnapshot({ position_ms: 60_000, duration_ms: 0, position_at_ms: 1_000_000 });
    expect(extrapolatePosition(m, now)).toBe(90_000);
  });
  it("freezes at position_ms when position_at_ms is 0 (host couldn't read timeline)", () => {
    // Regression: a playing source that omits timeline data leaves
    // position_at_ms at its default 0 (epoch). Extrapolating from epoch would
    // add ~now ms and render an absurd position — must freeze instead.
    const m = makeSnapshot({ position_ms: 45_000, position_at_ms: 0, status: "playing" });
    expect(extrapolatePosition(m, now)).toBe(45_000);
  });
});

describe("renderOscTemplate music tokens", () => {
  const fixedNow = new Date(1_030_000);

  it("renders empty (not --) when no track is active", () => {
    const rendered = renderOscTemplate("{music.title} {music.artist}", {
      music: null,
      now: fixedNow,
    });
    expect(rendered).toBe("");
    expect(rendered).not.toContain("--");
  });

  it("renders empty when active is false", () => {
    const m = makeSnapshot({ active: false });
    expect(renderOscTemplate("♪ {music.title}", { music: m, now: fixedNow })).toBe("");
  });

  it("renders title/artist/status glyph/position/duration/percent", () => {
    const m = makeSnapshot({ position_ms: 60_000, duration_ms: 200_000, position_at_ms: 1_000_000 });
    const out = renderOscTemplate(
      "{music.status} {music.title} — {music.artist} {music.position}/{music.duration} {music.percent}",
      { music: m, now: fixedNow },
    );
    // position extrapolated to 90s = 1:30, duration 3:20, percent round(90/200)=45%
    expect(out).toContain("▶");
    expect(out).toContain("Song");
    expect(out).toContain("Artist");
    expect(out).toContain("1:30/3:20");
    expect(out).toContain("45%");
  });

  it("renders progress bar at the configured width", () => {
    const m = makeSnapshot({ position_ms: 100_000, duration_ms: 200_000, position_at_ms: 1_030_000 });
    const out = renderOscTemplate("[{music.progressBar}]", {
      music: m,
      now: fixedNow,
      musicProgressWidth: 10,
    });
    expect(out).toBe("[▬▬▬▬▬▭▭▭▭▭]");
  });
});

describe("foldToAscii", () => {
  it("leaves plain ASCII untouched", () => {
    expect(foldToAscii("Hello World 123")).toBe("Hello World 123");
  });
  it("transliterates accented Latin", () => {
    expect(foldToAscii("Café Motörhead")).toBe("Cafe Motorhead");
  });
  it("strips CJK", () => {
    expect(foldToAscii("東京 Tokyo")).toBe("Tokyo");
  });
});
