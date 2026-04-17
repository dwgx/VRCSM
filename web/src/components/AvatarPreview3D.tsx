import { Suspense, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { AlertTriangle, Box, Lock, Loader2, RotateCcw } from "lucide-react";
import { useAvatarPreview } from "@/hooks/useAvatarPreview";

/* ── Error code → UI metadata ──────────────────────────────────────── */

const CODE_META: Record<
  string,
  { icon: typeof AlertTriangle; kind: "info" | "warn" }
> = {
  cache_missing:     { icon: Box,            kind: "info" },
  bundle_not_found:  { icon: Box,            kind: "info" },
  bundle_invalid:    { icon: Box,            kind: "info" },
  extractor_missing: { icon: Box,            kind: "info" },
  converter_missing: { icon: Box,            kind: "info" },
  extractor_failed:  { icon: AlertTriangle,  kind: "warn" },
  converter_failed:  { icon: AlertTriangle,  kind: "warn" },
  encrypted:         { icon: Lock,           kind: "warn" },
  preview_failed:    { icon: AlertTriangle,  kind: "warn" },
  missing_avatar_id: { icon: AlertTriangle,  kind: "warn" },
};

/* ── Sub-components ────────────────────────────────────────────────── */

function EmptyState({
  code,
  size,
  message,
  onRetry,
}: {
  code: string;
  size: number;
  message?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const meta = CODE_META[code] ?? CODE_META.preview_failed;
  const Icon = meta.icon;
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
      className={`relative flex flex-col items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-3 py-4 text-center ${tint}`}
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
      {onRetry && code !== "encrypted" && code !== "extractor_missing" ? (
        <button
          onClick={onRetry}
          className="mt-1 flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.1)] transition-colors"
        >
          <RotateCcw className="size-3" />
          {t("avatars.preview3d.retry", { defaultValue: "Retry" })}
        </button>
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
        {t("avatars.preview3d.loading", { defaultValue: "Extracting\u2026" })}
      </span>
    </div>
  );
}

function FallbackError({
  size,
  fallbackImageUrl,
  message,
}: {
  size: number;
  fallbackImageUrl: string;
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5" style={{ width: size }}>
      <div
        className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))]"
        style={{ width: size, height: size }}
      >
        <img
          src={fallbackImageUrl}
          className="h-full w-full object-cover"
          alt=""
        />
      </div>
      <div className="flex w-full items-center justify-center rounded-[calc(var(--radius-sm)-2px)] border border-[hsl(var(--warn-foreground,var(--destructive))/0.5)] bg-[hsl(var(--destructive)/0.08)] py-1.5">
        <AlertTriangle className="mr-1.5 size-3 text-[hsl(var(--warn-foreground,var(--destructive)))]" />
        <span className="text-center text-[9px] font-bold uppercase tracking-wider text-[hsl(var(--warn-foreground,var(--destructive)))]">
          {message?.includes("assetUrl")
            ? "No Asset URL"
            : "Preview Unavailable"}
        </span>
      </div>
    </div>
  );
}

/* ── 3D Scene internals ────────────────────────────────────────────── */

/**
 * Compute a "tight" bounding box by trimming the 2% most extreme
 * vertices from each axis. This is a safety net that eliminates any
 * residual outlier geometry the Python extractor didn't catch
 * (e.g. stray vertices at world origin, edge-case props).
 */
function computeRobustBounds(scene: THREE.Object3D): THREE.Box3 {
  const positions: THREE.Vector3[] = [];

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geo = child.geometry;
    if (!geo?.attributes?.position) return;

    const posAttr = geo.attributes.position;
    const worldMatrix = child.matrixWorld;
    const v = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i);
      v.applyMatrix4(worldMatrix);
      positions.push(v.clone());
    }
  });

  if (positions.length === 0) {
    return new THREE.Box3().setFromObject(scene);
  }

  const trim = Math.max(1, Math.floor(positions.length * 0.02));

  const xs = positions.map((p) => p.x).sort((a, b) => a - b);
  const ys = positions.map((p) => p.y).sort((a, b) => a - b);
  const zs = positions.map((p) => p.z).sort((a, b) => a - b);

  return new THREE.Box3(
    new THREE.Vector3(xs[trim], ys[trim], zs[trim]),
    new THREE.Vector3(
      xs[xs.length - 1 - trim],
      ys[ys.length - 1 - trim],
      zs[zs.length - 1 - trim],
    ),
  );
}

