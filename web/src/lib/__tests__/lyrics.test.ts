import { describe, expect, it } from "vitest";
import {
  currentLyricLine,
  currentLyricTrans,
  mergeTranslation,
  normalizeQuery,
  parseLrc,
  type LyricLine,
} from "../lyrics";
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

  it("renders the translated line for {music.lyricsTranslated}", () => {
    const m = makeSnapshot();
    // The template cleaner tightens spaces around "/", so the bilingual preset
    // renders as "lyric/translation".
    const out = renderOscTemplate("{music.lyrics} / {music.lyricsTranslated}", {
      music: m,
      now: fixedNow,
      musicLyricLine: "こんにちは",
      musicLyricTranslated: "Hello",
    });
    expect(out).toBe("こんにちは/Hello");
  });

  it("leaves {music.lyricsTranslated} empty when none is passed", () => {
    const m = makeSnapshot();
    const out = renderOscTemplate("{music.lyrics}{music.lyricsTranslated}", {
      music: m,
      now: fixedNow,
      musicLyricLine: "solo",
    });
    expect(out).toBe("solo");
  });
});

describe("normalizeQuery", () => {
  it("strips a parenthetical year", () => {
    expect(normalizeQuery("Yesterday (2006)", "The Beatles")).toEqual({
      title: "Yesterday",
      artist: "The Beatles",
    });
  });

  it("strips noise tags like Official / MV / Lyrics / HD", () => {
    expect(normalizeQuery("Shape of You (Official Video) [HD]", "Ed Sheeran")).toEqual({
      title: "Shape of You",
      artist: "Ed Sheeran",
    });
    expect(normalizeQuery("Song Name - Lyrics", "Artist").title).toBe("Song Name");
  });

  it("drops feat./ft. credits", () => {
    expect(normalizeQuery("Stay feat. Justin Bieber", "The Kid LAROI").title).toBe("Stay");
    expect(normalizeQuery("Track ft. Someone", "Main").title).toBe("Track");
  });

  it("strips CJK noise words and full-width brackets", () => {
    expect(normalizeQuery("告白气球（官方MV）【高清】", "周杰伦").title).toBe("告白气球");
  });

  it("splits 'Artist - Title' when artist is empty", () => {
    expect(normalizeQuery("Daft Punk - Get Lucky", "")).toEqual({
      title: "Get Lucky",
      artist: "Daft Punk",
    });
  });

  it("splits 'Artist - Title' when artist looks like an uploader channel", () => {
    expect(normalizeQuery("Adele - Hello", "AdeleVEVO")).toEqual({
      title: "Hello",
      artist: "Adele",
    });
  });

  it("keeps a real artist and does not split the title", () => {
    expect(normalizeQuery("Hello - Goodbye", "The Band")).toEqual({
      title: "Hello - Goodbye",
      artist: "The Band",
    });
  });
});

describe("mergeTranslation", () => {
  const main: LyricLine[] = [
    { timeMs: 1_000, text: "line one" },
    { timeMs: 5_000, text: "line two" },
    { timeMs: 9_000, text: "line three" },
  ];

  it("aligns translations to the nearest timestamp within tolerance", () => {
    const tr: LyricLine[] = [
      { timeMs: 1_050, text: "第一行" },
      { timeMs: 5_200, text: "第二行" },
      { timeMs: 9_000, text: "第三行" },
    ];
    const merged = mergeTranslation(main, tr);
    expect(merged.map((l) => l.trText)).toEqual(["第一行", "第二行", "第三行"]);
    // Original array is not mutated.
    expect(main[0].trText).toBeUndefined();
  });

  it("leaves trText empty when no translation is within ~1s", () => {
    const tr: LyricLine[] = [{ timeMs: 3_000, text: "far away" }];
    const merged = mergeTranslation(main, tr);
    // 3000 is >1s from every main line (nearest is line two at 5000, delta 2000).
    expect(merged.map((l) => l.trText)).toEqual([undefined, undefined, undefined]);
  });

  it("returns main unchanged when there is no translation track", () => {
    expect(mergeTranslation(main, [])).toBe(main);
  });
});

describe("currentLyricTrans", () => {
  const lines: LyricLine[] = [
    { timeMs: 10_000, text: "first", trText: "一" },
    { timeMs: 20_000, text: "second" },
    { timeMs: 30_000, text: "third", trText: "三" },
  ];

  it("returns the translation of the current line", () => {
    expect(currentLyricTrans(lines, 12_000)).toBe("一");
    expect(currentLyricTrans(lines, 35_000)).toBe("三");
  });

  it("returns empty when the current line has no translation", () => {
    expect(currentLyricTrans(lines, 22_000)).toBe("");
  });

  it("returns empty before the first line and for no lines", () => {
    expect(currentLyricTrans(lines, 5_000)).toBe("");
    expect(currentLyricTrans([], 12_000)).toBe("");
  });
});
