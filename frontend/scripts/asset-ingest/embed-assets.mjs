// Precompute sentence embeddings for the open-asset library, for the figure
// composer's lazy "Smart search" layer (Option A in
// docs/proposals/2026-06-15-icon-semantic-search.md).
//
// Owned by the Figure Composer lane (model/dim choices, vector format); RUN +
// R2-synced by the INJEST / ingest lane (R2 write is theirs). Standalone Node
// tooling, no app imports. One-shot batch, CPU only.
//
// Usage:
//   pnpm add @xenova/transformers   # one-time, in the ingest toolchain
//   node embed-assets.mjs --manifest <path-or-url> --out <dir>
//
//   # examples
//   node embed-assets.mjs --manifest https://assets.research-os.com/manifest.json --out ./out
//   node embed-assets.mjs --manifest ./out/bundle/manifest.json --out ./out/bundle
//
// Writes, into <out>:
//   embeddings-v1.bin       Float16 matrix, row-major [count x 384], L2-normalized.
//                           ROW ORDER IS IDENTICAL TO manifest.json (assumed same
//                           array order). The client maps row i -> manifest[i].
//   embeddings-v1.meta.json { model, dims, count, dtype:"f16", normalized:true,
//                             text:"title category tags", builtFrom:"<manifest>" }
//
// R2 sync discipline (INJEST): `rclone copy` ONLY (never sync), exclude welcome/**,
// place next to manifest.json. Bump the -v1 suffix on ANY model/dim change so the
// client cache-busts. Regenerate whenever the corpus changes so rows never drift.

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const MODEL = "Xenova/all-MiniLM-L6-v2"; // 384-d, ~23MB int8 in-browser, strong for short text
const DIMS = 384;
const VERSION = "v1";
const BATCH = 64;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** The text we embed per asset. MUST match the client's query intent: a short
 *  natural description. Title carries the most signal, then category, then tags. */
function assetText(a) {
  return [a.title, a.category ?? "", (a.tags ?? []).join(" ")]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** IEEE-754 float32 -> float16 (half) bit pattern, returned as a uint16. Round
 *  to nearest, with subnormal + overflow handling. Lets us halve the on-wire
 *  matrix (~22MB f32 -> ~11MB f16) for the lazy client download. */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(value) {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | (mant ? 0x7e00 : 0x7c00); // NaN / Inf
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00; // overflow -> Inf
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow -> 0
    mant |= 0x800000;
    const shift = 14 - exp;
    let half = mant >> shift;
    if ((mant >> (shift - 1)) & 1) half += 1; // round to nearest
    return sign | half;
  }
  let half = (exp << 10) | (mant >> 13);
  if (mant & 0x1000) half += 1; // round to nearest
  return sign | half;
}

async function loadManifest(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`manifest fetch ${res.status} for ${src}`);
    return res.json();
  }
  return JSON.parse(readFileSync(src, "utf8"));
}

async function main() {
  const manifestSrc = arg("manifest", "https://assets.research-os.com/manifest.json");
  const outDir = arg("out", "./out");
  mkdirSync(outDir, { recursive: true });

  console.log(`[embed] manifest: ${manifestSrc}`);
  const assets = await loadManifest(manifestSrc);
  if (!Array.isArray(assets)) throw new Error("manifest is not an array");
  const count = assets.length;
  console.log(`[embed] ${count} assets, model ${MODEL} (${DIMS}-d), batch ${BATCH}`);

  // Lazy import so the dep is only needed when actually embedding.
  // The repo migrated the client to @huggingface/transformers v3 (same MiniLM model
  // + onnxruntime backend); keep this build script on the same backend so the
  // precomputed vectors match what the browser produces for live queries.
  const { pipeline, env } = await import("@huggingface/transformers");
  // Pull the model from OUR R2 (assets.research-os.com/Xenova/...), exactly the
  // host the browser client uses, instead of huggingface.co (whose downloads time
  // out here). R2 already serves the quantized model + config + tokenizer with CORS.
  // Mirrors the client's env wiring in asset-embed-search.ts.
  const MODEL_HOST = process.env.ASSET_MODEL_HOST || "https://assets.research-os.com";
  env.allowLocalModels = false;
  env.remoteHost = MODEL_HOST.replace(/\/$/, "") + "/";
  env.remotePathTemplate = "{model}/";
  // dtype:"q8" -> onnx/model_quantized.onnx, the same weights the client loads, so
  // corpus + query vectors come from the SAME model (v3's CPU default fp32 would
  // both mismatch the client and require the absent model.onnx).
  const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });

  // f16 matrix, row-major count x DIMS.
  const half = new Uint16Array(count * DIMS);
  let done = 0;
  for (let start = 0; start < count; start += BATCH) {
    const slice = assets.slice(start, start + BATCH);
    const texts = slice.map(assetText);
    // mean pooling + L2 normalize -> unit vectors, so client scoring is a dot product.
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const data = output.data; // Float32Array, length slice.length * DIMS
    for (let r = 0; r < slice.length; r++) {
      const base = (start + r) * DIMS;
      const src = r * DIMS;
      for (let d = 0; d < DIMS; d++) half[base + d] = toHalf(data[src + d]);
    }
    done += slice.length;
    if (done % (BATCH * 10) === 0 || done === count) {
      console.log(`[embed] ${done}/${count} (${Math.round((done / count) * 100)}%)`);
    }
  }

  const binPath = join(outDir, `embeddings-${VERSION}.bin`);
  // Uint16Array buffer is little-endian on all supported platforms; the client
  // decodes with a DataView using littleEndian=true to be explicit.
  writeFileSync(binPath, Buffer.from(half.buffer, half.byteOffset, half.byteLength));

  const meta = {
    model: MODEL,
    dims: DIMS,
    count,
    dtype: "f16",
    normalized: true,
    text: "title category tags",
    version: VERSION,
    builtFrom: manifestSrc,
  };
  const metaPath = join(outDir, `embeddings-${VERSION}.meta.json`);
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  const mb = (half.byteLength / 1e6).toFixed(1);
  console.log(`[embed] wrote ${binPath} (${mb} MB) + ${metaPath}`);
  console.log(`[embed] DONE. Sync both next to manifest.json (rclone copy, exclude welcome/**).`);
}

main().catch((e) => {
  console.error("[embed] FAILED:", e);
  process.exit(1);
});
