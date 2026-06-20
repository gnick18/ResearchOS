# Class Mode + cross-folder operations: consolidated scope and build spec

Status: SCOPE (first pass), design-first, awaiting Grant sign-off per phase. Author: orchestrator lane.
House voice applies (no em-dashes, no emojis, no mid-sentence colons).

This is the single consolidated scope for two intertwined initiatives Grant asked to build out together:

1. CLASS MODE (the teaching / classroom lane). A lab head points to a SEPARATE, CONTAINED folder that is a classroom, isolated from their lab, and switches between contexts on one login. Roadmap and pilot intel locked in `docs/proposals/2026-06-17-class-mode-teaching.md` (Owen Sullivan pilot).
2. CROSS-FOLDER OPERATIONS (an all-users feature). Move, copy, send, and bulk-handle objects BETWEEN the multiple folders a single user keeps on one laptop. No prior design doc existed; scoped here from scratch.

It was produced by five parallel scoping sub-bots (folder-kind/switcher, roster, teaching tools, cross-folder, PI-bug/pricing), each file-anchored against the live codebase. Per Grant's direction the plan is: scope everything (this doc), run a SECOND design pass over all sections (the completeness critic, see the addendum at the end), then build in the phases below, parallelizing lanes that do not collide.

The load-bearing foundation already shipped and is LIVE in prod: one login can remember and switch between MULTIPLE folders, each folder carries a KIND (`RememberedFolderLabRole = "solo" | "head" | "member"`, `frontend/src/lib/file-system/indexeddb-store.ts:931`), and the lab-as-folder residency model (member keeps own folder, shared data assembles from the relay, PI co-owns a team key, E2E server-blind) is wired (`docs/handoffs/2026-06-19-multi-lab-membership-handoff.md`). Class Mode is, structurally, a fourth folder flavor with a teaching skin; almost everything it needs already exists at the data layer.

---

## Part A. Class Mode

### A0. The load-bearing reuse claim (read first)

A class is a lab. The locked residency model already gives a classroom everything it needs because the verbs are identical. An instructor is a head, a student is a member. "Shared to all students" is the existing whole-lab grant (`WHOLE_LAB_SENTINEL = "*"`, `frontend/src/lib/sharing/unified.ts:21`). "Assign a checklist to everyone" is an assigned task plus a per-task notebook. "Students see each other's data" is the assembled lab view (`pullLabView`, `frontend/src/lib/lab/lab-read.ts:135`). The only genuinely NEW primitives Class Mode adds are (a) a class-vs-lab folder flavor, (b) per-class modular tool toggles, and (c) a thin homework-submission status. Everything else is wiring an existing surface to a new label.

### A1. The class folder kind

Recommendation: add ONE new value to the existing folder role, do NOT build a parallel dimension or a separate `class_id`.

- `RememberedFolderLabRole` (`indexeddb-store.ts:931`) widens to `"solo" | "head" | "member" | "class" | "student"`. `"class"` = the instructor's own class folder (head-of-a-class). `"student"` = a managed folder a student joined (member-of-a-class). Both are additive; legacy readers already treat an absent or unknown role as `"solo"`.
- REUSE `labId` as the class id. A class IS a lab under the hood (lab key, roster, sealed envelopes), so the existing `labId` on the meta row and `lab_id` in `settings.json` already identify it. A parallel `class_id` would fork the whole lab plumbing (`getLabRemote`, `openLabKeyCopy`, dedupe-by-labId at `indexeddb-store.ts:1338`) for no benefit. `labRole === "class"` is what distinguishes a class from a research lab; the id stays one field.
- The instructor's class folder writes `account_type: "lab_head"` (so all PI machinery, sealing, roster, audit works) plus `lab_id`. To let in-folder chrome (a page deep inside the folder reads `settings.account_type` / `lab_id`, not the switcher meta) know it is a class, add ONE optional field to `UserSettings` near `lab_id` (`frontend/src/lib/settings/user-settings.ts:343`):

  ```
  lab_kind?: "lab" | "class"   // absent => research lab (today's behavior)
  ```

FLAG (data-shape): the `RememberedFolderLabRole` enum widening (idb-keyval `RememberedFolderMeta` rows) and the new `UserSettings.lab_kind` field (per-folder `settings.json`) are both stored-value changes. Both are additive, normalize-defaulted absent, and only WRITTEN when the Class Mode flag is on.

### A2. Create-a-class flow

Recommendation: managed OPFS folder, NO OS picker, mirroring the proven member-join provisioning path. The class owner is the instructor (head).

New module `frontend/src/lib/lab/provision-class-folder.ts`, sibling of `provision-member-folder.ts`:

1. Open OPFS root, `getDirectoryHandle("class-<safeLabId>", { create: true })` (new `class-` prefix, same shape as `managedMemberFolderName()`, `provision-member-folder.ts:33`).
2. Point `fileService` at the new handle, `ensureFolderStructure()`.
3. Lab genesis into this folder: `createLabLocal()` (`frontend/src/lib/lab/lab-create.ts:104`) mints labId + lab key + sealed head envelope, then queue `publishLabRemote()` retryably (as `LabCreateResume.tsx:178-185`).
4. Write per-folder identity: `patchUserSettings(username, { account_type: "lab_head", lab_id, lab_kind: "class", lab_pending_genesis })`.
5. Register the row: `rememberManagedFolder(handle, { labRole: "class", labId, labName: className })` (`indexeddb-store.ts:1324`). Dedupe-by-labId (`:1338`) handles re-entry.

UI entry: a "Create a class" action in the FolderSwitcher panel (next to "Open another folder", `FolderSwitcher.tsx:520`) and in Settings, collecting a class name and optional term. Flag-gated so it never renders today.

FLAG (decision): a class should NOT be published in the public lab directory. Recommend skipping the `publishLabRemote` directory upsert (`lab-create.ts:179`) when `lab_kind === "class"`. Confirm.

### A3. Context switcher chrome (the reskin)

- Switcher label: extend `folderLabLabel()` (`frontend/src/lib/file-system/folder-lab-label.ts:30`) so a class reads "Genetics 410 - class" and a joined class reads "Genetics 410 - student". Two-line addition before the head/member fallthrough; flag-off output byte-identical (and already only called when lab-as-folder is on, `FolderSwitcher.tsx:417`).
- The class row needs a distinct glyph (a mortarboard / graduation icon). FLAG: new Icon registry entry, requires Grant sign-off (one-glyph-per-meaning rule); do not self-approve.
- Context predicate: add `isClassFolder({ accountType, labKind })` to `frontend/src/lib/lab/lab-mode.ts` (pure), surfaced via a new `useIsClassMode()` hook modeled on `useIsLabHead` / `useIsLabMode`, reading from the same per-folder settings source `useAccountType` already subscribes to. This is where "am I in a class" lives.
- Chrome differences in `AppShell.tsx`: the role lens (`AppShell.tsx:302-307`) gains a class branch (lens label "Class" not "Lab"); the dashboard `"/"` entry label (`:289-302`) reads "Class Overview"; the nav filter (`:317`, `lib/nav.ts`) conditionally SHOWS teaching surfaces (Roster, Shared materials, Assignments, per-student notebook view) using the `SOCIAL_LAYER_ENABLED` conditional-entry pattern (`nav.ts:44`), and de-emphasizes lab-management chrome (funding, purchasing) that does not fit a classroom. The science tools (sequences, primer design, phylo, datahub, notebook, methods) STAY visible; they are the point of a CURE course.

