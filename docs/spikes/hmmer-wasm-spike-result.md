# Spike result: in-browser HMMER (hmmscan) via WebAssembly

Author: sequence editor master (feasibility spike), 2026-06-05. Status: COMPLETE.
Throwaway spike, nothing merges. Gate question only: is on-device WASM hmmscan
feasible, and how fast.

Verdict in one line: YELLOW. The on-device WASM path is genuinely viable and the
right architecture, but NO prebuilt HMMER WASM module exists today, so it needs a
build. The search itself is fast enough to be a non-issue. The EBI fallback is
confirmed browser-direct (seamless), so we are de-risked either way.

## 1. Does a usable in-browser HMMER exist TODAY?

No. Nothing ready to load. Every channel came back empty:

- biowasm catalog: 41 tools (samtools, bcftools, minimap2, muscle, mafft, kalign,
  seqtk, fastp, ...). NO hmmer, hmmscan, hmmsearch, or hmmbuild. Verified against
  the live `tools/` directory of github.com/biowasm/biowasm and the aioli package
  (@biowasm/aioli is on npm at 3.2.1, but its tool set is the biowasm catalog, so
  same gap).
- npm: searching "hmmer" returns only EBI web-service clients and viewers
  (sequence-analyses, domain-gfx, skylign, taxonomy-visualisation). None is a WASM
  HMMER engine.
- GitHub repo search: `hmmer wasm` -> 0 repos. `hmmer webassembly` -> 0 repos.
- Pyodide: pyhmmer is NOT in the Pyodide package list (34 packages; no hmmer/bio
  match). No published pyhmmer emscripten wheel. pyhmmer's own issue tracker has 0
  issues mentioning wasm / pyodide / emscripten. So the "Pyodide could carry
  pyhmmer" idea is unproven and would itself require building an emscripten wheel
  of a Cython+C extension, i.e. the same C-to-WASM work plus a Pyodide layer.

So the proposal's note ("a ready-made HMMER WASM module was NOT confirmed") is now
a confirmed NO, across biowasm, npm, GitHub, and Pyodide.

### Why none exists (build-effort read)

HMMER3's hot loops (the MSV/SSV prefilter and Viterbi) are hand-written SIMD in
architecture-specific source dirs selected at `./configure` time: `src/impl_sse`,
`src/impl_neon`, `src/impl_vmx` (plus `fm_sse.c`). There is no `impl_wasm` and no
portable scalar fallback wired into the dispatch. A WASM port therefore is not a
plain `emcc make`; someone has to either add a WASM-SIMD backend (port impl_sse to
WASM 128-bit SIMD intrinsics, which map fairly directly from SSE2) or accept a slow
scalar path. This is the concrete reason biowasm never shipped it, even though it
ships comparable plain-C tools.

emcc is NOT installed in this environment (`which emcc` -> none), so a build was
correctly out of scope for this timebox. Effort estimate for Phase 1: building
HMMER to WASM with a WASM-SIMD MSV backend is a multi-day, specialist task (port
one SIMD file, wire Emscripten + a virtual FS like aioli's, validate against the
native oracle). Not multi-hour, not multi-week. The Easel/HMMER build is autoconf
+ make, which Emscripten handles; the SIMD backend is the only real work.

## 2. Measured numbers (native HMMER 3.3.2 as the perf + size proxy)

WASM does not run hmmscan in Node yet (there is no module to load), so I measured
the native engine that is already installed (HMMER 3.3.2, the exact reference the
WASM build would be compiled from) to ground the perf and size envelope.

Setup: real test protein = human CDK2 (UniProt P24941, 298 aa, a Ser/Thr protein
kinase). Reference library = 4 real Pfam HMMs fetched from the InterPro API
(PF00069 Pkinase, PF00071, PF00076, PF00096), then `hmmpress`-ed to the binary
form hmmscan actually loads.

- Correctness: hmmscan returns the textbook-correct hit. CDK2 -> Pkinase
  (PF00069.32), full-sequence E-value 2.5e-81, bit score 260.9, aligned over
  residues 4-286 (the entire kinase fold). Exactly the expected domain. Gate
  question 1 (does it return the right domain): PASS.
- Wall-clock per protein: median 0.010 s for the 4-HMM library, 0.006 s for a
  48-HMM library, single CPU. Both are dominated by process spawn (~6-10 ms); the
  actual HMM search of a ~300 aa protein is sub-millisecond. Search time barely
  grows with library size at this scale because the SIMD MSV prefilter rejects
  non-hits almost for free. Native scan of one protein against the "tens of MB"
  subset will be tens of milliseconds, not seconds.
- Memory: max RSS 5.96 MB for the whole hmmscan process on the 4-HMM run. The HMM
  data plus working heap is small; a few-hundred-HMM subset stays comfortably
  inside a browser tab budget.