/**
 * Loads a GLB via drei's useGLTF, then normalizes its origin:
 *   1. Robust bounding box (trim 2% outlier vertices)
 *   2. Center X/Z, plant feet at Y=0
 *   3. Scale to fit ~2m tall
 */
function GlbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!groupRef.current) return;

    scene.updateMatrixWorld(true);

    const box = computeRobustBounds(scene);
    const boxSize = new THREE.Vector3();
    const boxCenter = new THREE.Vector3();
    box.getSize(boxSize);
    box.getCenter(boxCenter);

    const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z);
    const scale = maxDim > 0 ? 2.0 / maxDim : 1;

    groupRef.current.scale.setScalar(scale);
    groupRef.current.position.set(
      -boxCenter.x * scale,
      -box.min.y * scale,
      -boxCenter.z * scale,
    );

    return () => {
      useGLTF.clear(url);
    };
  }, [url, scene]);

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

/** Subtle ground reference grid — only rendered at larger sizes. */
function GroundGrid({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <group>
      <gridHelper
        args={[3, 12, 0x444444, 0x2a2a2a]}
        position={[0, 0, 0]}
      />
      {/* Faint ground disc for visual grounding */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.002, 0]}
        receiveShadow
      >
        <circleGeometry args={[1.2, 32]} />
        <meshStandardMaterial
          color="#1a1a1a"
          transparent
          opacity={0.25}
        />
      </mesh>
    </group>
  );
}

/* ── Main Export ────────────────────────────────────────────────────── */

/**
 * Dark Unity-style 3D avatar preview.
 *
 * Calls C++ `avatar.preview` IPC (via `useAvatarPreview` hook), which
 * resolves the bundle, runs the Python extractor, and returns a `.glb`
 * URL served via WebView2's `preview.local` virtual host.
 *
 * Camera controls (built into Three.js OrbitControls):
 *   - LMB drag:        Rotate
 *   - Shift+LMB drag:  Pan
 *   - Scroll:          Zoom
 *   - RMB drag:        Pan (alternative)
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
  const { state, retry } = useAvatarPreview(avatarId, assetUrl);

  const canvasStyle = useMemo<React.CSSProperties>(
    () => ({ width: size, height: size, background: "hsl(var(--canvas))" }),
    [size],
  );

  // Show ground grid only when the preview is large enough to see it
  const showGrid = size >= 180;

  if (state.kind === "loading") {
    return <LoadingState size={size} />;
  }

  if (state.kind === "error") {
    if (fallbackImageUrl) {
      return (
        <FallbackError
          size={size}
          fallbackImageUrl={fallbackImageUrl}
          message={state.message}
        />
      );
    }
    return (
      <EmptyState
        code={state.code}
        size={size}
        message={state.message}
        onRetry={retry}
      />
    );
  }

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
          {/* 3-point lighting: ambient fill + key + rim */}
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 10, -5]} intensity={1.5} />
          <directionalLight position={[-5, 5, 5]} intensity={0.5} />

          <group position={[0, -0.05, 0]}>
            <GlbModel url={state.url} />
            <GroundGrid visible={showGrid} />
          </group>
        </Suspense>

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          panSpeed={1.5}
          zoomSpeed={2.5}
          rotateSpeed={1.0}
          enableDamping
          dampingFactor={0.08}
          minDistance={0.5}
          maxDistance={10}
          target={[0, 0.8, 0]}
          makeDefault
        />
      </Canvas>
    </div>
  );
}
