import { useTranslation } from "react-i18next";
import { Music, Plus, Type } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  MUSIC_PRESETS,
  MUSIC_STATUS_GLYPHS,
  extrapolatePosition,
  makeMusicPresetCard,
  mmss,
  oscProgressBar,
  renderOscTemplate,
  type MusicPreset,
  type OscStudioCard,
} from "@/lib/osc-studio";
import { currentLyricLine, currentLyricTrans } from "@/lib/lyrics";
import type { NowPlayingApi } from "@/lib/useNowPlaying";

interface NowPlayingPanelProps {
  nowPlaying: NowPlayingApi;
  now: Date;
  onAddCard: (card: OscStudioCard) => void;
  /** Set the selected card's template to a preset (when one is selected). */
  onSetTemplate: (template: string) => void;
  /** Whether a chatbox-style card is selected to receive onSetTemplate. */
  canSetTemplate: boolean;
}

/**
 * Live now-playing media view + chatbox preview for the OSC Studio. Reads the
 * GSMTC-backed snapshot from useNowPlaying, renders the current track and the
 * exact chatbox line a preset would send, and exposes the four presets, the
 * progress-bar width control, and the ASCII-fold toggle. Presets are inserted
 * on demand (click) — nothing auto-sends.
 */
export function NowPlayingPanel({
  nowPlaying,
  now,
  onAddCard,
  onSetTemplate,
  canSetTemplate,
}: NowPlayingPanelProps) {
  const { t } = useTranslation();
  const { music, progressWidth, setProgressWidth, asciiFold, setAsciiFold, lyrics, lyricsStatus, lyricsSource } =
    nowPlaying;

  const active = !!music?.active;
  const nowMs = now.getTime();
  const pos = music ? extrapolatePosition(music, nowMs) : 0;
  const dur = music && music.duration_ms > 0 ? music.duration_ms : 0;
  const statusGlyph = music ? MUSIC_STATUS_GLYPHS[music.status] ?? music.status : "";
  // Live current lyric line + translation for the preview, matching position.
  const lyricLine = active ? currentLyricLine(lyrics, pos) : "";
  const lyricTranslated = active ? currentLyricTrans(lyrics, pos) : "";

  function applyPreset(preset: MusicPreset) {
    if (canSetTemplate) {
      onSetTemplate(preset.template);
    } else {
      onAddCard(makeMusicPresetCard(preset));
    }
  }

  return (
    <Card elevation="flat" className="overflow-hidden p-0">
      <div className="unity-panel-header flex items-center gap-2">
        <Music className="size-3.5" />
        {t("osc.music.title", { defaultValue: "Now playing" })}
        <Badge
          variant={active ? "success" : "muted"}
          className="ml-auto h-4 px-1.5 text-[9px]"
        >
          {active
            ? t("osc.music.live", { defaultValue: "live" })
            : t("osc.music.idle", { defaultValue: "no media" })}
        </Badge>
      </div>
      <div className="grid gap-3 p-3 text-[11px]">
        {/* Live track */}
        {active && music ? (
          <div className="grid gap-1.5">
            <div className="grid grid-cols-[auto_1fr] items-center gap-2">
              <span className="text-[14px] leading-none">{statusGlyph}</span>
              <span className="min-w-0 truncate text-[13px] font-semibold" title={music.title}>
                {music.title || t("osc.music.unknownTitle", { defaultValue: "Unknown title" })}
              </span>
            </div>
            <Fact label={t("osc.music.artist", { defaultValue: "Artist" })} value={music.artist} />
            <Fact label={t("osc.music.album", { defaultValue: "Album" })} value={music.album} />
            <Fact label={t("osc.music.source", { defaultValue: "Source" })} value={music.app_name} />
            <div className="mt-1 grid gap-1">
              <div className="font-mono text-[12px] tracking-tight">
                {oscProgressBar(pos, dur, progressWidth)}
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                <span>{mmss(pos)}</span>
                <span>{dur > 0 ? mmss(dur) : "--:--"}</span>
              </div>
            </div>
            {/* Synced lyrics: current line + resolution status */}
            <div className="mt-1 grid gap-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {t("osc.music.lyrics", { defaultValue: "Lyrics" })}
                </span>
                <Badge
                  variant={lyricsStatus === "found" ? "success" : "muted"}
                  className="h-4 px-1.5 text-[9px]"
                >
                  {lyricsStatus === "found"
                    ? t("osc.music.lyricsFound", { defaultValue: "found" })
                    : lyricsStatus === "instrumental"
                      ? t("osc.music.lyricsInstrumental", { defaultValue: "instrumental" })
                      : t("osc.music.lyricsNone", { defaultValue: "none" })}
                </Badge>
                {lyricsSource !== "none" ? (
                  <Badge variant="muted" className="h-4 px-1.5 text-[9px] uppercase" title={t("osc.music.lyricsSource", { defaultValue: "Lyrics source" })}>
                    {lyricsSource === "lrclib"
                      ? t("osc.music.sourceLrclib", { defaultValue: "LRCLIB" })
                      : t("osc.music.sourceNetease", { defaultValue: "NetEase" })}
                  </Badge>
                ) : null}
              </div>
              <div className="min-h-[16px] truncate text-[12px] italic text-[hsl(var(--foreground))]" title={lyricLine}>
                {lyricLine ||
                  (lyricsStatus === "found"
                    ? t("osc.music.lyricsWaiting", { defaultValue: "..." })
                    : "")}
              </div>
              {lyricTranslated ? (
                <div className="min-h-[14px] truncate text-[11px] text-[hsl(var(--muted-foreground))]" title={lyricTranslated}>
                  {lyricTranslated}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] px-2 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
            {t("osc.music.emptyHint", {
              defaultValue: "Play a track in any app (Spotify, browser, foobar2000...) and it appears here.",
            })}
          </p>
        )}

        {/* Presets */}
        <div className="grid gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {t("osc.music.templates", { defaultValue: "Templates" })}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {MUSIC_PRESETS.map((preset) => {
              const previewLine = renderOscTemplate(preset.template, {
                music,
                now,
                musicProgressWidth: progressWidth,
                musicLyricLine: lyricLine,
                musicLyricTranslated: lyricTranslated,
                asciiFold,
              });
              const presetLabel = t(preset.labelKey, { defaultValue: preset.label });
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="grid gap-1 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-2 text-left transition-colors hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--accent))]"
                  title={preset.template}
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold">
                    {canSetTemplate ? <Type className="size-3" /> : <Plus className="size-3" />}
                    {presetLabel}
                  </span>
                  <span className="truncate font-mono text-[9px] text-[hsl(var(--muted-foreground))]">
                    {previewLine || preset.template}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[9px] text-[hsl(var(--muted-foreground))]">
            {canSetTemplate
              ? t("osc.music.applyToSelected", { defaultValue: "Click to set the selected message's template." })
              : t("osc.music.addAsCard", { defaultValue: "Click to add a new chatbox message." })}
          </p>
        </div>

        {/* Rendered chatbox preview */}
        <div className="grid gap-1.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {t("osc.music.preview", { defaultValue: "Chatbox preview" })}
          </div>
          <div className="whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[hsl(var(--surface-bright))] px-2 py-1.5 text-[12px] leading-relaxed">
            {renderOscTemplate(MUSIC_PRESETS[1].template, {
              music,
              now,
              musicProgressWidth: progressWidth,
              musicLyricLine: lyricLine,
              musicLyricTranslated: lyricTranslated,
              asciiFold,
            }) || t("osc.music.previewEmpty", { defaultValue: "(nothing playing)" })}
          </div>
        </div>

        {/* Controls */}
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t("osc.music.barWidth", { defaultValue: "Progress bar width" })}
              <span className="font-mono text-[10px] normal-case">{progressWidth}</span>
            </span>
            <Input
              type="range"
              min={4}
              max={24}
              step={1}
              value={progressWidth}
              onChange={(e) => setProgressWidth(Math.max(4, Math.min(24, parseInt(e.target.value, 10) || 10)))}
              aria-label={t("osc.music.barWidth", { defaultValue: "Progress bar width" })}
              className="h-6 cursor-pointer p-0"
            />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-2 py-1.5">
            <span className="grid gap-0.5">
              <span className="text-[11px] font-medium">
                {t("osc.music.asciiFold", { defaultValue: "ASCII fold" })}
              </span>
              <span className="text-[9px] text-[hsl(var(--muted-foreground))]">
                {t("osc.music.asciiFoldHint", { defaultValue: "Strip non-ASCII for fonts that mangle CJK" })}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={asciiFold}
              onChange={(e) => setAsciiFold(e.target.checked)}
              aria-label={t("osc.music.asciiFold", { defaultValue: "ASCII fold" })}
              className="size-4 cursor-pointer accent-[hsl(var(--primary))]"
            />
          </label>
        </div>
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-2">
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className="min-w-0 truncate" title={value ?? undefined}>{value || "--"}</span>
    </div>
  );
}
