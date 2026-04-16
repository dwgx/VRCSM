#!/usr/bin/env python3
"""
extract_to_glb.py  –  UnityPy-based VRChat .vrca bundle → GLB converter.

Replaces the broken AssetStudioModCLI pipeline for Unity 2022 bundles.

Usage:
    python extract_to_glb.py <bundle_path> <output_glb_path>
"""

import sys, struct, os
import numpy as np

try:
    if sys.stdout is None or sys.stdout.fileno() < 0:
        sys.stdout = open(os.devnull, 'w')
except Exception:
    sys.stdout = open(os.devnull, 'w')

try:
    if sys.stderr is None or sys.stderr.fileno() < 0:
        sys.stderr = open(os.devnull, 'w')
except Exception:
    sys.stderr = open(os.devnull, 'w')

# Unity VertexFormatPC32 / VertexFormat mapping → byte size per component
FORMAT_SIZES = {
    0: 4,   # kVertexFormatFloat
    1: 2,   # kVertexFormatFloat16
    2: 1,   # kVertexFormatUNorm8
    3: 1,   # kVertexFormatSNorm8
    4: 2,   # kVertexFormatUNorm16
    5: 2,   # kVertexFormatSNorm16
    6: 4,   # kVertexFormatUInt8  (sic — stored in 4-byte slot pre-2019)
    7: 4,   # kVertexFormatSInt8
    8: 4,   # kVertexFormatUInt16
    9: 4,   # kVertexFormatSInt16
    10: 2,  # kVertexFormatUInt32 (half in some builds)
    11: 4,  # kVertexFormatSInt32
}


def _decode_channel(raw: bytes, base: int, stride: int, count: int,
                    ch_offset: int, fmt: int, dim: int) -> np.ndarray:
    """
    Decode a single vertex channel from a raw byte stream.
    Returns float32 numpy array of shape (count, dim).
    """
    bpc = FORMAT_SIZES.get(fmt, 4)  # bytes per component
    out = np.empty((count, dim), dtype=np.float32)

    for v in range(count):
        ptr = base + v * stride + ch_offset
        if fmt == 0:  # float32
            vals = struct.unpack_from(f'<{dim}f', raw, ptr)
        elif fmt == 1:  # float16
            raw_halves = struct.unpack_from(f'<{dim}H', raw, ptr)
            vals = [float(np.frombuffer(struct.pack('<H', h), dtype=np.float16)[0])
                    for h in raw_halves]
        elif fmt == 2:  # UNorm8
            vals = [b / 255.0 for b in raw[ptr: ptr + dim]]
        elif fmt == 3:  # SNorm8
            vals = [((b if b < 128 else b - 256) / 127.0)
                    for b in raw[ptr: ptr + dim]]
        elif fmt == 4:  # UNorm16
            vals = [v2 / 65535.0 for v2 in
                    struct.unpack_from(f'<{dim}H', raw, ptr)]
        elif fmt == 5:  # SNorm16
            vals = [v2 / 32767.0 for v2 in
                    struct.unpack_from(f'<{dim}h', raw, ptr)]
        else:  # fallback: read as float32
            try:
                vals = struct.unpack_from(f'<{dim}f', raw, ptr)
            except struct.error:
                vals = [0.0] * dim
        out[v] = vals[:dim]
    return out


# Unity ShaderChannel / VertexAttribute index → semantic name
# Unity 2019+: 0=Vertex, 1=Normal, 2=Tangent, 3=Color, 4=TexCoord0, ...
_CHANNEL_SEMANTICS = {
    0: 'position',
    1: 'normal',
    2: 'tangent',
    3: 'color',
    4: 'uv0',
}


def parse_vertex_data(mesh):
    """
    Extract positions, normals, and UV0 from Unity's packed VertexData.
    Returns (positions, normals, uv0, vertex_count) as float32 arrays or None.
    """
    vd = mesh.m_VertexData
    vc = vd.m_VertexCount
    if vc == 0:
        return None, None, None, 0

    channels = vd.m_Channels
    raw = bytes(vd.m_DataSize)  # the actual blob

    # ── 1. Compute per-stream stride ──────────────────────────────────────────
    # Unity packs channels of the same stream contiguously; the stride equals
    # the sum of (bytes-per-component × dimension) for every active channel in
    # that stream, padded to a 4-byte boundary.
    stream_strides = {}
    for ch in channels:
        if ch.dimension == 0:
            continue
        s = ch.stream
        bpc = FORMAT_SIZES.get(ch.format, 4)
        end = ch.offset + bpc * ch.dimension
        if s not in stream_strides or end > stream_strides[s]:
            stream_strides[s] = end

    # Align each stream stride to 4 bytes
    for s in stream_strides:
        r = stream_strides[s] % 4
        if r:
            stream_strides[s] += 4 - r

    # ── 2. Compute stream base offsets in the raw blob ────────────────────────
    stream_bases = {}
    offset = 0
    for s in sorted(stream_strides.keys()):
        stream_bases[s] = offset
        offset += stream_strides[s] * vc

    # ── 3. Decode requested channels ─────────────────────────────────────────
    positions = None
    normals = None
    uv0 = None

    for ci, ch in enumerate(channels):
        if ch.dimension == 0:
            continue
        semantic = _CHANNEL_SEMANTICS.get(ci)
        if semantic not in ('position', 'normal', 'uv0'):
            continue

        s = ch.stream
        stride = stream_strides.get(s, 0)
        base = stream_bases.get(s, 0)

        arr = _decode_channel(raw, base, stride, vc, ch.offset, ch.format, ch.dimension)

        if semantic == 'position':
            positions = arr[:, :3]
        elif semantic == 'normal':
            normals = arr[:, :3]
        elif semantic == 'uv0':
            uv0 = arr[:, :2]

    return positions, normals, uv0, vc


