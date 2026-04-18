#!/usr/bin/env python3
"""
extract_to_glb.py  v2 — VRChat .vrca bundle → GLB converter

Pipeline: UnityPy parse → adaptive mesh filter → vectorized decode → glTF2 build

Key improvements over v1:
  - Volume-based adaptive filtering replaces hard 15m threshold
  - Numpy-vectorized vertex decode (10-50x faster, zero Python loops)
  - LOD deduplication (keeps highest-detail variant per mesh group)
  - Spatial outlier rejection (removes meshes far from body cluster)

Usage:
    python extract_to_glb.py <bundle_path> <output.glb>
"""

import io
import sys, struct, os, re
from dataclasses import dataclass
from typing import Optional, Any
import numpy as np

# ── Redirect stdio to a file-backed log in frozen PyInstaller env ────
# The old guard checked `fileno() < 0` but PyInstaller can hand us a
# valid fd that still fails with OSError 22 on the first write — the
# handle is inherited from the parent's CREATE_NO_WINDOW log redirect,
# and Windows' text-mode CRT trips on the non-console handle type.
# Fix: when frozen, always substitute a file-backed stream before any
# import can print() to the broken handle.
def _install_safe_stdio():
    try:
        probe_dir = (
            os.path.dirname(os.path.abspath(sys.argv[2]))
            if len(sys.argv) > 2 else
            os.path.dirname(os.path.abspath(sys.argv[0]))
        )
        os.makedirs(probe_dir, exist_ok=True)
        log_path = os.path.join(probe_dir, "extractor_runtime.log")
        stream = open(log_path, "w", encoding="utf-8", buffering=1, errors="replace")
        return stream
    except Exception:
        return io.StringIO()

if getattr(sys, "frozen", False):
    _safe_stream = _install_safe_stdio()
    sys.stdout = _safe_stream
    sys.stderr = _safe_stream
else:
    # Dev-mode guard: only redirect if stdio is genuinely broken.
    try:
        if sys.stdout is None or sys.stdout.fileno() < 0:
            sys.stdout = open(os.devnull, "w")
    except Exception:
        sys.stdout = open(os.devnull, "w")
    try:
        if sys.stderr is None or sys.stderr.fileno() < 0:
            sys.stderr = open(os.devnull, "w")
    except Exception:
        sys.stderr = open(os.devnull, "w")


# ── Constants ────────────────────────────────────────────────────────

# Unity VertexFormat → bytes per component
FORMAT_BPC = {
    0: 4,    # Float32
    1: 2,    # Float16
    2: 1,    # UNorm8
    3: 1,    # SNorm8
    4: 2,    # UNorm16
    5: 2,    # SNorm16
    6: 4,    # UInt8  (padded to 4 in older Unity)
    7: 4,    # SInt8  (padded)
    8: 4,    # UInt16 (padded)
    9: 4,    # SInt16 (padded)
    10: 2,   # UInt32-half
    11: 4,   # SInt32
}

# Unity ShaderChannel index → semantic name
_CHAN_SEM = {0: 'position', 1: 'normal', 2: 'tangent', 3: 'color', 4: 'uv0'}


def log(msg: str):
    print(f"[extract_to_glb] {msg}")


# ─── Vectorized Vertex Decode ─────────────────────────────────────────

def _decode_channel_vec(raw_np: np.ndarray, base: int, stride: int,
                        count: int, ch_off: int, fmt: int, dim: int
                        ) -> Optional[np.ndarray]:
    """
    Decode a single vertex channel using numpy fancy indexing.
    Zero Python per-vertex loops — 10-50x faster than the v1 struct.unpack loop.
    """
    bpc = FORMAT_BPC.get(fmt, 4)
    total = bpc * dim

    # Byte positions for every component of every vertex
    vtx_off = np.arange(count, dtype=np.int64) * stride + base + ch_off
    byte_idx = (vtx_off[:, None] + np.arange(total, dtype=np.int64)).ravel()

    if byte_idx.size == 0 or byte_idx[-1] >= len(raw_np):
        return None

    g = raw_np[byte_idx]  # gather all channel bytes in one vectorized op

    if fmt == 0:    # Float32
        return g.view(np.float32).reshape(count, dim).copy()
    elif fmt == 1:  # Float16
        return g.view(np.float16).reshape(count, dim).astype(np.float32)
    elif fmt == 2:  # UNorm8
        return g.reshape(count, dim).astype(np.float32) / 255.0
    elif fmt == 3:  # SNorm8
        return g.view(np.int8).reshape(count, dim).astype(np.float32) / 127.0
    elif fmt == 4:  # UNorm16
        return g.view(np.uint16).reshape(count, dim).astype(np.float32) / 65535.0
    elif fmt == 5:  # SNorm16
        return g.view(np.int16).reshape(count, dim).astype(np.float32) / 32767.0
    else:           # Fallback: treat as float32
        try:
            return g.view(np.float32).reshape(count, dim).copy()
        except ValueError:
            return None