### A4. Containment / isolation

Verdict: isolation is ALREADY GUARANTEED structurally. A class is its own OPFS folder with its own `settings.json`, `users/`, roster, and a distinct labId + lab key (`createLabLocal`, `lab-create.ts:111-116`), account-scoped (`getFolderRegistryScope`). A student sealed into the class key cannot read the personal lab, and switching to the class never mutates the lab folder. This is the same isolation that already prevents the Emile-test corruption.

Two small confirm-pass items (verify, do not assume): the two `account_type` readers at `lib/local-api.ts:5464` and `:8499` should read only the ACTIVE folder; and the switcher discovery sublabel (`FolderSwitcher.tsx:489`) should branch so a discovered class reads "Student" not "Member".

### A5. Roster onboarding (manual ships v1, LMS investigated in parallel)

Grant chose BOTH-in-parallel. The "invite by email, send a branded sign-up email, they join" loop is already built for labs; roster v1 is a bulk-and-track wrapper over it.

Existing single-invite loop reused as-is: `mintInviteForHead` (`frontend/src/lib/lab/lab-head-membership.ts:59`) -> `LabMembershipPanel.deliverInviteEmail` (`frontend/src/components/lab-head/LabMembershipPanel.tsx:393`) -> `/api/lab/invite-email/route.ts` (gates on `isSharingEnabled`, per-IP rate limit, refuses non-`/lab/join` URLs) -> Resend via `sendLabInviteEmail` (`frontend/src/lib/lab/invite-mailer.ts:106`) -> student opens link, signs in with any provider, email bound to membership (`app/lab/join/page.tsx`). Membership lands in the head-signed crypto roster (`LabRecord.members[]`, `lab-membership.ts:45`) and the Neon billing roster (`billing_lab_members`, `frontend/src/lib/billing/lab.ts:41`).

MANUAL ROSTER (v1 ship):
- Two inputs that both reduce to a deduped `{ email, displayName? }` list: an email-paste textarea (accepts commas, semicolons, newlines, and "Name <email>" paste) and a CSV upload (client-side parse, auto-detect the email column). Dedup via `canonicalizeEmail` (`frontend/src/lib/sharing/directory/email.ts`). Pre-send preview ("28 new, 2 already invited, 1 invalid").
- Fan-out: for each new entry, `mintInviteForHead` + POST `/api/lab/invite-email` (class name flows in as `labName`) + upsert a roster row. Client-side throttle the loop so the per-IP limiter (`invite-email/route.ts:60`) does not trip mid-blast; a dedicated authenticated limiter bucket is a fast follow.
- One genuinely new store: a `class_roster_entries` Neon table keyed `(lab_owner_key, email_canonical)` with `status: pending | joined | bounced | removed`, `invite_count`, `last_invited_at`, `joined_at`. Drives the pending-vs-joined roster UI and bulk "Re-invite all pending".
- Reconcile pending -> joined at the join path (`app/lab/join` / `join/route.ts:67`) by canonical-email match. Edge case: a student who signs up with a different email than invited shows as "joined (unmatched)"; v1 shows both lists and allows manual resolve, no auto-merge.

FLAG (data-shape + privacy): `class_roster_entries` stores invited student emails server-side, which breaks the current "we never store invited emails" stance (`invite-mailer.ts:41`). Deliberate, scoped to the class context; needs Grant's call on plaintext-canonical (matches the existing `billing_lab_members.label` precedent) vs peppered-hash-plus-encrypted-display.

LMS SYNC (investigation result, honest feasibility):
- The hard constraint: every live LMS roster pull (LTI Advantage NRPS, Canvas REST, Moodle web services) requires a registered server-side OAuth client / LTI tool with stored secrets, public callback endpoints, and at least one PER-INSTITUTION admin registration. ResearchOS has essentially no general backend. Full multi-institution LTI is MONTHS plus a per-campus IT relationship, disproportionate for a one-instructor pilot.
- The realization: Owen's headline ask ("sync the roster and auto-email students to sign up") is DELIVERED by the manual path the moment the CSV uploader accepts a Moodle/Canvas roster export. The auto-email-to-sign-up half (the valuable, hard part) already exists. The zero-backend "sync" is "export from the LMS, drop the file".
- Recommended phasing: Phase 1 (ship now, no backend) manual paste + CSV, explicitly documented as "drop your Moodle/Canvas CSV export here". Phase 2 (smallest live slice, post-pilot, flagged, single-site) a Moodle web-service token the instructor pastes plus a thin `/api/lms/moodle-roster` proxy holding it; needs Grant sign-off on token storage/rotation. Phase 3 (only on proven multi-institution demand) full LTI Advantage + NRPS, Canvas + Moodle.

### A6. Teaching tools

TOOL 1, SHARED CLASS MATERIALS. Map to the existing whole-lab grant: a material shared "to all students" carries the `"*"` sentinel in `shared_with`, resolved at read time by `expandSharedWith` (`unified.ts:153-176`) and already materialized to every student via the pull runner. Notes, datahub records, methods, inventory are covered with no new transport. The one real gap: raw files/images/sequences carry no ACL of their own; do NOT invent a file ACL, wrap each uploaded material in a note (or datahub deposit) carrier authored by the instructor with `shared_with: ["*"]`. Instructor UX reuses `ShareDialog`'s "Share with the whole lab" toggle (`ShareDialog.tsx:369-385`) relabeled "the whole class" via a class-mode copy switch. Add a "Class Materials" panel that filters the instructor's own records where `isWholeLabShared` (`unified.ts:248`).

FLAG (decision): sequence whole-class sharing. Sequences have no lab ACL and are excluded from the in-lab share tab (`UnifiedShareDialog.tsx:105`). Owen's primer-design demo shares sequences to the class, so v1 likely needs either a sequence ACL or routing shared sequences through a note carrier. Decision, not a silent build.

TOOL 2, ASSIGNED TASKS AS METHODS + PER-STUDENT NOTEBOOK. The instructor authors the protocol once as a method (`methodsApi.create`, `local-api.ts:2255`) with an optional `SubTask[]` checklist. The real gap: assignment is one-at-a-time today (`AssignTaskButton` / `assignTask`, `frontend/src/lib/lab/pi-actions.ts:440` reassign an EXISTING single task). Add `assignMethodToClass`, modeled on `assignTask` (same role gate, audit append, notification append) but fanning OUT: for each student in the relay roster (`getLabRemote(activeLabId).record.members` filtered to students, NOT the folder-bound `useLabData().users`), create a task in `users/<student>/tasks/<id>.json` with the method attached and the checklist copied into `sub_tasks`, set `assignee`/`owner = student`, append a notification. Each task's notebook (`users/<student>/results/task-<id>/notes.md` + `results.md`, `frontend/src/lib/tasks/results-paths.ts:20-43`) is the gradeable lab notebook, private to the student by default and visible to the instructor by team-key construction, not to peers.

