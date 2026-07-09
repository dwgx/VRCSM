import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the IPC client so the host-proxy path (lyrics.fetch) never hits the
// network. Each test drives ipcCallMock's return value / rejection.
const ipcCallMock = vi.fn();
vi.mock("@/lib/ipc", () => ({
  ipc: {
    call: (...args: unknown[]) => ipcCallMock(...args),
  },
}));

import {
  currentLyricLine,
  currentLyricTrans,
  fetchLyrics,
  hostFetchJson,
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

describe("hostFetchJson", () => {
  beforeEach(() => {
    ipcCallMock.mockReset();
  });

  it("parses the returned body on a 2xx status", async () => {
    ipcCallMock.mockResolvedValue({ status: 200, body: JSON.stringify({ ok: 1 }) });
    const out = await hostFetchJson("https://lrclib.net/api/get");
    expect(out).toEqual({ ok: 1 });
  });

  it("returns null on a non-2xx status", async () => {
    ipcCallMock.mockResolvedValue({ status: 404, body: "" });
    expect(await hostFetchJson("https://lrclib.net/api/get")).toBeNull();
  });

  it("returns null when the ipc call rejects (no host / SSRF rail)", async () => {
    ipcCallMock.mockRejectedValue(new Error("lyrics_fetch_failed"));
    expect(await hostFetchJson("https://music.163.com/api")).toBeNull();
  });

  it("returns null on an unparseable body", async () => {
    ipcCallMock.mockResolvedValue({ status: 200, body: "not json {" });
    expect(await hostFetchJson("https://lrclib.net/api/get")).toBeNull();
  });
});

describe("fetchLyrics source selection", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    ipcCallMock.mockReset();
    // Fail any direct browser fetch fallback so a leaked network call is
    // visible as a miss rather than a real request.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("no network in test")) as never;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  // A synced LRCLIB record the host proxy returns for the exact /get lookup.
  const lrclibBody = JSON.stringify({
    instrumental: false,
    syncedLyrics: "[00:00.00] lrclib line",
  });
  // A NetEase search + lyric pair.
  const neteaseSearchBody = JSON.stringify({
    result: { songs: [{ id: 42, name: "NetEase Song", artists: [{ name: "NetEase Artist" }], duration: 200_000 }] },
  });
  const neteaseLyricBody = JSON.stringify({ lrc: { lyric: "[00:00.00] netease line" } });
  // A QQ smartbox search + lyric pair.
  const qqSearchBody = JSON.stringify({
    data: { song: { itemlist: [{ mid: "000abc", name: "QQ Song", singer: "QQ Artist" }] } },
  });
  const qqLyricBody = JSON.stringify({ lyric: "[00:00.00] qq line" });

  it("uses only LRCLIB when netease and qq and kugou are disabled", async () => {
    // LRCLIB miss (empty record); with the other providers off the chain
    // must NOT fall through to NetEase, QQ, or Kugou.
    ipcCallMock.mockResolvedValue({ status: 200, body: JSON.stringify({}) });

    const res = await fetchLyrics("SkipTrack", "Artist A", "", 200_000, {
      sources: { lrclib: true, netease: false, qq: false, kugou: false },
    });

    expect(res.found).toBe(false);
    for (const call of ipcCallMock.mock.calls) {
      const url = (call[1] as { url: string }).url;
      expect(url).toContain("lrclib.net");
      expect(url).not.toContain("music.163.com");
      expect(url).not.toContain("c.y.qq.com");
      expect(url).not.toContain("kugou.com");
    }
  });

  it("skips LRCLIB when sources.lrclib is false and uses NetEase", async () => {
    ipcCallMock.mockImplementation((_method: string, params: { url: string }) => {
      if (params.url.includes("/search/get")) return Promise.resolve({ status: 200, body: neteaseSearchBody });
      if (params.url.includes("/song/lyric")) return Promise.resolve({ status: 200, body: neteaseLyricBody });
      return Promise.resolve({ status: 200, body: lrclibBody });
    });

    const res = await fetchLyrics("NetEase Song", "NetEase Artist", "", 200_000, {
      sources: { lrclib: false, netease: true, qq: false },
    });

    expect(res.source).toBe("netease");
    expect(res.found).toBe(true);
    // No LRCLIB request should have been issued.
    for (const call of ipcCallMock.mock.calls) {
      const url = (call[1] as { url: string }).url;
      expect(url).toContain("music.163.com");
      expect(url).not.toContain("lrclib.net");
    }
  });

  it("falls through to QQ Music when LRCLIB and NetEase miss", async () => {
    ipcCallMock.mockImplementation((_method: string, params: { url: string }) => {
      // LRCLIB miss, NetEase miss (empty songs), QQ hit.
      if (params.url.includes("lrclib.net")) return Promise.resolve({ status: 200, body: JSON.stringify({}) });
      if (params.url.includes("music.163.com")) return Promise.resolve({ status: 200, body: JSON.stringify({ result: { songs: [] } }) });
      if (params.url.includes("smartbox_new.fcg")) return Promise.resolve({ status: 200, body: qqSearchBody });
      if (params.url.includes("fcg_query_lyric_new.fcg")) return Promise.resolve({ status: 200, body: qqLyricBody });
      return Promise.resolve({ status: 200, body: JSON.stringify({}) });
    });

    const res = await fetchLyrics("QQ Song", "QQ Artist", "", 200_000, {
      sources: { lrclib: true, netease: true, qq: true },
    });

    expect(res.source).toBe("qq");
    expect(res.found).toBe(true);
    expect(res.synced.length).toBeGreaterThan(0);
  });

  it("QQ retries with title-only when title+artist search misses", async () => {
    let searchCount = 0;
    const qqHitSearch = JSON.stringify({
      data: { song: { itemlist: [{ mid: "000xyz", name: "恶口 1&2", singer: "undaloop" }] } },
    });
    const qqHitLyric = JSON.stringify({ lyric: "[00:00.00] kuchi" });

    ipcCallMock.mockImplementation((_method: string, params: { url: string }) => {
      if (params.url.includes("lrclib.net")) return Promise.resolve({ status: 200, body: JSON.stringify({}) });
      if (params.url.includes("music.163.com")) return Promise.resolve({ status: 200, body: JSON.stringify({ result: { songs: [] } }) });
      if (params.url.includes("smartbox_new.fcg")) {
        searchCount++;
        if (searchCount === 1) return Promise.resolve({ status: 200, body: JSON.stringify({ data: { song: { itemlist: [] } } }) });
        return Promise.resolve({ status: 200, body: qqHitSearch });
      }
      if (params.url.includes("fcg_query_lyric_new.fcg")) return Promise.resolve({ status: 200, body: qqHitLyric });
      return Promise.resolve({ status: 200, body: JSON.stringify({}) });
    });

    const res = await fetchLyrics("恶口 1&2", "undaloop", "", 200_000, {
      sources: { lrclib: true, netease: true, qq: true },
    });

    expect(searchCount).toBe(2);
    expect(res.source).toBe("qq");
    expect(res.found).toBe(true);
  });

  it("uses LRCLIB when all sources are enabled (default)", async () => {
    ipcCallMock.mockResolvedValue({ status: 200, body: lrclibBody });

    const res = await fetchLyrics("BothOnTrack", "Artist B", "", 200_000, {
      sources: { lrclib: true, netease: true, qq: true },
    });

    expect(res.source).toBe("lrclib");
    expect(res.found).toBe(true);
  });

  it("falls through to Kugou when LRCLIB, NetEase, and QQ all miss", async () => {
    // Kugou requires 3 sequential fetches: song search, lyric search, download.
    const kugouSongSearch = JSON.stringify({
      status: 1,
      data: { info: [{ hash: "abc123hash", songname: "Kugou Song", singername: "Kugou Singer", duration: 200 }] },
    });
    const kugouLyricSearch = JSON.stringify({
      status: 200,
      candidates: [{ id: "99999", accesskey: "DEADBEEF", song: "Kugou Song", singer: "Kugou Singer", duration: 200000 }],
    });
    const kugouLyricDownload = JSON.stringify({
      status: 200,
      content: btoa("[00:05.00] kugou line one\n[00:10.00] kugou line two"),
      fmt: "lrc",
    });

    ipcCallMock.mockImplementation((_method: string, params: { url: string }) => {
      if (params.url.includes("lrclib.net")) return Promise.resolve({ status: 200, body: JSON.stringify({}) });
      if (params.url.includes("music.163.com")) return Promise.resolve({ status: 200, body: JSON.stringify({ result: { songs: [] } }) });
      if (params.url.includes("smartbox_new.fcg")) return Promise.resolve({ status: 200, body: JSON.stringify({ data: { song: { itemlist: [] } } }) });
      if (params.url.includes("mobileservice.kugou.com")) return Promise.resolve({ status: 200, body: kugouSongSearch });
      if (params.url.includes("lyrics.kugou.com/search")) return Promise.resolve({ status: 200, body: kugouLyricSearch });
      if (params.url.includes("lyrics.kugou.com/download")) return Promise.resolve({ status: 200, body: kugouLyricDownload });
      return Promise.resolve({ status: 200, body: JSON.stringify({}) });
    });

    const res = await fetchLyrics("Kugou Song", "Kugou Singer", "", 200_000, {
      sources: { lrclib: true, netease: true, qq: true, kugou: true },
    });

    expect(res.source).toBe("kugou");
    expect(res.found).toBe(true);
    expect(res.synced.length).toBe(2);
    expect(res.synced[0].text).toBe("kugou line one");
  });

  it("skips Kugou when sources.kugou is false", async () => {
    ipcCallMock.mockResolvedValue({ status: 200, body: JSON.stringify({}) });

    const res = await fetchLyrics("KugouSkip", "Artist", "", 200_000, {
      sources: { lrclib: true, netease: false, qq: false, kugou: false },
    });

    expect(res.found).toBe(false);
    for (const call of ipcCallMock.mock.calls) {
      const url = (call[1] as { url: string }).url;
      expect(url).not.toContain("kugou.com");
    }
  });
});
