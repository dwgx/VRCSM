import { describe, expect, it } from "vitest";
import { currentLyricLine, parseLrc, type LyricLine } from "../lyrics";
import { renderOscTemplate, type NowPlayingSnapshot } from "../osc-studio";

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

describe("parseLrc", () => {
  it("parses mm:ss.xx timestamps to ms", () => {
    const lines = parseLrc("[00:13.08] I am the God");
    expect(lines).toEqual([{ timeMs: 13_080, text: "I am the God" }]);
  });

  it("parses mm:ss.xxx (milliseconds) timestamps", () => {
    const lines = parseLrc("[01:02.500] line");
    expect(lines).toEqual([{ timeMs: 62_500, text: "line" }]);
  });

  it("parses mm:ss (no fraction) timestamps", () => {
    const lines = parseLrc("[02:05] line");
    expect(lines).toEqual([{ timeMs: 125_000, text: "line" }]);
  });

  it("accepts a colon before the fraction ([mm:ss:xx])", () => {
    const lines = parseLrc("[00:10:50] line");
    expect(lines).toEqual([{ timeMs: 10_500, text: "line" }]);
  });

  it("sorts unsorted input by time", () => {
    const lines = parseLrc("[00:30.00] third\n[00:05.00] first\n[00:15.00] second");
    expect(lines.map((l) => l.text)).toEqual(["first", "second", "third"]);
    expect(lines.map((l) => l.timeMs)).toEqual([5_000, 15_000, 30_000]);
  });

  it("skips blank lines and metadata-only tags", () => {
    const lrc = [
      "[ti:Song Title]",
      "[ar:Artist]",
      "[al:Album]",
      "[length:03:20]",
      "",
      "[00:00.00]",
      "[00:12.00] real line",
    ].join("\n");
    const lines = parseLrc(lrc);
    expect(lines).toEqual([{ timeMs: 12_000, text: "real line" }]);
  });

  it("expands a line carrying multiple timestamps", () => {
    const lines = parseLrc("[00:10.00][00:40.00] chorus");
    expect(lines).toEqual([
      { timeMs: 10_000, text: "chorus" },
      { timeMs: 40_000, text: "chorus" },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseLrc("")).toEqual([]);
  });
});

describe("currentLyricLine", () => {
  const lines: LyricLine[] = [
    { timeMs: 10_000, text: "first" },
    { timeMs: 20_000, text: "second" },
    { timeMs: 30_000, text: "third" },
  ];

  it("returns empty before the first timestamp", () => {
    expect(currentLyricLine(lines, 5_000)).toBe("");
  });

  it("returns the line at an exact boundary", () => {
    expect(currentLyricLine(lines, 10_000)).toBe("first");
    expect(currentLyricLine(lines, 20_000)).toBe("second");
  });

  it("returns the last line whose time <= position (between lines)", () => {
    expect(currentLyricLine(lines, 15_000)).toBe("first");
    expect(currentLyricLine(lines, 29_999)).toBe("second");
  });

  it("returns the final line after the last timestamp", () => {
    expect(currentLyricLine(lines, 999_999)).toBe("third");
  });

  it("returns empty for no lines", () => {
    expect(currentLyricLine([], 12_345)).toBe("");
  });

  it("treats non-finite position as 0", () => {
    expect(currentLyricLine(lines, Number.NaN)).toBe("");
  });
});

describe("{music.lyrics} rendering", () => {
  const fixedNow = new Date(1_030_000);

  it("renders the passed lyric line", () => {
    const m = makeSnapshot();
    const out = renderOscTemplate("♪ {music.lyrics}", {
      music: m,
      now: fixedNow,
      musicLyricLine: "I am the God",
    });
    expect(out).toBe("♪ I am the God");
  });

  it("renders empty when no lyric line is passed (active track)", () => {
    const m = makeSnapshot();
    // A card that is ONLY {music.lyrics} collapses to empty → send loop skips.
    expect(renderOscTemplate("{music.lyrics}", { music: m, now: fixedNow })).toBe("");
  });

  it("renders empty when no track is active", () => {
    expect(
      renderOscTemplate("♪ {music.lyrics}", {
        music: null,
        now: fixedNow,
        musicLyricLine: "should be ignored",
      }),
    ).toBe("");
  });
});
