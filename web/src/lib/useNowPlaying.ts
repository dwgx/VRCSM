import { useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc";
import type { NowPlayingSnapshot } from "@/lib/osc-studio";
import { fetchLyrics, type LyricLine, type LyricsSource } from "@/lib/lyrics";
import { useUiPrefBoolean } from "@/lib/ui-prefs";

// Per-source lyrics toggles, both default on. Persisted as UI prefs so the
// NowPlayingPanel switches and the fetch path read the same state.
export const LYRICS_LRCLIB_PREF_KEY = "vrcsm.osc.lyrics.lrclib";
export const LYRICS_NETEASE_PREF_KEY = "vrcsm.osc.lyrics.netease";
export const LYRICS_QQ_PREF_KEY = "vrcsm.osc.lyrics.qq";
export const LYRICS_KUGOU_PREF_KEY = "vrcsm.osc.lyrics.kugou";

export const NOW_PLAYING_POLL_MS = 2000;
export const DEFAULT_MUSIC_PROGRESS_WIDTH = 10;
export const DEFAULT_MUSIC_MARQUEE_WIDTH = 20;

/**
 * Polls the host `music.nowPlaying` method (GSMTC-backed) every 2s and also
 * listens for the unsolicited `music.nowPlaying` push event, keeping the latest
 * media snapshot in state + a ref. The 1s OSC send loop reads the ref and calls
 * `extrapolatePosition` so the progress bar advances smoothly between polls
 * without re-hitting GSMTC every tick.
 *
 * Also owns the studio-level render options the NowPlayingPanel controls:
 * progress-bar width and the ASCII-fold toggle. They live here (not per card)
 * so every {music.*} card renders consistently.
 */
export function useNowPlaying() {
  const [music, setMusic] = useState<NowPlayingSnapshot | null>(null);
  const [progressWidth, setProgressWidth] = useState(DEFAULT_MUSIC_PROGRESS_WIDTH);
  const [marqueeWidth, setMarqueeWidth] = useState(DEFAULT_MUSIC_MARQUEE_WIDTH);
  const [asciiFold, setAsciiFold] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsStatus, setLyricsStatus] = useState<"none" | "found" | "instrumental">("none");
  const [lyricsSource, setLyricsSource] = useState<LyricsSource>("none");

  // Per-source toggles (both default on). Read here so the fetch path honours
  // them; the NowPlayingPanel switches bind to the same UI-pref keys.
  const [lyricsLrclib] = useUiPrefBoolean(LYRICS_LRCLIB_PREF_KEY, true);
  const [lyricsNetease] = useUiPrefBoolean(LYRICS_NETEASE_PREF_KEY, true);
  const [lyricsQq] = useUiPrefBoolean(LYRICS_QQ_PREF_KEY, true);
  const [lyricsKugou] = useUiPrefBoolean(LYRICS_KUGOU_PREF_KEY, true);

  const musicRef = useRef<NowPlayingSnapshot | null>(null);
  const progressWidthRef = useRef(progressWidth);
  const marqueeWidthRef = useRef(marqueeWidth);
  const asciiFoldRef = useRef(asciiFold);
  const lyricsRef = useRef<LyricLine[]>([]);
  const lyricsSourcesRef = useRef({ lrclib: lyricsLrclib, netease: lyricsNetease, qq: lyricsQq, kugou: lyricsKugou });
  // Identity of the track we last fetched lyrics for, so a 2s poll of the same
  // song doesn't re-fetch. Cleared to "" when nothing is playing.
  const lyricsTrackKeyRef = useRef<string>("");

  useEffect(() => {
    progressWidthRef.current = progressWidth;
  }, [progressWidth]);
  useEffect(() => {
    marqueeWidthRef.current = marqueeWidth;
  }, [marqueeWidth]);
  useEffect(() => {
    asciiFoldRef.current = asciiFold;
  }, [asciiFold]);
  // Keep the source-flags ref current and re-resolve lyrics for the live track
  // when a toggle changes (clearing the track key forces the next sync to
  // re-fetch under the new provider set).
  useEffect(() => {
    lyricsSourcesRef.current = { lrclib: lyricsLrclib, netease: lyricsNetease, qq: lyricsQq, kugou: lyricsKugou };
    lyricsTrackKeyRef.current = "";
    syncLyrics(musicRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricsLrclib, lyricsNetease, lyricsQq, lyricsKugou]);

  function setLyricLines(
    lines: LyricLine[],
    status: "none" | "found" | "instrumental",
    source: LyricsSource = "none",
  ) {
    lyricsRef.current = lines;
    setLyrics(lines);
    setLyricsStatus(status);
    setLyricsSource(source);
  }

  // Fetch synced lyrics once per track identity (title+artist+album). Runs off
  // the poll path so a 2s re-poll of the same song never re-hits the network.
  function syncLyrics(snapshot: NowPlayingSnapshot | null) {
    if (!snapshot || !snapshot.active || (!snapshot.title && !snapshot.artist)) {
      if (lyricsTrackKeyRef.current !== "") {
        lyricsTrackKeyRef.current = "";
        setLyricLines([], "none");
      }
      return;
    }
    const key = `${snapshot.title}|${snapshot.artist}|${snapshot.album}`;
    if (key === lyricsTrackKeyRef.current) return;
    lyricsTrackKeyRef.current = key;
    setLyricLines([], "none");
    void fetchLyrics(snapshot.title, snapshot.artist, snapshot.album, snapshot.duration_ms, {
      sources: lyricsSourcesRef.current,
    })
      .then((res) => {
        // A newer track may have arrived while we were awaiting; ignore stale.
        if (lyricsTrackKeyRef.current !== key) return;
        if (!res.found) {
          setLyricLines([], "none");
        } else if (res.instrumental) {
          setLyricLines([], "instrumental", res.source);
        } else {
          setLyricLines(res.synced, "found", res.source);
        }
      })
      .catch(() => {
        if (lyricsTrackKeyRef.current === key) setLyricLines([], "none");
      });
  }

  function apply(snapshot: NowPlayingSnapshot | null) {
    musicRef.current = snapshot;
    setMusic(snapshot);
    syncLyrics(snapshot);
  }

  useEffect(() => {
    let cancelled = false;
    // In-flight guard: the host read can stall (it round-trips into the media
    // source app), and the interval fires on a fixed 2s cadence regardless. If
    // a poll is still awaiting when the next tick fires, skipping it prevents
    // overlapping reads from piling onto the shared host IPC worker pool.
    let inFlight = false;

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const snapshot = await ipc.call<undefined, NowPlayingSnapshot>("music.nowPlaying");
        if (!cancelled) apply(snapshot);
      } catch {
        // No media session / host unavailable — treat as "nothing playing"
        // rather than surfacing an error toast on a background poll.
        if (!cancelled && musicRef.current !== null) apply(null);
      } finally {
        inFlight = false;
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), NOW_PLAYING_POLL_MS);
    const unsub = ipc.on<NowPlayingSnapshot>("music.nowPlaying", (snapshot) => {
      if (!cancelled) apply(snapshot);
    });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsub();
    };
  }, []);

  return {
    music,
    musicRef,
    progressWidth,
    setProgressWidth,
    progressWidthRef,
    marqueeWidth,
    setMarqueeWidth,
    marqueeWidthRef,
    asciiFold,
    setAsciiFold,
    asciiFoldRef,
    lyrics,
    lyricsRef,
    lyricsStatus,
    lyricsSource,
  };
}

export type NowPlayingApi = ReturnType<typeof useNowPlaying>;
