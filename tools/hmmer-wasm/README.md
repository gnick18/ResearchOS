# HMMER compiled to WebAssembly (on-device protein search)

This is the validated build output from the on-device-HMMER effort (2026-06-05).
It runs `hmmsearch` (one or more profile HMMs vs a protein) entirely in the
browser / Node, no server. Preserved here so the ~70-minute build is not lost;
the eventual feature will serve `hmmsearch.wasm` + `hmmsearch.js` as a static
asset from `frontend/public/`.

## Files

- `hmmsearch.wasm` (388 KB) + `hmmsearch.js` (81 KB) - the Emscripten module.
- `run-search.mjs` - Node harness showing the exact browser pattern (load the
  module, write the `.hmm` + query into MEMFS, `callMain`, capture stdout).
- `PF00069.hmm` (Pfam Protein kinase domain) + `cdk2.fasta` (human CDK2) - the
  validation pair.

## Run it

```
node run-search.mjs PF00069.hmm cdk2.fasta          # default: NO hits (see below)
node run-search.mjs PF00069.hmm cdk2.fasta --max     # CORRECT: Pkinase, ~7e-82
```

## Status (verified, the important part)

GREEN to ship a curated-subset on-device annotator NOW, with one caveat.

- The module COMPILES, LOADS, and RUNS in Node (the browser MEMFS pattern), fast
  (~24 ms module-load + search), exit 0.
- The MAIN ALIGNMENT DP IS CORRECT. With `--max` (prefilters off) it reproduces
  native HMMER exactly: Pkinase / PF00069, score 260.9 bits, E ~ 7e-82, domain
  over residues 4..286, full alignment. Matches the native oracle.
- THE BUG IS ISOLATED TO THE MSV / SSV PREFILTER. In default mode the prefilter
  rejects everything ("No hits"). The prefilter (`src/impl_sse/msvfilter.c`,
  `ssvfilter.c`) uses SSE2 saturating UNSIGNED 8-bit arithmetic (`_mm_adds_epu8`,
  `_mm_subs_epu8`, `_mm_max_epu8`); Emscripten's SSE2 -> WASM-SIMD translation of
  those saturating ops is producing wrong scores, so nothing passes the filter.

## What this means

- SHIP PATH (now): run with `--max` (skip the prefilter, full DP on every model).
  For a curated subset (hundreds of HMMs) this is correct and fast enough for an
  interactive one-protein annotation. No SIMD debugging needed to ship v1.
- OPTIMIZATION (fast-follow): fix the MSV/SSV unsigned-saturating SIMD so the
  prefilter works, which is what makes full-Pfam-scale (~20k HMMs) on-device fast.
  Without it, `--max` on full Pfam is minutes, not seconds.

## Build recipe (reproducible)

Built on macOS (Apple Silicon) with Emscripten 6.0.0.

1. Install emsdk: `git clone https://github.com/emscripten-core/emsdk && cd emsdk
   && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh`.
2. Clone HMMER (3.x) + Easel submodule (EddyRivasLab/hmmer, EddyRivasLab/easel).
3. Configure for WASM SIMD via the SSE backend:
   `emconfigure ./configure --enable-sse --host=i686-pc-linux-gnu --disable-threads`
4. Compile with SSE2 -> WASM-SIMD translation flags:
   `-O2 -msse2 -mssse3 -msse4.1 -msimd128`
5. Link the `hmmsearch` program to a runnable module (the produced `hmmsearch.js`
   exposes `FS` + `callMain`, `noInitialRun`, growable memory).

## Provenance

HMMER (BSD-3) and Easel are by the Eddy/Rivas lab. This build is unmodified HMMER
source compiled to WASM; only the build configuration is ours. Carry HMMER's
attribution into the app's open-source credits when this ships.