FLAG (data-shape, additive nullable): recommend `Task.assignment_id?: string` + `Task.template_method_id?: number` so the instructor can group "all instances of Assignment 3" for grading and redistribution. Cheap, matches how `assignee` / `flagged` were added.

TOOL 3, SHARED VISIBILITY. This is the assembled lab view unchanged. Two separate levers: per-record sharing owned by the author (student decides private / named-classmate / whole-class, default private), and a class-level visibility POLICY owned by the instructor that sets the create-time DEFAULT for student records ("Collaborative" defaults new student records to `"*"`, the CURE default; "Private" defaults them private, the exam default). The policy seeds the initial `shared_with` at create time only, never retroactively reshares, so the author stays in control per record. The instructor can force-share or unshare any student record via the PI owner-routed write, audited.

TOOL 4, HOMEWORK UPLOAD + GRADING. DEFER the gradebook, scores, weighting, rubric math, and grade export to the LMS (Owen grades in Moodle; do not build a competing gradebook). Build only a minimal submit + review status: a submission is a state transition on the existing per-student task, not a new upload pipeline. FLAG (data-shape, additive nullable): `Task.submission?: { status: "not_submitted" | "submitted" | "returned"; submitted_at?; submitted_rev?; instructor_note? }` (same shape optionally on `Note`). `submitted_rev` pins the notebook version-history rev so "what they submitted" is fixed even if they keep editing. The instructor's class dashboard lists per-assignment submission status (relay roster joined with each student's `submission.status`), opens the notebook inline (already readable via team key), writes a freeform `instructor_note`, flips to "returned". No score stored in ResearchOS; optionally deep-link to the LMS assignment.

CURE-AWARE MODULARITY. Every CURE course differs, so tools must be modular toggles, not a fixed template. Reuse the proven `enabledMethodTypes` precedent (`user-settings.ts:494`, resolved by `frontend/src/lib/methods/method-type-enablement.ts` with the contract ABSENT = all-on, empty = all-off, unknown dropped, ALWAYS_ENABLED carve-outs). Store per-class config keyed by labId:

```
classConfig?: {
  isClass: boolean;
  courseName?: string;
  term?: string;
  enabledTools?: string[];                 // ABSENT = all on, mirrors enabledMethodTypes
  visibilityDefault?: "collaborative" | "private";
  lmsLink?: string;
}
```

FLAG (decision): config home A (instructor account-scoped settings, recommended for v1, travels cross-device, head-authored) vs B (signed relay LabRecord, needed only if students must read `visibilityDefault` at create time on their own device). Recommend A for v1, push only `visibilityDefault` toward the team-key store later if needed.

FLAG (deferred): widening the signed `LabMember.role` beyond `"head" | "member"` (`lab-membership.ts:50`). v1 reads "is this a class" from `classConfig.isClass`, not a new role. Defer `instructor` / `student` / `ta` roles until TAs need a distinct mid-tier permission.

### A7. The PI-context-lost bug (Owen pilot)

Verdict: NOT a JSON-corruption bug, and the shipped lab-as-folder work does NOT cover it. It is structural. Owen connected a brand-new EMPTY Google Drive folder with no `settings.json`, so `account_type` resolved to its default `"member"` (`DEFAULT_SETTINGS.account_type = "member"`, `user-settings.ts:546`; `normalize()` merge at `:582`), rendering individual chrome. His name survived (a different, account-scoped source); `account_type` and `lab_id` are folder-local and absent in the new folder, so PI context vanished. `account_type: "lab_head"` is only ever written by explicit promotion (`LabCreateResume.tsx:131,183`; `settings/page.tsx:1317`; `dev-lab`), never re-derived on folder connect. The multi-folder foundation makes this MORE likely, because a PI now routinely lands in folders that were never promoted.

Fix direction (all additive, no schema change; for Grant to approve):
1. Stopgap now: a banner on a folder that has no `lab_id` but whose signed-in account is a known lab head, linking to the Settings account-type toggle (respects no-soft-locks, unblocks Owen today).
2. Durable: on connect, if the remembered-folder `labRole === "head"`/`"class"`, seed `account_type` (and `lab_id` from the cached `labId`) into the freshly connected folder when its `settings.json` is absent (reuses IndexedDB metadata the store already holds).
3. New-folder case: if the identity is the head of a live lab DO, offer "make this your lab folder" with an explicit confirmation so we never silently re-PI a folder the user meant to keep personal.

### A8. Pricing (Grant decides; framing only)

The tension: Model A meters usage, but education buyers expect a flat, seasonal, PO-friendly per-class or per-seat rate; students are many low-usage seats and the instructor (or department) is the single payer; FERPA/edu-data expectations lean flat and institutional. Options: (A) ride inside the Lab tier (fastest, matches the multi-folder foundation, but mis-prices the student-burst shape and gives the highest-effort feature away free), (B) Department/Institution feature (governance and one invoice fit, but still per-lab metered and gates the wedge behind the slowest sale), (C) a dedicated flat education SKU (matches the buyer and the Benchling-competitor target, but is net-new billing work in a deliberately metered system). Recommended sequence: run the pilot under Lab (A) at zero pricing work while explicitly NOT committing the long-term price, then introduce a flat education SKU (C) once the feature set firms. The live question is flat-included-usage vs metered, more than which tier label it sits under.

---

## Part B. Cross-folder operations (all users: move / copy / send / bulk)

### B0. The one architectural fact that shapes everything

`fileService` is a module singleton bound to exactly ONE `directoryHandle` (`frontend/src/lib/file-system/file-service.ts:24-44`). Every `JsonStore`, every `local-api.ts` API, every attachment read/write resolves against that one handle. Folder switching works by REBINDING the singleton (`setDirectoryHandle`, called from `switchFolder` at `file-system-context.tsx:1600`). There is no "write to folder B" parameter in the data layer.

Two strategies. Strategy A (handle-direct): keep `fileService` on the source folder and write into the destination through a SECOND, explicitly-passed handle from `getRememberedFolderHandle(id)` (`indexeddb-store.ts:1230`), via a destination-scoped writer. Strategy B (serialize-then-switch): serialize in A, switch the singleton to B, materialize, switch back, delete. RECOMMENDATION: Strategy A, because the collect/materialize seam is already cleanly factored (below) and the only missing piece is a destination-scoped write target. Strategy B is the fallback.

FLAG (infra, highest risk): Strategy A needs `JsonStore` + attachment writes against a non-active handle. The cleanest seam is a second `FileService` instance (the class is exported, `file-service.ts:24`; only the singleton at `:795` is shared). Counters (`json-store.ts:34-96`) and `getCurrentUserCached` (`:21-28`) are also active-folder singletons, so the destination writer must read/write counters by explicit path and NOT through the cached current-user.

### B1. Reuse the existing collect/materialize seam

The relay send path already solves the hard part and factors cleanly into COLLECT and MATERIALIZE:
- COLLECT: `buildNoteBundleInput` (`frontend/src/lib/sharing/note-transfer.ts:179`), `buildMethodSendPayload` (`method-transfer.ts`), `buildProjectSendPayload` (`project-transfer.ts:94`) read the entity plus attachments and strip all account-scoped/local fields (`sanitizeNoteEntity`, `note-transfer.ts:121-157`).
- MATERIALIZE: `importNoteBundle` (`note-transfer.ts:268`) RE-IDs into the destination id space via `*.create` (fresh per-user id from `_counters.json`, `json-store.ts:275-294`), writes attachments under the new id's `Images/` folder with identical filenames so markdown links stay valid with zero rewriting (`note-transfer.ts:394-402`), and re-resolves embedded-object cross-references with dedup-by-portableId (`embedded-object-import.ts:378`).

