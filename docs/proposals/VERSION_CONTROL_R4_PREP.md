# Version Control R4 Prep: diff library + compaction algorithm

**Author:** VCP R4-prep design
**Date:** 2026-05-26
**Status:** Pre-implementation, doc only. Sibling to `VERSION_CONTROL_PROPOSAL.md`. Locks the open follow-ups flagged at the bottom of OQ section (diff library pick, compaction-with-deltas algorithm). No code, no `package.json` change. The install lands when R4 ships.

---

## 0. Why this doc

The main proposal locked OQ10 (text-diff deltas) and OQ3 (500 rows total, 100 recent verbatim) but flagged two follow-ups for R4 kickoff:

1. Pick the diff library, version-lock it, plan the install.
2. Design the compaction-with-deltas algorithm. The earlier §3d covered compaction in the full-snapshot world; deltas change the data being folded.

Both decisions need to land BEFORE the R4 implementation chip fires so the role brief can pin the library version and the test surface knows what to cover.

---

## 1. Diff library pick

### 1a. Decision

**Library:** `diff` (a.k.a. jsdiff) on npm.
**Version:** `9.0.0` (released 2026-04-13, current latest stable).
**License:** BSD-3-Clause (compatible with our existing license posture).
**Install posture for R4:** add `"diff": "9.0.0"` to `frontend/package.json` `dependencies` (exact pin, no caret). No `@types/diff` install (see §1d).

### 1b. Why jsdiff

The candidate set, with the trade-off we land on:

| Library | Output format | Reverse-patch primitive | Disk-readable | Verdict |
|---|---|---|---|---|
| **jsdiff** (`diff` on npm) | Unified diff (RFC 6902-style text patch) | YES (`reversePatch` / `applyPatch` with reversed direction) | YES, the patch text is human-readable | CHOSEN |
| `fast-diff` | Array of `[op, text]` tuples (Myers algo, same as Quill) | NO native reverse, would need to write our own | NO, opaque tuples | rejected: no reverse, opaque rows |
| `diff-match-patch` (Google) | Patch objects, custom string format | YES via patch_make + apply | partial, custom format | rejected: heavier, the patch format is non-standard |
| Custom delta (write our own) | n/a | n/a | n/a | rejected: invents NIH risk, no upside |

jsdiff wins on three axes that matter for OQ10 + §3l + the wiki forensic story:

1. **Unified-diff is text-canonical.** A history row's `delta` field is a human-readable patch. If a user opens `_history/notes/47.jsonl` in a text editor (or a regulator audits the file), they can read the change without running the app. fast-diff and diff-match-patch both produce opaque structures.
2. **Reverse-patch is a built-in.** §3l's revert algorithm walks backward from HEAD applying reverse deltas. jsdiff ships `reversePatch` (added in v5.x, stable in v9). fast-diff has no reverse primitive.
3. **Industry standard.** Unified diff is what `git diff`, `patch`, GitHub PR diffs, every IDE diff view all speak. If we ever export a record's history to a regulator, the format is self-explanatory.

### 1c. Bundle size + tree shaking

The unpacked install is ~616 KB (npm `dist.unpackedSize`). The bulk of that is line/word/sentence/CSS/JSON dialect modules and source maps. We only import three functions:

```ts
import { createTwoFilesPatch, applyPatch, reversePatch } from "diff";
```

jsdiff publishes a dual ESM + CJS build with proper `exports` map and per-module source files under `lib/`. Next.js 16's Turbopack + the ESM `module` entry tree-shake the unused dialects (Css, Json, Sentences, Lines, etc.). Expected production bundle hit: ~30 KB minified for the three text-patch helpers (rough order; verify via `next build` size report when the R4 install lands).

`sideEffects` is not explicitly set in the package; Next 16 + Turbopack treat the ESM entry as side-effect-free for pure functions, so the unused dialects DO drop. We document this in the R4 chip's deliverables: include the bundle-size check in the R4 PR description, surface a regression if the import balloons past ~50 KB.

### 1d. TypeScript types

