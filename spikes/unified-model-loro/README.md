# unified-model-loro spike

Throwaway prototype proving the make-or-break parts of the unified data model
(docs/proposals/UNIFIED_DATA_MODEL.md) on Loro (loro-crdt, MIT). Every check is a
discrete node script that runs and exits. No servers, no wrangler, no websockets,
no browser, no React.

This spike covers the data-model and history gates only (section 12 gates 1, 2, 4,
5). The live-binding gate (loro-codemirror over the Durable Object relay, gate 3)
and the React 19 + WASM first-load gate (gate 6) are deferred to a separate spike,
they are explicitly out of scope here.

## Run

```
npm install        # installs loro-crdt only, once
npm run gate1      # on-disk model + external-edit policy (highest priority)
npm run gate2      # native history + version control + size/load numbers
npm run gate5      # fork pitfall + deterministic seed
npm run gate4      # one structured record in one doc
npm run all        # all four, in order
```

Each harness asserts objective outcomes and prints a PASS/FAIL banner with a check
count. A failing gate sets a non-zero exit code.

## What each gate proves

Gate 1 (gate1-ondisk.mjs, lib/note-store.mjs)
  The locked B-plus-graceful-C on-disk model. A Loro doc is the merge/history source
  of truth, persisted as a binary sidecar (.researchos/<id>.loro) plus a readable
  markdown mirror written on every save. Proves the external-edit policy (ingest as
  one snapshot-commit, clean diff where followable, full-copy plus warning where
  whack, version tree walkable on both sides of the boundary), the concurrent
  external-plus-in-app conflict-copy rule, Peritext marks (formatting in the CRDT,
  not as markdown control characters) converging under concurrent formatting, and
  rebuild-from-mirror when the sidecar is missing.

Gate 2 (gate2-history-vc.mjs)
  Loro's native history delivers the version-control features (commit per change with
  time plus peer plus message, exact frontier diff, non-destructive revertTo restore,
  peer-to-identity attribution). Measures encoded size and load time for a note with
  several thousand small commits, full history vs a shallow snapshot.

Gate 5 (gate5-fork-seed.mjs, lib/seed.mjs)
  The fork pitfall. A deterministic seed (fixed peer, fixed timestamp, canonical
  ordering) makes two independent clients converge from the same legacy file with no
  duplication. A non-deterministic seed (different peer ids) forks and duplicates,
  proving the seed function is the fix.

Gate 4 (gate4-structured-record.mjs)
  One experiment as a single Loro doc mixing typed scalars (Map plus Counter), a
  nested folder (Movable Tree), and rich-text notes (Text). Different-field edits
  merge cleanly, same-scalar edits resolve to a deterministic winner with the loser
  still inspectable in history, and attributable history reads correctly across the
  mixed types in one timeline.

## Notes

- loro-crdt version pinned by npm at install time (tested on 1.12.3, Node 24).
- node_modules, package-lock, and the scratch probe file are gitignored.
- The scratch data folder Gate 1 uses is created under the OS temp dir and removed
  at the end of the run.
