# Handoff: Class Mode identity-reset re-seal + CT-2 student-open loop (2026-06-20)

Owner: orchestrator / Class-Mode lane. Read with the prior handoff
`docs/handoffs/2026-06-20-class-mode-stage3-teaching-tools-and-subkey-sync-handoff.md`,
the subkey-sync design `docs/proposals/2026-06-20-class-subkey-sync-integration.md`,
and the running-state memory `project_class_mode_cross_folder`. House voice, no
em-dashes, no emojis, no mid-sentence colons.

## TL;DR

Built the two named fast-follows from the prior handoff: the identity-reset
re-seal, and the CT-2 student-open path (the last student-facing wiring gap).
Both are committed to LOCAL main (`e3cf8bb14`, `4dd674ab5`), NOT pushed, gated
behind `NEXT_PUBLIC_CLASS_MODE` (off) and inert. Gate green at each commit (tsc 0
grants-filtered, new tests pass, eslint clean, full lab dir green modulo a
pre-existing `lab-do-client` hash-chain flake that passes in isolation). A
single-user browser verification prompt was handed to Grant; he is running it.

## What landed this session (LOCAL main, not pushed)

### 1. Identity-reset re-seal (`e3cf8bb14`)

When a student resets identity, `readmitMember` (`lab-key.ts:592`) rotates the team
key and re-admits them under a new x25519 key, but their existing subkey envelopes
still sealed to the old key, so they lost access to their own prior private
notebooks. Fix:

- `reSealEnvelopeForStudent` (`lib/lab/lab-subkey.ts`), the crypto core. Opens the
  subkey via the head's OWN sealed copy (the head co-holds every subkey), re-seals
  ONLY the student's copy to their new public key, leaves the head's copy
  byte-identical. The subkey is unchanged, so the at-rest ciphertext is NOT
  re-encrypted, only the envelope's student copy is replaced. A classmate who held
  no copy still holds none, so the FERPA boundary survives the reset.
- `reSealPrivateNotebooksForStudent` (`lib/lab/class-private-notebook.ts`), the
  head-side orchestration. Lists the student's subkeyed notebooks under their
  owner-prefix, re-seals each envelope, re-PUTs HEAD-signed under the NEW team key.
  Verified the relay accepts this: `rosterAllows` (`relay/src/worker.ts:3468`) is
  head-OR-member and does NOT tie the signer to the owner-prefix, so a head write
  to a student's prefix is authorized. Reads under `oldTeamKey`, re-wraps under
  `newTeamKey` so the re-admitted student peels both layers with the keys they
  actually hold (no seed-chain dependency). Best-effort + idempotent.
- Wired into `LabRoster.doReadmit` (`components/lab-head/LabRoster.tsx`),
  class-mode gated, best-effort (the re-admit has already committed), reading the
  head x25519 priv from `getSessionIdentity()` at call time per the locked decision.

Adversarial tests in `class-private-notebook.test.ts` prove the re-admitted
student reads their prior notebook with the NEW key while the old key and a
classmate stay blocked, and the head keeps access throughout.

### 2. CT-2 student-open loop (`4dd674ab5`)

The student-facing loop was genuinely unbuilt, and discovery surfaced a real bug:
the assignment record was published with a redundant `encryptTeamRecord`
double-wrap that the read path never peeled (the dashboard publishes raw), so a
student could never read an assignment at all.

- WIRE-FORMAT FIX: `class-assignment-store.encodeAssignmentRecord` now publishes
  the RAW assignment payload like `class-dashboard-store` (putLabRecord's team-key
  AEAD is the one seal). Flag-off, nothing published yet, so no migration. Updated
  `class-assignment-store.test.ts` to the raw shape.
- MATERIALIZE: `lab-view-materialize` aggregates pulled `class_assignment` payloads
  into the root `_class_assignments.json` (the announcements pattern). NOTE:
  `class_assignment` is NOT in `LAB_WORK_TYPES` (like `class_dashboard`), so the
  materialize drift guard is unaffected.
- READER: `listStudentAssignments` (`lib/lab/class-assignment-read.ts`), reads the
  cached root file folder-locally, defensive against missing / malformed file.
- OPEN ACTION: `openAssignmentNotebook` (`lib/lab/class-student-open.ts`). Idempotent
  find-or-create of the student-owned notebook task, seeded with the assignment
  back-link, checklist copied into sub_tasks, template method, and per-assignment
  visibility. A private notebook then satisfies `isPrivateClassNotebookRecord`, so
  the Stage-C sync partition auto-seals it under the per-student subkey on the next
  sync. So this stays a PLAIN owner-scoped create, not a bespoke crypto write.
- API EXTENSION: `tasksApi.create` (`lib/local-api.ts`) gained additive
  `assignment_id` / `template_method_id` / `class_visibility` params (absent on
  every non-class create, so byte-identical otherwise). `class_visibility`
  OVERRIDES the folder shared_with seed so a private notebook never carries the
  whole-class "*".
- STUDENT UI: `isClassStudentFolder` predicate (`lib/lab/lab-mode.ts`, member +
  class, mutually exclusive with the instructor `isClassFolder`) + `useIsClassStudent`
  hook + `ClassAssignmentsPanel`, mounted in `LabOverviewPage` behind the
  student-only class gate. `SubmitNotebookButton` (built-but-unmounted before this
  lane) is now mounted on the opened notebook.

## Data-shape touches (FLAGGED)

- New on-disk root file `_class_assignments.json` (student folder).
- Additive `tasksApi.create` CT-2 params + Task already carried
  `assignment_id?` / `template_method_id?`.
- Assignment wire-format simplification (flag-off, no migration).

## Verification state

- Crypto + backend covered by unit + adversarial tests (re-seal round-trip,
  open-action idempotency, reader defensiveness, materialize aggregation,
  predicate exclusivity).
- Task 1 (re-seal) needs a 2-user identity-reset over the relay to walk in a
  browser, so it leans on the adversarial tests, not a UI walk.
- Task 2 (student-open loop) browser verify prompt handed to Grant: isolated
  `scripts/worktree-dev.sh` flag-on server, a scratch folder seeded with
  `_user_settings` (class + member) + a `_class_assignments.json` fixture, walked
  via Claude-in-Chrome (Preview MCP cannot drive the FSA folder picker).

## Where to pick up (remaining, unchanged from the prior handoff minus these two)

- SEAL-AT-SCALE, bulk reseal for a 30-student class (`reconcileDeferredSeals` is
  opportunistic-only). Gates a LIVE demo, not flag-on correctness.
- STAGE 4 ROSTER, manual CSV/email paste + the authenticated per-PI invite limiter
  (current limiter is 10/IP/day), then Moodle/Canvas LMS.
- HEAVY-TYPE cross-folder right-click / per-row wiring (components ready to mount).

## Key anchors

- Re-seal core: `lib/lab/lab-subkey.ts` (reSealEnvelopeForStudent); orchestration:
  `lib/lab/class-private-notebook.ts` (reSealPrivateNotebooksForStudent).
- Student-open: `lib/lab/class-student-open.ts`, `lib/lab/class-assignment-read.ts`,
  `components/lab-overview/ClassAssignmentsPanel.tsx`, `hooks/useIsClassStudent.ts`.
- Wire-format fix: `lib/lab/class-assignment-store.ts`.
- Memory: `project_class_mode_cross_folder` (the full running state log).