jsdiff v9 ships **built-in TypeScript types** (`types: 'libcjs/index.d.ts'`, plus `libesm/index.d.ts` for the ESM build). No `@types/diff` package is needed.

The `@types/diff` package on DefinitelyTyped is now a stub (v8.0.0, "Stub TypeScript definitions entry for diff, which provides its own types definitions"). We MUST NOT install `@types/diff`: it would be dead weight and risks shadowing the upstream types.

R4 chip task: lint rule or comment in `frontend/src/lib/history/diff.ts` documenting "do not add @types/diff, types are upstream."

### 1e. ESM / CJS interop with Next 16 + React 19

jsdiff v9's `exports` field:

```jsonc
{
  ".": {
    "import": { "types": "./libesm/index.d.ts", "default": "./libesm/index.js" },
    "require": { "types": "./libcjs/index.d.ts", "default": "./libcjs/index.js" }
  }
}
```

This is the modern dual-build pattern. Next.js 16 + Turbopack auto-pick the ESM build for client / server components and the CJS build for any legacy `require` path. No `transpilePackages` entry needed.

`engines.node: ">=0.3.1"`. No engine constraint conflict with our Node runtime.

### 1f. Version-lock posture

We pin EXACTLY `"diff": "9.0.0"` (no caret, no tilde). Reasoning:

- The history file format is on-disk, persistent across upgrades. If jsdiff ever ships a breaking change in `createTwoFilesPatch` output (e.g. trailing newline rules, hunk-header format), existing `_history/<type>/<id>.jsonl` rows could fail `applyPatch` on read.
- The patch format is stable in practice (v5 through v9 produce compatible unified diffs), but our delta-on-disk contract means we own the upgrade window. Exact-pin lets us lock the wire format until we explicitly test a bump.
- Upgrade path: a future "upgrade jsdiff" chip will re-emit known-good patches through the new version and round-trip-verify against the old version. Until that chip ships, we stay on 9.0.0.

### 1g. Install plan for R4

When the R4 implementation chip fires:

1. `cd frontend && npm install --save-exact diff@9.0.0`
2. Confirm `frontend/package.json` line reads `"diff": "9.0.0"` (no `^`, no `~`).
3. Confirm `frontend/package-lock.json` resolves to a single `diff` version (no peer-dep multi-resolve).
4. Smoke-test the import in `frontend/src/lib/history/diff.ts`:
   ```ts
   import { createTwoFilesPatch, applyPatch, reversePatch } from "diff";
   ```
5. Run `npm run build` and inspect the route-by-route size delta. Flag if any route grew by more than 50 KB.

---

## 2. Compaction-with-deltas algorithm

The main proposal's §3d describes compaction in the original "old/new value pair per row" world. OQ10 flipped that to text-diff deltas. This section re-designs §3d for the delta-row format and reconciles with §3l (revert backward-walk) and §3m (24h undo-revert).

### 2a. Compaction trigger

**Choice: on-write check, fires on every Save.**

The Save handler that appends a history row also runs an O(1) line-count check on the file AFTER the append. If the count exceeds 500, compaction runs synchronously before the Save handler returns.

Alternatives considered:

| Trigger | Pros | Cons | Verdict |
|---|---|---|---|
| **On-write check (chosen)** | File NEVER exceeds 501 rows. Predictable. No background coordination. | Adds latency to the Save that crosses the boundary (one extra read + one extra write). | CHOSEN |
| Daily background timer | Save latency unaffected. | File can drift up to 501 + 1 day of edits. Background timer needs coordination with the user's app session, awkward in a local-first single-folder app. | rejected |
| User-triggered ("Compact now" button) | Zero hidden cost. | Users never click it. The file grows forever. | rejected |
| Threshold + async queue | Lower p99 latency on the boundary-crossing save. | New async surface to manage; failure modes (queue lost, partial compaction) are bad. | rejected for v1 |

The boundary-crossing save (the 501st) pays a one-time cost: read the 501-row file, fold, write the 101-row file. For a 5000-word markdown body's worth of deltas this is ~5-10 MB read + a smaller write, well under 100 ms on a local SSD. Boundary-crossing happens once per ~500 saves on a busy record, so the amortized cost is negligible.

