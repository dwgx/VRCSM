import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  AlertTriangle,
  Box,
  Eye,
  Hand,
  Loader2,
  Lock,
  Maximize2,
  RotateCcw,
  ScanSearch,
  SquareStack,
} from "lucide-react";
import { useAvatarPreview } from "@/hooks/useAvatarPreview";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type PreviewMode = "textured" | "clay" | "wireframe";

interface PreparedSceneMeta {
  center: THREE.Vector3;
  size: THREE.Vector3;
  meshCount: number;
  materialCount: number;
  boneCount: number;
}

const DISABLED_MOUSE_BUTTON = -1 as THREE.MOUSE;

function applyControlsMode(controls: any, shiftPanning: boolean) {
  if (!controls) return;
  controls.mouseButtons.LEFT = shiftPanning
    ? THREE.MOUSE.PAN
    : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE = DISABLED_MOUSE_BUTTON;
  controls.enablePan = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.update();
}

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
          type="button"
          onClick={onRetry}
          className="mt-1 flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-medium text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--primary)/0.1)]"
        >
          <RotateCcw className="size-3" />
          {t("avatars.preview3d.retry", { defaultValue: "Retry" })}
        </button>
      ) : null}
    </div>
  );
}

const PREVIEW_PHASES = [
  "queued",
  "starting",
  "resolving_bundle",
  "downloading_bundle",
  "extracting",
  "finalizing",
  "cached",
] as const;

function phaseProgress(phase: string | undefined): number {
  if (!phase) return 0.15;
  const idx = PREVIEW_PHASES.indexOf(phase as (typeof PREVIEW_PHASES)[number]);
  if (idx < 0) return 0.15;
  // Map 0..6 → 0.05..0.95
  return 0.05 + (idx / (PREVIEW_PHASES.length - 1)) * 0.9;
}

function formatPreviewPhase(
  phase: string | undefined,
  queuePosition: number | undefined,
): string {
  switch (phase) {
    case "queued":
      return queuePosition && queuePosition > 1
        ? `Queued (${queuePosition})`
        : "Queued";
    case "starting":
      return "Preparing";
    case "resolving_bundle":
      return "Finding bundle";
    case "downloading_bundle":
      return "Downloading";
    case "extracting":
      return "Extracting";
    case "finalizing":
      return "Finalizing";
    case "cached":
      return "Loading cache";
    default:
      return "Extracting";
  }
}

function LoadingState({
  size,
  phase,
  message,
  queuePosition,
}: {
  size: number;
  phase?: string;
  message?: string;
  queuePosition?: number;
}) {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  const progress = phaseProgress(phase);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const compact = size < 200;

  return (
    <div
      className="flex flex-col items-center justify-center gap-2.5 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))]"
      style={{ width: size, height: size }}
    >
      <Loader2 className="size-5 animate-spin text-[hsl(var(--primary))]" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {formatPreviewPhase(phase, queuePosition)}
      </span>

      {/* ── Progress bar ── */}
      <div
        className="relative overflow-hidden rounded-full bg-[hsl(var(--border))] shadow-[inset_0_0_0_1px_hsl(var(--border))]" 
        style={{ width: compact ? size - 40 : Math.min(size - 48, 220), height: 5 }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--primary))] transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <span className="px-3 text-center text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
        {message ??
          t("avatars.preview3d.loading", {
            defaultValue: "Extracting avatar preview...",
          })}
      </span>
      <span className="text-[9px] font-mono text-[hsl(var(--muted-foreground))] opacity-70">
        {seconds}s
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

