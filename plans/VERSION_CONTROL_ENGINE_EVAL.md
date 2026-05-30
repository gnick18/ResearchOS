# Version Control Storage Engine Evaluation: Real Git vs. Custom Delta Store

Author: vc-engine-eval bot (for HR), 2026-05-29

Status: Decision doc. Design/research only, no app code. Picks the STORAGE ENGINE under the version-control system. Companion to `docs/proposals/VERSION_CONTROL_PROPOSAL.md` and `docs/proposals/VERSION_CONTROL_R4_PREP.md` (both already locked).

---

## 0. The decision in one paragraph

Grant's instinct (deltas, not snapshots) is correct and is already locked in R4 (jsdiff unified diffs, compaction-with-deltas, OQ10). The open question is the ENGINE underneath those deltas:

- **Option A, REAL GIT via isomorphic-git.** Maintain a real `.git` object store inside the user's chosen folder. Pure-JS git in the browser, bridged to the File System Access API (FSA). The user owns a real repo, openable in any git tool.
- **Option B, CUSTOM DELTA STORE.** The R4 design already chosen: per-record `_history/<type>/<id>.jsonl`, jsdiff deltas per row, compaction at 500 rows. Just more JSON/JSONL files in the per-user folder.

Both are delta-based. The difference is whether we adopt git's on-disk object format (with its atomicity assumptions) or keep writing plain app-managed files through the existing atomic-write path.

**Recommendation: Option B (continue R4's custom delta store), with a git-INSPIRED conceptual borrow but NO live `.git`.** The decider is cloud-sync safety: a real `.git` object store does not survive Dropbox/Box/Drive/OneDrive/iCloud multi-machine sync without corruption, and our product's entire sharing model is "put the folder on a cloud drive and every lab member syncs it." Real git's failure mode is exactly the conflict-copy + partial-sync scenario we ship into by default. Details and the table below.

---

## 1. The constraint that frames everything: ResearchOS IS a cloud-synced multi-writer folder

This is not an edge case for us; it is the documented happy path. From `frontend/src/app/wiki/shared-lab-accounts/page.tsx`:

> "Put your ResearchOS folder inside a cloud-synced folder (e.g., OneDrive, Google Drive, Dropbox, or iCloud). Every lab member points ResearchOS at that **same** folder on their own computer."

The same wiki already documents that concurrent writers corrupt our plain JSON:

> "Stacking OneDrive and Dropbox on the same folder corrupts JSON files when both try to write."

And the codebase is already defensive about sync reality: `file-service.ts` does atomic `.tmp` + FSA `move()` writes specifically because "a torn write (tab close, crash, unhandled rejection mid-write) can only ever leave the OLD file contents intact, never a zero-byte file"; the startup loader counts reads so the user "knows something's happening even when OneDrive is being slow"; and there is a `_user_metadata.json` tombstone specifically so "OneDrive resurrection doesn't un-delete" a user.

So the engine question is really: **which engine survives a partially-synced, conflict-copy-prone, multi-machine folder?** That single criterion dominates the ranking.

---

## 2. Criterion-by-criterion: Option A (real git) vs Option B (custom delta store)

### 2.1 CLOUD-SYNC SAFETY (the decider)

The "git inside a cloud-synced folder corrupts" problem is one of the most well-documented failure modes in git operations. The mechanism:

- Git requires **atomic, ordered** multi-file updates. A single `commit` writes loose object files under `.git/objects/`, may rewrite `.git/index`, and updates a ref under `.git/refs/heads/`. These must land together, in order. ([git-remote-dropbox FAQ][grd], [sqlpey safe-practices][sqlpey])
- Cloud sync clients sync **per-file, out of order, eventually**. They have no idea git's `index`, `objects/`, and `refs/` must be consistent with each other. A partial sync can ship a ref that points at an object that hasn't synced yet, or a packfile without its `.idx`. ([sqlpey][sqlpey])
- When two machines touch the folder, the sync client makes **conflict copies**. iCloud renames a conflicted file `refs/heads/main 2`, OneDrive/Dropbox append `(conflicted copy)`. A real-world iCloud report: git began failing with `fatal: bad object refs/heads/main 2` and `did not send all necessary objects` because iCloud created a second HEAD file per branch, violating git's "exactly one ref per branch" rule and injecting illegal characters/spaces into ref names. ([architchandra iCloud][icloud])
- `git gc`/`repack` make it worse: they delete loose objects after packing them. If the packfile syncs but the deletion of the now-redundant loose objects races, or vice versa, you get "loose object is corrupt" / "did not send all necessary objects." ([oneuptime loose-object][loose], [DEV recover-corrupted][devrecover])

The universal expert guidance is blunt: **"Avoid shared/networked filesystems for `.git/`. NFS, CIFS, and cloud-synced folders (Dropbox, OneDrive) are notorious for causing corruption."** The recommended safe patterns all REMOVE `.git` from the sync surface (exclude `.git` from sync, or use a bare repo accessed over the Dropbox API via `git-remote-dropbox`, not the desktop sync client). ([sqlpey][sqlpey], [git-remote-dropbox][grd])

**Does isomorphic-git's loose-vs-packed object handling mitigate this? No, and it slightly worsens the default.** isomorphic-git writes **loose objects by default** (one file per blob/tree/commit) and does not run automatic `gc`/`repack`. That means our `.git/objects/` would accumulate many small files, the exact churn pattern the project already avoided (the AGENTS-referenced "batch the `Files/` PNG writes" rule, and the proposal's own §3e rejection of per-write snapshot files because "many tiny files = OneDrive churn"). Each loose object is a separate sync event; a multi-writer folder multiplies the conflict-copy surface. Packing would reduce file count but introduces the gc-races-with-deletion failure mode above. Neither posture is safe under multi-machine sync. The atomicity isomorphic-git can offer is per-file (same as our `file-service` atomic write); it cannot make the **cross-file** commit transaction atomic across an async cloud sync.