### 2b. Compaction procedure

**Inputs:**

- The per-record history file `_history/<type>/<id>.jsonl` with N > 500 rows.
- The live record on disk (HEAD state, post the row that just landed).

**Anchor identification:**

- Row 0 is either the genesis row (`kind: "genesis"`) OR a previously-written boundary snapshot (`kind: "boundary_snapshot"`). The compaction reader detects which by inspecting `kind`.
- If genesis: the anchor state is reconstructed from the genesis row's `post_hash` plus the live record (we have a hash, not a value, so we forward-walk from a known empty state OR use the first non-genesis row's `old` half of the delta as the anchor; see §2c for the corner case).
- If a previous boundary snapshot: the anchor state IS `state` on that row, byte-for-byte. No reconstruction needed.

**Compaction window:**

- Define the window as rows `[0, N-100)`. The window includes the anchor at row 0 and every row up through row N-101.
- Rows `[N-100, N-1]` form the "recent verbatim" window, untouched by compaction.

**Forward walk:**

1. Initialize `state = anchor_state`.
2. For each row in `[1, N-100)` (skip the anchor at row 0): `state = applyPatch(state, row.delta)`. If `applyPatch` returns `false` (corrupt delta), abort compaction with a clear error; the file is left untouched; we surface the corruption to the user via a "history corrupted at row X" warning in the History tab (same shape as the §3l corruption path).
3. After the loop, `state` is the canonical document state at row N-100's timestamp.

**Write the boundary snapshot:**

```ts
interface BoundarySnapshotRow {
  id: string;                  // new UUID
  ts: string;                  // = original row (N-100)'s ts, preserved
  v: 1;
  actor: "compaction";         // sentinel actor
  owner: string;               // owner at the time, copied from the row's owner
  kind: "boundary_snapshot";
  state: unknown;              // full document JSON at row N-100
  state_hash: string;          // sha256 of canonical(state), for round-trip verify
  compacted_row_count: number; // how many rows were folded into this snapshot
  compacted_range: { from_id: string; to_id: string; from_ts: string; to_ts: string };
}
```

The `kind: "boundary_snapshot"` row is distinct from the `kind: "compacted"` marker the original §3d described. The original marker was an annotation row appended ALONGSIDE the surviving rows; the new boundary snapshot REPLACES the entire compaction window with a single row.

**File rewrite:**

1. Compose the new file contents: `[boundary_snapshot_row, ...rows_from_N-100_to_N-1]`. That's 1 + 100 = 101 rows.
2. Write to `_history/<type>/<id>.jsonl.tmp` (full overwrite, not append).
3. fsync the tmp file.
4. Atomic rename `_history/<type>/<id>.jsonl.tmp` -> `_history/<type>/<id>.jsonl`.