function computeRobustBounds(scene: THREE.Object3D): THREE.Box3 {
  const meshBoxes: Array<{
    box: THREE.Box3;
    largestDim: number;
    volume: number;
  }> = [];

  scene.updateMatrixWorld(true);
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry;
    if (!geometry) return;

    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox) return;

    const worldBox = geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
    if (worldBox.isEmpty()) return;

    const size = new THREE.Vector3();
    worldBox.getSize(size);
    const largestDim = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largestDim) || largestDim <= 0) return;

    meshBoxes.push({
      box: worldBox,
      largestDim,
      volume: Math.max(size.x * size.y * size.z, 0),
    });
  });

  if (meshBoxes.length === 0) {
    return new THREE.Box3().setFromObject(scene);
  }

  const sortedLargestDims = meshBoxes
    .map((entry) => entry.largestDim)
    .sort((a, b) => a - b);
  const sortedVolumes = meshBoxes
    .map((entry) => entry.volume)
    .sort((a, b) => a - b);
  const medianLargestDim = sortedLargestDims[Math.floor(sortedLargestDims.length / 2)] ?? 0;
  const medianVolume = sortedVolumes[Math.floor(sortedVolumes.length / 2)] ?? 0;

  const filtered = meshBoxes.filter((entry) => {
    const dimOk = medianLargestDim <= 0 || entry.largestDim <= medianLargestDim * 5;
    const volumeOk = medianVolume <= 0 || entry.volume <= medianVolume * 125;
    return dimOk && volumeOk;
  });

  const source = filtered.length > 0 ? filtered : meshBoxes;
  const merged = source[0].box.clone();
  for (let index = 1; index < source.length; index += 1) {
    merged.union(source[index].box);
  }
  return merged;
}

function buildDebugMaterial(
  original: THREE.Material,
  mode: Exclude<PreviewMode, "textured">,
): THREE.Material {
  if (mode === "wireframe") {
    return new THREE.MeshStandardMaterial({
      color: "#D2D7E2",
      roughness: 0.92,
      metalness: 0.02,
      wireframe: true,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: "#C9B8A2",
    roughness: 0.96,
    metalness: 0.02,
    flatShading: original instanceof THREE.MeshNormalMaterial,
  });
}

function disposeDebugMaterial(
  material: THREE.Material | THREE.Material[] | undefined,
) {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
}

function applyPreviewMode(scene: THREE.Object3D, mode: PreviewMode) {
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mesh = child as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material | THREE.Material[]
    > & {
      userData: {
        __vrcsmOriginalMaterial?: THREE.Material | THREE.Material[];
        __vrcsmDebugMaterial?: THREE.Material | THREE.Material[];
      };
    };

    if (!mesh.userData.__vrcsmOriginalMaterial) {
      mesh.userData.__vrcsmOriginalMaterial = mesh.material;
    }

    if (mesh.userData.__vrcsmDebugMaterial) {
      disposeDebugMaterial(mesh.userData.__vrcsmDebugMaterial);
      delete mesh.userData.__vrcsmDebugMaterial;
    }

    if (mode === "textured") {
      mesh.material = mesh.userData.__vrcsmOriginalMaterial;
      return;
    }

    const original = mesh.userData.__vrcsmOriginalMaterial;
    const debugMaterial = Array.isArray(original)
      ? original.map((material) => buildDebugMaterial(material, mode))
      : buildDebugMaterial(original, mode);

    mesh.userData.__vrcsmDebugMaterial = debugMaterial;
    mesh.material = debugMaterial;
  });
}

