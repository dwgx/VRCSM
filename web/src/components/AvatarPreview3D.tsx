import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import {
  AlertTriangle,
  Box,
  Eye,
  Hand,
  Loader2,
  Lock,
  RotateCcw,
  ScanSearch,
  SquareStack,
} from "lucide-react";
import { useAvatarPreview } from "@/hooks/useAvatarPreview";

type PreviewMode = "textured" | "clay" | "wireframe";

interface PreparedSceneMeta {
  center: THREE.Vector3;
  size: THREE.Vector3;
  meshCount: number;
  materialCount: number;
  boneCount: number;
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
        {t("avatars.preview3d.loading", { defaultValue: "Extracting..." })}
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
  const positions: THREE.Vector3[] = [];

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geo = child.geometry;
    if (!geo?.attributes?.position) return;

    const posAttr = geo.attributes.position;
    const worldMatrix = child.matrixWorld;
    const v = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i += 1) {
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
    flatShading: original instanceof THREE.MeshNormalMaterial ? true : false,
  });
}

function disposeDebugMaterial(material: THREE.Material | THREE.Material[] | undefined) {
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
    groupRef.current.updateMatrixWorld(true);

    const normalizedBounds = new THREE.Box3().setFromObject(groupRef.current);
    const normalizedCenter = new THREE.Vector3();
    const normalizedSize = new THREE.Vector3();
    normalizedBounds.getCenter(normalizedCenter);
    normalizedBounds.getSize(normalizedSize);

    let meshCount = 0;
    let boneCount = 0;
    const materialIds = new Set<string>();
    scene.traverse((child) => {
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
  }, [onPrepared, scene]);

  useEffect(() => {
    return () => {
      useGLTF.clear(url);
    };
  }, [url]);

  useEffect(() => {
    applyPreviewMode(scene, mode);
    return () => {
      applyPreviewMode(scene, "textured");
    };
  }, [mode, scene]);

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

function GroundGrid({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <group>
      <gridHelper args={[3.5, 14, 0x4e5a67, 0x232a33]} position={[0, 0, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
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
}: {
  sceneMeta: PreparedSceneMeta | null;
  fitTick: number;
  shiftPanning: boolean;
}) {
  const { camera, invalidate } = useThree();
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    if (!controlsRef.current) return;
    controlsRef.current.mouseButtons.LEFT = shiftPanning
      ? THREE.MOUSE.PAN
      : THREE.MOUSE.ROTATE;
    controlsRef.current.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controlsRef.current.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controlsRef.current.update();
  }, [shiftPanning]);

  useEffect(() => {
    if (!sceneMeta || !controlsRef.current) return;

    const center = sceneMeta.center.clone();
    const maxDim = Math.max(sceneMeta.size.x, sceneMeta.size.y, sceneMeta.size.z, 0.75);
    const distance = Math.max(1.6, maxDim * 1.7);

    camera.position.set(
      center.x + distance * 0.3,
      center.y + maxDim * 0.12,
      center.z + distance,
    );
    camera.near = 0.01;
    camera.far = 150;
    camera.updateProjectionMatrix();

    controlsRef.current.target.copy(center);
    controlsRef.current.minDistance = Math.max(0.18, maxDim * 0.18);
    controlsRef.current.maxDistance = Math.max(6, maxDim * 8);
    controlsRef.current.update();
    invalidate();
  }, [camera, fitTick, invalidate, sceneMeta]);

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan
      enableZoom
      enableRotate
      panSpeed={1.25}
      zoomSpeed={1.45}
      rotateSpeed={0.82}
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
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
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
  const { t } = useTranslation();
  const { state, retry } = useAvatarPreview(avatarId, assetUrl);
  const [mode, setMode] = useState<PreviewMode>("textured");
  const [fitTick, setFitTick] = useState(0);
  const [shiftPanning, setShiftPanning] = useState(false);
  const [sceneMeta, setSceneMeta] = useState<PreparedSceneMeta | null>(null);
  const lastPreparedKey = useRef<string>("");

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

  const canvasStyle = useMemo<CSSProperties>(
    () => ({ width: size, height: size, background: "hsl(var(--canvas))" }),
    [size],
  );

  useEffect(() => {
    if (state.kind === "ready") {
      lastPreparedKey.current = "";
      setSceneMeta(null);
    }
  }, [state.kind, state.kind === "ready" ? state.url : ""]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setShiftPanning(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setShiftPanning(false);
      }
    };
    const onBlur = () => {
      setShiftPanning(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (state.kind === "ready") {
      setFitTick((value) => value + 1);
    }
  }, [state.kind, state.kind === "ready" ? state.url : ""]);

  const showGrid = size >= 200;

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
      className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--canvas))] select-none"
      style={{ width: size, height: size }}
    >
      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          <OverlayButton onClick={() => setFitTick((value) => value + 1)}>
            <ScanSearch className="size-3" />
            {t("avatars.preview3d.fit", { defaultValue: "Fit" })}
          </OverlayButton>
          <OverlayButton active={mode === "textured"} onClick={() => setMode("textured")}>
            <Eye className="size-3" />
            {t("avatars.preview3d.modeTextured", { defaultValue: "Textured" })}
          </OverlayButton>
          <OverlayButton active={mode === "clay"} onClick={() => setMode("clay")}>
            <SquareStack className="size-3" />
            {t("avatars.preview3d.modeClay", { defaultValue: "Clay" })}
          </OverlayButton>
          <OverlayButton active={mode === "wireframe"} onClick={() => setMode("wireframe")}>
            <Box className="size-3" />
            {t("avatars.preview3d.modeWireframe", { defaultValue: "Wireframe" })}
          </OverlayButton>
        </div>

        <div
          className="pointer-events-auto rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--surface)/0.92)] px-2 py-1 text-right text-[10px] leading-tight text-[hsl(var(--muted-foreground))] shadow-sm"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-end gap-1 text-[hsl(var(--foreground))]">
            <Hand className="size-3" />
            {t("avatars.preview3d.controlsTitle", { defaultValue: "Blender-style controls" })}
          </div>
          <div>
            {t("avatars.preview3d.controlsBody", {
              defaultValue: "LMB rotate · Shift+LMB pan · wheel zoom · RMB pan",
            })}
          </div>
        </div>
      </div>

      {sceneMeta ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex items-center justify-between gap-2">
          <div
            className="rounded-[var(--radius-sm)] border border-[hsl(var(--border)/0.75)] bg-[hsl(var(--surface)/0.9)] px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))] shadow-sm"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {sceneMeta.meshCount}M / {sceneMeta.materialCount}Mat / {sceneMeta.boneCount}Bone
          </div>
          {shiftPanning ? (
            <div
              className="rounded-[var(--radius-sm)] border border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.16)] px-2 py-1 text-[10px] font-medium text-[hsl(var(--primary))] shadow-sm"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {t("avatars.preview3d.panning", { defaultValue: "Pan mode" })}
            </div>
          ) : null}
        </div>
      ) : null}

      <Canvas dpr={[1, 2]} camera={{ position: [0, 1, 3.5], fov: 34 }} style={canvasStyle}>
        <color attach="background" args={["#0D1218"]} />
        <fog attach="fog" args={["#0D1218", 6, 18]} />

        <Suspense fallback={null}>
          <ambientLight intensity={0.62} />
          <hemisphereLight args={["#E7EEF9", "#11151C", 0.65]} />
          <directionalLight position={[4.5, 8, 5]} intensity={1.55} />
          <directionalLight position={[-6, 5, -3]} intensity={0.52} />

          <group position={[0, -0.04, 0]}>
            <GlbModel
              url={state.url}
              mode={mode}
              onPrepared={handlePrepared}
            />
            <GroundGrid visible={showGrid} />
          </group>

          <PreviewCameraRig
            sceneMeta={sceneMeta}
            fitTick={fitTick}
            shiftPanning={shiftPanning}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