def _parse_vertex_data(mesh):
    """
    Extract (positions, normals, uv0, vertex_count) from Unity packed VertexData.
    Returns None for positions if the mesh is unparseable.
    """
    vd = mesh.m_VertexData
    vc = vd.m_VertexCount
    if vc == 0:
        return None, None, None, 0

    channels = vd.m_Channels
    raw_np = np.frombuffer(bytes(vd.m_DataSize), dtype=np.uint8)
    if raw_np.size == 0:
        return None, None, None, 0

    # 1. Compute per-stream strides (sum of channel sizes, 4-byte aligned)
    stream_strides: dict[int, int] = {}
    for ch in channels:
        if ch.dimension == 0:
            continue
        s = ch.stream
        end = ch.offset + FORMAT_BPC.get(ch.format, 4) * ch.dimension
        if s not in stream_strides or end > stream_strides[s]:
            stream_strides[s] = end
    for s in stream_strides:
        r = stream_strides[s] % 4
        if r:
            stream_strides[s] += 4 - r

    # 2. Stream base offsets in the raw blob
    stream_bases: dict[int, int] = {}
    off = 0
    for s in sorted(stream_strides):
        stream_bases[s] = off
        off += stream_strides[s] * vc

    # 3. Decode wanted channels
    positions = normals = uv0 = None
    for ci, ch in enumerate(channels):
        if ch.dimension == 0:
            continue
        sem = _CHAN_SEM.get(ci)
        if sem not in ('position', 'normal', 'uv0'):
            continue

        s = ch.stream
        arr = _decode_channel_vec(
            raw_np, stream_bases.get(s, 0), stream_strides.get(s, 0),
            vc, ch.offset, ch.format, ch.dimension)
        if arr is None:
            continue

        if sem == 'position' and arr.shape[1] >= 3:
            positions = arr[:, :3]
        elif sem == 'normal' and arr.shape[1] >= 3:
            normals = arr[:, :3]
        elif sem == 'uv0' and arr.shape[1] >= 2:
            uv0 = arr[:, :2]

    return positions, normals, uv0, vc


# ─── Mesh Metrics & Adaptive Filtering ────────────────────────────────

@dataclass
class _MeshInfo:
    """Pre-computed metrics + cached vertex data for a single mesh."""
    mesh: Any
    name: str
    binding_name: str
    vc: int
    bone_count: int
    volume: float
    extents: np.ndarray
    centroid: np.ndarray
    bbox_min: np.ndarray
    bbox_max: np.ndarray
    is_skinned: bool
    positions: np.ndarray
    normals: Optional[np.ndarray]
    uv0: Optional[np.ndarray]
    object_path_id: int
    keyword_penalty: int


@dataclass
class _MeshBinding:
    game_object_name: str
    materials: list[Any]


_HARD_EXCLUDE_KEYWORDS = (
    "bloom",
    "particle",
    "trail",
    "laser",
    "beam",
    "speaker",
    "audio",
    "trumpet",
    "horn",
    "megaphone",
    "gun",
    "rifle",
    "sword",
    "weapon",
)

_SOFT_EXCLUDE_KEYWORDS = (
    "bag",
    "backpack",
    "prop",
    "fx",
    "effect",
    "vfx",
    "aura",
    "halo",
    "glow",
)


def _mesh_label(name: str, binding_name: str) -> str:
    return f"{name} {binding_name}".strip().lower()


def _keyword_penalty(name: str, binding_name: str) -> int:
    label = _mesh_label(name, binding_name)
    penalty = 0
    for token in _HARD_EXCLUDE_KEYWORDS:
        if token in label:
            penalty += 10
    for token in _SOFT_EXCLUDE_KEYWORDS:
        if token in label:
            penalty += 4
    return penalty


def _aabb_overlap_ratio(candidate: _MeshInfo, body_min: np.ndarray, body_max: np.ndarray) -> float:
    overlap_min = np.maximum(candidate.bbox_min, body_min)
    overlap_max = np.minimum(candidate.bbox_max, body_max)
    overlap_extents = np.maximum(overlap_max - overlap_min, 0.0)
    overlap_volume = float(np.prod(overlap_extents))
    if overlap_volume <= 0.0:
        return 0.0
    candidate_volume = max(candidate.volume, 1e-6)
    return overlap_volume / candidate_volume