function GlbModel({
  url,
  mode,
  onPrepared,
}: {
  url: string;
  mode: PreviewMode;
  onPrepared: (meta: PreparedSceneMeta) => void;
}) {
  const { scene } = useGLTF(url);
  const clonedScene = useMemo(() => cloneSkeleton(scene), [scene]);
  const groupRef = useRef<THREE.Group>(null);

  useLayoutEffect(() => {
    if (!groupRef.current) return;

    clonedScene.updateMatrixWorld(true);

    const box = computeRobustBounds(clonedScene);
    const boxSize = new THREE.Vector3();
    const boxCenter = new THREE.Vector3();
    box.getSize(boxSize);
    box.getCenter(boxCenter);

    const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z);
    const scale = maxDim > 0 ? 1.6 / maxDim : 1;

    groupRef.current.scale.setScalar(scale);
    groupRef.current.position.set(
      -boxCenter.x * scale,
      -box.min.y * scale,
      -boxCenter.z * scale,
    );
    groupRef.current.updateMatrixWorld(true);

    const normalizedBounds = new THREE.Box3().setFromObject(groupRef.current);
    const normalizedCenter = new THREE.Vector3();
    const normalizedSize = new THREE.Vector3();
    normalizedBounds.getCenter(normalizedCenter);
    normalizedBounds.getSize(normalizedSize);

    let meshCount = 0;
    let boneCount = 0;
    const materialIds = new Set<string>();
    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshCount += 1;
        const material = child.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => materialIds.add(entry.uuid));
        } else if (material) {
          materialIds.add(material.uuid);
        }
      }
      if (child instanceof THREE.Bone) {
        boneCount += 1;
      }
    });

    onPrepared({
      center: normalizedCenter,
      size: normalizedSize,
      meshCount,
      materialCount: materialIds.size,
      boneCount,
    });
  }, [clonedScene, onPrepared]);

  useEffect(() => {
    applyPreviewMode(clonedScene, mode);
    return () => {
      applyPreviewMode(clonedScene, "textured");
    };
  }, [clonedScene, mode]);

  // GPU-resource cleanup. useGLTF.clear at the parent level drops the JS
  // cache entry but three.js doesn't reference-count geometries/textures,
  // so without an explicit dispose() the buffers leak on every avatar
  // switch. cloneSkeleton shares geometry with the original scene, but
  // since we're tearing the whole URL out of the cache in the same tick,
  // disposing here is safe.
  useEffect(() => {
    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    return () => {
      clonedScene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child.geometry) geometries.add(child.geometry);
        const registerMaterial = (material: THREE.Material) => {
          materials.add(material);
          for (const value of Object.values(material) as Array<unknown>) {
            if (value instanceof THREE.Texture) textures.add(value);
          }
        };
        if (Array.isArray(child.material)) {
          child.material.forEach(registerMaterial);
        } else if (child.material) {
          registerMaterial(child.material);
        }
        if (child.userData?.__vrcsmDebugMaterial) {
          const debugMat = child.userData.__vrcsmDebugMaterial;
          if (Array.isArray(debugMat)) {
            debugMat.forEach(registerMaterial);
          } else if (debugMat) {
            registerMaterial(debugMat as THREE.Material);
          }
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    };
  }, [clonedScene]);

  return (
    <group ref={groupRef}>
      <primitive object={clonedScene} />
    </group>
  );
}

function GroundGrid({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <group>
      <gridHelper args={[3.5, 14, 0x4e5a67, 0x232a33]} position={[0, 0, 0]} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.002, 0]}
        receiveShadow
      >
        <circleGeometry args={[1.45, 40]} />
        <meshStandardMaterial color="#12161D" transparent opacity={0.28} />
      </mesh>
    </group>
  );
}

function PreviewCameraRig({
  sceneMeta,
  fitTick,
  shiftPanning,
  controlsExternalRef,
  onSettled,
}: {
  sceneMeta: PreparedSceneMeta | null;
  fitTick: number;
  shiftPanning: boolean;
  controlsExternalRef: React.MutableRefObject<any | null>;
  onSettled: () => void;
}) {
  const { camera, invalidate } = useThree();
  const controlsRef = useRef<any>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  // Separate effect for shift-panning mode — does NOT touch camera position
  useLayoutEffect(() => {
    applyControlsMode(controlsRef.current, shiftPanning);
  }, [shiftPanning]);

  // Controls ref assignment (stable — only runs on mount/unmount)
  useLayoutEffect(() => {
    controlsExternalRef.current = controlsRef.current;
    return () => {
      if (controlsExternalRef.current === controlsRef.current) {
        controlsExternalRef.current = null;
      }
    };
  }, [controlsExternalRef]);

  // Camera framing — only runs when the scene geometry or fitTick changes
  useLayoutEffect(() => {
    if (!sceneMeta || !controlsRef.current) return;

    const center = sceneMeta.center.clone();
    const maxDim = Math.max(sceneMeta.size.x, sceneMeta.size.y, sceneMeta.size.z, 0.75);
    const distance = Math.max(2.1, maxDim * 2.1);

    camera.position.set(
      center.x + distance * 0.3,
      center.y + maxDim * 0.16,
      center.z + distance,
    );
    camera.near = 0.01;
    camera.far = 150;
    camera.updateProjectionMatrix();

    controlsRef.current.target.copy(center);
    controlsRef.current.minDistance = Math.max(0.24, maxDim * 0.2);
    controlsRef.current.maxDistance = Math.max(8, maxDim * 9);
    controlsRef.current.update();
    invalidate();

    let frame1 = 0;
    let frame2 = 0;
    frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(() => {
        onSettledRef.current();
      });
    });

    return () => {
      if (frame1) {
        window.cancelAnimationFrame(frame1);
      }
      if (frame2) {
        window.cancelAnimationFrame(frame2);
      }
    };
  // onSettled is captured via ref — NOT in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, fitTick, invalidate, sceneMeta]);

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan
      enableZoom
      enableRotate
      panSpeed={1.15}
      zoomSpeed={1.45}
      rotateSpeed={0.78}
      enableDamping
      dampingFactor={0.08}
      screenSpacePanning
      makeDefault
    />
  );
}

