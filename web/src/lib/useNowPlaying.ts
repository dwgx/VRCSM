import { useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc";
import type { NowPlayingSnapshot } from "@/lib/osc-studio";

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

  const musicRef = useRef<NowPlayingSnapshot | null>(null);
  const progressWidthRef = useRef(progressWidth);
  const marqueeWidthRef = useRef(marqueeWidth);
  const asciiFoldRef = useRef(asciiFold);

  useEffect(() => {
    progressWidthRef.current = progressWidth;
  }, [progressWidth]);
  useEffect(() => {
    marqueeWidthRef.current = marqueeWidth;
  }, [marqueeWidth]);
  useEffect(() => {
    asciiFoldRef.current = asciiFold;
  }, [asciiFold]);

  function apply(snapshot: NowPlayingSnapshot | null) {
    musicRef.current = snapshot;
    setMusic(snapshot);
  }

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const snapshot = await ipc.call<undefined, NowPlayingSnapshot>("music.nowPlaying");
        if (!cancelled) apply(snapshot);
      } catch {
        // No media session / host unavailable — treat as "nothing playing"
        // rather than surfacing an error toast on a background poll.
        if (!cancelled && musicRef.current !== null) apply(null);
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
  };
}

export type NowPlayingApi = ReturnType<typeof useNowPlaying>;