**The custom delta store under the same sync:** it is "just more JSON/JSONL files in the per-user folder," and crucially it is **per-user-namespaced** (`users/<u>/_history/...`). Two lab members on two machines never write the same history file, because each writes only inside their own `users/<self>/` subtree (the one cross-owner writer is the PI under a Phase-5 unlock, rare and serialized). So the multi-writer-same-file collision that destroys git's shared `.git/index` and `refs/` simply does not arise. Within a single user's files, a conflict copy of `_history/notes/47.jsonl` is survivable: it is an append-only log, the live record is the source of truth, the proposal already specifies "if a delta is corrupt, the History tab still works and the live record is untouched," and the trash/history indices are explicitly rebuildable from a directory scan. A torn or conflicted history file degrades gracefully to "no history for this record"; it never bricks the app or loses the live record.

**Verdict: B wins decisively.** A is the single most-documented anti-pattern for git, and our product ships directly into that anti-pattern by design. This criterion alone is close to disqualifying for A.

### 2.2 BROWSER FEASIBILITY

- **FSA adapter: must be hand-built.** isomorphic-git needs an fs backend implementing `readFile, writeFile, unlink, readdir, mkdir, rmdir, stat, lstat` (plus optional `symlink/readlink/chmod`). ([isomorphic-git fs docs][fsdocs]) Its two officially-maintained backends, [LightningFS][lfs] and BrowserFS, are **IndexedDB/in-memory**, not FSA, so they would store `.git` in the browser's IndexedDB, NOT in the user's chosen folder, defeating the entire "real repo the user owns" rationale for Option A. To put `.git` in the user's folder we must hand-write an FSA-to-fs bridge. A real-world example exists (a browser-only git diff viewer) but the author **hand-wrote the adapter**, hit `instanceof FileSystemFileHandle` breaking under test (must use `.kind`), and discovered FSA is "dramatically slower than native filesystem operations," requiring multi-layer caching (ref cache, object cache, adapter cache). Notably even read-only `statusMatrix` **writes** `.git/index`, so the adapter needs full write support just to show a diff, more write churn into the synced folder. ([DEV diff-viewer][devfsa])
- **Performance on every manual save.** Our save path runs in the UI thread on a manual Save. A git `commit` in isomorphic-git over a hand-rolled FSA adapter (slow) means: read/update `.git/index`, write loose objects (blob+tree(s)+commit), update a ref, all through FSA's slow handle traversal (`getDirectoryHandle` walks each path segment, see `getHandleByPath` in our `file-service.ts`). For our realistic per-user repo (hundreds-to-low-thousands of small JSON records), the index alone grows with file count and is rewritten on each commit. The custom store, by contrast, touches exactly two files per save (the record + one append-RMW on one small per-record `.jsonl`), which is the cost we already pay.
- **Bundle size.** isomorphic-git v1.38.3 main bundle is **~227 KB minified / ~67 KB gzipped**, with 11 transitive deps (pako, sha.js, async-lock, diff3, etc.). ([bundlephobia API, fetched 2026-05-29]) The custom store's only dep is jsdiff, already chosen, at ~30 KB minified for the three functions we import (per R4-prep §1c). So A adds ~2x the gzipped weight of the entire diff approach, for an engine we'd then have to wrap anyway.
- **License: MIT** for isomorphic-git ([npm][npm]), clean against our MIT posture. (Not a differentiator; jsdiff is BSD-3, also fine.)

