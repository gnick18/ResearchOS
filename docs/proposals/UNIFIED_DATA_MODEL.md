# Unified Data Model, design doc

Status, DRAFT for Grant sign-off (2026-06-04). Synthesizes a six-facet deep-research pass. No code until this is approved, and the approval is gated on a prototype (section 12).

## 0. Why this exists

Building Collaborate Mode revealed a fork in the road. The naive path bolts a CRDT/live-editing world next to today's value-in/value-out + JSON-sidecar + version-control local world, leaving two histories, two metadata paths, two save paths that drift apart forever. Grant's directive (2026-06-04), do NOT build two systems. Unify editing, history, and metadata into ONE model the whole app uses, where going live is just the same local document connecting to a relay, and offline is the same document with nobody connected. End game, Google-Docs-style real-time editing (simultaneous edits, live cursors, presence) for notes, methods, experiments, AND whole project folders.

The core tension the research kept hitting, **no shipping system gets full real-time collaboration AND a fully human-readable canonical store from the same bytes.** Readable-file products (Obsidian, file-era Logseq) have no real-time collab; collab products (Automerge, Yjs, Anytype, Notion, DB-era Logseq) all keep an opaque canonical store. Logseq is the cautionary tale, it was "just markdown files," concluded files could not support real-time collab plus block properties, moved to SQLite, and demoted markdown to a lossy export. Our job is to get both without repeating that demotion.

## 1. Decision summary (TL;DR)

| Question | Recommendation | Confidence |
| --- | --- | --- |
| Substrate | **Loro, CONFIRMED for data + history + AND live text** (both prototypes passed 2026-06-04). Automerge/Yjs fallbacks no longer needed | High, prototype-proven |
| On-disk model | LOCKED to B-plus-graceful-C (Grant, 2026-06-04). CRDT sidecar is the merge/history source of truth, a readable markdown/JSON mirror is always written, an external edit is ingested as ONE snapshot-commit (clean diff where the change is cleanly followable, full-copy checkpoint + a warning where it is not), concurrent external + in-app edits keep both as a conflict copy | High, locked |
| Rich-text formatting | Marks live in the CRDT sidecar (Peritext-style), NOT as markdown control characters in the text | High |
| Document granularity | One small CRDT doc per entity, linked by id; a project folder is a container doc holding child ids + folder metadata, not child content | High |
| Folder membership | Authoritative on the child (child holds its parent id as one LWW field), never two folder lists | High |
| Structured field merge | Per-field by type, free text = Text CRDT, scalars = map LWW with conflict surfaced, tables = list + deterministic repair-on-read, monotonic = counter | High |
| Invariants | The CRDT guarantees convergence, not validity, a deterministic validate-and-repair-on-read pass is mandatory, hard invariants modeled as a single LWW scalar | High |
| Attachments | Content-addressed blob store, only a hash reference in the CRDT, conflict is LWW on the reference and the loser blob is kept as a conflict copy | High |
| Version control | Derives from the CRDT's native history, auto-snapshot/diff/restore come free, day and session grouping built on top (Patchwork precedent), compaction window is the retention knob | High |
| Migration | Additive sidecars, lazy migrate-on-open per entity type (notes first), mirror back to readable files on every save, round-trip non-lossy gate, deterministic seed builder to avoid the fork pitfall, rollback by deleting sidecars | High |
| E2E collab | secsync shape, relay stores only encrypted snapshots + update log, all VC runs client-side after decrypt | High |

## 2. Substrate, Loro primary, Automerge fallback, Yjs out

Three pillars must hold in ONE library, (a) a JSON-shaped typed nested data model for structured records, (b) native attributable time-travelable history our version control derives from directly, (c) fast live text with a CodeMirror 6 binding and cursors.

- **Yjs is disqualified as the canonical substrate** for an ELN. It is the best live-text engine and has the deepest bindings, but it garbage-collects history by default (deep history needs `gc:false`, which its own maintainer calls "pretty awful" for performance and disk), and critically it stores NO who/when on deletions, so "who removed this result" is unanswerable. For a notebook whose audit trail is a compliance feature (NIH), that is close to disqualifying. Yjs stays only as a last-resort live-text fallback with a custom snapshot layer.
- **Automerge is the proven version-control substrate.** Full history at roughly 30% overhead, exact diffs, attributable changes, and Ink and Switch's Patchwork is a working version-control product built on it. But it is slow to LOAD a non-empty document (~1.8s for a large doc) and its text-editor bindings are alpha, both bad for an editor-first app you open constantly. Strong fallback.
- **Loro is the recommended primary.** It is effectively "Automerge's data and history model with Yjs-class (or faster) text performance, in one library", JSON/typed/nested data, native git-like history (frontiers, checkout, commit messages, shallow snapshots) our VC derives from, top-tier apply/load performance, a working CodeMirror 6 binding with cursor awareness, AND a first-class Movable Tree type that models a project folder of nested items natively. MIT, transport-agnostic (reuses our Durable Object relay).

