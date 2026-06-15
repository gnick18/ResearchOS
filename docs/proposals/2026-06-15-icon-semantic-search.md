# Icon semantic search — hybrid (C baseline shipped, A embedding layer spec)

**Date:** 2026-06-15
**Lane:** Figure Composer
**Memory:** `[[project_bioart_icon_library]]`
**Builds on:** the open-asset library (14.5k icons on `assets.research-os.com`), the grouped picker (`FigureLeftRail` IconsPanel).

## Decision (recommended, Grant to confirm scope)

Hybrid search, best UX for the user:
- **C — always-on baseline (BUILT, `figure-semantic-search` a993e7d55):** pure trigram-fuzzy + curated science-synonym ranker (`asset-search.ts`). Zero download, instant, offline, free. Catches typos + synonyms + most near-misses. Ranks every keystroke.
- **A — lazy "Smart search" layer (THIS SPEC, not built):** true sentence embeddings for the deep-semantic long tail (paraphrases, hard typos, concepts with no shared tokens). Loads only when invoked, so nobody pays for it unless they want it.

We deliberately skip **B (thin embedding endpoint)**: a recurring per-query cost + a server dependency that breaks the client-only/offline story, for the same quality A gives with neither.

## A — architecture (client-side, lazy, free)

Two precomputed artifacts on R2 (owned by the INJEST / ingest lane), one client engine (this lane).

### 1. Offline asset-vector precompute (INJEST lane, ingest pipeline)
- At ingest, embed each asset's text (`title + " " + category + " " + tags.join(" ")`) with a small sentence-transformer (recommend **all-MiniLM-L6-v2**, 384-d) via `@xenova/transformers` in Node (no GPU needed for a one-shot batch of ~15k).
- Write a compact sidecar to R2 next to `manifest.json`:
  - `embeddings-v1.bin` — Float16 matrix, row order **identical to manifest order**, `count × 384`. ~15k × 384 × 2 B ≈ **11 MB**.
  - `embeddings-v1.meta.json` — `{ model, dims, count, dtype: "f16", normalized: true }`. Vectors L2-normalized at write time so query-time scoring is a plain dot product.
- Ride the same R2 `rclone copy` (NOT sync) discipline; never touch `welcome/`.
- Regenerate whenever the corpus changes; bump the `-v1` suffix on a model/dim change so the client can cache-bust.

### 2. Client engine (Figure Composer lane)
- New module `asset-embed-search.ts`, lazy: on first "Smart search" use, dynamically `import("@xenova/transformers")` + fetch `embeddings-v1.bin` (cached `force-cache`) and decode into a `Float32Array` matrix.
- Query: embed the query string in-browser (MiniLM, ~50 ms after warm), L2-normalize, dot-product vs the matrix, top-K.
- **Blend with C**, do not replace it: `final = max(keywordScore, 0.92 * semanticScore)` (or interleave), so a literal match still wins and semantics only *adds* recall. Keep C as the instant pre-filter; run A only when C's top result is weak or the user toggles "Smart".
- Gate behind `NEXT_PUBLIC_ASSET_SMART_SEARCH` (off) until the sidecar is live + Grant okays the ~34 MB lazy footprint (23 MB model + 11 MB vectors, first-use only, cached).

### Cost / weight summary
- First "Smart search" use: ~34 MB lazy download (model + vectors), then instant + offline + free + private forever.
- Normal use never triggers it (C handles the common case with zero download).

## Open questions for Grant
1. OK on the ~34 MB lazy footprint for the opt-in smart layer? (Alternative: a smaller/quantized model ~6–10 MB, slightly lower quality.)
2. Smart search as an explicit toggle, or auto-fire when C's best score is below a threshold?
3. Does INJEST have headroom to add the embedding step to the ingest pipeline now, or stage it after the current corpus work?

## Status
C shipped on `figure-semantic-search` (gate-green: tsc 0, 134 figure tests, verified vs the live 14,559 manifest). A is unbuilt; gated on the INJEST sidecar + Grant's footprint OK.