**Verdict: B is materially easier.** A requires building and maintaining a slow FSA bridge, ships ~67 KB gzip + 11 deps, and is slower per save. Feasible, but a real engineering tax with no offsetting safety benefit.

### 2.3 VERSION MODEL FIT

- Git gives a true commit **DAG**: branches, merges, a real tree of versions, and content-addressed dedup. The custom store gives **linear-per-record** history (the proposal's Non-Goals §7 explicitly states "No branches, no merges, no rebase. The history is linear per record").
- **Do we actually want branching?** The desired UX (per the proposal and Grant's brief) is: a per-record timeline of who/what/when, click-to-revert any version, and a 24h undo-revert window. That is **linear per record**. Grant said "tree", but the relevant tree is the **UI tree of versions for one record over time** (a vertical timeline), not git-style divergent branches that need merging. ResearchOS has no merge UX, no conflict resolution UI, and explicitly chose last-write-wins for concurrent edits (§7 "No OT / CRDT"). A real DAG's branching power would be **unused capability we still have to reason about** (a synced conflict-copy could even manifest as an accidental branch). Linear-per-record is the better fit, and it is what B delivers natively.
- Git's packfile delta compression is real and good, but R4 already gets delta compression from jsdiff + compaction (a 5000-word doc edited 500x stays ~5 MB, not ~50 MB, per R4-prep). We do not need git's packing to get delta storage.

**Verdict: B fits the actual UX better.** Git's DAG is power we would not use and would have to defend against (sync-induced phantom branches). The "tree" Grant wants is a per-record timeline, which is linear and is exactly Option B.

### 2.4 ATTRIBUTION

- Our model already stamps `last_edited_by` / `last_edited_at` on the record and a full `actor`/`owner` on every history row (proposal §3c, §3f). That is per-version authorship, equivalent to a git commit author, without git.
- **isomorphic-git has NO `blame` command.** Its API (67 functions) includes `log`, `walk`, `readTree`, `readCommit`, `readBlob`, but no `blame`. ([isomorphic-git alphabetic API][alpha]) Per-file history (`git log -- path`) is **not native** either; issue [#677][i677] (closed) confirms users must build it manually by walking commits and diffing trees. So with Option A we would STILL hand-build per-file history and any blame view, on top of also building the FSA bridge.
- In-file, word-level "who changed this word" is a **jsdiff DISPLAY layer in BOTH options**. Git stores commits, not word-level provenance; word-level blame within a single field is computed from diffs at render time regardless of engine. So attribution is a wash on the display side and B wins on the plumbing side (we already have the actor stamps; A makes us reconstruct them via manual commit-walking with no blame primitive).

**Verdict: B, mildly.** Neither gives word-level blame for free. Git gives commit-author but no blame and no per-file log out of the box; we already have richer per-row attribution.

### 2.5 MULTI-USER / SHARED

- Our model is **per-user-folder JsonStore + explicit sharing** (`owner` + `shared_with`), NOT a shared working tree. There is no single repo the whole lab commits into.
- **Real git fights this.** Git's unit is a whole-repo working tree + one shared `.git`. To map onto our model we would need **one `.git` per user folder** (`users/<u>/.git`). That is N independent repos in one synced folder. The moment two machines both have user Alex's folder (the shared-lab-account case, or Alex on a laptop + lab desktop), both write `users/alex/.git/index` and `refs/`, which is the corruption scenario in 2.1. A PI editing across owners would be committing into someone else's repo from a different machine, guaranteed conflict-copy territory.
- **Custom store has no whole-repo transaction.** Each save touches only that record's files inside that owner's folder. Concurrent edits to DIFFERENT records never interact. Concurrent edits to the SAME record degrade to last-write-wins on the live file plus two appended history rows, exactly the behavior the proposal already specified and accepts (§5 edge case 2). No merge engine required.

**Verdict: B.** Git's whole-repo commit model directly conflicts with our per-user-namespace model; B is built for it.

### 2.6 PORTABILITY BONUS (the genuine upside of A)

This is the one real win for Option A and deserves honest weight: a real `.git` means the user owns a **standard repo** they can `git log`, `git checkout`, push to GitHub, or open in any git tool, an excellent local-first, no-lock-in story that fits ResearchOS's MIT/own-your-data ethos.

But weigh it against the cost:
- The portability is only as good as the repo's integrity, and 2.1 says the repo will likely be **corrupt** in the exact multi-machine cloud-sync setup we recommend. A corrupt repo is worse than no repo: it looks portable until it fails.
- The audience that would run `git log` on their lab folder is a thin slice of researchers; most never open a terminal.
- We can capture **most** of the portability value without the risk via the hybrid (below): jsdiff unified diffs are already the literal text format `git diff`/`patch` speak (R4-prep §1b), and a small exporter can render the per-record `.jsonl` history into a real `.git` **on demand** ("Export history as a git repo"), giving the power-user the portable artifact without keeping a fragile live `.git` in the synced folder.

**Verdict: real but outweighed, and largely recoverable via export.** Not enough to accept the sync-corruption risk as the live engine.

### 2.7 REVERSIBILITY OF THE CHOICE

- R4 (custom delta store) is **already partly built / fully designed**: the diff library is picked and version-locked (`diff@9.0.0`), the compaction algorithm has a 10-test ship checklist, and the data layout is specified down to the row schema. Choosing B = **continue**, near-zero pivot cost.
- Choosing A = **discard** the R4-prep design, build the FSA-to-fs adapter, re-derive compaction (git gives packing, but we lose the human-readable jsonl forensic story the regulatory framing leans on), and re-solve per-file history and blame manually anyway. It is a from-scratch engine swap on a system that already has a green light.
- B is also **forward-compatible with A's best part**: the on-disk deltas are git-format-compatible unified diffs, so a future "export to real git" feature stays open. A is NOT cheaply reversible back to B once `.git` is the source of truth.

**Verdict: B.** B is the low-risk continuation; A is a costly restart that throws away locked design work.

---

## 3. Comparison table

| Criterion (deciders first) | Option A: Real git (isomorphic-git, live `.git`) | Option B: Custom delta store (R4) | Winner |
|---|---|---|---|
| **1. Cloud-sync safety** (decider) | Corrupts. `.git` (loose/packed objects + `index` + `refs`) needs atomic cross-file commits; cloud sync ships files partial/out-of-order and makes conflict copies (`refs/heads/main 2`). Multi-machine = the documented "never put `.git` in Dropbox/iCloud" anti-pattern. Loose-object default = more sync churn; packing adds gc-race corruption. | Survives. Per-user-namespaced append-only JSONL; no shared mutable index/refs. Conflict copy of one history file degrades to "no history for this record"; live record untouched; indices rebuildable from disk scan. | **B (decisive)** |
| **2. Browser feasibility** | Must hand-write FSA->fs adapter (no maintained one; official backends are IndexedDB, wrong folder). FSA "dramatically slower," needs multi-layer caching; even read `statusMatrix` writes `.git/index`. ~227 KB min / ~67 KB gz + 11 deps. MIT. | Two file writes per save (record + one small JSONL append-RMW), the cost we already pay. One dep (jsdiff, ~30 KB), already chosen. BSD-3. | **B** |
| **3. Version model fit** | True commit DAG: branches/merges/dedup. But we have no merge UX, chose last-write-wins, want a per-record timeline, not divergent branches. Sync could spawn phantom branches. | Linear-per-record timeline = exactly the locked UX (revert any row + 24h undo). | **B** |
| **4. Attribution** | Commit author per version, but NO `blame` command and NO native per-file `log` (#677, manual). Word-level blame is a jsdiff display layer regardless. | Already stamps actor/owner per row + `last_edited_by`. Word-level blame = same jsdiff display layer. | **B (mild)** |
| **5. Multi-user / shared** | Whole-repo commit model fights per-user-namespace model. One `.git` per user folder = N repos in one synced folder; cross-machine same-user writes corrupt `index`/`refs`. | No whole-repo transaction; per-record writes inside owner folder; concurrent = last-write-wins + 2 history rows, already specified. | **B** |
| **6. Portability bonus** | Real, standard repo, openable anywhere (genuine local-first win). But only if not corrupt, and it likely is under our sync model. | No live repo, but jsdiff deltas are git-format text; "export history to a real git repo" stays available on demand. | **A (the one win), recoverable by B via export** |
| **7. Reversibility of choice** | Discards locked R4-prep (pinned `diff@9.0.0`, compaction, 10-test plan); from-scratch engine swap; still must build blame/per-file-log manually. | Continue. Near-zero pivot. Stays export-compatible with A's best part. | **B** |

Score: **B wins 6 of 7; A wins only Portability, and that win is largely recoverable in B via an on-demand exporter.**

---

## 4. Recommendation

**Continue Option B (R4's custom delta store), explicitly framed as "git-INSPIRED, not git-backed."**

Lead rationale (cloud-sync): a live `.git` does not survive the multi-machine cloud-synced shared folder that IS our product's recommended deployment. Storing `.git` in Dropbox/OneDrive/iCloud/Drive is the single most-documented git corruption anti-pattern, and isomorphic-git's loose-object default makes the sync-churn worse, not better. Our own wiki already warns that concurrent writers corrupt even plain JSON in this folder; git's cross-file atomic-commit requirement is far more fragile than one JSON file. This kills A as the live engine for OUR product.

Adopt the **git fundamentals worth borrowing** without the live `.git` (the hybrid Grant intuited):
1. **Content-addressed thinking + delta storage**: already in R4 (jsdiff deltas, boundary snapshots).
2. **Unified-diff wire format**: already chosen; it is literally `git diff`'s format, so the on-disk history is human-readable and git-exportable.
3. **Per-record linear history as the "tree" UX**: the timeline view, not divergent branches.
4. **Optional "Export history as a real git repo" feature (future, low priority)**: capture the portability upside on demand by replaying the jsonl into a fresh `.git` the user can take anywhere, getting A's only real win without A's risk.

Do NOT introduce a live `.git` in the synced folder. Do NOT adopt isomorphic-git as the runtime engine.

---

## 5. Is a spike needed?

**No spike is needed to make the call.** The cloud-sync verdict is decisive on documented evidence, and continuing B carries the lowest risk by far.

**If Grant wants empirical confirmation before fully closing A** (reasonable given he's intrigued by real git), run ONE narrow, time-boxed spike, NOT a build:
- Create a trivial real git repo inside a folder synced by Dropbox (or OneDrive) on **two machines** (or two synced accounts). On machine 1 commit; before it fully syncs, commit on machine 2. Sync both. Run `git fsck`. Expected result: conflict-copied `refs`/objects and/or `git fsck` errors ("bad object", "did not send all necessary objects"). This reproduces the [iCloud][icloud] / [Dropbox][sqlpey] reports in our own conditions in well under a day.
- Do NOT spike the isomorphic-git + FSA adapter build; that only answers feasibility (which is "possible but slow + hand-rolled"), not safety, and safety is the decider.

---

## 6. The ONE decision for Grant

> **Lock the version-control storage engine as the git-INSPIRED custom delta store (continue R4: jsdiff unified diffs + compaction), and do NOT maintain a live `.git` in the user's folder, because a real git object store corrupts under the multi-machine cloud-synced shared folder that is ResearchOS's recommended deployment. Real-git portability is preserved as an optional future "export history to a git repo" feature, not as the live engine.**

Yes = continue R4 unchanged, no engine swap, no isomorphic-git dependency, and add "git export" to the someday backlog.

No / "I still want real git" = we run the one-day two-machine sync-corruption spike in §5 to confirm before committing either way.

---

## Sources

- [git-remote-dropbox FAQ, why the desktop client corrupts a git repo][grd]
- [Safe practices for git + Dropbox: atomicity mismatch, corruption modes, safe alternatives][sqlpey]
- [Storing a git repo in iCloud Drive: `fatal: bad object refs/heads/main 2`, conflict-suffix corruption][icloud]
- [Fixing "loose object is corrupt" errors / cloud-sync as a known cause][loose]
- [Recovering from a corrupted git repository (gc/repack + sync race)][devrecover]
- [isomorphic-git: required fs backend interface (readFile/writeFile/unlink/readdir/mkdir/rmdir/stat/lstat)][fsdocs]
- [isomorphic-git LightningFS (IndexedDB backend, not FSA)][lfs]
- [Browser-only git diff viewer over FSA: hand-rolled adapter, FSA "dramatically slower," statusMatrix writes index][devfsa]
- [isomorphic-git full API list (has log/walk/readTree, no blame)][alpha]
- [isomorphic-git issue #677: per-file `git log -- path` is not native, must be built manually][i677]
- [isomorphic-git on npm (v1.38.3, MIT license)][npm]
- Bundle size: bundlephobia API for `isomorphic-git@1.38.3`, fetched 2026-05-29 (main bundle 226,878 B min / 67,483 B gzip, 11 deps).
- Internal: `frontend/src/app/wiki/shared-lab-accounts/page.tsx` (cloud-sync deployment + "stacking providers corrupts JSON"), `frontend/src/lib/file-system/file-service.ts` (atomic `.tmp`+`move` write, OneDrive-aware), `frontend/src/lib/storage/json-store.ts` (per-user `users/<u>/` namespacing), `docs/proposals/VERSION_CONTROL_PROPOSAL.md` (§3c history layout, §3e per-file-jsonl rationale, §7 non-goals: linear, no branches), `docs/proposals/VERSION_CONTROL_R4_PREP.md` (jsdiff `diff@9.0.0` pick, compaction-with-deltas).

[grd]: https://github.com/anishathalye/git-remote-dropbox
[sqlpey]: https://sqlpey.com/git/git-dropbox-safe-practices/
[icloud]: https://architchandra.com/articles/a-side-effect-of-storing-a-git-repository-in-icloud-drive
[loose]: https://oneuptime.com/blog/post/2026-01-24-git-loose-object-corrupt/view
[devrecover]: https://dev.to/alanwest/how-to-recover-from-a-corrupted-git-repository-22oc
[fsdocs]: https://isomorphic-git.org/docs/en/fs
[lfs]: https://github.com/isomorphic-git/lightning-fs
[devfsa]: https://dev.to/chigichan24/i-built-a-browser-only-git-diff-viewer-using-file-system-access-api-no-server-needed-282g
[alpha]: https://isomorphic-git.org/docs/en/alphabetic
[i677]: https://github.com/isomorphic-git/isomorphic-git/issues/677
[npm]: https://www.npmjs.com/package/isomorphic-git