def _pptr_read(ptr):
    try:
        return ptr.read() if ptr else None
    except Exception:
        return None


def _normalize_prop_name(name: Any) -> str:
    if isinstance(name, str):
        return name
    if hasattr(name, "name"):
        try:
            return str(name.name)
        except Exception:
            pass
    return str(name)


def _color_to_rgba(value: Any) -> list[float]:
    if value is None:
        return [1.0, 1.0, 1.0, 1.0]
    out = []
    for key in ("r", "g", "b", "a"):
        try:
            out.append(float(getattr(value, key)))
        except Exception:
            out.append(1.0 if key == "a" else 0.0)
    return out


def _vector2_to_list(value: Any) -> list[float]:
    if value is None:
        return [1.0, 1.0]
    out = []
    for key, fallback in (("x", 1.0), ("y", 1.0)):
        try:
            out.append(float(getattr(value, key)))
        except Exception:
            out.append(fallback)
    return out


def _collect_mesh_bindings(env) -> dict[int, _MeshBinding]:
    """
    Build mesh path_id -> renderer binding.
    Static meshes use GameObject + MeshFilter + MeshRenderer.
    Skinned meshes use SkinnedMeshRenderer directly.
    """
    objects = []
    game_objects: dict[int, Any] = {}

    for obj in env.objects:
        try:
            data = obj.read()
        except Exception:
            continue
        objects.append(data)
        if obj.type.name == "GameObject":
            game_objects[obj.path_id] = data

    bindings: dict[int, _MeshBinding] = {}

    for go_path_id, go in game_objects.items():
        components = []
        for comp in getattr(go, "m_Component", []) or []:
            entry = getattr(comp, "component", comp)
            comp_obj = _pptr_read(entry)
            if comp_obj is not None:
                components.append(comp_obj)

        mesh_filter = next((c for c in components if c.__class__.__name__ == "MeshFilter"), None)
        mesh_renderer = next((c for c in components if c.__class__.__name__ == "MeshRenderer"), None)
        skinned_renderer = next((c for c in components if c.__class__.__name__ == "SkinnedMeshRenderer"), None)
        game_object_name = getattr(go, "m_Name", "")

        if skinned_renderer is not None:
            mesh_ptr = getattr(skinned_renderer, "m_Mesh", None)
            mesh_obj = _pptr_read(mesh_ptr)
            if mesh_obj is not None and getattr(mesh_obj, "object_reader", None):
                bindings[mesh_obj.object_reader.path_id] = _MeshBinding(
                    game_object_name=game_object_name,
                    materials=[m for m in getattr(skinned_renderer, "m_Materials", []) or []],
                )

        if mesh_filter is not None and mesh_renderer is not None:
            mesh_ptr = getattr(mesh_filter, "m_Mesh", None)
            mesh_obj = _pptr_read(mesh_ptr)
            if mesh_obj is not None and getattr(mesh_obj, "object_reader", None):
                bindings[mesh_obj.object_reader.path_id] = _MeshBinding(
                    game_object_name=game_object_name,
                    materials=[m for m in getattr(mesh_renderer, "m_Materials", []) or []],
                )

    return bindings


def _collect_metrics(mesh_list, mesh_bindings: Optional[dict[int, _MeshBinding]] = None) -> list[_MeshInfo]:
    """Parse all meshes once — cache vertex data + compute bounding metrics."""
    out: list[_MeshInfo] = []
    for mesh in mesh_list:
        positions, normals, uv0, vc = _parse_vertex_data(mesh)
        if positions is None or vc < 3:
            continue

        bbox_min = positions.min(axis=0)
        bbox_max = positions.max(axis=0)
        extents = bbox_max - bbox_min
        volume = float(np.prod(np.maximum(extents, 1e-6)))
        centroid = ((bbox_min + bbox_max) / 2).astype(np.float64)
        object_path_id = getattr(getattr(mesh, 'object_reader', None), 'path_id', 0)
        binding = (mesh_bindings or {}).get(object_path_id)
        binding_name = binding.game_object_name if binding else ""
        name = getattr(mesh, 'm_Name', f'mesh_{len(out)}')

        bones = getattr(mesh, 'm_BoneNameHashes', None) or []
        bc = len(bones)

        out.append(_MeshInfo(
            mesh=mesh,
            name=name,
            binding_name=binding_name,
            vc=vc, bone_count=bc,
            volume=volume, extents=extents, centroid=centroid,
            bbox_min=bbox_min.astype(np.float64),
            bbox_max=bbox_max.astype(np.float64),
            is_skinned=bc > 4,
            positions=positions, normals=normals, uv0=uv0,
            object_path_id=object_path_id,
            keyword_penalty=_keyword_penalty(name, binding_name),
        ))
    return out


