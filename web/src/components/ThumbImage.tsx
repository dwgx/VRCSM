import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { initials, placeholderGradient } from "@/lib/placeholder";

export interface ThumbImageProps {
  /** Image URL. null/undefined/empty → render placeholder only. */
  src?: string | null;
  /**
   * Stable key for deterministic colour + initials fallback. Usually the
   * avatar/world id or file path. Never the url itself (urls can change
   * across sessions and we want the user to recognise the tile).
   */
  seedKey: string;
  /** Optional friendly label. When omitted, seedKey is used for initials. */
  label?: string | null;
  /**
   * Tailwind aspect-ratio class. Default `aspect-square`. Use
   * `aspect-video` for screenshots, `aspect-[4/3]` for event banners etc.
   */
  aspect?: string;
  /** Extra classes applied to the outer wrapper. */
  className?: string;
  /** Tailwind radius. Default small. */
  rounded?: string;
  /**
   * "eager" on above-fold first-screen tiles so the browser fetches
   * them with high priority; "lazy" elsewhere. React 19 forwards
   * `fetchPriority` so high-priority tiles also skip the low-priority
   * queue on Chromium.
   */
  priority?: "eager" | "lazy";
  alt?: string;
  /** Override placeholder (e.g. smaller initials in tiny avatars). */
  fallbackClassName?: string;
  /** Inline style passthrough (aspect-ratio override, fixed size, etc). */
  style?: CSSProperties;
  /** Called with the failed src before the component falls back. */
  onImageError?: (src: string) => void;
}

/**
 * Unified thumbnail renderer — deterministic colour placeholder in the
 * background + <img> fading in on load. Used across the
 * app so every image slot looks "not empty" on the first paint.
 *
 * Design notes
 *   • The gradient lives on the wrapper, not the <img>, so load/error/
 *     retransition never flashes white.
 *   • Initials render only until the real image is up and decoded,
 *     avoiding a text-on-image flash.
 *   • <img> defaults to eager loading because WebView2 can miss native
 *     lazy-load triggers inside nested app scroll containers.
 */
export function ThumbImage({
  src,
  seedKey,
  label,
  aspect = "aspect-square",
  className,
  rounded = "rounded-[var(--radius-sm)]",
  priority = "eager",
  alt = "",
  fallbackClassName,
  style,
  onImageError,
}: ThumbImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  // Reset on src change so the fade re-runs when a row gets its real URL
  // lazily fetched (e.g. avatar.details enrichment in AvatarBenchmark).
  useEffect(() => {
    setLoaded(false);
    setErrored(false);
  }, [src]);

  const showImage = !!src && !errored;
  const showFallback = !showImage || !loaded;

  return (
    <div
      className={cn(
        "relative overflow-hidden border border-[hsl(var(--border))]",
        aspect,
        rounded,
        className,
      )}
      style={{ background: placeholderGradient(seedKey), ...style }}
    >
      {showFallback && (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            fallbackClassName,
          )}
          aria-hidden="true"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/70 drop-shadow-sm">
            {initials(label ?? seedKey)}
          </span>
        </div>
      )}
      {showImage && (
        <img
          src={src!}
          alt={alt}
          loading={priority === "eager" ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority === "eager" ? "high" : "auto"}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setErrored(true);
            if (src) onImageError?.(src);
          }}
        />
      )}
    </div>
  );
}