The honest counter, Loro is young (about 12k weekly downloads vs Yjs's 920k, its CM6 binding is months old with a thin contributor base). Betting an irreplaceable-research substrate on it is a real durability risk. Hence the prototype gate (section 12). If Loro fails the gates, Automerge is the fallback (accepting load-time work) before Yjs.

## 3. On-disk model, CRDT-authoritative with a reconstructable readable mirror

The two poles from the research, (B) CRDT binary is master and the readable file is a projection, true unification but the file is second-class, (C) readable file is master and the CRDT is a sidecar, best promise fidelity but external-edit reconciliation is fragile and no one has shipped it in production.

LOCKED (Grant, 2026-06-04), B as the base plus a graceful-degradation rule for external edits, instead of fighting for perfect reconciliation.
- The CRDT (a per-entity binary, stored in a hidden `.researchos/` directory, same idiom as `.git/` or `.obsidian/`) is the source of truth for merge and history.
- A human-readable markdown + JSON mirror is written into the user's folder on every save (a deterministic projection). The folder is always readable, greppable, exportable without the app. This is the promise, kept.
- External edits to the readable file (made outside ResearchOS), the file watcher detects the change and ingests it as ONE "external edit" version, NOT by reverse-engineering fine-grained operations (the fragile path the research flagged as corruption-prone under concurrency). Two cases, (a) where the change is cleanly followable (simple text edit), compute and show a normal diff for that version, (b) where it is not (the JSON was reshaped, the structure is "whack"), store a FULL COPY of the new content as that version's snapshot and warn the user that this version was edited outside ResearchOS so a clean diff across it is not available. Either way the version-control tree stays walkable, the external-edit version is a snapshot boundary, history before and after it is granular and time-travelable, and the boundary is just a coarse step instead of a clean diff. This is the deliberate, knowable limitation we accept rather than risk silent corruption. Storage cost is a bounded full copy per external-edit event (rare, compressible), not per keystroke.
- Concurrent external edit AND in-app or collaborator edit to the same content, do not force a merge, keep both as a conflict copy (the same model as attachment conflicts) and warn, let the user reconcile.
- If a sidecar is missing or stale, rebuild it from the readable file (graceful degradation to a fresh seed).

Hard constraint from Peritext, do NOT store bold/italic/links as markdown control characters inside the text CRDT, concurrent edits corrupt them. Formatting marks live in the sidecar keyed to character ids, the markdown body is the plain-text layer. Structured typed JSON fields round-trip cleanly (maps), only free-text fields carry the formatting-in-sidecar rule.

## 4. Document granularity, linked small docs

One small CRDT document per entity (each note, method, experiment). The project folder is a container document, a CRDT holding child entity ids + folder metadata (name, ordering, membership), NOT the children's content. Sync the set together, load child docs lazily on open. This is the Automerge-repo / Yjs-subdocument pattern and it is the only model that gives partial loading, partial sharing (share one experiment vs the whole project), and bounded live-collab memory. One-giant-folder-doc loses on all three and hits the >60k-edit in-memory-sync wall.

Cross-document atomicity is the cost. "Move experiment X from folder A to B" touches multiple docs that merge independently. Model membership as authoritative on the CHILD (the child holds its parent folder id as a single LWW field), so a move is one LWW write and can never double-list or vanish.

## 5. Per-field merge semantics + the invariant caveat

The CRDT picks a deterministic winner but does not understand the domain. Choose the shape per field.

- Free text (note body, method narrative) = Text CRDT, character-level merge.
- Independent scalars (concentration, status, title, date) = map key, LWW. Prefer Loro/Automerge's conflict surfacing (keep the loser, let the UI offer it) over Yjs's silent drop, a clobbered numeric value is a data-integrity event in a lab.
- Ordered/tabular (plate wells, gradient rows, PCR steps) = list/array. Structural merge is predictable but the domain invariant is NOT preserved.
- Monotonic tallies = counter type, only where additive semantics are correct.
- Cursors, selection, field-focus presence = a separate ephemeral awareness channel, never in the synced doc.

The load-bearing caveat, a CRDT guarantees convergence, not validity. Concurrent edits can produce an invalid plate layout (two samples in well A1) or a non-monotonic gradient. Mitigation, a deterministic validate-and-repair-on-read pass every replica computes identically (re-sort gradient rows, dedupe wells by the same deterministic winner the CRDT uses, clamp/flag out-of-range). Where the science cannot tolerate even a transient invalid state, model that structure as a single LWW scalar (one writer wins the whole structure), trading collaborative granularity for safety. Notably tldraw, a sophisticated collaborative structured-data product, chose server-authoritative per-field LWW over a full CRDT for structured records, the per-character machinery is reserved for actual prose. Per-field LWW + presence + conflict surfacing is a proven-enough model for our structured records.

## 6. Attachments, content-addressed

Binaries never live in CRDT history (it is append-only, they would bloat it forever, and the Vercel 4.5MB function cap means blobs route around the sync server anyway). Store each blob in a content-addressed store keyed by its SHA-256, keep only `{ name, hash, mime, size }` in the CRDT. Concurrent replacement of the same attachment, each upload has a different hash so blobs never collide, the conflict is LWW on the hash reference, and because content-addressed blobs are immutable the loser is never destroyed, surface it as a conflict copy (`image.png` and `image (Mira's copy).png`) for free. Dedup and GC run independently of CRDT history. (tldraw uses exactly this, R2 asset store + reference-by-id.)

## 7. Version control, derived from native history

Our paused VC requirements map onto the substrate's native history.
- Auto snapshot, free, every editor commit is a CRDT change with time + actor + optional message, debounced to idle so commits align with meaningful edits.
- Diff vs previous, free, exact char-level patches between two heads.
- Restore, fork at the target version and re-apply its content as a NEW attributed change on the live doc (restore is itself a mergeable history entry, not a destructive rewind).
- Attribution, map CRDT actor ids to ResearchOS identities in a sidecar index (the same identity directory the sharing feature already has), persisted before any compaction so it survives.
- Group by day, trivial client bucket on change time.
- Group by editing session, build it (cluster consecutive same-actor changes within a time gap), the one genuinely custom piece, Patchwork-proven.

Compaction is the retention knob, keep granular incrementals for a recent window (full diffs), compact older history to a snapshot when fine-grained diffs age out, accepting that below the compaction boundary you keep state but lose per-change granularity. The retention window is a deliberate decision. Compliance note, CRDTs retain history, hard-deleting specific content (a GDPR/PII purge) is awkward and needs a deliberate mechanism.

## 8. E2E collaboration, the relay stays blind

Adopt the secsync shape, the server (our Vercel + Durable Object relay) stores only an encrypted snapshot plus a log of encrypted updates, authenticating unencrypted metadata (doc id, public keys, clocks) without ever reading content. After the client decrypts, it rebuilds the full CRDT and therefore the full native history, so ALL version-control features run client-side and work identically online or offline. This keeps the locked E2E-blind (4a) posture from the collaborate proposal and reuses the existing X25519/Ed25519 keys. A bonus convergence, signed CRDT changes give conflict-merge AND verified-sender provenance from one mechanism, which dovetails with the verified-sender provenance already shipped on imported experiments/methods.

## 9. Migration, additive and non-destructive

- Additive `.researchos/<id>` CRDT sidecars written NEXT TO the existing markdown/JSON, never replacing them.
- Lazy migrate-on-open, flag-gated, per entity type, notes first (matches the existing pilot cadence), then methods, then experiments. Listings read legacy files regardless of per-entity state so nothing breaks mid-rollout.
- Mirror the current CRDT state back out to the readable files on every save, so an older app build or a full rollback always finds correct files. Deleting the sidecars returns the app to pure legacy mode with zero loss.
- Round-trip non-lossy gate, migrate an entity only if the CRDT rebuilds the original byte-for-byte (normalized), otherwise stay legacy and log.
- THE fork pitfall, if two users independently import the same pre-existing file, their CRDTs fork instead of merging unless the import seed is byte-identical. Build a deterministic seed function (`legacyBytes -> seedBytes`, fixed actor id, fixed timestamps, canonical ordering), anchor each doc by its existing stable entity id, unit-test byte-equality across runs. This is the single most important build-time detail and it is confirmed for all candidate libraries.
- Schema evolution, embedded schema-version integer + hard-coded deterministic migration changes, keep additive, defer Cambria lenses (experimental).

## 10. Architecture shape, one store, swappable backends

Steal tldraw's shape. ONE in-memory reactive document model is the single source of truth. Behind it sit swappable backends, (a) a folder-materializer that writes the readable mirror, (b) the CRDT-sidecar persistence, (c) the Durable Object relay for live collab. Local edits and remote edits are the SAME kind of change applied to the SAME model, never a fork. This is the unanimous pattern across Yjs, Automerge, Loro, tldraw, and Linear.

## 11. MVP vs frontier (clear-eyed)

MVP-able with low risk, co-editing a single note's prose with cursors (the solved text path), structured records (experiment/method scalar fields) with per-field LWW + presence + conflict surfacing, attachments via content-addressed reference, a linked-doc folder where membership and ordering merge and children load lazily, version control derived from native history.

Frontier, defer, invariant-safe concurrent editing of complex structures (live two-person plate-layout where the merge must never produce an invalid artifact, carry the repair layer or serialize edits), and whole-project-folder live collaboration as a single scope with many simultaneous editors and cross-folder moves (cross-document atomicity is the unsolved-by-the-library part).

## 12. The prototype (the gate before any real build)

A throwaway prototype on Loro that proves the risky bits at once, because the two scariest pieces (on-disk reconciliation and Loro's maturity) are both unproven and no one has shipped this exact shape.

It must answer, in order of risk,
1. On-disk model + the external-edit policy, build the CRDT-sidecar + readable-mirror model for a note, then prove the locked B-plus-graceful-C rule. An external markdown edit (sequential, file changed while the app was closed) ingests as one snapshot-commit, with a clean diff where the change is followable and a full-copy + warning where it is not, and the version tree stays walkable on both sides of that boundary. A concurrent external edit + in-app edit to the same content produces a conflict copy + warning, not a silent corrupt merge. Formatting (bold/italic) survives a markdown round-trip under concurrency (proves marks-in-sidecar). Rebuild-from-readable-file works when the sidecar is missing. The goal is to confirm the accepted-limitation behavior is clean, not to chase perfect reconciliation.
2. Loro history weight + VC, measure on-disk size and load time with full history and with a shallow snapshot on a representative notebook, and confirm diff/restore/attribution read correctly. Confirm Loro's history delivers the VC features as cleanly as Automerge's (the one thing the VC facet did not directly verify for Loro).
3. Loro bindings, stress loro-codemirror with concurrent editors, large docs, undo/redo, offline-then-merge, and cursor awareness over the existing Durable Object relay.
4. One structured record in one doc, build a real experiment mixing typed fields (map/counter), a folder (Movable Tree), and rich-text notes (Text), confirm attributable history reads across those types in one timeline.
5. The fork-pitfall seed, two clients independently seed from the same legacy file and confirm they converge (deterministic seed) rather than duplicating.
6. React 19 + WASM init cost on first load in Chrome/Edge against our UX budget.

If Loro clears these, it is the substrate and we scope the real phased build (notes pilot first, mirroring the migration plan). If it fails on history weight or bindings, fall back to Automerge (accepting load-time work). Yjs only if both fall over.

## 12.1 Prototype results (2026-06-04), Loro CONFIRMED

Both prototypes passed, so section 12 is closed and Loro is the substrate.
- Data-model prototype (`spikes/unified-model-loro/`, node-only, 75/75 checks): the B + graceful-C external-edit policy works end to end, version-control-from-native-history is cheap (5000 commits compress to a 22KB snapshot that loads in 1.45ms, vs Automerge's ~1.8s large-doc load), the deterministic seed prevents the fork pitfall, and a structured record (Map + Counter + Movable Tree + Text in one doc) merges per-field with cross-type attribution.
- Live-binding prototype (`spikes/unified-model-loro-binding/`): loro-codemirror 0.3.3 binds CodeMirror 6 cleanly (no peer-dep friction), concurrent + offline-then-merge-out-of-order converge, and cursor awareness uses Loro stable Cursors that track position natively (a notch ahead of Yjs's raw-offset awareness). WASM init is ~30ms (a non-issue); the only load note is the ~700KB brotli first-load, serve it brotli-compressed with `compileStreaming` and warm it during onboarding.

Two follow-ups to fold into the phased build, NOT blockers: (1) mount `LoroExtensions` inside ONE real React 19 component behind a flag (the Notes pilot is the natural host) to prove the binding under React 19 concurrent rendering, the spikes proved it in isolation only; (2) the brotli-stream + warm-on-onboarding WASM load strategy. The maturity caveat stands, loro-codemirror is young (single maintainer, the awareness API already churned once from `LoroAwarenessPlugin` to `LoroEphemeralPlugin`), so pin versions and watch the project. This is a governance risk, not a capability risk.

## 12.2 WASM load strategy + version pins

### Load mechanism

loro-crdt 1.12.3 ships four distribution targets. The one bundlers consume automatically is `bundler/` (set as `"module": "bundler/index.js"` in the package exports). That target does a static WASM import:

```js
import * as rawWasm from "./loro_wasm_bg.wasm";
```

This is a bundler-native static WASM import, not a `fetch()` call and not a base64-embedded blob. The `loro_wasm_bg.wasm` file is 3.07 MB raw; the spike measured approximately 700 KB after brotli compression. The bundler resolves the import at build time and emits the WASM as a separate asset alongside the JS chunk that references it.

Next.js with Turbopack handles this natively. Turbopack supports static `.wasm` imports without any `asyncWebAssembly: true` webpack experimental flag, so no `next.config.ts` changes are needed. The existing CSP already includes `'wasm-unsafe-eval'` (added for `@react-pdf/renderer`'s yoga-layout dependency), so Loro WASM compiles and instantiates without any security-policy change either.

The `base64/index.js` target (WASM inlined as a base64 string, inflating the bundle to approximately 3 MB) is intentionally NOT used in the app. The spike used it only for a self-contained `file://` demo build where a separate `.wasm` fetch would be blocked. The `web/` target (fetch-based async init) is also out; it requires explicit `initWasm(url)` calls and a manually served `.wasm` file, which the `bundler/` target handles more cleanly.

### Serving and compression

Next.js serves all static assets (JS chunks and any co-located `.wasm` asset the bundler emits) with brotli compression automatically when deployed on Vercel or any server that processes `Accept-Encoding: br`. No manual brotli setup is needed. The WASM asset lands in the browser cache after the first visit, so only the cold first-load pays the approximately 700 KB transfer cost.

The browser's `WebAssembly.compileStreaming` path fires automatically when the WASM asset is served with the correct `application/wasm` content-type. Next.js sets this content-type for `.wasm` assets in its static serving pipeline, so streaming compilation (which overlaps network download with WASM compilation, reducing total latency) is the default behavior.

### Warm-on-onboarding call

The first note open triggers the Loro editor. Without pre-warming, that moment pays the approximately 30ms WASM compile cost in the foreground. The correct warm point is the `setup-wrapup` step, which renders after the user has confirmed their folder connection and feature picks but before they click into the in-product walkthrough. The WASM is useless before folder connect (no documents to open), so firing it earlier wastes memory for users who exit the tour.

Insert a fire-and-forget warm call in `SetupWrapupStep.tsx` (`frontend/src/components/onboarding/v4/steps/setup/SetupWrapupStep.tsx`), inside a `useEffect` that runs once on mount:

```ts
useEffect(() => {
  // Pre-warm the Loro WASM module so the first note open
  // does not pay a foreground compile cost.
  void import("loro-crdt");
}, []);
```

The dynamic import resolves the module (triggering WASM compile and instantiate in the background) without blocking the render. If the user clicks "Give me a tour" before the compile finishes, the first note open will still pay whatever compile time remains, but that window is typically a few hundred milliseconds of tour narration. The warm call is a best-effort optimization, not a gate. It covers both the happy path (user takes the tour) and the skip path (user clicks "Skip for now, take me to home"), because both happen after folder connect and both route to the product where a note open is plausible within seconds.

### Version pins

Pin both packages to exact versions when the Notes pilot adds them to `frontend/package.json`:

- `loro-crdt@1.12.3` -- the version the spike validated. Do not use a caret range; loro-crdt moves fast and the WASM ABI is not stable across minor versions.
- `loro-codemirror@0.3.3` -- the version the spike validated. The awareness API already churned once between `LoroAwarenessPlugin` (older builds) and `LoroEphemeralPlugin` (0.3.x). Watch the loro-codemirror CHANGELOG before any upgrade; a second rename would be silent at runtime and only caught by TypeScript.

The spike's `spikes/unified-model-loro-binding/package.json` carries the verified pins as a reference.

### What does NOT need to change

- `frontend/next.config.ts` -- no webpack or Turbopack WASM config changes needed. Turbopack handles static `.wasm` imports natively.
- The CSP in `next.config.ts` -- `'wasm-unsafe-eval'` is already in `script-src`.
- `frontend/public/` -- no manual `.wasm` copy needed. The bundler emits the asset from the static import in the `bundler/` target.
- The Vercel deployment config -- brotli serving is automatic on Vercel for all static assets.

## 12.3 Phased build roadmap

Collab is not a parallel system bolted onto local editing. Per section 10, ONE store has three swappable backends, (a) the readable mirror, (b) the CRDT sidecar, (c) the Durable Object relay. Going live is the same local document connecting backend (c). So the relay is the LAST backend plugged in, not the first thing built. The phases reflect that.

- Phase 0, substrate validation. DONE. Both Loro spikes passed, the React 19 mount is proven (the flag-gated `LoroNoteEditor` on main), and the WASM strategy is planned (section 12.2). Identity, the directory, the store-and-forward sharing relay, and `encryption.ts` already shipped, so the crypto and identity layer collab needs is in place.
- Phase 1, unified local store (notes pilot, single-user, NO relay). Build the store plus backends (a) and (b) for notes behind `LORO_PILOT_ENABLED`. This is the load-bearing foundation. Detailed scope in `UNIFIED_MODEL_PHASE1_NOTES.md`. Needs sign-off on its persisted-data-shape decisions before code.
- Phase 2, version control from native Loro history (notes). Auto-snapshot, diff-vs-previous, restore-as-a-new-change, day and session grouping, the attribution sidecar. Replaces the paused VC Phase 1 engine; derives from Loro history instead of a bespoke delta store.
- Phase 3, live collab MVP (the relay backend, two-person live note). The one new infra, a Cloudflare Worker plus Durable Object. The DO authenticates a signed Ed25519 socket, fans encrypted Loro updates, relays encrypted awareness for cursors. Per-doc key wrapped to the collaborator via the existing `sealToRecipient`. E2E-blind (locked 4a). Retire-to-local through the existing `note-transfer.ts`. The `collab-yjs` spike already proved the fan-out mechanic; swap the Yjs client for Loro.
- Phase 4, collab hardening. Blind snapshot plus compaction for late-join and reconnect catch-up, N-person sessions, methods (same text core), relay-the-final-snapshot for an offline-at-retire collaborator, and the live file-watcher for external edits while the app is open.
- Phase 5, structured records plus folders. Experiment and method scalar fields (map LWW plus counter) with validate-and-repair-on-read, content-addressed attachments with conflict copies, the project folder as a container doc (Movable Tree) with lazy child loading. Whole-folder live collab stays frontier, deferred (cross-document atomicity is the unsolved-by-the-library part).

Two gates before the build starts, (1) Grant signs off on the phasing and the Phase 1 data-shape decisions, (2) Cloudflare Worker plus DO provisioning, which is a Phase 3 prerequisite and can proceed in parallel since Phases 1 and 2 need no new infra.

## 13. Open decisions for Grant

1. Approve the overall direction, one CRDT-backed model, CRDT-authoritative-with-readable-mirror on disk, linked-per-entity docs.
2. Substrate lean, prototype Loro first as recommended, or prototype Loro and Automerge head-to-head from the start.
3. Greenlight the prototype (it needs no infra, local wrangler-dev relay like the collab spike).
4. Retention window for granular history before compaction (can be decided after the prototype measures real growth).

## 14. Grounding

Six facet research reports (2026-06-04), prior-art survey, Yjs vs Automerge vs Loro, on-disk readability, version-control-from-CRDT, structured-records/folders/attachments, migration. Key external grounding, Ink and Switch local-first essay + Peritext + Patchwork + Cambria, Automerge storage + 2.0 + modeling-data + merge-rules + conflicts docs, Loro repo + versioning deep dive + loro-codemirror, Yjs INTERNALS + subdocuments + snapshots, secsync, tldraw collaboration system, the Logseq DB-version migration. Full citations live in the six task reports.