function OverlayButton({
  active = false,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className={
        "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border px-2 text-[10px] font-medium transition-colors " +
        (active
          ? "border-[hsl(var(--primary)/0.55)] bg-[hsl(var(--primary)/0.18)] text-[hsl(var(--primary))]"
          : "border-[hsl(var(--border)/0.75)] bg-[hsl(var(--surface)/0.88)] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-raised))]")
      }
    >
      {children}
    </button>
  );
}

function PreviewViewport({
  url,
  size,
  mode,
  setMode,
  fitTick,
  onFit,
  shiftPanning,
  sceneMeta,
  onPrepared,
  onPointerDownCapture,
  onPointerUpCapture,
  onMouseDownCapture,
  onMouseUpCapture,
  onAuxClickCapture,
  onExpand,
  showExpand,
  controlsExternalRef,
}: {
  url: string;
  size: number;
  mode: PreviewMode;
  setMode: (mode: PreviewMode) => void;
  fitTick: number;
  onFit: () => void;
  shiftPanning: boolean;
  sceneMeta: PreparedSceneMeta | null;
  onPrepared: (meta: PreparedSceneMeta) => void;
  onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUpCapture: (event: React.PointerEvent<HTMLDivElement>) => void;
  onMouseDownCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMouseUpCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
  onAuxClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
  onExpand?: () => void;
  showExpand: boolean;
  controlsExternalRef: MutableRefObject<any | null>;
}) {
  const { t } = useTranslation();
  const canvasStyle = useMemo<CSSProperties>(
    () => ({ width: size, height: size, background: "hsl(var(--canvas))" }),
    [size],
  );
  const tiny = size < 140;
  const compact = size < 240;
  const showGrid = size >= 180;
  const showStats = size >= 180;
  const showModes = !compact;
  const showControls = !compact;
  const showTextureNote = size >= 280;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    setCameraReady(false);
  }, [url, fitTick, sceneMeta]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;

    const suppressMiddleMouse = (event: MouseEvent | PointerEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const suppressAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
    };

    element.addEventListener("mousedown", suppressMiddleMouse, true);
    element.addEventListener("mouseup", suppressMiddleMouse, true);
    element.addEventListener("pointerdown", suppressMiddleMouse, true);
    element.addEventListener("pointerup", suppressMiddleMouse, true);
    element.addEventListener("auxclick", suppressAuxClick, true);

    return () => {
      element.removeEventListener("mousedown", suppressMiddleMouse, true);
      element.removeEventListener("mouseup", suppressMiddleMouse, true);
      element.removeEventListener("pointerdown", suppressMiddleMouse, true);
      element.removeEventListener("pointerup", suppressMiddleMouse, true);
      element.removeEventListener("auxclick", suppressAuxClick, true);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] select-none"
      style={{ width: size, height: size, touchAction: "none" }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDownCapture={onPointerDownCapture}
      onPointerUpCapture={onPointerUpCapture}
      onMouseDownCapture={onMouseDownCapture}
      onMouseUpCapture={onMouseUpCapture}
      onAuxClickCapture={onAuxClickCapture}
    >
      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          <OverlayButton onClick={onFit}>
            <ScanSearch className="size-3" />
            {t("avatars.preview3d.fit", { defaultValue: "Fit" })}
          </OverlayButton>
          {showExpand && onExpand ? (
            <OverlayButton onClick={onExpand}>
              <Maximize2 className="size-3" />
              {t("avatars.preview3d.expand", { defaultValue: "Expand" })}
            </OverlayButton>
          ) : null}
          {showModes ? (
            <>
              <OverlayButton
                active={mode === "textured"}
                onClick={() => setMode("textured")}
              >
                <Eye className="size-3" />
                {t("avatars.preview3d.modeTextured", { defaultValue: "Original" })}
              </OverlayButton>
              <OverlayButton active={mode === "clay"} onClick={() => setMode("clay")}>
                <SquareStack className="size-3" />
                {t("avatars.preview3d.modeClay", { defaultValue: "Clay" })}
              </OverlayButton>
              <OverlayButton
                active={mode === "wireframe"}
                onClick={() => setMode("wireframe")}
              >
                <Box className="size-3" />
                {t("avatars.preview3d.modeWireframe", { defaultValue: "Wireframe" })}
              </OverlayButton>
            </>
          ) : null}
        </div>

        {showControls ? (
          <div
            className="pointer-events-auto rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--surface)/0.92)] px-2 py-1 text-right text-[10px] leading-tight text-[hsl(var(--muted-foreground))] shadow-sm"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-end gap-1 text-[hsl(var(--foreground))]">
              <Hand className="size-3" />
              {t("avatars.preview3d.controlsTitle", {
                defaultValue: "Blender-style controls",
              })}
            </div>
            <div>
              {t("avatars.preview3d.controlsBody", {
                defaultValue: "LMB rotate · Shift+LMB pan · wheel zoom · RMB pan",
              })}
            </div>
          </div>
        ) : null}
      </div>

      {showTextureNote ? (
        <div className="pointer-events-none absolute left-2 right-2 top-11 z-10">
          <div className="w-fit max-w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--surface)/0.9)] px-2 py-1 text-[10px] leading-tight text-[hsl(var(--muted-foreground))] shadow-sm">
            {t("avatars.preview3d.textureNote", {
              defaultValue:
                "Original mode uses any extracted material and texture data that survived the bundle export. Clay and wireframe stay available for broken or noisy materials.",
            })}
          </div>
        </div>
      ) : null}

      {(showStats && sceneMeta) || shiftPanning ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex items-center justify-between gap-2">
          {showStats && sceneMeta ? (
            <div
              className="rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--surface)/0.9)] px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))] shadow-sm"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {sceneMeta.meshCount}M / {sceneMeta.materialCount}Mat / {sceneMeta.boneCount}Bone
            </div>
          ) : (
            <span />
          )}
          {shiftPanning && !tiny ? (
            <div
              className="rounded-[var(--radius-sm)] border border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.16)] px-2 py-1 text-[10px] font-medium text-[hsl(var(--primary))] shadow-sm"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {t("avatars.preview3d.panning", { defaultValue: "Pan mode" })}
            </div>
          ) : null}
        </div>
      ) : null}

      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 1, 3.5], fov: 34 }}
        style={{
          ...canvasStyle,
          opacity: sceneMeta && cameraReady ? 1 : 0,
          // Always animate in and out — previously we only fade in, which
          // made avatar URL swaps snap to black before fading back. A
          // symmetric transition cross-dissolves instead.
          transition: "opacity 140ms ease-out",
        }}
      >
        <color attach="background" args={["#0D1218"]} />
        <fog attach="fog" args={["#0D1218", 6, 18]} />

        <Suspense fallback={null}>
          <ambientLight intensity={0.62} />
          <hemisphereLight args={["#E7EEF9", "#11151C", 0.65]} />
          <directionalLight position={[4.5, 8, 5]} intensity={1.55} />
          <directionalLight position={[-6, 5, -3]} intensity={0.52} />

          <group position={[0, -0.04, 0]}>
            <GlbModel url={url} mode={mode} onPrepared={onPrepared} />
            <GroundGrid visible={showGrid} />
          </group>

          <PreviewCameraRig
            sceneMeta={sceneMeta}
            fitTick={fitTick}
            shiftPanning={shiftPanning}
            controlsExternalRef={controlsExternalRef}
            onSettled={() => setCameraReady(true)}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