- Per-HMM data size: the pressed binary (.h3m/.h3f/.h3p/.h3i) averaged ~70 KB per
  HMM in this sample (Pkinase is a large family, so this is an over-estimate for
  the average domain). Extrapolation: a 30 MB pressed budget holds roughly 440 of
  these large HMMs (more for smaller families), which is a meaningful curated
  common-molbio set. Full Pfam-A (~21,000 HMMs) extrapolates to ~1.4 GB pressed at
  this per-HMM rate, consistent with the proposal's "multi-GB, browser-default-too-
  big" claim and confirming the curated-subset decision.
- SIMD caveat (the one real perf risk for WASM): the native binary uses HMMER's
  SSE2 backend (x86_64 build, the SIMD MSV/Viterbi path). The numbers above are WITH
  SIMD. A WASM build MUST use WASM SIMD (128-bit) to keep these numbers; a scalar
  fallback would slow the MSV/Viterbi inner loop by a large factor (commonly cited
  as several-x to an order of magnitude for these kernels). For a one-protein,
  one-click, small-subset use case this might still land in the "few seconds with a
  progress bar" tolerance even scalar, but the safe Phase 1 target is a WASM-SIMD
  build. WASM SIMD is supported in all current Chrome/Edge (the project's only
  supported browsers), so there is no compatibility blocker to relying on it.

WASM module size: not measurable without a build. For reference, comparable biowasm
C tools land in the low single-digit MB range for the .wasm, which the proposal's
cache-once download model absorbs fine.

## 3. EBI InterProScan CORS: browser-direct or proxy?

Browser-direct, SEAMLESS. Confirmed live against
`https://www.ebi.ac.uk/Tools/services/rest/iprscan5`:

- GET `/parameters` with an Origin header returns:
  `access-control-allow-origin: *`,
  `access-control-allow-methods: POST, GET, DELETE, PUT`.
- OPTIONS preflight for `POST /run` returns the same `access-control-allow-origin:
  *` and the allowed methods, so the browser-side preflight for the submit call
  succeeds.

This is the Zenodo case, not the Figshare case. A browser can submit a job, poll,
fetch results, and auto-add features with NO server proxy. The opt-in EBI handoff
in the proposal (decision 3) is therefore worth keeping: it can be truly seamless,
full-Pfam coverage, off-device only when the user opts in. The "drop the handoff if
CORS blocks" branch does NOT trigger.

## 4. Recommendation: YELLOW (viable, needs a build; perf is not the risk)

On-device WASM hmmscan is the correct, on-brand architecture and there is no
fundamental blocker. But it is YELLOW, not GREEN, because the engine does not exist
yet and must be built. The breakdown:

- Correctness: proven. The reference engine gives the exact right domain on a real
  protein.
- Speed: a non-issue. One protein against a curated subset is milliseconds native;
  even a SIMD WASM build will be well inside the "few seconds" target, and the
  search cost barely scales with subset size at this range.
- Memory: a non-issue at subset scale (single-digit MB).
- The real cost is the BUILD: HMMER has no WASM backend and no scalar fallback in
  its SIMD dispatch, so Phase 1 must port one SIMD file (impl_sse -> WASM SIMD) and
  wrap it with Emscripten + a virtual FS (aioli is the template). Multi-day
  specialist work, not a turnkey npm install.
- De-risking the build: the EBI InterProScan handoff is confirmed browser-direct
  and seamless, so even if the WASM build slips or underperforms on low-end
  machines, there is a clean, privacy-disclosed, full-coverage fallback already
  proven to work from the browser. The arc does not stall on the build.

Suggested gate decision: proceed to Phase 1 on the WASM path, but scope Phase 1's
first chunk as "build + validate the HMMER WASM-SIMD module against the native
oracle on CDK2/PF00069" as its own sub-gate before the feature UI is wired. If that
chunk produces a working module at the measured speeds, it flips to GREEN; if the
SIMD port proves harder than estimated, ship the seamless EBI handoff first (it is
ready now) and keep the WASM build as a fast-follow. Either way the user-facing
feature is deliverable.

## Sources (all verified live during the spike)

- biowasm catalog (live tools dir): https://github.com/biowasm/biowasm , aioli:
  https://github.com/biowasm/aioli (npm @biowasm/aioli 3.2.1)
- pyhmmer: https://github.com/althonos/pyhmmer (no wasm/pyodide issue, no
  emscripten wheel)
- Pyodide package list: https://github.com/pyodide/pyodide (no pyhmmer)
- HMMER 3.3.2 native (BSD-3), used as oracle + perf proxy: http://hmmer.org/ ,
  source SIMD layout: https://github.com/EddyRivasLab/hmmer (src/impl_sse,
  impl_neon, impl_vmx; no impl_wasm)
- Test protein CDK2: https://rest.uniprot.org/uniprotkb/P24941.fasta
- Pfam HMMs via InterPro API:
  https://www.ebi.ac.uk/interpro/api/entry/pfam/PF00069/?annotation=hmm
- EBI InterProScan REST + CORS:
  https://www.ebi.ac.uk/Tools/services/rest/iprscan5 (access-control-allow-origin: *
  on GET and OPTIONS-preflight, confirmed via curl -sI)