Cross-folder COPY = `collect(object, sourceFolder)` then `materialize(bundle, destFolder)`, the only novelty being a destination HANDLE instead of the active folder and no relay/encryption hop (local disk-to-disk). New file `frontend/src/lib/transfer/local-folder-transfer.ts` holds `copyObjectToFolder(target, destFolderId, mode)`.

### B2. Move vs copy semantics

COPY: collect in source, materialize into destination (fresh destination-space id, re-stamped username, copied attachment binaries, embedded objects deduped-by-portableId so an object already present in the destination is LINKED not duplicated, `embedded-object-import.ts:432-450`). Source untouched.

MOVE = COPY then delete source, with strict ordering: collect, materialize, AWAIT full resolve (the importers are ack-after-write, `note-transfer.ts:32-37`), THEN delete the source record and its attachment folder, trash-not-hard-delete where a reachable trash path exists (memory: trash-not-delete). A failure before the delete leaves the source intact (no-op).

References that do not travel (match the existing shipped relay behavior, do not silently re-point): a note's embedded objects travel inside the bundle and dedupe/link in the destination; `Images/` binaries travel; but a single task's deps (task->task), a single task's method reference, and compound-method children do NOT come along and become dangling/placeholder refs the UI already tolerates (`note-transfer.ts:444-447`, unresolvable `taskKey` at `types.ts:792-796`). A project copy DOES carry its native experiments as a closure (`buildProjectSendPayload`, `project-transfer.ts:65-72`). Surface a one-line "N linked items will not move, they will show as unavailable in <folder>" so a move is never silent data loss; reuse `NoteDependencyPanel` (`frontend/src/components/sharing/NoteDependencyPanel.tsx`) for the selection UI.

### B3. Send via the existing export rails

Grant's instruction: cross-folder SEND extends the existing "Send to..." machinery, not a parallel system. It is the same pipeline with the relay hop removed: reuse the per-type COLLECT builders unchanged, replace `sendShare -> relay -> inbox -> import` with a direct local `materializeIntoFolder(bundle, destHandle)`. No encryption, no email, no recipient lookup, because both folders are on the same disk under the same account; the relay exists to cross a trust/network boundary and there is none here. Surface it as the "Another folder of mine" destination inside the same Share dialog, sibling to "Send to a person" (the seamless-export vision).

### B4. UI entry points

- A third tab in `UnifiedShareDialog.tsx` (`:179-198`), "Another folder of mine", shown only when `listRememberedFolders()` returns more than one folder (no dead empty state).
- Right-click / row context menu "Copy to folder..." and "Move to folder..." on existing object affordances, and in the bulk selection action bar.
- A new shared `FolderDestinationPicker`: lists remembered folders (cached `name` + `labRole`/`labName` labels, no need to open each), excludes the active folder, resolves the destination handle via `getRememberedFolderHandle(id)` and requests `readwrite` permission from the user-gesture click (FSA requires a gesture, the picker click qualifies). Denied permission shows an inline retry, never a dead end.
- Command-palette entry deferred to a later phase.

### B5. Bulk / multi-select