function AvatarPreviewSurface({
  url,
  size,
  enableExpand = true,
  expandedSize = 620,
}: {
  url: string;
  size: number;
  enableExpand?: boolean;
  expandedSize?: number;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<PreviewMode>("textured");
  const [fitTick, setFitTick] = useState(0);
  const [shiftPanning, setShiftPanning] = useState(false);
  const [sceneMeta, setSceneMeta] = useState<PreparedSceneMeta | null>(null);
  const [expanded, setExpanded] = useState(false);
  const lastPreparedKey = useRef<string>("");
  const controlsRef = useRef<any>(null);
  const shiftPressedRef = useRef(false);
  const leftPointerDownRef = useRef(false);
  const syncControlsMode = useCallback((next: boolean) => {
    setShiftPanning(next);
    applyControlsMode(controlsRef.current, next);
  }, []);

  const handlePrepared = useCallback((meta: PreparedSceneMeta) => {
    const key = [
      meta.center.x.toFixed(4),
      meta.center.y.toFixed(4),
      meta.center.z.toFixed(4),
      meta.size.x.toFixed(4),
      meta.size.y.toFixed(4),
      meta.size.z.toFixed(4),
      meta.meshCount,
      meta.materialCount,
      meta.boneCount,
    ].join("|");

    if (lastPreparedKey.current === key) {
      return;
    }
    lastPreparedKey.current = key;
    setSceneMeta(meta);
  }, []);

  useEffect(() => {
    lastPreparedKey.current = "";
    setSceneMeta(null);
    setFitTick((value) => value + 1);
  }, [url]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        shiftPressedRef.current = true;
        if (!leftPointerDownRef.current) {
          setShiftPanning(true);
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        shiftPressedRef.current = false;
        if (leftPointerDownRef.current) {
          syncControlsMode(false);
        } else {
          setShiftPanning(false);
        }
      }
    };
    const onBlur = () => {
      shiftPressedRef.current = false;
      leftPointerDownRef.current = false;
      syncControlsMode(false);
    };
    const onPointerRelease = () => {
      if (!leftPointerDownRef.current) return;
      leftPointerDownRef.current = false;
      syncControlsMode(false);
      setShiftPanning(shiftPressedRef.current);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerup", onPointerRelease);
    window.addEventListener("pointercancel", onPointerRelease);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerup", onPointerRelease);
      window.removeEventListener("pointercancel", onPointerRelease);
    };
  }, [syncControlsMode]);

  const handlePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.button === 0) {
        leftPointerDownRef.current = true;
        shiftPressedRef.current = event.shiftKey;
        syncControlsMode(event.shiftKey);
      }
    },
    [syncControlsMode],
  );

  const handlePointerUpCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button === 0) {
        leftPointerDownRef.current = false;
        shiftPressedRef.current = event.shiftKey;
        syncControlsMode(false);
        setShiftPanning(event.shiftKey);
      }
    },
    [syncControlsMode],
  );

  const handleMouseDownCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [],
  );

  const handleMouseUpCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [],
  );

  const handleAuxClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [],
  );

  const preview = (
    <PreviewViewport
      url={url}
      size={size}
      mode={mode}
      setMode={setMode}
      fitTick={fitTick}
      onFit={() => setFitTick((value) => value + 1)}
      shiftPanning={shiftPanning}
      sceneMeta={sceneMeta}
      onPrepared={handlePrepared}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onMouseDownCapture={handleMouseDownCapture}
      onMouseUpCapture={handleMouseUpCapture}
      onAuxClickCapture={handleAuxClickCapture}
      onExpand={enableExpand ? () => setExpanded(true) : undefined}
      showExpand={enableExpand}
      controlsExternalRef={controlsRef}
    />
  );

  if (!enableExpand) {
    return preview;
  }

  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <>
        {preview}
        <DialogContent className="max-w-[760px] gap-3 border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <div className="pr-8">
            <DialogTitle>
              {t("avatars.preview3d.expandedTitle", {
                defaultValue: "Expanded avatar preview",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("avatars.preview3d.expandedBody", {
                defaultValue:
                  "Use the larger viewport for close inspection. Shift plus left drag pans, right drag also pans, and the middle mouse button is disabled to avoid WebView glitches.",
              })}
            </DialogDescription>
          </div>
          <div className="flex justify-center">
            <PreviewViewport
              url={url}
              size={expandedSize}
              mode={mode}
              setMode={setMode}
              fitTick={fitTick}
              onFit={() => setFitTick((value) => value + 1)}
              shiftPanning={shiftPanning}
              sceneMeta={sceneMeta}
              onPrepared={handlePrepared}
              onPointerDownCapture={handlePointerDownCapture}
              onPointerUpCapture={handlePointerUpCapture}
              onMouseDownCapture={handleMouseDownCapture}
              onMouseUpCapture={handleMouseUpCapture}
              onAuxClickCapture={handleAuxClickCapture}
              showExpand={false}
              controlsExternalRef={controlsRef}
            />
          </div>
        </DialogContent>
      </>
    </Dialog>
  );
}