def main():
    if len(sys.argv) < 3:
        print("Usage: extract_to_glb.py <bundle_path> <output.glb>", file=sys.stderr)
        sys.exit(1)

    bundle_path = sys.argv[1]
    glb_path = sys.argv[2]

    if not os.path.isfile(bundle_path):
        print(f"ERROR: bundle not found: {bundle_path}", file=sys.stderr)
        sys.exit(1)

    import UnityPy
    from pygltflib import (GLTF2, Scene, Node, Mesh as GltfMesh, Primitive,
                           Buffer, BufferView, Accessor, Material as GltfMaterial, Asset,
                           FLOAT, UNSIGNED_SHORT, UNSIGNED_INT, TRIANGLES,
                           ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER)

    print(f"[extract_to_glb] Loading: {bundle_path}")
    env = UnityPy.load(bundle_path)

    # Collect all meshes with vertex data
    mesh_list = []
    for obj in env.objects:
        if obj.type.name == 'Mesh':
            try:
                data = obj.read()
                vd = getattr(data, 'm_VertexData', None)
                if vd and vd.m_VertexCount > 0:
                    mesh_list.append(data)
            except Exception:
                pass

    if not mesh_list:
        log_pth = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "extractor_error.log")
        with open(log_pth, "w") as f:
            f.write("ERROR: No meshes found in bundle.")
    # Filter: Strongly prefer Skinned Meshes (meshes with bones).
    # Rigid components without bones are usually static props/world drops (like trumpets).
    skinned_meshes = [
        m for m in mesh_list 
        if (getattr(m, 'm_BoneNameHashes', None) and len(m.m_BoneNameHashes) > 0) or 
           (getattr(m, 'm_BindPose', None) and len(m.m_BindPose) > 0)
    ]
    
    # Fallback to all meshes if literally no skinned meshes exist (e.g. static robot prop avatar)
    if not skinned_meshes:
        skinned_meshes = mesh_list
        print("[extract_to_glb] No skinned meshes found, falling back to all meshes.")

    # Sort by vertex count
    skinned_meshes.sort(key=lambda m: m.m_VertexData.m_VertexCount, reverse=True)
    MAX_MESHES = 12
    mesh_list = skinned_meshes[:MAX_MESHES]
    print(f"[extract_to_glb] Processing {len(mesh_list)} meshes...")

    # Build GLB
    bin_blob = bytearray()
    gltf = GLTF2(
        asset=Asset(version="2.0", generator="VRCSM-UnityPy"),
        scene=0,
        scenes=[Scene(nodes=[])],
        nodes=[], meshes=[], accessors=[], bufferViews=[], buffers=[],
        materials=[GltfMaterial(
            name="default",
            pbrMetallicRoughness={"baseColorFactor": [0.8, 0.8, 0.8, 1.0],
                                  "metallicFactor": 0.05, "roughnessFactor": 0.7}
        )],
    )

    exported = 0
    for mesh_data in mesh_list:
        try:
            name = getattr(mesh_data, 'm_Name', f'mesh_{exported}')
            positions, normals, uv0, vc = parse_vertex_data(mesh_data)
            if positions is None or vc < 3:
                continue

            # Unity LH (Y-up, Z-forward) → glTF RH (Y-up, Z-back): negate X to flip handedness
            # The standard Unity→glTF conversion is to negate X (not Z).
            positions = positions.copy()
            positions[:, 0] = -positions[:, 0]
            
            # Anti-Trumpet Check: Measure spatial bounds
            bbox_min = positions.min(axis=0)
            bbox_max = positions.max(axis=0)
            extents = bbox_max - bbox_min
            if getattr(extents, 'max', lambda: 0)() > 15.0:
                print(f"[extract_to_glb] Skipping {name}: Extents {extents} > 15m (likely unscaled prop/skybox)")
                continue

            if normals is not None:
                normals = normals.copy()
                normals[:, 0] = -normals[:, 0]

            # Read index buffer
            idx_buf = bytes(mesh_data.m_IndexBuffer)
            idx_format = getattr(mesh_data, 'm_IndexFormat', 0)
            if idx_format == 0:  # UInt16
                all_indices = list(struct.unpack(f'<{len(idx_buf)//2}H', idx_buf))
            else:  # UInt32
                all_indices = list(struct.unpack(f'<{len(idx_buf)//4}I', idx_buf))

            # Filter OOB indices
            all_indices = [i for i in all_indices if i < vc]
            if len(all_indices) < 3:
                continue

            # Reverse winding to match handedness flip (negate X reverses winding)
            tri_count = len(all_indices) // 3
            for t in range(tri_count):
                b = t * 3
                all_indices[b], all_indices[b + 2] = all_indices[b + 2], all_indices[b]

            max_idx = max(all_indices)
            if max_idx <= 65535:
                indices_np = np.array(all_indices, dtype=np.uint16)
                idx_ct = UNSIGNED_SHORT
            else:
                indices_np = np.array(all_indices, dtype=np.uint32)
                idx_ct = UNSIGNED_INT

            def append_accessor(data_np, target, type_str, component_type,
                                min_val=None, max_val=None):
                data_bytes = data_np.tobytes()
                off = len(bin_blob)
                bin_blob.extend(data_bytes)
                while len(bin_blob) % 4:
                    bin_blob.append(0)
                bv_idx = len(gltf.bufferViews)
                gltf.bufferViews.append(
                    BufferView(buffer=0, byteOffset=off,
                               byteLength=len(data_bytes), target=target))
                acc_kwargs = dict(
                    bufferView=bv_idx, byteOffset=0,
                    componentType=component_type,
                    count=len(data_np) if type_str == "SCALAR" else len(data_np),
                    type=type_str)
                if min_val is not None:
                    acc_kwargs['min'] = min_val
                    acc_kwargs['max'] = max_val
                acc_idx = len(gltf.accessors)
                gltf.accessors.append(Accessor(**acc_kwargs))
                return acc_idx

            attributes = {}

            # Positions
            pos_f32 = positions.astype(np.float32)
            pos_acc = append_accessor(
                pos_f32, ARRAY_BUFFER, "VEC3", FLOAT,
                min_val=pos_f32.min(axis=0).tolist(),
                max_val=pos_f32.max(axis=0).tolist())
            attributes["POSITION"] = pos_acc

            # Normals
            if normals is not None:
                n_acc = append_accessor(
                    normals.astype(np.float32), ARRAY_BUFFER, "VEC3", FLOAT)
                attributes["NORMAL"] = n_acc

            # UV0
            if uv0 is not None:
                # glTF UV origin is top-left, Unity is bottom-left → flip V
                uv_fixed = uv0.copy()
                uv_fixed[:, 1] = 1.0 - uv_fixed[:, 1]
                uv_acc = append_accessor(
                    uv_fixed.astype(np.float32), ARRAY_BUFFER, "VEC2", FLOAT)
                attributes["TEXCOORD_0"] = uv_acc

            # Indices
            i_acc = append_accessor(
                indices_np, ELEMENT_ARRAY_BUFFER, "SCALAR", idx_ct)

            mi = len(gltf.meshes)
            gltf.meshes.append(GltfMesh(
                name=name,
                primitives=[Primitive(
                    attributes=attributes, indices=i_acc,
                    material=0, mode=TRIANGLES)]))
            gltf.nodes.append(Node(name=name, mesh=mi))
            gltf.scenes[0].nodes.append(exported)
            exported += 1
            print(f"  + {name}: {vc} verts, {tri_count} tris")

        except Exception as ex:
            print(f"  ! Skip {getattr(mesh_data, 'm_Name', '?')}: {ex}", file=sys.stderr)

    if exported == 0:
        log_pth = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "extractor_error.log")
        with open(log_pth, "w") as f:
            f.write("ERROR: No meshes exported.")
        print("ERROR: No meshes exported.", file=sys.stderr)
        sys.exit(1)

    gltf.buffers.append(Buffer(byteLength=len(bin_blob)))
    gltf.set_binary_blob(bytes(bin_blob))
    os.makedirs(os.path.dirname(os.path.abspath(glb_path)), exist_ok=True)
    gltf.save(glb_path)
    kb = os.path.getsize(glb_path) / 1024
    print(f"[extract_to_glb] Done: {glb_path} ({kb:.0f} KB, {exported} meshes)")
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        log_path = os.path.join(os.path.dirname(sys.argv[0]), "extractor_error.log")
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
            
        # If the failure was due to LZMAError or MemoryError from a truncated download,
        # delete the corrupted .vrca file so VRCSM fetches it fresh next time.
        try:
            if len(sys.argv) >= 3 and os.path.exists(sys.argv[1]):
                os.remove(sys.argv[1])
        except Exception:
            pass
            
        sys.exit(1)