def _filter_adaptive(infos: list[_MeshInfo], max_meshes: int = 12) -> list[_MeshInfo]:
    """
    Multi-stage adaptive mesh filter — no hard-coded thresholds.

    Why this works better than the old "15m extent" check:
      - A 2m human with a 10m sword → sword volume >> median → rejected
      - A 10m giant avatar → all meshes similar volume → all kept
      - Tiny particle emitters → volume << median → rejected

    Stages:
      1. Prefer skinned meshes (bone_count > 4 = real body parts)
      2. Volume outlier rejection (relative to median, not absolute)
      3. Spatial centroid outlier rejection (> 3sigma from group)
      4. LOD deduplication (keep highest vertex count per name group)
    """
    if len(infos) <= 1:
        return infos

    # ── Stage 1: prefer skinned ──────────────────────────────────────
    skinned = [m for m in infos if m.is_skinned]
    pool = skinned if len(skinned) >= 2 else infos
    log(f"  filter stage 1: {len(skinned)} skinned / {len(infos)} total"
        f" → pool={len(pool)}")

    # ── Stage 2: volume outlier rejection ─────────────────────────────
    vols = np.array([m.volume for m in pool])
    v_med = float(np.median(vols))

    # Reject if volume > 50x median (giant weapons/wings/skyboxes)
    # Reject if volume < 0.001x median (particle scraps, glow planes)
    lo, hi = v_med * 0.001, v_med * 50
    kept = [m for m in pool if lo <= m.volume <= hi]
    if not kept:
        kept = pool  # safety fallback — never discard everything
    log(f"  filter stage 2: vol median={v_med:.4f}, range=[{lo:.6f}, {hi:.1f}]"
        f" → kept={len(kept)}")

    # ── Stage 3: spatial centroid outlier rejection ───────────────────
    if len(kept) > 2:
        cs = np.array([m.centroid for m in kept])
        center = cs.mean(axis=0)
        dists = np.linalg.norm(cs - center, axis=1)
        sigma = float(dists.std())
        if sigma > 1e-6:
            z = (dists - dists.mean()) / sigma
            spatial = [m for m, zi in zip(kept, z) if zi < 3.0]
            if spatial:
                kept = spatial
        log(f"  filter stage 3: centroid sigma={sigma:.3f} → kept={len(kept)}")

    # ── Stage 4: LOD deduplication ───────────────────────────────────
    groups: dict[str, list[_MeshInfo]] = {}
    for m in kept:
        base = re.sub(r'_?LOD\d+$', '', m.name, flags=re.IGNORECASE)
        groups.setdefault(base, []).append(m)
    deduped = [max(g, key=lambda x: x.vc) for g in groups.values()]
    log(f"  filter stage 4: LOD dedup {len(kept)} → {len(deduped)}")

    # ── Stage 5: body-cluster fit, reject props / FX / held objects ───────
    anchor_candidates = [
        m for m in deduped
        if m.is_skinned and m.keyword_penalty == 0
    ]
    if not anchor_candidates:
        anchor_candidates = [
            m for m in deduped
            if m.is_skinned and m.keyword_penalty < 10
        ]
    if not anchor_candidates:
        anchor_candidates = sorted(
            deduped,
            key=lambda m: (m.is_skinned, -m.keyword_penalty, m.vc, m.volume),
            reverse=True,
        )

    anchors = sorted(
        anchor_candidates,
        key=lambda m: (m.vc, m.volume),
        reverse=True,
    )[:3]
    anchor_ids = {m.object_path_id for m in anchors}
    body_min = np.min([m.bbox_min for m in anchors], axis=0)
    body_max = np.max([m.bbox_max for m in anchors], axis=0)
    body_center = (body_min + body_max) / 2.0
    body_diag = float(np.linalg.norm(body_max - body_min))
    body_extent_max = float(np.max(body_max - body_min))
    anchor_volumes = np.array([m.volume for m in anchors], dtype=np.float64)
    anchor_extent_max = max(float(np.max(m.extents)) for m in anchors)
    anchor_volume_median = float(np.median(anchor_volumes)) if len(anchor_volumes) else 0.0
    log(
        "  filter stage 5: body anchors="
        + ", ".join(m.binding_name or m.name for m in anchors)
    )

    clustered: list[_MeshInfo] = []
    for mesh in deduped:
        if mesh.object_path_id in anchor_ids:
            clustered.append(mesh)
            continue

        overlap_ratio = _aabb_overlap_ratio(mesh, body_min, body_max)
        dist = float(np.linalg.norm(mesh.centroid - body_center))
        label = _mesh_label(mesh.name, mesh.binding_name)

        if mesh.keyword_penalty >= 10:
            extent_ratio = float(np.max(mesh.extents)) / max(anchor_extent_max, 1e-6)
            volume_ratio = mesh.volume / max(anchor_volume_median, 1e-6)
            if extent_ratio >= 1.8 or volume_ratio >= 3.5:
                log(
                    f"    - reject {mesh.binding_name or mesh.name}: hard keyword oversized"
                    f" (extent x{extent_ratio:.1f}, volume x{volume_ratio:.1f})"
                )
                continue
            if not mesh.is_skinned:
                log(f"    - reject {mesh.binding_name or mesh.name}: hard keyword prop ({label})")
                continue
            if overlap_ratio < 0.92 or dist > max(0.22, body_diag * 0.28):
                log(f"    - reject {mesh.binding_name or mesh.name}: hard keyword detached ({label})")
                continue

        if mesh.keyword_penalty >= 4 and overlap_ratio < 0.25 and dist > max(0.45, body_diag * 0.45):
            log(f"    - reject {mesh.binding_name or mesh.name}: soft keyword + detached")
            continue

        if mesh.keyword_penalty >= 4 and not mesh.is_skinned and overlap_ratio < 0.55:
            log(f"    - reject {mesh.binding_name or mesh.name}: soft keyword prop")
            continue

        if overlap_ratio < 0.03 and dist > max(0.85, body_diag * 0.60):
            log(f"    - reject {mesh.binding_name or mesh.name}: detached from body cluster")
            continue

        if mesh.volume < max(1e-6, np.median([m.volume for m in anchors]) * 0.0002) and dist > max(0.5, body_extent_max * 0.25):
            log(f"    - reject {mesh.binding_name or mesh.name}: tiny detached mesh")
            continue

        clustered.append(mesh)

    if not clustered:
        clustered = anchors
    log(f"  filter stage 5: body cluster {len(deduped)} → {len(clustered)}")

    clean = [m for m in clustered if m.keyword_penalty == 0]
    if len(clean) >= min(max_meshes, max(4, len(anchors) + 1)):
        log(
            f"  filter stage 6: keeping clean body set {len(clustered)} → {len(clean)}"
        )
        clustered = clean
    else:
        no_keyword_props = [
            m for m in clustered
            if m.object_path_id in anchor_ids or m.keyword_penalty < 4
        ]
        if len(no_keyword_props) >= max(len(anchors), 3) and len(no_keyword_props) != len(clustered):
            log(
                f"  filter stage 6: dropping keyword props {len(clustered)} → {len(no_keyword_props)}"
            )
            clustered = no_keyword_props

        no_hard_props = [
            m for m in clustered
            if m.object_path_id in anchor_ids or m.keyword_penalty < 10
        ]
        if len(no_hard_props) >= max(len(anchors), 3) and len(no_hard_props) != len(clustered):
            log(
                f"  filter stage 6: dropping hard-keyword props {len(clustered)} → {len(no_hard_props)}"
            )
            clustered = no_hard_props

    # Sort by body relevance first, then by size.
    clustered.sort(
        key=lambda m: (
            1 if m.object_path_id in anchor_ids else 0,
            1 if m.keyword_penalty == 0 else 0,
            m.is_skinned,
            m.vc,
            m.volume,
        ),
        reverse=True,
    )
    return clustered[:max_meshes]


