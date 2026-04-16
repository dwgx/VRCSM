import { Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { AlertTriangle, Box, Lock, Loader2 } from "lucide-react";
import { ipc } from "@/lib/ipc";

/**
 * C++ → JS response from `avatar.preview`. `ok: true` means the
 * pipeline (or the on-disk cache) produced a usable `.glb` URL.
 * Failures carry a stable `code` the frontend switches on to pick an
 * empty state — the exact taxonomy lives in `src/core/AvatarPreview.h`.
 */
interface PreviewResponse {
  avatarId: string;
  ok: boolean;
  glbUrl?: string;
  glbPath?: string;
  cached?: boolean;
  code?: string;
  message?: string;
}

// Every known failure code maps to an i18n key + an icon. Unknown
// codes drop to a generic "preview failed" state so new C++ codes
// don't render as broken UI.
const CODE_META: Record<
  string,
  { icon: typeof AlertTriangle; kind: "info" | "warn" }
> = {
  cache_missing: { icon: Box, kind: "info" },
  bundle_not_found: { icon: Box, kind: "info" },
  bundle_invalid: { icon: Box, kind: "info" },
  extractor_missing: { icon: Box, kind: "info" },
  converter_missing: { icon: Box, kind: "info" },
  extractor_failed: { icon: AlertTriangle, kind: "warn" },
  converter_failed: { icon: AlertTriangle, kind: "warn" },
  encrypted: { icon: Lock, kind: "warn" },
  preview_failed: { icon: AlertTriangle, kind: "warn" },
  missing_avatar_id: { icon: AlertTriangle, kind: "warn" },
};

function EmptyState({
  code,
  size,
  message,
}: {
  code: string;
  size: number;
  message?: string;
}) {
  const { t } = useTranslation();
  const meta = CODE_META[code] ?? CODE_META.preview_failed;
  const Icon = meta.icon;
  // The translation key is conventionally `avatars.preview3d.<code>`.
  // i18next silently falls back to the default value when a key is
  // missing, so adding a new code only needs one C++ + one locale
  // edit.
  const title = t(`avatars.preview3d.${code}`, {
    defaultValue:
      code === "encrypted"
        ? "Asset encrypted"
        : code === "extractor_missing" || code === "converter_missing"
          ? "3D preview disabled"
          : "3D preview unavailable",
  });
  const tint =
    meta.kind === "warn"
      ? "border-[hsl(var(--warn-foreground,var(--destructive))/0.5)] bg-[hsl(var(--destructive)/0.08)]"
      : "border-[hsl(var(--border))] bg-[hsl(var(--canvas))]";
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-3 py-4 text-center ${tint}`}
      style={{ width: size, height: size }}
    >
      <Icon className="size-5 text-[hsl(var(--muted-foreground))]" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {title}
      </span>
      {message ? (
        <span className="font-mono text-[9px] text-[hsl(var(--muted-foreground))] opacity-70">
          {message}
        </span>
      ) : null}
    </div>
  );
}

function LoadingState({ size }: { size: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]"
      style={{ width: size, height: size }}
    >
      <Loader2 className="size-5 animate-spin text-[hsl(var(--primary))]" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {t("avatars.preview3d.loading", {
          defaultValue: "Extracting…",
        })}
      </span>
    </div>
  );
}

/**
 * React-three-fiber model. `useGLTF` suspends on load, which is why
 * we wrap it in a `<Suspense>` below. Cleaning up the cache on
 * unmount prevents a slow leak when the user clicks through dozens
 * of avatars — react-three-fiber's default cache keeps every blob
 * alive indefinitely otherwise.
 */
function GlbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  useEffect(() => {
    return () => {
      useGLTF.clear(url);
    };
  }, [url]);

  return <primitive object={scene} />;
}

/**
 * Dark Unity-style 3D preview. Calls the C++ `avatar.preview` IPC,
 * which returns either a `.glb` URL (possibly cached) or a stable
 * error code that maps to an empty-state. The Canvas is only
 * mounted on success — failures render as a single dimmed panel so
 * the inspector still has a fixed-size slot.
 *
 * The Canvas background is pinned to the Unity "canvas" token so
 * the model blends with the rest of the inspector. `<Stage>` from
 * drei adds the three-point rim/fill/key lighting and ground
 * shadow plane; `OrbitControls` lets the user rotate the model
 * without keyboard shortcuts getting in the way.
 */
export function AvatarPreview3D({
  avatarId,
  assetUrl,
  fallbackImageUrl,
  size = 140,
}: {
  avatarId: string;
  assetUrl?: string;
  fallbackImageUrl?: string;
  size?: number;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; url: string }
    | { kind: "error"; code: string; message?: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    ipc
      .call<{ avatarId: string; assetUrl?: string }, PreviewResponse>("avatar.preview", { avatarId, assetUrl })
      .then((resp) => {
        if (cancelled) return;
        if (resp.ok && resp.glbUrl) {
          setState({ kind: "ready", url: resp.glbUrl });
        } else {
          setState({
            kind: "error",
            code: resp.code ?? "preview_failed",
            message: resp.message,
          });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          code: "preview_failed",
          message: e instanceof Error ? e.message : String(e),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [avatarId, assetUrl]);

  const canvasStyle = useMemo<React.CSSProperties>(
    () => ({ width: size, height: size, background: "hsl(var(--canvas))" }),
    [size],
  );

  if (state.kind === "loading") {
    return <LoadingState size={size} />;
  }

  if (state.kind === "error") {
    if (fallbackImageUrl) {
      return (
        <div 
          className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]" 
          style={{ width: size, height: size }}
        >
          <img src={fallbackImageUrl} className="h-full w-full object-cover" alt="" />
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-4 bg-gradient-to-t from-[hsl(var(--background))/0.9] to-transparent">
            <AlertTriangle className="size-4 text-[hsl(var(--warn-foreground,var(--destructive)))] mb-1" />
            <span className="text-[9px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              {state.message?.includes("assetUrl") ? 'No Asset URL' : 'Preview Unavailable'}
            </span>
          </div>
        </div>
      );
    }
    return <EmptyState code={state.code} size={size} message={state.message} />;
  }

  // We explicitly avoid Drei's <Stage> because it computes a bounding
  // box over ALL meshes in the GLTF. If a prop (like a trumpet) was
  // oversized locally and scaled down in Unity, our raw mesh extraction
  // sees it as 100 meters large. <Stage> would then shift the entire
  // model so the 100-meter prop is centered, wildly displacing the
  // character's body. By managing the camera and origin ourselves,
  // the avatar's native feet origin (0,0,0) stays anchored, and the
  // camera looks statically at the waist/chest [0, 0.8, 0].
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]"
      style={{ width: size, height: size }}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 1.0, 3.5], fov: 35 }}
        style={canvasStyle}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 10, -5]} intensity={1.5} />
          <directionalLight position={[-5, 5, 5]} intensity={0.5} />
          
          <group position={[0, -0.05, 0]}>
            <GlbModel url={state.url} />
          </group>
        </Suspense>
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          panSpeed={1.5}
          zoomSpeed={2.5}
          enableDamping={true}
          dampingFactor={0.05}
          minDistance={1.2}
          maxDistance={8}
          target={[0, 0.8, 0]}
          makeDefault
        />
      </Canvas>
    </div>
  );
}
