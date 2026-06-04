# Loro CodeMirror live-binding spike

Throwaway scratch. This run retires the last open risk on the unified-data-model
substrate decision (UNIFIED_DATA_MODEL.md section 12, gates 3 and 6), is
loro-codemirror (Loro's CodeMirror 6 binding) mature enough to be our live-editing
layer. The Loro DATA MODEL already passed in spikes/unified-model-loro/. This run
is only about the live binding plus cursors plus WASM cost.

Nothing here is wired into the app. Do not import from frontend/.

## What it proves

1. Integration and API maturity. A real CodeMirror 6 EditorView wired to a Loro
   Text via loro-codemirror's all-in-one LoroExtensions and via the granular
   plugins, typechecked against the published types (src/binding.ts).
2. Convergence (the load-bearing proof). Two LoroDocs exchange updates through an
   in-memory relay that is the same dumb byte-pipe a Durable Object would be,
   including a concurrent-edit case and an offline-then-merge case flushed out of
   order (test/convergence.mjs).
3. Awareness and cursors. loro-codemirror relays cursors as Loro stable Cursors
   in an EphemeralStore, and the receiver decodes them to live offsets that track
   text shifts without drift (test/awareness.mjs).
4. A buildable static browser demo. Two CodeMirror editors on one page share a
   doc through an in-page relay, built to dist/ with esbuild, openable from
   file:// with no server (src/demo.ts, dist/).
5. WASM init cost. loro-crdt bundle size plus cold import and instantiate timing
   (test/wasm-cost.mjs).

## Watchdog-safety

Every check is a discrete command that runs and EXITS. There is no dev server, no
wrangler dev, no websocket server, no watch mode anywhere in this spike. A prior
unified-model spike was killed by the watchdog for running a blocking live server,
so this one is headless first and the browser demo is a pre-built static file.

## Run steps

Install once.

```
cd spikes/unified-model-loro-binding
npm install
```

Then run any of the discrete, exiting checks.

```
npm run convergence   # headless convergence proof, prints PASS/FAIL
npm run awareness     # headless cursor/awareness proof, prints PASS/FAIL
npm run wasm          # WASM size + cold-init timing
npm run typecheck     # tsc --noEmit against loro-codemirror published types
npm run all           # convergence + awareness + wasm in one shot
npm run build:demo    # builds the static two-editor demo into dist/
```

## Opening the browser demo (no server)

After `npm run build:demo`, open dist/index.html directly in Chrome or Edge
(File, Open File, or drag the file into the window). Two editors appear. Type in
either and the text plus the remote caret show up live in the other. The WASM is
inlined as base64 so file:// works with nothing running.

The demo runs both editors in ONE page over an in-page relay. The full
two-browser-tab test over a REAL relay is a MANUAL step for the orchestrator or
Grant, reuse spikes/collab-yjs/ wrangler Durable Object and swap the Yjs client
for the Loro wiring in src/demo.ts. It is intentionally not run here because a
live relay server is exactly the blocking process the watchdog rule forbids.

## Layout

```
src/binding.ts        typecheck-only, real EditorView wiring (never executed)
src/demo.ts           the two-editor static demo source
src/index.html        demo HTML shell
build-demo.mjs        one-shot esbuild build into dist/ (exits)
test/convergence.mjs  headless convergence proof
test/awareness.mjs    headless cursor/awareness proof
test/wasm-cost.mjs     WASM size + init timing
dist/                 built static demo (gitignored, rebuild with build:demo)
```