# ─── GLB Builder ──────────────────────────────────────────────────────

def _build_glb(infos: list[_MeshInfo], glb_path: str, mesh_bindings: Optional[dict[int, _MeshBinding]] = None) -> bool:
    """Construct and save a binary glTF (.glb) from filtered mesh infos."""
    from pygltflib import (
        GLTF2, Scene, Node, Mesh as GltfMesh, Primitive,
        Buffer, BufferView, Accessor, Material as GltfMaterial, Asset,
        Image as GltfImage, Texture as GltfTexture, TextureInfo,
        PbrMetallicRoughness, NormalMaterialTexture,
        FLOAT, UNSIGNED_SHORT, UNSIGNED_INT, TRIANGLES,
        ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER,
    )

    bin_blob = bytearray()
    gltf = GLTF2(
        asset=Asset(version="2.0", generator="VRCSM-UnityPy-v2"),
        scene=0,
        scenes=[Scene(nodes=[])],
        nodes=[], meshes=[], accessors=[], bufferViews=[], buffers=[],
        materials=[GltfMaterial(
            name="default",
            pbrMetallicRoughness=PbrMetallicRoughness(
                baseColorFactor=[0.8, 0.8, 0.8, 1.0],
                metallicFactor=0.05,
                roughnessFactor=0.7,
            ),
        )],
        images=[],
        textures=[],
    )
    texture_cache: dict[int, int] = {}
    material_cache: dict[int, int] = {}

    def _acc(data_np, target, type_str, ct, min_v=None, max_v=None) -> int:
        """Append accessor + buffer-view, return accessor index."""
        raw = data_np.tobytes()
        off = len(bin_blob)
        bin_blob.extend(raw)
        while len(bin_blob) % 4:
            bin_blob.append(0)
        bv_i = len(gltf.bufferViews)
        gltf.bufferViews.append(
            BufferView(buffer=0, byteOffset=off, byteLength=len(raw), target=target))
        kw = dict(bufferView=bv_i, byteOffset=0, componentType=ct,
                  count=len(data_np), type=type_str)
        if min_v is not None:
            kw['min'] = min_v
            kw['max'] = max_v
        acc_i = len(gltf.accessors)
        gltf.accessors.append(Accessor(**kw))
        return acc_i

    def _append_bytes(raw: bytes, mime_type: Optional[str] = None) -> tuple[int, int]:
        off = len(bin_blob)
        bin_blob.extend(raw)
        while len(bin_blob) % 4:
            bin_blob.append(0)
        bv_i = len(gltf.bufferViews)
        gltf.bufferViews.append(
            BufferView(buffer=0, byteOffset=off, byteLength=len(raw)))
        return bv_i, len(raw)

    def _extract_texture_index(tex_ptr: Any) -> Optional[int]:
        tex_obj = _pptr_read(tex_ptr)
        if tex_obj is None:
            return None

        tex_path_id = getattr(getattr(tex_obj, "object_reader", None), "path_id", 0)
        if tex_path_id in texture_cache:
            return texture_cache[tex_path_id]

        try:
            image = tex_obj.image
        except Exception:
            return None
        if image is None:
            return None

        buf = io.BytesIO()
        try:
            image.save(buf, format="PNG")
        except Exception:
            return None

        png = buf.getvalue()
        if not png:
            return None

        bv_i, _ = _append_bytes(png, "image/png")
        img_i = len(gltf.images)
        gltf.images.append(GltfImage(
            bufferView=bv_i,
            mimeType="image/png",
            name=getattr(tex_obj, "m_Name", None),
        ))
        tex_i = len(gltf.textures)
        gltf.textures.append(GltfTexture(
            source=img_i,
            name=getattr(tex_obj, "m_Name", None),
        ))
        texture_cache[tex_path_id] = tex_i
        return tex_i

    def _build_material_index(mat_ptr: Any) -> int:
        mat_obj = _pptr_read(mat_ptr)
        if mat_obj is None:
            return 0

        mat_path_id = getattr(getattr(mat_obj, "object_reader", None), "path_id", 0)
        if mat_path_id in material_cache:
            return material_cache[mat_path_id]

        props = getattr(mat_obj, "m_SavedProperties", None)
        colors = { _normalize_prop_name(name): value for name, value in getattr(props, "m_Colors", []) or [] }
        floats = { _normalize_prop_name(name): float(value) for name, value in getattr(props, "m_Floats", []) or [] }
        tex_envs = { _normalize_prop_name(name): value for name, value in getattr(props, "m_TexEnvs", []) or [] }

        base_color = _color_to_rgba(colors.get("_BaseColor") or colors.get("_Color"))
        base_color_tex = None
        normal_tex = None
        emissive_tex = None

        if "_MainTex" in tex_envs:
            tex_i = _extract_texture_index(tex_envs["_MainTex"].m_Texture)
            if tex_i is not None:
                base_color_tex = TextureInfo(index=tex_i, texCoord=0)
        if "_BaseMap" in tex_envs and base_color_tex is None:
            tex_i = _extract_texture_index(tex_envs["_BaseMap"].m_Texture)
            if tex_i is not None:
                base_color_tex = TextureInfo(index=tex_i, texCoord=0)
        if "_BumpMap" in tex_envs:
            tex_i = _extract_texture_index(tex_envs["_BumpMap"].m_Texture)
            if tex_i is not None:
                normal_tex = NormalMaterialTexture(index=tex_i, texCoord=0, scale=1.0)
        if "_EmissionMap" in tex_envs:
            tex_i = _extract_texture_index(tex_envs["_EmissionMap"].m_Texture)
            if tex_i is not None:
                emissive_tex = TextureInfo(index=tex_i, texCoord=0)

        alpha_mode = "OPAQUE"
        alpha_cutoff = None
        if base_color[3] < 0.999 or floats.get("_Mode") in (2.0, 3.0):
            alpha_mode = "BLEND"
        if floats.get("_Cutoff", 0.0) > 0.0:
            alpha_mode = "MASK"
            alpha_cutoff = floats.get("_Cutoff")

        emissive_color = _color_to_rgba(colors.get("_EmissionColor"))
        material = GltfMaterial(
            name=getattr(mat_obj, "m_Name", None),
            pbrMetallicRoughness=PbrMetallicRoughness(
                baseColorFactor=base_color,
                baseColorTexture=base_color_tex,
                metallicFactor=float(floats.get("_Metallic", 0.0)),
                roughnessFactor=max(0.0, min(1.0, 1.0 - float(floats.get("_Glossiness", 0.3)))),
            ),
            normalTexture=normal_tex,
            emissiveTexture=emissive_tex,
            emissiveFactor=emissive_color[:3],
            alphaMode=alpha_mode,
            alphaCutoff=alpha_cutoff,
            doubleSided=bool(floats.get("_Cull", 2.0) == 0.0),
        )
        mat_i = len(gltf.materials)
        gltf.materials.append(material)
        material_cache[mat_path_id] = mat_i
        return mat_i

    exported = 0
    for info in infos:
        try:
            # ── Coordinate transform: Unity LH → glTF RH (negate X) ──
            pos = info.positions.copy()
            pos[:, 0] = -pos[:, 0]

            nrm = None
            if info.normals is not None:
                nrm = info.normals.copy()
                nrm[:, 0] = -nrm[:, 0]

            # ── Index buffer ──────────────────────────────────────────
            idx_buf = bytes(info.mesh.m_IndexBuffer)
            idx_fmt = getattr(info.mesh, 'm_IndexFormat', 0)
            if idx_fmt == 0:
                indices = np.frombuffer(idx_buf, dtype=np.uint16).astype(np.int32)
                index_elem_size = 2
            else:
                indices = np.frombuffer(idx_buf, dtype=np.uint32).astype(np.int32)
                index_elem_size = 4

            # ── Build primitive attributes ────────────────────────────
            attrs = {}
            pos_f32 = pos.astype(np.float32)
            attrs["POSITION"] = _acc(
                pos_f32, ARRAY_BUFFER, "VEC3", FLOAT,
                pos_f32.min(axis=0).tolist(), pos_f32.max(axis=0).tolist())

            if nrm is not None:
                attrs["NORMAL"] = _acc(
                    nrm.astype(np.float32), ARRAY_BUFFER, "VEC3", FLOAT)

            if info.uv0 is not None:
                uv = info.uv0.copy()
                uv[:, 1] = 1.0 - uv[:, 1]  # Unity bottom-left → glTF top-left
                attrs["TEXCOORD_0"] = _acc(
                    uv.astype(np.float32), ARRAY_BUFFER, "VEC2", FLOAT)
            binding = (mesh_bindings or {}).get(info.object_path_id)
            materials = binding.materials if binding else []
            primitives = []
            submeshes = getattr(info.mesh, "m_SubMeshes", None) or []
            if not submeshes:
                submeshes = [None]

            total_triangles = 0
            for submesh_index, submesh in enumerate(submeshes):
                if submesh is None:
                    sub_indices = indices
                else:
                    start = int(getattr(submesh, "firstByte", 0)) // index_elem_size
                    count = int(getattr(submesh, "indexCount", 0))
                    sub_indices = indices[start:start + count]

                sub_indices = sub_indices[(sub_indices >= 0) & (sub_indices < info.vc)]
                if len(sub_indices) < 3:
                    continue

                tri_count = len(sub_indices) // 3
                sub_indices = sub_indices[:tri_count * 3].reshape(-1, 3)
                sub_indices[:, [0, 2]] = sub_indices[:, [2, 0]]
                sub_indices = sub_indices.ravel()
                total_triangles += tri_count

                max_idx = int(sub_indices.max())
                if max_idx <= 65535:
                    idx_np = sub_indices.astype(np.uint16)
                    idx_ct = UNSIGNED_SHORT
                else:
                    idx_np = sub_indices.astype(np.uint32)
                    idx_ct = UNSIGNED_INT

                i_acc = _acc(idx_np, ELEMENT_ARRAY_BUFFER, "SCALAR", idx_ct)
                mat_i = 0
                if materials:
                    mat_i = _build_material_index(
                        materials[min(submesh_index, len(materials) - 1)]
                    )
                primitives.append(Primitive(
                    attributes=attrs,
                    indices=i_acc,
                    material=mat_i,
                    mode=TRIANGLES,
                ))

            if not primitives:
                continue
            mi = len(gltf.meshes)
            gltf.meshes.append(GltfMesh(
                name=info.name,
                primitives=primitives))
            node_name = binding.game_object_name if binding and binding.game_object_name else info.name
            gltf.nodes.append(Node(name=node_name, mesh=mi))
            gltf.scenes[0].nodes.append(exported)
            exported += 1
            log(f"  + {node_name}: {info.vc} verts, {total_triangles} tris, {len(primitives)} prims")

        except Exception as ex:
            print(f"  ! skip {info.name}: {ex}", file=sys.stderr)

    if exported == 0:
        return False

    gltf.buffers.append(Buffer(byteLength=len(bin_blob)))
    gltf.set_binary_blob(bytes(bin_blob))
    os.makedirs(os.path.dirname(os.path.abspath(glb_path)), exist_ok=True)
    gltf.save(glb_path)
    kb = os.path.getsize(glb_path) / 1024
    log(f"Done: {glb_path} ({kb:.0f} KB, {exported} meshes)")
    return True