Atomic write is critical: concurrent readers (a second tab or the lab-head's view) must never see a partial file. The rename is atomic on macOS / Linux; on Windows we'd need MoveFileEx with REPLACE_EXISTING (the file-service abstraction already handles this; see `frontend/src/lib/file/file-service.ts` for the existing tmp-then-move pattern used by `_pi_audit.json`).

### 2c. Genesis-anchored compaction corner case

The first time compaction runs on a record, the anchor is `kind: "genesis"`. The genesis row has no `state` field (it carries only `post_hash`). To forward-walk we need the state AT the genesis point.

Two options:

- **Reconstruct from the first delta's "old" side.** jsdiff's `createTwoFilesPatch` output contains the pre-image as the `-` lines; in theory we can reverse-engineer the state. Fragile and parser-dependent. REJECTED.
- **Lazy snapshot on first read (chosen).** When the History reader first opens a record whose genesis row lacks a `state` field, it captures the live record's state, walks BACKWARD by reverse-applying every delta from HEAD to genesis, and writes the resulting state into the genesis row as `genesis_state`. This is a one-time backfill per record, idempotent (the `genesis_state` field is the cache; presence means done).

The backfill happens on first compaction trigger (= record reaches 500 rows), not eagerly. By the time a record needs compaction, the genesis snapshot can be reconstructed by the same backward-walk the revert algorithm already uses.

Risk: if any delta in the walk is corrupt, the backfill aborts and compaction fails. The file stays at 500+ rows, the History tab still works (it doesn't depend on compaction). The user sees no immediate degradation; we log a warning to the console. Recovery: manual jsonl repair, or accept that this record's history is forever unbounded (still readable, just larger).

### 2d. Revert through compacted region (interaction with §3l)

§3l's revert walker reads rows backward from HEAD applying reverse deltas until it reaches the target row. The boundary snapshot row changes how the walker terminates.

Three cases:

**Case A: revert target is INSIDE the recent verbatim window (rows N-100 through N-1).**

The walker reverse-applies deltas from HEAD to the target row. Boundary snapshot is never touched. Identical to the pre-compaction algorithm. No special handling.

**Case B: revert target IS the boundary snapshot row itself.**

The walker reverse-applies deltas from HEAD through the recent verbatim window. When it reaches the boundary row, it does NOT reverse-apply a delta (the row has `state`, not `delta`). It reads `state` directly. That value IS the canonical "state at the boundary's timestamp." Walk stops. The revert writes that state as a new history row with the appropriate `delta` (computed as `createTwoFilesPatch(HEAD, boundary.state)`).

**Case C: revert target is BEFORE the boundary snapshot (inside the compacted window).**

The intermediate rows are gone. The walker reaches the boundary row and cannot proceed further. Resolution:

- The History tab's revert button SHOULD NOT be rendered on rows older than the boundary, because those rows no longer exist in the file. The tab UI naturally hides them; the user simply doesn't see the affordance.
- If a stale UI somehow asks to revert to a pre-boundary row (e.g. the user kept the tab open from before compaction, then a save triggered compaction, then they clicked revert): the revert handler detects the missing row and surfaces "This version was folded into a snapshot during compaction. The closest reachable point is [boundary timestamp]. Revert to that instead?" Click-through performs Case B.

Document the lossiness explicitly in the wiki copy: edits older than the recent 100 are reachable only at the boundary granularity, not row-by-row. This is the trade-off OQ3 locked.

### 2e. Boundary snapshot storage cost

A 5000-word markdown body in canonical JSON is ~30 KB. Across 8 entity types and one boundary snapshot per record per ~500 edits:

- A heavily edited record (50 edits/day, 250 working days/year) hits compaction once per ~10 days, so ~36 boundary snapshots per year.
- But, see §2f: there is only EVER one boundary snapshot in the file at any time. The 36-per-year number is the count of compaction EVENTS, not stored snapshots.
- Steady state: 1 boundary snapshot row (~30 KB at most) + 100 recent delta rows (small) per active record. Even at 1000 active records per user, that is ~30 MB of boundary snapshots, modest.

The growing cost is recent verbatim rows + occasional small boundary rewrites. Trade-off is acceptable. If a record's body grows past 50 KB (very long methods, image-heavy notes that we now sidecar-attach), the boundary snapshot grows in proportion; see §3 for the budget warning.

### 2f. Multiple compaction events: still ONE boundary snapshot at a time

This is the key invariant: after K compactions, the file has 1 boundary snapshot + 100 recent rows = 101 rows total. NOT K snapshots.

The second compaction (file hits 501 again after 400 more saves past the first boundary):

1. Anchor = the existing boundary snapshot row at the file's head. Anchor state = `boundary.state`, byte-for-byte (no reconstruction).
2. Compaction window = rows `[0, N-100)`, which is the boundary row PLUS the 400 saves since the first compaction.
3. Forward walk from `boundary.state`, apply each of the 400 deltas, land at the new boundary's state.
4. Write a NEW boundary snapshot row, replacing the OLD one entirely.
5. File now has: 1 new boundary snapshot + 100 most-recent rows = 101 rows.

The old boundary snapshot is DISCARDED in the rewrite. Its state is fully captured in the new boundary's state (via the forward-walk). No information is lost beyond what the first compaction already lost.

Why this matters: without the invariant, snapshots would accumulate and the "bounded storage" promise of OQ3 would fail. The R4 implementation MUST assert this in code (e.g. when reading the file, exactly zero or one `kind: "boundary_snapshot"` row is allowed).

### 2g. Concurrency + atomicity edge cases

- **Two tabs editing the same record.** Save in tab A triggers compaction at the same instant as tab B's save. Defense: the compaction-write uses the same atomic tmp+move pattern, and the compaction READ snapshots the file at one instant. Tab B's save sees the post-compaction file (one boundary row + 100 recent + 1 new = 102 rows, just under threshold). If both saves happen to cross the 500 boundary in the same window, one wins the rewrite, the other's append lands on the new compacted file. This works because append-line on a 101-row file just adds a 102nd row; the file shape is fine.
- **Process crash mid-compaction.** The tmp file is partial; the rename never happened; the original file is intact. Next save re-triggers compaction, re-runs the procedure. Safe.
- **OneDrive merge during compaction.** Unlikely (compaction is a local rewrite; OneDrive sees a single file replacement). If OneDrive reverts our rename due to a sync conflict, the file may end up with both old + new content interleaved. We rely on the same "OneDrive conflict detection" pattern already used elsewhere; out of scope here.

### 2h. Undo-revert window interaction (§3m)

§3m's `revert_undo_window` lives on the LIVE record, not in history. It references `from_version` and `to_version` as row INDICES.

After compaction, the row indices shift: rows at positions 1..N-100 become a single boundary row at position 1. A `revert_undo_window` pointing at a row that no longer exists is stale.

Defense:

- The undo-revert button on the popup is gated by `now() < expires_at`. The 24-hour window is short; the chance that a record both crosses the 500-row boundary AND has an unexpired undo-window pointer to a compacted row is small but real.
- The undo-revert handler reads the live record's `revert_undo_window` and looks up `from_version` in the history file. If the row no longer exists (because compaction folded it), the handler falls back to the boundary snapshot's state IF the boundary captures the same point in time; otherwise it surfaces "Undo not possible, the version this revert came from was compacted away" and clears the `revert_undo_window` field.
- Simpler alternative implemented in R6 if this gets messy: when compaction fires, scan the live record for `revert_undo_window` and clear it if the referenced row was inside the compaction window. Compaction's "side effect" on undo is documented in the wiki.

R4 ships without R6 (revert UX), so this interaction is documented now but coded later. The R4 deliverable just needs to NOT break the data layout; the §3m cleanup logic is a R6 task.

### 2i. Tests required at R4 ship time

The R4 implementation chip's test surface must cover:

1. **501-row file triggers compaction.** Seed a record with 500 rows of synthetic deltas. Trigger one more save. Assert: file is 101 rows, first row is `kind: "boundary_snapshot"` with a valid `state`, last 100 rows are the most-recent deltas verbatim.
2. **Round-trip: forward-walk from boundary matches pre-compaction state.** Before compaction, capture HEAD state. Trigger compaction. Forward-walk the new 101-row file from the boundary, applying each of the 100 recent deltas. Assert the result equals HEAD.
3. **Reverse-walk for revert, target inside recent window.** Set HEAD = state at row N. Revert to row N-50 (inside the verbatim window). Assert the walker reverse-applies 50 deltas correctly. No boundary involvement.
4. **Reverse-walk for revert, target = boundary.** Revert to the boundary row. Assert the walker reverse-applies 100 deltas back to the boundary, then reads `boundary.state` directly. Result matches `boundary.state`.
5. **Reverse-walk for revert, target before boundary.** Construct a stale "revert to row 5" request where the file has been compacted (row 5 no longer exists). Assert the handler surfaces the "compaction snapshot is the closest reachable point" message and offers the Case-B fallback.
6. **1001-row file triggers SECOND compaction.** Start from the 101-row post-compaction file. Append 400 more rows (file = 501). Trigger one more save. Assert: file is back to 101 rows, exactly one boundary row, the old boundary's state is no longer present byte-for-byte (it was folded forward).
7. **Genesis-anchored compaction backfill.** Record has a genesis row with no `state`. Trigger compaction. Assert: the backward-walk from HEAD reconstructs `genesis_state`, the compaction proceeds, the resulting boundary snapshot is correct.
8. **Atomic write under simulated crash.** Mock a process kill between the tmp-write and the rename. Re-open the file: original 501-row file is intact. Re-trigger save: compaction re-runs and succeeds.
9. **Concurrent appends across compaction.** Simulate two tabs: tab A's save triggers compaction; tab B's save lands during compaction. Assert: final file is consistent (101 + 1 rows OR the second save retries cleanly).
10. **Corrupt delta aborts compaction cleanly.** Inject one row with a malformed unified-diff `delta`. Trigger compaction. Assert: file is untouched, a clear "compaction failed at row X" warning is surfaced, History tab still works.

Tests 1, 2, 6 are the trio that verifies the §2f single-boundary invariant. Tests 3-5 verify revert. Tests 7-10 are the corner-case battery.

---

## 3. Open follow-ups

These do not block R4 but are flagged for future implementation chips.

**FU1, background-timer compaction alternative.**
On-write compaction (§2a) is the locked choice. If labs report consistent latency spikes on the boundary-crossing save (rare; ~once per 500 saves on a busy record), an opt-in background-timer alternative could fire compaction during idle time. The trade-off is added complexity (timer coordination, edge cases when the timer fires mid-edit). Defer until we see real lab telemetry.

**FU2, boundary snapshot size budget.**
A record's `boundary_snapshot.state` is the full document JSON at the compaction point. For a typical 5000-word note this is ~30 KB. For a Method with 200 sub-steps and rich-text bodies, could be 500 KB. For a Project containing inline metadata for hundreds of tasks (we don't do this today but could), could exceed 1 MB.

Surface a warning if `boundary_snapshot.state` exceeds 1 MB at write time. The warning is a `console.warn` plus a Settings-page indicator (in the future "History & Trash" tab). No hard cap, just visibility. R4 chip can implement the warning as a one-liner.

**FU3, configurable 100-row recent window.**
OQ3 locked the recent-verbatim window at 100. If labs report this is too small for forensic investigation ("I need to see every keystroke of the last week, not the last hour"), the Settings page exposes the override. The data model already supports this: compaction's `[N-100, N-1]` becomes `[N-RECENT, N-1]` where RECENT is the per-user setting. No format change needed.

**FU4, history-format schema version bump path.**
The `v: 1` field on every row is the migration anchor. If a v2 row format ships (e.g. binary deltas instead of text patches, or compressed state in boundary snapshots), the reader handles both shapes. R4 ships v1; a future chip designs the v1 -> v2 migration if needed.

**FU5, bulk-revert vs per-field revert UX.**
R6 ships per-field revert. The compaction algorithm makes bulk revert ("revert this entire record to last week") harder because intermediate states inside the compacted window are unreachable. Document this in the R6 chip: bulk revert is constrained to the recent-verbatim window OR the boundary snapshot, no in-between.

**FU6, jsdiff version bump cadence.**
We pin `9.0.0` exact. Future jsdiff releases (9.1.0, 10.0.0) need a dedicated "verify the wire format stayed compatible" chip before we bump. Reasonable cadence: revisit annually OR when a security advisory lands. Add a `// VERSION-LOCK` comment in `frontend/src/lib/history/diff.ts` pointing at this doc.

---

## 4. Acknowledgment and handoff

This doc unlocks the R4 implementation chip. With it:

- The diff library is picked, version-locked, install procedure documented.
- The compaction-with-deltas algorithm has a procedure, an invariant, a corner-case battery, and a 10-test ship checklist.
- The interaction with revert (§3l) and undo-revert (§3m) is documented; R6 inherits the constraints.

Outstanding only on master orchestrator's plate:
- Decide whether the R4 chip also ships FU2's size-warning code or defers it to a separate polish chip.
- Confirm the `diff@9.0.0` exact-pin posture is acceptable (vs. `~9.0.x` patch-allowed) before R4 fires.

Signed: **VCP R4-prep design**, 2026-05-26