function PreviewBusyOverlay({
  size,
  phase,
  queuePosition,
}: {
  size: number;
  phase?: string;
  queuePosition?: number;
}) {
  const label = formatPreviewPhase(phase, queuePosition);
  const progress = phaseProgress(phase);
  const compact = size < 200;
  return (
    <div
      className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-col items-center gap-1"
    >
      <div className="flex items-center gap-1.5 rounded-full border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--surface)/0.95)] px-2.5 py-1 shadow-sm">
        <Loader2 className="size-3 animate-spin text-[hsl(var(--primary))]" />
        <span className="text-[10px] font-medium text-[hsl(var(--foreground))]">
          {label}
        </span>
      </div>
      {!compact ? (
        <div
          className="relative overflow-hidden rounded-full bg-[hsl(var(--border))]"
          style={{ width: Math.min(size - 32, 180), height: 3 }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--primary))] transition-[width] duration-500 ease-out"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function AvatarPreview3D({
  avatarId,
  assetUrl,
  bundlePath,
  fallbackImageUrl,
  size = 140,
  enableExpand = true,
  expandedSize = 620,
}: {
  avatarId: string;
  assetUrl?: string;
  bundlePath?: string;
  fallbackImageUrl?: string;
  size?: number;
  enableExpand?: boolean;
  expandedSize?: number;
}) {
  const { state, retry } = useAvatarPreview(avatarId, assetUrl, bundlePath);

  // Keep the previously-ready URL visible while the pipeline is loading
  // the next one. Without this, every avatar switch unmounts the Canvas
  // (WebGL context teardown ≈ 200 ms) and then the user stares at a
  // spinner even for cache hits that resolve in under 50 ms. We hold the
  // last good URL in state and only swap it when the new one reports
  // ready. Error states still fall through so the user sees a real
  // failure message instead of a stale ghost preview.
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  useEffect(() => {
    if (state.kind === "ready") {
      setDisplayUrl(state.url);
    } else if (state.kind === "error") {
      setDisplayUrl(null);
    }
  }, [state]);

  // Release the drei useGLTF cache entry when we move off a URL. Without
  // this every avatar ever inspected stays resident in GPU memory until
  // the full tab reloads, which shows up as cumulative lag on each
  // subsequent switch once a few dozen avatars have been opened. The
  // cleanup runs AFTER React has committed the new displayUrl so the
  // new <GlbModel> already has its own fresh scene reference — we only
  // evict the one nobody is looking at anymore.
  useEffect(() => {
    if (!displayUrl) return;
    return () => {
      try {
        useGLTF.clear(displayUrl);
      } catch {
        /* non-fatal — drei may have already evicted it */
      }
    };
  }, [displayUrl]);

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

  if (state.kind === "loading" && !displayUrl) {
    return (
      <LoadingState
        size={size}
        phase={state.phase}
        message={state.message}
        queuePosition={state.queuePosition}
      />
    );
  }

  const activeUrl = state.kind === "ready" ? state.url : displayUrl;
  if (!activeUrl) {
    // Shouldn't happen — defensive fallback in case state is ready with
    // an empty url. Mirrors the LoadingState return above.
    return (
      <LoadingState
        size={size}
        phase={state.kind === "loading" ? state.phase : undefined}
        message={state.kind === "loading" ? state.message : undefined}
        queuePosition={state.kind === "loading" ? state.queuePosition : undefined}
      />
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <AvatarPreviewSurface
        url={activeUrl}
        size={size}
        enableExpand={enableExpand}
        expandedSize={expandedSize}
      />
      {state.kind === "loading" ? (
        <PreviewBusyOverlay
          size={size}
          phase={state.phase}
          queuePosition={state.queuePosition}
        />
      ) : null}
    </div>
  );
}
