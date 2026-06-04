# Cross-Boundary Sharing, Projects (the largest tier)

How to share a whole project across a folder boundary, the composite of composites. This fleshes out the project tier that the roadmap (`CROSS_BOUNDARY_SHARING_ROADMAP.md` §"Tier 4, Projects") and the experiments doc (`CROSS_BOUNDARY_SHARING_EXPERIMENTS.md`) deferred. The goal here is to do the hard thinking on paper so the eventual build is fast.

This is a design proposal, not a build spec. No code lands from this document. Where it touches the export/import internals or the relay, it names the exact files so the build inherits a map rather than a sketch.

It does not contradict the locked tenets. Everything stays end-to-end encrypted, the relay never permanently stores readable data, and every share ends as a local clone the recipient owns. The project tier extends the rails, it does not rewrite them.

---

## 1. Scope, what a project share carries

A project is the whole subtree. Concretely, a project share carries:

- The `Project` record itself (`frontend/src/lib/types.ts`, the `Project` interface), name, tags, color, weekend flag, sort order. NOT the sharing overlay fields (`is_shared_with_me`, `shared_with`, `shared_permission`, `last_edited_by`, the `revert_undo_window`) and NOT `funding_account_id` (a grant link is meaningless in the recipient's namespace, see open question Q4).
- Every child experiment, every `Task` whose `project_id` is this project. Each experiment is exactly the composite the experiment tier already packages, the task record plus its notes and results markdown, every attachment under both tabs, and every method the task references (the method record, its structured protocol for PCR / LC / plate / cell-culture / mass-spec / coding-workflow / qPCR, and any body or PDF).
- The inter-task dependencies among those experiments (`Dependency` records, `parent_id` / `child_id` / `dep_type`). This is the payoff the single-experiment tier could not deliver, because now BOTH endpoints of an in-project link are present in one bundle (see §4).

Out of scope for the carried data, anything that lives outside the project subtree. A task that is only hosted into this project via `external_project` (`frontend/src/lib/sharing/project-hosting.ts`) but is owned elsewhere is NOT pulled in, because its real record lives in another owner's directory and the sender does not own it to share. The bundle carries the project's NATIVE tasks (`task.project_id === project.id && task.owner === sender`), and hosted-foreign tasks are noted as "not carried" the same way a severed dependency is (see §7). Goals, purchases, and funding are out of scope for v1 (open questions Q4, Q5).

---

## 2. Bundle shape, a project bundle that reuses the experiment foundation

The experiment tier already produces a `researchos-experiment` zip per task (`frontend/src/lib/export/raw.ts`, orchestrated by `frontend/src/lib/export/orchestrate.ts`). Crucially, `exportExperiments` ALREADY accepts `Task[]` and, for two or more tasks, produces a wrapper `experiments-{date}.zip` that holds one intact per-experiment `{name}-raw.zip` inside it (a zip-of-zips, see `buildMultiZip` in `orchestrate.ts`). So multi-experiment EXPORT exists today. What does NOT exist today is a project-LEVEL export, there is no path that takes a `Project`, walks its task subtree as a unit, carries the project record itself, or carries the cross-task dependencies as a project-scoped set. See §10 for the precise "what exists" answer.

The project bundle is therefore the multi-experiment wrapper plus a thin project envelope. Proposed layout, a `researchos-project` zip:

```
researchos-project-{slug}.zip
  _project-manifest.json        <- new: format, version, project id/name, the
                                   per-experiment index, the project-scoped
                                   dependency index, counts + total bytes
  project.json                  <- the Project record (stripped of overlay fields)
  dependencies.json             <- project-scoped Dependency records (the union
                                   of every in-project link, deduped)
  experiments/
    {slug-1}-raw.zip            <- intact existing researchos-experiment bundle
    {slug-2}-raw.zip
    ...
```

Each `experiments/{slug}-raw.zip` is byte-for-byte the bundle `raw.ts` already builds, untouched. The project layer wraps, it does not re-pack. This means:

- The dependency-carry foundation (`collectTaskDependencies` in `extract.ts`, the v2 `dependencies.json`, `ImportPayload.dependencies`) is reused verbatim. The per-experiment bundles still each carry their own task's dependency records; the project-level `dependencies.json` is the deduped union, which is what lets the importer remap links whose both endpoints are in the bundle.
- The method-localization foundation (`ImportNotCarried.methodRefs`, the Gap 2 fix in `apply.ts`) is reused verbatim per experiment. A method shared across several of the project's experiments localizes once per experiment under today's rules; deduping a shared method to a single recipient-side method across the whole project is a v1.1 optimization, not a v1 requirement (open question Q3).

The `_project-manifest.json` is the small, sealable index that the SIZE solution in §3 hangs on. It must be cheap to fetch and read on its own, so it carries no file bytes, only counts, names, sizes, and hashes.

This layout keeps the single monolithic-zip option open for SMALL projects (a project that is a few hundred KB seals and ships as one blob exactly like an experiment does today, no manifest machinery needed). The manifest-plus-per-file path in §3 is the LARGE-project path. Both produce a `researchos-project` payload the inbox dispatches on; the difference is purely in transport. See §3 for the size threshold that selects between them.

---

## 3. The SIZE problem and the share manifest

### Why today's model does not scale to projects

Today one share is one bundle, built in the browser, sealed in memory with `sealToRecipient` (`frontend/src/lib/sharing/encryption.ts`), and PUT as a single R2 object via one presigned URL (`frontend/src/lib/sharing/relay/storage.ts`, `presignUpload`). That is fine for a note, a method, or a modest experiment. A full project with many large image and PDF attachments can:

- exceed browser memory, the whole archive plus its sealed copy are materialized at once (JSZip builds a blob, `sealToRecipient` returns a new `concatBytes` buffer, so peak working set is roughly two times the archive),
- produce one sealed object that must upload and re-download atomically, no resume on a dropped connection, the recipient pays the full transfer before seeing anything,
- give the recipient no way to preview what they are about to pull before pulling gigabytes.

### The evolution, a sealed manifest plus per-file sealed objects

Move from one monolithic sealed blob to:

1. A small sealed MANIFEST object. It lists every record file (the project JSON, each `task.json`, each method record, the markdown bodies) inline or as small entries, plus one entry per LARGE file (attachments, PDFs, images) with that file's hash, byte length, and its own R2 object key. The manifest is sealed to the recipient with the existing `sealToRecipient` exactly as a small bundle is today.
2. A per-share symmetric key (the data key, DEK). One random 32-byte XChaCha20-Poly1305 key is generated per share. Every large file is encrypted under THIS one key, not sealed individually to the recipient. The DEK is wrapped to the recipient once and stored in the manifest. This is the standard envelope / hybrid-encryption pattern, encrypt the payload once with a fast symmetric cipher and wrap only the short key to each recipient with the public-key mechanism ([hybrid cryptosystem](https://en.wikipedia.org/wiki/Hybrid_cryptosystem), [GCP envelope encryption](https://docs.cloud.google.com/kms/docs/envelope-encryption)). It is the correct choice for many-file payloads because the expensive asymmetric step runs once instead of once per file.

   Concretely, the DEK is wrapped by sealing it to the recipient's X25519 key with the existing `sealToRecipient` (the DEK is just 32 bytes of plaintext to the seal function). No new crypto dependency, the same `@noble` primitives that `encryption.ts` already uses.
3. Per-file sealed objects. Each large file is encrypted under the DEK and uploaded as its own R2 object via its own presigned PUT. For files large enough to matter on their own, encrypt them as a chunked authenticated stream rather than one buffer, libsodium's `crypto_secretstream_xchacha20poly1305` is the canonical construction for this, it splits a large payload into ~64 KB chunks each individually authenticated, rekeys transparently so streams can be arbitrarily large, and tags the final chunk so truncation is detectable ([libsodium secretstream](https://doc.libsodium.org/secret-key_cryptography/secretstream)). We do NOT add libsodium; the same streaming AEAD shape is expressible with the `@noble/ciphers` XChaCha20-Poly1305 we already have, by framing the file into fixed-size chunks with per-chunk nonces derived from the DEK and a counter, and an explicit final-chunk marker. The design commitment is the SHAPE (chunked, authenticated, final-tagged), not the library.
4. The recipient pulls the manifest first, decrypts it, sees the full inventory, then streams the files it needs, decrypting chunk by chunk and writing straight to the local folder via the File System Access API.

### Bounded memory

Peak working set becomes one chunk (~64 KB to a few MB) plus the small manifest, regardless of project size. The browser never holds the whole project in memory, on either the send or the receive side. This is the same bounded-memory property the existing local export already pursues for multi-experiment exports (`packZipStreaming` / `streamZipToDisk` in `orchestrate.ts` stream the OUTPUT zip rather than buffering it), extended to the encrypted-transport case.

### Resumable up and download

Per-file objects give file-level resume for free, a dropped connection costs only the in-flight file, not the whole project, because each file is an independent presigned PUT / GET and the manifest records which keys exist. The relay's existing confirm-after-upload model (`db.ts`, the `pending` to `ready` flip) extends naturally, the manifest row goes `ready` only after every file object it references has been uploaded and confirmed.

A note on S3 multipart upload, S3 (and R2) support multipart upload with a part-per-presigned-URL pattern that gives WITHIN-file resume and parallel parts ([AWS multipart with presigned URLs](https://aws.amazon.com/blogs/compute/uploading-large-objects-to-amazon-s3-using-multipart-upload-and-transfer-acceleration/)). BUT R2's presigned-URL support for the multipart control operations (`CreateMultipartUpload`, `CompleteMultipartUpload`) is reported as unreliable, presigned URLs work cleanly for simple PUT, while multipart create/complete via presigned URL has returned Access Denied and is better driven server-side ([Cloudflare community thread](https://community.cloudflare.com/t/does-the-presigned-url-for-r2-support-multipart-upload/600038), [R2 presigned URLs docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)). RECOMMENDATION, v1 uses one presigned PUT per file (file-level resume, no server involvement in the data path, preserves the blind-relay tenet) and does NOT use S3 multipart. Within-file resume for a single very large file is a later refinement, and if we ever want it we add a tiny server endpoint that brokers `CreateMultipartUpload` / `CompleteMultipartUpload` while the part PUTs still go direct and sealed. That endpoint would see object keys and part numbers, never plaintext, so it stays inside the tenet.

### Previewing before pulling gigabytes

Because the manifest is small and fetched first, the receive UI can show "N experiments, M notes, K files, total X GB" and let the recipient decide before any large transfer starts (§6). With today's monolithic blob the recipient must download everything to learn what it is.

### Contrast with today, summarized

| | Today (note / experiment) | Project tier (large) |
| --- | --- | --- |
| Sealing | one `sealToRecipient` over the whole zip | manifest sealed; files encrypted under one wrapped DEK |
| R2 objects | one | one manifest + one per large file |
| Memory | ~2x archive size in RAM | one chunk + manifest |
| Resume | none (atomic) | per-file |
| Preview | none (must download all) | manifest-first inventory |
| Asymmetric ops | one | one (DEK wrap), regardless of file count |

### Small-project fast path

A project under a threshold (proposed, the existing large-export trigger in `stream-output.ts`, `LARGE_EXPORT_BYTE_THRESHOLD`, reused so one constant governs both local export and share transport) ships as a single sealed `researchos-project` zip exactly like an experiment, no manifest, no per-file objects. The manifest path engages only above the threshold. This keeps the common case (a small teaching project, a single-experiment-plus-notes project) on the simple rails and reserves the machinery for the cases that need it.

---

## 4. Id-remap at scale

Every record in the bundle gets a fresh id in the recipient's namespace and every cross-reference is rewritten to the new id. The machinery exists, `applyImportPlan` in `frontend/src/lib/import/apply.ts` already does this for one experiment, a fresh task id from `tasksApi.create`, project resolution, per-method localization and reference rewrite (`remapMethodIds`, `remapMethodAttachments`), and dependency remap (`remapDependencies`). The project tier loops it and feeds it a fuller id map.

What changes for projects:

- **One project resolution for the whole bundle.** Today each experiment import resolves a project (`applyProjectResolution`, use-existing / import-new / no-project). For a project share the project is resolved ONCE, the recipient gets one new `Project` (always-new, see §5), and every imported task's `project_id` points at it. The per-experiment project-resolution UI is suppressed in favor of a single project-level decision.
- **A real multi-entry task-id map.** `remapDependencies` already takes a `taskIdMap` and was deliberately built to support more than one entry (`apply.ts`, the comment "The shape already supports multi-task remap so the later tier plugs in without touching this rule"). For a project import, the loop materializes every task first, building the full `sourceTaskId -> newTaskId` map, THEN remaps dependencies against that complete map. Because both endpoints of an in-project link are now present, the link is RECREATED rather than dropped-and-reported. This is the concrete payoff that the single-experiment tier (`CROSS_BOUNDARY_SHARING_EXPERIMENTS.md` Gap 1) explicitly deferred to here.
- **Ordering.** Create the project, create all tasks (collecting the id map), localize methods (per experiment, with the optional cross-experiment dedup of Q3), write notes/results/attachments, then create dependencies last against the complete map. Methods and protocols already get fresh ids inside `applyMethodResolutions`; nothing about that changes.
- **Failure-aware reporting.** `ImportResult.notCarried` (`frontend/src/lib/import/types.ts`) already structures dropped dependencies and dropped method refs. The project importer aggregates one `notCarried` across all experiments so the recipient gets a single "here is what did not come over" summary (a hosted-foreign task that was referenced, a method that failed to localize), rather than one per experiment.

A new `applyProjectImportPlan` orchestrates this; it composes the existing single-experiment apply rather than reimplementing it. The per-experiment `applyImportPlan` stays the unit of work; the project layer drives the shared project id in and merges the `notCarried` out.

---

## 5. The new-vs-merge import fork (the key product decision)

When the recipient imports a project, does it always create a NEW project in their folder, or can it MERGE into an existing one?

### Always-new (recommended for v1)

The project lands as a fresh `Project` with a fresh id, all child tasks/methods/dependencies remapped under it, and a provenance marker recording who sent it and when. No conflict handling exists because nothing pre-existing is touched. Concretely:

- One `projectsApi.create` (reuse `pickImportedProjectName` so a name collision becomes "Photosynthesis assay (imported)" rather than a clash).
- A provenance marker on the new project, proposed, reuse the existing `external_project` / hosting vocabulary in spirit but as a lightweight, additive `imported_from` stamp (sender label + ISO timestamp + source project name), so the UI can show "Imported from alex@lab on 2026-06-04" without inventing a sharing relationship the project does not have. This is a small additive field on `Project` (FLAG, a new persisted field, must be pre-flagged before any code, see §8).
- Every subsequent import of an updated copy of the same project makes ANOTHER new project. That is the honest, safe behavior, two snapshots, two projects, the recipient reconciles by hand or deletes the stale one. It covers the dominant real use case, "here is my project, take a copy."

Always-new is simple, safe, and lossless in the sense that it never overwrites the recipient's existing work. It is the recommended v1 and the only mode the build implements first.

### Merge-into-existing (powerful, but a separate later design)

Merge targets converging collaborators, two people working a shared project who each want the other's latest pulled into THEIR copy without a duplicate project. It is genuinely useful and genuinely hard, because it pulls in real conflict semantics:

- **Identity across the boundary.** The recipient's copy and the incoming copy have DIFFERENT ids for the same conceptual experiment (ids are per-namespace). Merge needs a stable cross-namespace identity to match "this incoming experiment IS my existing experiment X." The `imported_from` provenance stamp is the seed of that, but a robust merge needs a durable shared identifier minted at first share and carried on both sides.
- **Per-record dedup.** For each incoming experiment, note, method, decide create-new vs update-existing. For methods this overlaps the existing per-method use-existing / import-new resolution, but at project scale across dozens of records it needs a default policy plus an override UI, not a modal per record.
- **Version reconcile.** When both sides edited the same note since the last sync, what wins. This is the same class of problem the local version-control work (`project_vc_phase1_decisions`) and the future Collaborate mode (`CROSS_BOUNDARY_SHARING_ROADMAP.md` §"Collaborate mode") are circling. Merge should almost certainly borrow that machinery (vs-previous diff, last-edited stamps already on `Task` / `Project`) rather than invent its own. A three-way merge with a shared base version is the principled answer and is a project unto itself.

RECOMMENDATION, ship always-new in v1. Mark merge as a separately-designed later capability, gated on (a) a durable cross-namespace identity minted at share time, and (b) the local version-control reconcile primitives being mature enough to lean on. Do not build merge speculatively; build the `imported_from` stamp now (cheap, additive) so that WHEN merge is designed, the provenance trail it needs already exists in the data.

---

## 6. Receive UX

The recipient reviews a project's manifest BEFORE importing, then imports as a new project.

1. **Inbox row.** The Shared-with-me tab shows the row as a project (the inbox dispatch-by-type refactor from `CROSS_BOUNDARY_SHARING_EXPERIMENTS.md` §"inbox dispatch by type" is the seam; project is a third `entityType` alongside note and experiment). Sniffing reuses the marker-file approach in `experiment-transfer.ts` (`sniffSharePayload`), a `researchos-project` payload is identified by `_project-manifest.json` at the zip root, disjoint from the experiment marker (`_export-manifest.json`) and the note BagIt markers.
2. **Manifest review.** On open, fetch and decrypt ONLY the manifest. Show the inventory, project name, N experiments, M notes, K files, total size, and the sender. For the manifest-path (large) case this is the whole point of §3, the recipient sees the cost before paying it. Show the `notCarried`-class warnings that are knowable from the manifest alone (e.g. a referenced hosted-foreign task that the bundle could not include).
3. **Decide and import.** The recipient confirms "Import as a new project." Because v1 is always-new, there is no project-picker and no per-experiment project resolution, the single project-level decision in §4 is implicit. A method-resolution pass MAY still surface if the recipient already owns matching methods and we want to offer use-existing; the simplest v1 is to localize every method fresh (always import-new for methods) and skip the resolution UI entirely, matching the cross-boundary "the recipient does not have the sender's lab-mate, so the method must become local" rule from the experiments doc. Offering use-existing is a v1.1 nicety.
4. **Stream and write.** Pull each file object, decrypt chunk by chunk, write to the local folder. Show per-file progress (the existing `ExportProgress` shape in `orchestrate.ts` is a ready template for a "12 of 50" line). The import is resumable, if the tab closes mid-pull, the manifest plus the already-written files let it resume rather than restart.
5. **Ack after write.** Acknowledge the relay (which deletes the R2 objects) only AFTER the import has fully materialized on disk, the same ack-after-write rule notes and experiments already follow. For the multi-object project case, ack deletes the manifest object and every file object the manifest references.

---

## 7. Failure modes

- **Partial upload (sender side).** The manifest row stays `pending` until every file object is uploaded and confirmed, so a half-uploaded project is never visible to the recipient (extends the existing `pending` to `ready` gate in `db.ts`). An abandoned partial upload is swept by the existing `sweepStalePending` grace-window cleanup; orphaned file objects with no `ready` manifest are reclaimed by the daily orphan-sweep cron the build plan already calls for (`CROSS_BOUNDARY_SHARING_BUILD_PLAN.md`). Resumable upload means the sender can retry only the missing files rather than the whole project.
- **Partial download (recipient side).** Per-file objects plus the manifest make download resumable, already-written files are skipped on retry, only missing files are re-pulled. The import commits to disk incrementally; a project that is 80% pulled is 80% of its experiments on disk, and the recipient can resume the rest. We do NOT ack the relay until the import is complete, so an interrupted download leaves the source intact for a retry within the 30-day TTL.
- **A file fails its hash.** Each file entry in the manifest carries a content hash. After decrypting a file, the recipient recomputes and compares. On mismatch (corruption in transit, a tampered object), the file is rejected, that single file is re-pulled. The chunked AEAD (`crypto_secretstream`-shape) already authenticates each chunk and detects truncation via the final tag, so a hash mismatch should be rare; the manifest hash is the belt-and-suspenders end-to-end check. Persistent mismatch after retry aborts the import with a clear error rather than writing corrupt data.
- **Quota, a project may exceed the per-user storage budget.** The free budget is 5 GB per user with a pending-share cap of 100 (settled, `CROSS_BOUNDARY_SHARING_SETTINGS.md`, to be enforced via `FREE_STORAGE_BYTES` in `frontend/src/lib/sharing/relay/limits.ts`). A large project is the first share type that can plausibly hit it. DECISION for v1, the SENDER's send is the enforcement point, before reserving the manifest row, sum the project's sealed size and reject the send up front if it would push the recipient's pending total past the budget, with a clear "this project is X GB and would exceed alex's available relay space" message. This is honest (the recipient is the one whose budget is spent, since they are the addressee) and avoids a half-uploaded project that can never complete. The budget is a RELAY-transit budget, not a local-storage budget, once imported the project lives in the recipient's own data folder and no longer counts against it. A future refinement could let the recipient pre-authorize a large incoming project, but v1 keeps it simple, fits-or-rejects at send time.
- **The recipient declines.** A reviewed-but-declined project is acked-as-declined, the relay deletes all its objects, nothing lands locally. Same as a declined note today.

---

## 8. Phasing, prerequisites, open questions

### Prerequisites (must land before the project build)

1. The experiment tier shipped (`CROSS_BOUNDARY_SHARING_EXPERIMENTS.md`), it provides the per-experiment bundle the project bundle wraps, the dependency-carry, the method-localization, and the inbox dispatch-by-type seam.
2. The shared relay constants in `frontend/src/lib/sharing/relay/limits.ts` (`FREE_STORAGE_BYTES`, the pending cap, the TTL) exist and are enforced, the quota failure mode in §7 depends on byte enforcement that does not exist today.

### Phasing

- **P1, project bundle + always-new import, single-blob transport.** Build the `researchos-project` wrapper (project envelope + multi-experiment wrapper + project-scoped dependencies), `applyProjectImportPlan` (loop the existing apply, full task-id map, project-level resolution, recreate in-project dependencies, aggregate `notCarried`), the `imported_from` provenance stamp, and the receive UX, all over the EXISTING single-sealed-blob transport. This ships project sharing for small-to-medium projects and proves the id-remap-at-scale path without the manifest machinery. Most of the genuinely new product logic lives here.
- **P2, manifest + per-file sealing for large projects.** Add the sealed manifest, the wrapped DEK, per-file sealed objects, chunked streaming encrypt/decrypt, manifest-first preview, and resumable up/download. This is the SIZE solution; it is transport plumbing, not product logic, and it is gated behind the size threshold so P1 projects are unaffected. Decide the threshold against `LARGE_EXPORT_BYTE_THRESHOLD`.
- **P3 (later, separate design), merge-into-existing.** Only after a durable cross-namespace identity and the local version-control reconcile primitives are ready (§5).

### Open questions for Grant

- **Q1, manifest threshold.** Reuse `LARGE_EXPORT_BYTE_THRESHOLD` as the single trigger for both local large-export and share-transport, or set a separate share-transport threshold tuned to the relay (e.g. anything over the Vercel-irrelevant but R2-meaningful ~50 MB)? Recommendation, reuse the one constant in v1, split later if needed.
- **Q2, quota enforcement point.** Confirm sender-side fits-or-rejects at send time (§7) is the right v1 behavior, versus a recipient pre-authorization handshake. Recommendation, sender-side reject for v1.
- **Q3, cross-experiment method dedup.** When several of a project's experiments reference the SAME method, localize it once for the whole project (one recipient-side method, all tasks point at it) or once per experiment (today's per-experiment behavior, producing duplicates)? Recommendation, dedup within a project import (cleaner library, matches user intent), as a P1 refinement if cheap, else P2.
- **Q4, funding/grant link.** A project can carry `funding_account_id`. Drop it on share (recommended, the recipient's funding accounts are a different namespace), or surface a "link to one of your grants" step on import? Recommendation, drop in v1, with the source grant NAME preserved in the provenance stamp for reference.
- **Q5, project-attached goals.** High-level goals reference `project_id`. Are they in scope for a project share, or explicitly excluded for v1? Recommendation, exclude for v1 (note them as not-carried), revisit if users ask.
- **Q6, the `imported_from` field.** Approve adding a small additive persisted field on `Project` now (FLAG, new persisted field). It is the cheap seed that future merge (P3) needs, and it powers the "Imported from X" label in v1. Building it now avoids a re-migration later.

---

## 9. Tenet check

- **End-to-end encrypted.** The manifest is sealed to the recipient; files are encrypted under a per-share DEK that is itself wrapped (sealed) to the recipient. The relay sees only ciphertext and object keys, never a key, never plaintext. Unchanged from the locked encryption model in `encryption.ts`.
- **Relay never permanently stores readable data.** Same store-and-forward, blind-mailbox, 30-day-TTL, ack-deletes model as today; the project tier just adds more objects per share, all opaque, all swept.
- **Clone-and-run-local.** Every project share ends as a real local project the recipient fully owns in their own data folder; the cloud copy is deleted on ack. No hosted project, no dependency on the relay after import.

---

## 10. Does export/import support project-level transfer today?

No, not as a project. Precisely:

- EXPORT, `exportExperiments` (`orchestrate.ts`) accepts `Task[]` and, for two or more tasks, produces a wrapper zip of intact per-experiment `{name}-raw.zip` bundles (`buildMultiZip`). So multi-experiment export EXISTS. But there is no `exportProject` that takes a `Project`, walks its task subtree as a coherent unit, carries the `Project` RECORD itself, or carries the project-scoped dependency set. The dependency-carry that exists (`collectTaskDependencies` in `extract.ts`) is PER TASK, and the multi-experiment wrapper does not dedupe or reconcile dependencies across the selected tasks.
- IMPORT, `applyImportPlan` (`apply.ts`) is strictly single-experiment, it materializes one task, resolves one project, and its `taskIdMap` has exactly one entry, so cross-task dependencies whose other endpoint is absent are dropped-and-reported (the Gap 1 behavior). The function was deliberately shaped (`remapDependencies` taking a multi-entry map) to MAKE the project tier easy, but the project-level orchestration does not exist yet.

So the project tier is a wrapping layer (project envelope on export, `applyProjectImportPlan` loop on import) plus, for large projects, the manifest transport. The hardest internal piece, composite packing with full id-remap, is already built and tested at the experiment grain; projects compose it.

---

See also `CROSS_BOUNDARY_SHARING_ROADMAP.md` (the tier sequence and the architectural decision this document settles) and `CROSS_BOUNDARY_SHARING_EXPERIMENTS.md` (the experiment foundation projects build on).
