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
node run-search.mjs PF00069.hmm cdk2.fasta          # default: Pkinase, ~7e-82 (FIXED 2026-06-05)
node run-search.mjs PF00069.hmm cdk2.fasta --max     # CORRECT: Pkinase, ~7e-82
```

## Status (verified)

GREEN. The prefilter bug is FIXED (2026-06-05); default mode now matches native.

- The module COMPILES, LOADS, and RUNS in Node (the browser MEMFS pattern), fast
  (~27 ms module-load + search), exit 0.
- THE MAIN ALIGNMENT DP IS CORRECT. With `--max` (prefilters off) it reproduces
  native HMMER exactly: Pkinase / PF00069, score 260.9 bits, E ~ 7e-82, domain
  over residues 4..286, full alignment. Matches the native oracle.
- THE MSV / SSV PREFILTER IS NOW CORRECT TOO. Default mode (prefilter on) finds
  the same Pkinase hit as `--max` and native, and correctly REJECTS an unrelated
  protein (lysozyme) just like native. The prefilter discriminates again, it does
  not just let everything through.

## The bug (and the fix)

The hypothesis going in was a mistranslated SSE2 saturating SIMD intrinsic
(`_mm_adds_epu8` / `_mm_subs_epu8` / `_mm_max_epu8` / the byte shifts / the
horizontal max). That hypothesis was WRONG. Every one of those intrinsics was
verified to translate correctly under Emscripten (standalone lane-by-lane tests
all passed).

The real root cause is a SCALAR float-to-uint8 conversion in
`biased_byteify()` (`src/impl_sse/p7_oprofile.c`), which builds the MSV/SSV byte
match-score tables (`om->rbv` / `om->sbv`):

```c
sc = -1.0f * roundf(om->scale_b * sc);            /* cost; NEGATIVE for a good match */
b  = (sc > 255 - om->bias_b) ? 255 : (uint8_t) sc + om->bias_b;
```

For a good match `sc` is a small negative float (e.g. -17.0). The original code
relies on x86's MODULAR float->int conversion: `(uint8_t)(-17.0) -> 239`, so
`239 + bias(17) = 256 -> 0`, the correct small biased cost. But WebAssembly's
float->unsigned conversion (`i32.trunc_sat_f32_u`, which clang emits) SATURATES
negative floats to 0 instead of wrapping. So `(uint8_t)(-17.0) -> 0`, and
`0 + 17 = 17`: every good match collapsed to exactly `bias_b`. The minimum match
cost across the whole profile was stuck at `bias_b` (17), there were no
good-match cells at all, so the MSV/SSV prefilter rejected every sequence and
default-mode searches found nothing. `--max` was unaffected because the full DP
uses the separate FLOAT score path, never the byte tables.

THE FIX (`prefilter-simd-fix.patch`): under `__wasm__` / `__EMSCRIPTEN__`, do the
rounding + bias in signed integer space and mask to a byte, which reproduces the
intended modular wrap on every target:

```c
int cost = (int) sc + (int) om->bias_b;           /* may be negative for a good match */
b = (cost > 255) ? 255 : (uint8_t) (cost & 0xff);
```

It is guarded by `#if defined(__EMSCRIPTEN__) || defined(__wasm__)`, so the
native x86 build is byte-for-byte unchanged (and the wasm result is identical to
what native produces). This is a one-function, ~3-line behavioral fix.

## What this means

- SHIP PATH: default mode (prefilter ON) now works, so the on-device engine runs
  the normal fast HMMER pipeline. The earlier `--max`-only workaround is no longer
  required for correctness, and full-Pfam-scale (~20k HMMs) on-device is fast
  again because the MSV/SSV prefilter rejects non-matches instead of running full
  DP on every model.

## Validation (default mode, after the fix)

```
$ node run-search.mjs PF00069.hmm cdk2.fasta
    E-value  score  bias    E-value  score  bias    exp  N  Sequence
    6.3e-82  260.9   0.0    7.1e-82  260.8   0.0    1.0  1  sp|P24941|CDK2_HUMAN
   1 !  260.8   0.0   7.1e-82   7.1e-82   1   262 []   4   286 ..   4   286 .. 0.91
Passed MSV filter:  1  (1); expected 0.0 (0.02)        <- was 0 before the fix
[harness] exit=0 wall=30.7ms

# matches the native oracle exactly:
$ hmmsearch PF00069.hmm cdk2.fasta
    6.3e-82  260.9   0.0    7.1e-82  260.8   0.0    1.0  1  sp|P24941|CDK2_HUMAN
Passed MSV filter:  1  (1)

# and an unrelated protein (lysozyme) is correctly rejected by both:
#   wasm default:  [No hits detected]  Passed MSV filter: 0
#   native:        [No hits detected]  Passed MSV filter: 0
```

## Build recipe (reproducible)

Built on macOS (Apple Silicon) with Emscripten 6.0.0.

1. Install emsdk: `git clone https://github.com/emscripten-core/emsdk && cd emsdk
   && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh`.
2. Clone HMMER (3.x) + Easel submodule (EddyRivasLab/hmmer, EddyRivasLab/easel).
3. Configure for WASM SIMD via the SSE backend:
   `emconfigure ./configure --enable-sse --host=i686-pc-linux-gnu --disable-threads`
4. APPLY THE PREFILTER FIX: `git apply prefilter-simd-fix.patch` from the HMMER
   source root (patches `src/impl_sse/p7_oprofile.c`). Without it, default-mode
   searches return no hits on WASM (see "The bug" above).
5. Compile with SSE2 -> WASM-SIMD translation flags:
   `-O2 -msse2 -mssse3 -msse4.1 -msimd128`
6. Link the `hmmsearch` program to a runnable module (the produced `hmmsearch.js`
   exposes `FS` + `callMain`, `noInitialRun`, growable memory):
   `emcc -O2 -msse2 -mssse3 -msse4.1 -msimd128 -o hmmsearch.js hmmsearch.o
   -lhmmer -leasel -ldivsufsort -lm -sMODULARIZE=1 -sEXPORT_NAME=createHmmer
   -sEXPORTED_RUNTIME_METHODS=callMain,FS -sINVOKE_RUN=0 -sALLOW_MEMORY_GROWTH=1
   -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1`

## Provenance

HMMER (BSD-3) and Easel are by the Eddy/Rivas lab. This build is HMMER source
compiled to WASM with one small, WASM-guarded correctness patch to
`biased_byteify()` (see `prefilter-simd-fix.patch`); the native x86 code path is
untouched. The build configuration is ours. Carry HMMER's attribution into the
app's open-source credits when this ships.