Precedent exists (`BulkSequenceSendDialog.tsx`). Each list gets a selection mode with a floating action bar offering "Copy to folder..." / "Move to folder...". Selection can be heterogeneous (notes + methods + tasks); a type-agnostic picker, a per-item dispatching executor `bulkTransfer(items[], destFolderId, mode)` that resolves the destination handle ONCE (single permission prompt), iterates items sequentially (so intra-batch embedded-object dedup works against the destination's live state), and reports per-item success/failure. Dependency-bearing batches write in dependency order (methods, then projects, then notes/tasks; full topological sort is a later refinement). Ship bulk COPY before bulk MOVE.

### B6. Conflict, safety, partial failure, undo

Id collisions cannot happen (every materialize allocates a fresh destination id; the source id is dropped in sanitize). Attachment filename collisions cannot happen (each object's attachments live under its own fresh-id folder). MOVE ordering is mandatory (verified destination write before any source delete). Bulk partial failure is per-item transactional (copy-then-delete per item); failed items stay in the source, reported as "Moved 7 of 9". Confirmation: light for copy (non-destructive) with the not-traveling-refs note, stronger for move (names destination + count + warning). Undo: copy needs none; move undo = trash-not-hard-delete on the source plus delete the destination copy, where a reachable trash path exists, else a stronger "cannot be undone" confirm and defer move for that type. No cross-session locking in v1 (accept the same race window folder-switch already has; append-only counter bumps are the lowest-collision write).

### B7. Cross-folder open questions (Grant)

- Q1 destination user identity: when copying into a multi-user folder B, does the object land under B's last-active user (simplest v1) or must the user pick a destination user? The materialize path stamps `username` from the destination's current user (`note-transfer.ts:374`).
- Q2 (FLAG infra): confirm a second `FileService` instance can be stood up cleanly (Strategy A) or accept Strategy B's switch-materialize-switch-back UX cost for v1.
- Q3: which entity types have a reachable trash/restore path, which gates the MOVE undo promise.
- Q4: local path produces+verifies the BagIt bundle (integrity, slower) vs hands the in-memory `BuildBundleInput` straight to a destination importer (faster). Recommend in-memory for the local case.

---

## Consolidated phased build plan (parallelizable lanes)

The two parts are largely independent and can run as parallel lanes. Within Class Mode, the data/chrome spine must land before the teaching tools. Cross-folder is its own self-contained lane. Roster manual-v1 is independent of the teaching tools. The residency seal-at-scale dependency (below) gates the STUDENT-SIDE lightup of teaching Tools 1 and 3, not their instructor-side build.

Lane 1, Class Mode spine (sequential foundation):
- CM-P1 data + types, flag-gated, no UI: widen `RememberedFolderLabRole`, add `UserSettings.lab_kind`, add `classConfig`, add `isClassFolder` to `lab-mode.ts`, add `class-mode-config.ts` (`NEXT_PUBLIC_CLASS_MODE`). FLAG all data-shape touches.
- CM-P2 provisioner: `provision-class-folder.ts` reusing `createLabLocal` + `rememberManagedFolder` + `patchUserSettings`, unit-tested with injected fakes.
- CM-P3 switcher chrome: extend `folderLabLabel`, the class glyph (Grant sign-off), the discovery sublabel branch, the "Create a class" action.
- CM-P4 reskin: `useIsClassMode`, AppShell lens + dashboard-label + conditional teaching nav, the modular-tool-toggle spine (`enabledTools`).

Lane 2, Class Mode teaching tools (after CM-P4; Tools 1 and 3 student-side gated on the seal dependency):
- CT-1 shared materials (whole-lab grant relabel + Class Materials panel + the sequence-carrier decision).
- CT-2 assign-to-class + per-student notebook (`assignMethodToClass` fan-out, roster-sourced; optional grouping fields).
- CT-3 shared-visibility policy (create-time `visibilityDefault` + instructor force-share).
- CT-4 submit + review (`Task.submission` + instructor status dashboard; grading stays in the LMS).

Lane 3, Roster (parallel to Lanes 1-2 once CM-P1 lands):
- R-1 manual roster (paste + CSV + `class_roster_entries` + fan-out + reconcile). FLAG the email-storage decision.
- R-2 (post-pilot, flagged) Moodle-token single-site live slice.
- R-3 (demand-gated) full LTI/NRPS.

Lane 4, Cross-folder operations (fully independent, can start immediately):
- CF-P1 smallest safe v1: COPY ONE NOTE to another folder (the destination-scoped writer is the load-bearing new infra, FLAG; `FolderDestinationPicker`; the "Another folder of mine" tab, copy-only).
- CF-P2 MOVE (single) + remaining single types (methods non-compound, sequences, experiments, purchases) + right-click entries.
- CF-P3 bulk multi-select + project-as-closure + dependency-ordered batches + the not-traveling-refs panel.

Lane 5, PI-context bug (independent, unblocks the live pilot, do early):
- PI-1 stopgap banner (recoverable mismatch).
- PI-2 durable seed-from-labRole-on-connect + the new-folder confirmation prompt.

Hard dependency (residency lane, not a Class-Mode build item but Class Mode is its forcing function): seal-on-approval / bulk reseal. The deferred-seal stranding ("The lab head has not finished adding you yet", `lab-member-activation.ts`) and the missing relay-membership discovery (chip `task_0754f33b`) block student-side lightup at class scale. A 30-student class cannot have the instructor manually reopen-to-seal each student. This must land before a real classroom demo of Tools 1 and 3.

---

## Data-shape FLAG register (every stored-value touch)

1. `RememberedFolderLabRole` enum widening (`+ "class" | "student"`), idb-keyval meta. Additive, flag-gated writer.
2. `UserSettings.lab_kind?: "lab" | "class"`, per-folder settings.json. Additive nullable.
3. `UserSettings.classConfig?` object (home A) keyed by labId. Additive nullable; mirrors `enabledMethodTypes`.
4. `Task.assignment_id?` + `Task.template_method_id?` (assignment grouping). Additive nullable.
5. `Task.submission?` object (and optionally `Note.submission?`). Additive nullable.
6. `class_roster_entries` new Neon table storing invited student emails server-side. Breaks the never-store-invited-emails stance; PRIVACY decision (plaintext-canonical vs hashed+encrypted).
7. New write action `assignMethodToClass` (no schema of its own; fans out existing-shape task records into each student folder).
8. Cross-folder destination-scoped writer (second `FileService` instance / non-active counters). Infra, highest-risk seam.
9. `class_dashboard` lab-wide-public relay record (CT-5, curated-Workbench template, E2E under team key) + the `isLabWidePublic` read extension at `lab-read.ts:208`. Force-only v1.
10. FOLLOW-UP from the Stage-1 class-spine build (claude/class-data-spine): the reload-time `LabGenesisPublishRetry` path republishes from `lab_pending_genesis` WITHOUT `suppressDirectory`, so a class whose genesis publish only lands on a later reload could still create a public directory row. Fix = thread a class/suppress marker into `PendingLabGenesis` so the retry passes `suppressDirectory`. Data-shape touch on `PendingLabGenesis`, deferred to a separate stage.

## Open decisions for Grant (consolidated)

- Class glyph: approve a new mortarboard Icon (one-glyph-per-meaning).
- Class directory listing: confirm classes are NOT published to the public lab directory.
- Roster email storage: plaintext-canonical vs hashed+encrypted in `class_roster_entries`.
- Sequence whole-class sharing: add a sequence ACL vs route shared sequences through a note carrier (needed if v1 must share sequences, which Owen's primer demo implies).
- classConfig home: A (instructor settings, recommended) vs B (signed relay record).
- LabMember.role widening: defer (v1 uses the class flag) vs build instructor/student/ta now.
- Pricing: Lab tier (A) for the pilot now, education SKU (C) later, or commit to a SKU up front.
- Cross-folder Strategy A (second FileService) vs B (switch-materialize-switch-back) for v1.
- Cross-folder destination user identity (Q1) and the BagIt-vs-in-memory local path (Q4).
- Sequencing: confirm the five lanes and which run in parallel now vs hold for the seal-at-scale dependency.

---

## Second design pass (addendum, reconciled)

Three adversarial critics (residency/crypto/safety, completeness/missed-surfaces, build-feasibility/sequencing) ran over the first-pass scope above. They returned `complete=false` with several CRITICAL findings that change the build. The throughline: the first-pass "a class is a lab, almost everything already exists" claim is true at the DATA-GENESIS layer and FALSE at the member READ/WRITE layer. The same `pullLabView` + relay-roster wiring the multi-lab spec lists as UNBUILT is the exact substrate every student-facing class tool needs. The sections above stand as the design intent; the corrections below OVERRIDE them where they conflict, and the revised plan at the very end supersedes the first-pass phased plan.

### CRITICAL findings (block the build as first-drafted)

C1. The whole-class share `"*"` does NOT resolve for students. A0 and A6 anchor Tools 1 and 3 on `WHOLE_LAB_SENTINEL` being expanded at read time. It is not. The member read path `pullLabView` gates through `recordSharedWith` (`lab-read.ts:81-100`), an EXACT username match with zero `"*"` handling. `expandSharedWith` (`unified.ts:153-176`) is the only expander, requires an `allLabUsernames` array, and is never called in any lab read path. A whole-class note is therefore invisible to every student. CORRECTIVE: a real build step must wire `pullLabView` to expand `"*"` against `getLabRemote(activeLabId).record.members` before any student-side lightup. This is genuinely UNBUILT, not a relabel, and it gates Tools 1 and 3.

C2. `assignMethodToClass` as drafted cannot work and self-destructs. Tool 2 says the instructor writes a task into `users/<student>/tasks/<id>.json`. Under residency the student keeps their OWN folder and has no subdir on the instructor's disk, so `tasksStore.updateForUser` against the singleton handle (`json-store.ts:214-241`) targets a directory that does not exist. The only path that reaches the student is a relay write under `owner = <student>`, but (a) the relay authorizes by roster membership only and does NOT bind `owner == signer` (`relay/src/worker.ts:3472-3475`), so this is an un-audited cross-owner write, and (b) on the student's next `runLabSyncForSession` the student's manifest does not contain that key, so the student's own sync TOMBSTONE-DELETES the instructor's assignment (`lab-sync.ts:257-303`). CORRECTIVE: re-author an assignment as an INSTRUCTOR-OWNED shared record (under the instructor's own owner-prefix, `shared_with: ["*"]` or per-student), exactly like the Tool 1 carrier the doc gets right. The per-student notebook is a SEPARATE student-owned record the student creates on first open, linked by `assignment_id`, never a file the head writes into the student's space. Adopt the invariant: no actor ever authors a record under another user's owner-prefix.

C3. Student notebooks are NOT cryptographically private from classmates (FERPA-grade hole). Every lab member holds the single class team key (`lab-read.ts:5-10` says so explicitly), and `GET /lab/data/get` is open at the transport (`worker.ts:3489-3507`). The `shared_with` gate in `pullLabView` is a client-side INTENT filter, not access control. So a student can fetch and decrypt any classmate's "private" exam notebook with a few lines of code. The "Private" visibility default (Tool 3) is a UI default that does NOT deliver cryptographic privacy. CORRECTIVE: either (a) encrypt per-student private notebooks under a per-student subkey held only by the student and the instructor (PI co-owner), not the class team key, or (b) state honestly that nothing a student writes is cryptographically private from classmates and FORBID Class Mode for graded/exam use until (a) ships. This is the single most dangerous claim in the scope and is a Grant decision.

C4. Cross-folder Strategy A is a multi-week store refactor, not "one missing writer." `JsonStore`, the counters, and `getCurrentUserCached` all import and resolve against the module SINGLETON (`json-store.ts:1,19-28,46-89`); `importNoteBundle` writes through both `notesApi.create` and direct singleton calls and hard-codes `username: getCurrentUser()` (`note-transfer.ts:374`), with no destination parameter anywhere. Strategy A requires threading a FileService instance + counters instance + destination-username through every store. CORRECTIVE: adopt Strategy B (serialize in source, `setDirectoryHandle(dest)`, run the existing materialize unchanged, switch back, delete) for v1; it reuses 100 percent of the import path and is a week not a month. Strategy B needs an offscreen switch guard, because swapping the singleton mid-operation tears down `negativeCache` + `inFlightReads` (`file-service.ts:38-39`) and flickers the live UI. Strategy A becomes a later "true two-handle" phase only if the switch UX proves unacceptable. This means CF is NOT "start immediately"; it is blocked on the strategy decision, and CF-P1 is the LEAST independently-startable lane, the opposite of the first-pass claim.

C5. The invite rate limiter caps a class at 10 invites per IP per day. `ratelimit.ts:152-160` is `slidingWindow(10, "86400 s")` keyed by IP (`invite-email/route.ts:59-60`). Behind a university NAT, one instructor sends 10/day, so 30 students take 3 days and 200 take 20 days. CORRECTIVE: the authenticated per-PI limiter bucket must ship WITH roster v1, not as a fast-follow, or the headline manual-roster feature cannot complete its first run.

C6. Student-side Class Mode is HARD-BLOCKED on multi-lab P2/P3 + seal-at-scale, so Class Mode is sequenced BEHIND multi-lab, not parallel to it. The seal stranding (`lab-member-activation.ts:100-106`, "the lab head has not finished adding you yet") is opportunistic-only (`reconcileDeferredSeals` runs when the head reopens the lab, `lab-session-effects.ts:358`); there is no seal-on-finalize or bulk reseal. A 30-student class cannot be sealed by hand. Additionally the dozen member-facing identity surfaces the multi-lab critic listed (`CommentsThread`, `MentionPicker`, `AttributionChip`, `useUserColorMap`, AI member tools, version-history actor labels, `UserAvatar`, etc., multi-lab-build-spec.md:211-224) are still unbuilt and render every co-student wrong at scale. CORRECTIVE: build eager bulk-seal before scheduling any classroom demo, and state that Class Mode student lightup depends on multi-lab P2/P3 landing.

C7. Cross-folder destinations that are JOINED-lab member folders leak private data. A `labRole === "member"` folder pushes its contents to the team-key mirror (`lab-sync.ts:193`), so copying a private note INTO it lets the PI of a lab you merely joined read it; MOVING an object OUT leaves the R2 blob un-tombstoned (default `tombstoneRemoved = false`), desyncing the mirror. CORRECTIVE: `FolderDestinationPicker` must exclude or hard-warn `labRole === "member"` destinations; this residency rule belongs in the spec, which only reasoned about folders "you own."

### HIGH findings (must fold in before the affected phase)

H1. `account_type === "lab_head"` is a hard ROUTE gate in many pages, so an AppShell-only reskin is insufficient. A class head would see research-lab chrome at `/lab-overview` (`page.tsx:22-72`), `/people`, `/approvals`, `/funding`, `/lab-work`, `/activity`, `/lab-notes`, `/lab-experiments`, plus `purchases`, `supplies`, `search`, `methods`, `gantt`, and `page-landing-redirect.ts`. CORRECTIVE: enumerate every `useAccountType` / `useIsLabHead` consumer and route each through `useIsClassMode`, or accept that a class head sees the research app.

H2. The BeakerBot PI copilot is lab-head-gated and research-framed. `LabHeadCopilotMount.tsx:22-53` mounts for any `lab_head`, and the 18-tool suite (`lib/ai/tools/lab-head.ts`) is grant/RPPR/inventory framed. A class instructor gets grant-rollup tools, not roster/assignment/submission tools. CORRECTIVE: suppress the PI tool suite under `lab_kind === "class"` or author a class-scoped tool subset. Build item, omitted by the first pass.

H3. `class_roster_entries` plaintext email MISREPRESENTS the `billing_lab_members` precedent. That table stores only the peppered owner-key HASH, never the address (`billing/lab.ts:8`); its `label` is a non-indexed display string keyed by the hash, not a canonical primary key. The product posture is "we never store invited emails" (`invite-mailer.ts:41`). CORRECTIVE: default `class_roster_entries` to a hashed key plus an encrypted display blob; correct the false precedent framing before Grant signs off. Blast radius of a plaintext leak is a class-keyed directory of student emails.

H4. The instructor OPFS class folder is NOT durable. The head push mirrors only the active user's OWN records and is size-gated (`lab-sync-runner.ts:157,166-184`), and OPFS is browser-evictable. A teacher who never connected a real disk folder can lose a semester on a "clear site data" or storage-pressure eviction; the first-pass "relay is the durable copy" framing is false for the head role. CORRECTIVE: require `navigator.storage.persist()` on class provisioning and surface its grant state; require either a real on-disk (FSA) backing folder or a forced heavy-inclusive R2 mirror before the OPFS class folder is the sole copy; call out the member-vs-head durability asymmetry.

H5. `visibilityDefault` (Tool 3) cannot reach the student device under config home A. The student's own device seeds `shared_with` at create time and cannot read the instructor's account-scoped settings. CORRECTIVE: commit `visibilityDefault` to the signed relay record (home B); home A breaks its own tool.

H6. Lane collisions on contended files. `FolderSwitcher.tsx` is touched by CM-P3, CF, the membership-discovery chip `task_0754f33b`, AND the unmerged mascot branch (`feat/welcome-mascot-canonical`, handoff:101-104). `AppShell.tsx` is contended with the unmerged require-account branch. `lib/nav.ts`, `user-settings.ts`, `indexeddb-store.ts`, `UnifiedShareDialog.tsx` are multi-lane. CORRECTIVE: declare FILE OWNERSHIP, not lane parallelism. Land the mascot branch first to clear `FolderSwitcher.tsx`; land CM-P1 (pure data/types) as a shared prerequisite; give ONE lane a single combined PR for the `FolderSwitcher` edits (Create-a-class + Another-folder-of-mine); `AppShell` waits on the require-account go-live call.

H7. Three flags, not one stack. Cross-folder is an all-users feature and must NOT sit behind `NEXT_PUBLIC_CLASS_MODE`. CORRECTIVE: `LAB_AS_FOLDER` (live) owns the registry/switcher; a new `NEXT_PUBLIC_CROSS_FOLDER` owns the destination writer + share-dialog tab; `NEXT_PUBLIC_CLASS_MODE` owns only teaching chrome + provisioner + classConfig. The `RememberedFolderLabRole` enum WRITERS gate on CLASS_MODE; the READERS must default unknown roles to solo regardless of any flag (test with class mode OFF and a class row present).

H8. End-of-term lifecycle is a whole missing lane. No class/lab archive concept exists; `forgetRememberedFolder` does NOT delete OPFS data (`indexeddb-store.ts:1406-1420`), so dropped-student and finished-class folders accumulate forever; there is no term boundary; and reusing one `labId` across terms would collapse switcher rows (dedupe-by-labId, `:1336-1340`). CORRECTIVE: spec drop/add mid-term, never-signed-up students, a student in two of the instructor's classes or in both the lab and a class, end-of-term archival, and shell reuse. Forbid `labId` reuse across terms or use a composite key.

### MEDIUM findings (fold into the relevant phase)

M1. Provisioner ordering invariant. `setActiveHandle` is the point of no return (`provision-member-folder.ts:143`); everything folder-local must follow it; the pure `createLabLocal` can run anytime. A reorder that calls `patchUserSettings` before `setActiveHandle` writes class identity into the WRONG folder (the Emile-test corruption class). Pin the order in the CM-P2 spec and add a unit test asserting the source folder's `settings.json` is byte-unchanged after a class provision (the in-memory FSA mock supports it).

M2. Cross-folder has NO transfer builder for many types. Builders exist only for note, method, experiment/task, sequence, project (and calculator). MISSING: purchases/purchase_items (the first-pass "purchases travel" claim is FALSE), inventory_items, inventory_stocks, PCR protocols, goals/weekly goals, calendar events, figures, standalone inbox images, one-on-ones/check-ins/IDPs. Phylo trees and big-table datasets are explicitly DEFERRED in the embedded collector. CORRECTIVE: publish an EXISTS/MISSING table and make the picker REFUSE types with no transfer path rather than silently no-op them.

M3. MOVE delete primitive must be the per-entity trashing API, not raw `deleteFile`. A real soft-delete trash path exists for nearly all move-target types (`_trash/<type>/` dispatcher, `local-api.ts:392-399`), so the undo promise mostly holds, but the migration-grade `trashFile` is a separate path and a raw delete hard-deletes. Also the cross-owner delete gate (`local-api.ts:358-384`) can refuse a non-owner delete and leave a silent duplicate. CORRECTIVE: name the trashing API the executor calls, and require it verify the source delete returned non-null before reporting "moved."

M4. Scale mechanics do not hold at 30-to-200 students. Key rotation on departure is O(N) per student / O(N^2) per term turnover (`lab-key.ts:311-372`); billing reconcile is O(N) sequential and risks route timeout (`billing/lab.ts:329-345`, `reconcile/route.ts:69-85`); roster UI lists are non-virtualized everywhere (`LabMembershipPanel`, `PeoplePage`, `LabRoster`, the `AssignTaskButton` select); the signed lab log embeds the FULL roster in every entry (`lab-membership.ts:88,135`), ~30-40 KB per entry at 200 members, unbounded. CORRECTIVE: batched-rotation, fan-out reconcile, virtualized lists, and a log-size strategy are prerequisites for a real class, not pricing-section afterthoughts.

M5. PI-context seed-on-connect needs a membership check. A cached `labRole`/`labId` does not prove the account is the head. CORRECTIVE: open the lab DO and confirm the account is `record.head` before writing `account_type: "lab_head"`, else risk re-PI-ing a folder the user meant to keep personal (the exact bug A7 fixes).

M6. Pending-invite expiry. The relay roster holds only joined members, so `class_roster_entries` pending rows never evict. Add a TTL.

### What the first pass got RIGHT (confirmed by the critics)

Tool 1 whole-class materials as an instructor-owned `shared_with: ["*"]` carrier is residency-correct in INTENT (pending the C1 `"*"` expansion wiring). Containment/isolation (A4) is genuinely structural. The `stripIdpForMirror` precedent is the right model for per-record privacy. Trash reachability for MOVE undo is real. CM-P1 (data + types) is genuinely the smallest, UI-free, flag-safe phase. The class provisioner (CM-P2) is unit-testable TODAY with the existing fake-handle infra (`provision-member-folder.test.ts`, `file-service-atomic.test.ts`), and is the one lane that can truly start immediately. `createLabLocal` is pure and safe to reuse.

### REVISED build plan (supersedes the first-pass phased plan)

Ordering principle: the data-genesis spine is buildable now; everything student-facing is sequenced behind the multi-lab read/write substrate and the crypto-privacy decision. Cross-folder is independent of class but blocked on the Strategy-B decision.

Stage 0, prerequisites (clear the decks):
- Decide Strategy B for cross-folder v1 (C4). Decide the student-notebook crypto privacy approach (C3, Grant). Decide roster email storage = hashed (H3, Grant).
- Land the mascot branch to clear `FolderSwitcher.tsx` (H6).
- Confirm the multi-lab P2/P3 substrate state and the seal-at-scale work as the gating dependency (C6).

Stage 1, Class Mode data spine (buildable now, no student dependency):
- CM-P1 data + types behind `NEXT_PUBLIC_CLASS_MODE` (enum widen with normalize-default in the SAME PR, `lab_kind`, `classConfig`, `isClassFolder`). Enum readers default-to-solo regardless of flag.
- CM-P2 `provision-class-folder.ts` with the M1 ordering invariant + the source-unchanged test + `navigator.storage.persist()` (H4).
- CF (cross-folder) Stage-1 in parallel under `NEXT_PUBLIC_CROSS_FOLDER`: Strategy-B copy-one-note with the offscreen switch guard, the EXISTS/MISSING type table (M2), the member-folder destination exclusion (C7), the trashing-delete + verify (M3).
- PI-1 stopgap banner + PI-2 seed-on-connect with the membership check (M5). Independent, do early.

Stage 2, Class Mode chrome (single-owner contended-file PR):
- Combined `FolderSwitcher` PR (Create-a-class + Another-folder-of-mine), the class glyph (Grant sign-off), the discovery sublabel.
- `useIsClassMode` plus the FULL `account_type`/`isLabHead` consumer sweep (H1), not just AppShell; BeakerBot class-tool decision (H2). Waits on the require-account go-live call for AppShell.

Stage 3, Class Mode teaching tools (gated on the multi-lab substrate + crypto decision):
- The `"*"` expansion wiring in `pullLabView` (C1) is the prerequisite for all of these.
- CT-1 shared materials; CT-2 assignment as an instructor-owned shared record + student-owned notebook linked by `assignment_id` (C2); CT-3 visibility policy with `visibilityDefault` on the relay record (H5); CT-4 submit + review (grading stays in the LMS).

Stage 4, Roster + scale + lifecycle:
- R-1 manual roster WITH the authenticated per-PI invite limiter (C5) and hashed `class_roster_entries` + TTL (H3, M6).
- Scale hardening (M4) and the end-of-term lifecycle lane (H8) before a real multi-student class.
- R-2 Moodle-token live slice and R-3 LTI remain demand-gated and unchanged.

Stage 5, cross-folder breadth:
- CF MOVE, bulk/multi-select, the missing transfer builders (M2), Strategy A only if the Strategy-B switch UX proves unacceptable.

### Decisions this addendum routes to Grant (new, on top of the first-pass open-decisions list)

- Student-notebook privacy (C3): ship per-student subkeys, or restrict Class Mode to non-graded/non-private use until they exist. This is the gating product-safety call.
- Cross-folder Strategy B for v1 (C4): confirm the switch-materialize-switch-back approach with an offscreen guard, deferring the Strategy-A store refactor.
- Class Mode sequenced BEHIND multi-lab P2/P3 + seal-at-scale (C6): confirm the dependency order, since it means the student-facing demo waits on that lane.
- Roster email storage hashed not plaintext (H3), and the authenticated invite limiter shipping with roster v1 (C5).

### GRANT DECISIONS (2026-06-19, these resolve the gating forks)

- Student-notebook privacy: BUILD PER-STUDENT SUBKEYS (C3). Each student's private notebook is encrypted under a subkey held only by that student and the instructor (PI co-owner), not the class team key. This is a real crypto build and is the prerequisite for any graded/private student work. It lands in the teaching-tools stage, not Stage 1.
- Cross-folder: STRATEGY A (C4 overridden). Grant chose the true two-handle implementation, so the store layer (`JsonStore`, counters, current-user) is refactored to accept a destination `FileService` instance + explicit username, ADDITIVE and backward-compatible so every existing caller stays byte-identical and the module singleton path is unchanged. This is the load-bearing refactor and the cross-folder lane owns it.
- Sequencing: Class Mode stays FULLY behind `NEXT_PUBLIC_CLASS_MODE`, off, until the entire feature (including the multi-lab substrate dependencies and per-student subkeys) is finished. No half-shipping; we build it all behind the flag and flip once complete.
- Roster email storage hashed not plaintext (H3) and the authenticated invite limiter with roster v1 (C5) stand as accepted.

Stage 1 (buildable now, all flag-gated, all independent): the class data spine + provisioner (CM-P1 + CM-P2 behind CLASS_MODE), the PI-context-lost fix (banner + validated seed-on-connect), and the cross-folder Strategy-A store-layer refactor + copy-one-note (behind CROSS_FOLDER).

### Scope refinements (Grant, 2026-06-19, post-second-pass)

REFINEMENT 1, the multi-folder substrate is ACCOUNT-AGNOSTIC, not lab-head-only. A SOLO user can hold multiple folders the same way a lab head can, of mixed kinds. One folder might be a class they teach, another their undergrad research lab, another a personal solo workspace. This is already structurally supported (the folder switcher is gated only by `MULTI_FOLDER_ENABLED`, not by `account_type`, `FolderSwitcher.tsx:113,125,238`, and `account_type` is per-folder, so a class folder makes you the head OF THAT CLASS regardless of your other folders). The build implication: class CREATION and the "Create a class" affordance must be offered to ANY account, NOT gated behind being a research lab head. A solo user creating a class gets a class folder where they are the instructor/head while their other folders stay solo. The `useIsClassMode` predicate and the create path must read per-folder, never require a research-lab-head account. This is a Stage 2 (chrome/create-affordance) constraint; the Stage 1 provisioner already writes `account_type: "lab_head"` into the new class folder regardless of the source folder, so it is compatible.

REFINEMENT 2, the classroom head sets what all students' dashboards look like (NEW teaching tool, CT-5). The instructor authors a class dashboard template once and it becomes every student's dashboard in that class, as a forced lock or a customizable seed at the instructor's choice (CURE-modularity philosophy).

GRANT DECISION (2026-06-19): "dashboard" ALWAYS means the curated Workbench (Option A below), never the widget grid. V1 is FORCE-ONLY (instructor sets it, students get exactly that, no per-student customization), which defers the student customization store + apply-banner entirely. The `class_dashboard` relay-record transport and the `isLabWidePublic` extension below stand.

CRITICAL grounding finding: the drag-and-drop widget-grid dashboard was DELIBERATELY TORN DOWN (`Widget-framework teardown v2`, 2026-06-02). There is no live customizable widget canvas. `app/page.tsx` is now a pure router (`lab_head` -> `/lab-overview`, everyone else -> `/workbench`); `LabOverviewPage.tsx` is a hardcoded layout, not a grid; the `dashboard_layout` / `enabledWidgets` settings shape is dead. A STUDENT's actual "dashboard" is `app/workbench/page.tsx`, a FIXED tab strip (Projects / Experiments / Notes / Lists / Mentoring). So "push a saved widget layout" cannot be built as stated. Two coherent redefinitions, a Grant decision:

- OPTION A (recommended, smallest, fits the shipped product): "dashboard" = the curated Workbench. The instructor authors a `class_dashboard` template that controls the student `/workbench` (which tabs and order, the landing tab, an instructor-pinned intro/syllabus banner, and which note/method/tool surfaces are enabled via the existing `enabledMethodTypes` gate). Declarative shape, not a pixel grid.
- OPTION B (heavier, only if a true grid is wanted): un-teardown the widget canvas, resurrect the deleted registry + `<GridLayout>` + layout-persistence, and seed `dashboard_layout` per student. Multi-week re-introduction of code the team intentionally deleted. Not recommended for v1.

Delivery (both options): NOT the instructor's local settings (home A breaks student-read, per H5) and NOT the signed `LabRecord` log (wrong home for mutable config, would bloat every signed entry). The correct transport is a NEW lab-wide-public relay record TYPE `class_dashboard`, instructor-owned, encrypted under the existing class team key (server-blind), surfaced to every student by EXTENDING the `isLabWidePublic` exception at `lab-read.ts:204-212` (the same mechanism that already delivers PI announcements to every member). This consolidates all student-readable class config (including the `visibilityDefault` the doc parked at "home B") onto one relay record. FLAG (data-shape): new `class_dashboard` lab-record type (additive, E2E under team key); `UserSettings.classDashboardAppliedRev?` and an optional student `workbenchCustomization?` (per-folder, additive nullable) only if the SEED-and-customize path ships.

Locked vs seed semantics: each captured field carries a `locked` flag (FORCE = student cannot change, re-applies on update; SEED = default the student may customize) and a monotonic `rev`. On a SEED update where the student already customized, do NOT silently clobber, surface "your instructor updated the class dashboard" with explicit Apply / Keep-mine (no silent data loss). FORCE-only is the cheapest v1 slice (defers the student customization store + apply-banner entirely). Precedence at render: forced template field > student customization > seeded template > today's hardcoded default (the ABSENT-is-all-on contract, reused from `method-type-enablement.ts`).

Phase placement: CT-5 in Stage 3, gated on the SAME C1 lab-wide-public read wiring as CT-1..CT-4 (it rides the identical `isLabWidePublic` path), and on CM-P4 `useIsClassMode`. Parallelizable with CT-1 (both are instructor-owned records on the same transport). Build the instructor authoring panel first behind `NEXT_PUBLIC_CLASS_MODE`; student-side lightup follows when C1 lands.