# ─── Entry Point ──────────────────────────────────────────────────────

def _die(msg: str):
    """Write error log and exit with failure."""
    # Write the log next to the GLB output so callers can find it
    # without knowing the frozen exe's temp-extract directory. Falls
    # back to the script dir for non-frozen dev runs.
    target_dir = (
        os.path.dirname(os.path.abspath(sys.argv[2]))
        if len(sys.argv) > 2 else
        os.path.dirname(os.path.abspath(sys.argv[0]))
    )
    try:
        os.makedirs(target_dir, exist_ok=True)
        log_pth = os.path.join(target_dir, "extractor_error.log")
        with open(log_pth, "w", encoding="utf-8") as f:
            f.write(f"ERROR: {msg}\n")
    except Exception:
        pass
    try:
        print(f"ERROR: {msg}", file=sys.stderr)
    except Exception:
        pass
    sys.exit(1)


def main():
    if len(sys.argv) < 3:
        print("Usage: extract_to_glb.py <bundle_path> <output.glb>", file=sys.stderr)
        sys.exit(1)

    bundle_path = sys.argv[1]
    glb_path = sys.argv[2]

    if not os.path.isfile(bundle_path):
        _die(f"bundle not found: {bundle_path}")

    import UnityPy
    log(f"Loading: {bundle_path}")
    env = UnityPy.load(bundle_path)
    mesh_bindings = _collect_mesh_bindings(env)
    log(f"Collected {len(mesh_bindings)} renderer bindings")

    # ── Collect all meshes with vertex data ───────────────────────────
    raw_meshes = []
    for obj in env.objects:
        if obj.type.name == 'Mesh':
            try:
                data = obj.read()
                vd = getattr(data, 'm_VertexData', None)
                if vd and vd.m_VertexCount > 0:
                    raw_meshes.append(data)
            except Exception:
                pass

    if not raw_meshes:
        _die("No meshes found in bundle")

    log(f"Found {len(raw_meshes)} raw meshes, computing metrics...")

    # ── Pre-compute metrics (vectorized vertex decode) ────────────────
    metrics = _collect_metrics(raw_meshes, mesh_bindings)
    if not metrics:
        _die("No valid meshes after vertex parsing")

    # ── Adaptive filter ───────────────────────────────────────────────
    filtered = _filter_adaptive(metrics)
    if not filtered:
        _die("No meshes survived filtering")

    # ── Build GLB ─────────────────────────────────────────────────────
    log(f"Building GLB from {len(filtered)} meshes...")
    if not _build_glb(filtered, glb_path, mesh_bindings):
        _die("No meshes exported to GLB")

    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        # Mirror _die's log-next-to-output-glb behavior so the host can
        # find the traceback. When frozen, sys.argv[0] points at the
        # temp extract dir which gets wiped on exit.
        target_dir = (
            os.path.dirname(os.path.abspath(sys.argv[2]))
            if len(sys.argv) > 2 else
            os.path.dirname(os.path.abspath(sys.argv[0]))
        )
        try:
            os.makedirs(target_dir, exist_ok=True)
            log_path = os.path.join(target_dir, "extractor_error.log")
            with open(log_path, "w", encoding="utf-8") as f:
                f.write(traceback.format_exc())
        except Exception:
            pass

        # If LZMA/MemoryError from truncated download, remove corrupted bundle
        # so VRCSM re-fetches it fresh on next attempt.
        if isinstance(e, MemoryError) or 'LZMA' in type(e).__name__:
            try:
                if len(sys.argv) >= 2 and os.path.isfile(sys.argv[1]):
                    os.remove(sys.argv[1])
            except Exception:
                pass

        sys.exit(1)
