// Avatar image embedding via a locally-run CLIP ViT-B/32 model
// (@huggingface/transformers under the hood, which in turn drives
// onnxruntime-web with WASM / WebGPU backends and caches the model in
// IndexedDB after the first download).
//
// The pipeline is LAZY — the ~150 MB model is only fetched the first
// time the experimental feature actually runs. Toggling the flag in
// Settings costs nothing.
//
// MVP: WASM backend only (CPU). WebGPU can be enabled later by passing
// `device: 'webgpu'` to the pipeline constructor; on a mid-range GPU
// it's ~10x faster but requires a fallback path when unavailable.

import type { ImageFeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/clip-vit-base-patch32";
export const MODEL_VERSION = "clip-vit-b32-transformers-v1";

// 512-dimension output matches the server-side schema
// (avatar_embeddings_vec uses float[512]). If we swap to a different
// model in future, bump MODEL_VERSION and the user_version migration
// should re-embed.
export const EMBEDDING_DIM = 512;

let _pipelinePromise: Promise<ImageFeatureExtractionPipeline> | null = null;
let _pipelineLoadError: Error | null = null;

/**
 * Kick off model initialization. Safe to call multiple times — returns
 * the same promise on concurrent invocations. Resolves when the pipeline
 * is ready to embed.
 */
export async function ensureEmbeddingPipeline(opts?: {
  onProgress?: (pct: number, stage: string) => void;
}): Promise<ImageFeatureExtractionPipeline> {
  if (_pipelineLoadError) {
    throw _pipelineLoadError;
  }
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      try {
        // Dynamic import so transformers.js (which pulls in the ONNX
        // runtime and protobuf helpers — ~300 KB gzipped) isn't in the
        // main bundle. Only loaded when the user opts into the feature.
        const transformers = await import("@huggingface/transformers");
        const { pipeline, env } = transformers;
        // Local-only: never hit the Hub for anything other than the
        // initial model download. We still need remote fetch for that
        // first load, but disable telemetry / dataset prefetch.
        env.allowLocalModels = true;
        env.useBrowserCache = true;
        opts?.onProgress?.(5, "loading transformers.js");
        const p = (await pipeline("image-feature-extraction", MODEL_ID, {
          // WASM (CPU) for MVP. `device: "webgpu"` is a v0.12 bet.
          progress_callback: (info: unknown) => {
            if (opts?.onProgress && info && typeof info === "object") {
              const i = info as { status?: string; progress?: number; file?: string };
              if (i.status === "progress" && typeof i.progress === "number") {
                const pct = Math.max(5, Math.min(95, 5 + i.progress * 0.9));
                opts.onProgress(pct, i.file ?? "downloading model");
              }
            }
          },
        })) as ImageFeatureExtractionPipeline;
        opts?.onProgress?.(100, "ready");
        return p;
      } catch (err) {
        _pipelineLoadError = err instanceof Error ? err : new Error(String(err));
        _pipelinePromise = null; // allow retry
        throw _pipelineLoadError;
      }
    })();
  }
  return _pipelinePromise;
}

/**
 * Embed an image (URL or Blob) into a 512-dim float vector. The returned
 * Float32Array is ready to post as `Array.from(...)` over IPC.
 *
 * This is the canonical function both "Find Similar" (single query image)
 * and background indexing (bulk cache scan) call. Keep it synchronous
 * in shape — callers that want batching can Promise.all() themselves.
 */
export async function embedImage(source: string | Blob): Promise<Float32Array> {
  const pipe = await ensureEmbeddingPipeline();
  // Transformers.js accepts URL string OR Blob. For a Blob we wrap it in
  // an object URL temporarily — the pipeline releases its reference once
  // feature extraction completes.
  const input =
    typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    // `pooling: "mean"` + `normalize: true` produces a unit-length
    // 512-vec that's directly comparable by cosine distance (which is
    // what sqlite-vec's default distance on unit vectors reduces to).
    // pooling/normalize are valid transformers.js options but the
    // published .d.ts for image-feature-extraction doesn't list them yet;
    // cast to any so we can pass them through.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await pipe(input, {
      pooling: "mean",
      normalize: true,
    } as any);
    // transformers.js returns a `Tensor` with a typed array under `.data`.
    const data = output.data as Float32Array;
    if (data.length !== EMBEDDING_DIM) {
      throw new Error(
        `embedding dim mismatch: got ${data.length}, expected ${EMBEDDING_DIM}`,
      );
    }
    // Copy so later GC of the tensor can't invalidate the caller's view.
    return new Float32Array(data);
  } finally {
    if (typeof source !== "string") {
      URL.revokeObjectURL(input);
    }
  }
}

/** True once the pipeline has successfully initialized. */
export function isEmbeddingPipelineReady(): boolean {
  return _pipelinePromise !== null && _pipelineLoadError === null;
}

/** Expose the most recent init error for Settings-page surfacing. */
export function getEmbeddingPipelineError(): Error | null {
  return _pipelineLoadError;
}
