# Class Mode: surfacing the instructor's template method in the student notebook

Date: 2026-06-20
Status: design note + plan (Part 2 of the class-notebook display follow-up)
Flag: NEXT_PUBLIC_CLASS_MODE (everything below stays behind it)

## The gap

When a student opens a class assignment, `openAssignmentNotebook`
(`frontend/src/lib/lab/class-student-open.ts`) creates a student-owned experiment
notebook that stores `template_method_id` (the numeric id of the INSTRUCTOR's
method). That id is a reference into the instructor's folder
(`users/<instructor>/methods/<id>.json`). It does not exist in the student's
folder, so the Method tab has nothing to render. The student sees an empty Method
tab and never sees the protocol they are supposed to follow.

The sibling gap (the assignment checklist not rendering) is fixed in Part 1 by
surfacing `sub_tasks` in the experiment Details tab. This note covers the larger
half: getting the protocol CONTENT to the student.

## What already exists (and why it makes this tractable)

Two pieces of existing machinery do most of the work:

1. The relay materializer already maps shared `method` records to disk.
   `lab-view-materialize.ts` has `RECORD_TYPE_TO_DIR.method = "methods"`, so any
   method record shared to the student over the relay lands at
   `users/<instructor>/methods/<id>.json` on the student's device with NO new
   materializer code.

2. Method attachments are already cross-owner aware. A `Task.method_attachments`
   entry carries `{ method_id, owner }`, and `MethodTabs` resolves it via
   `resolveMethodForAttachment(attachment, allMethods, task.owner)` against
   `fetchAllMethodsIncludingShared()`. The per-attachment `owner` field already
   disambiguates a method that lives in another user's namespace (the existing
   "alex's private 5 vs the public 5" case). So an attachment that points at the
   instructor's method by `owner = <instructor>` is a shape the renderer already
   understands.

The only thing missing is that the instructor's method is never SHARED to the
roster, and the student notebook attaches nothing (it only stores the bare
`template_method_id`, which the renderer does not consume).

## Two approaches

### Option A (recommended): reference-attach (share + materialize + attach by owner)

- Authoring (instructor, at assign time): in addition to the one instructor-owned
  `class_assignment` record, also publish the method record (`recordType:
  "method"`) shared to the same roster (`"*"` or per-student), under the team key.
  The protocol is not secret from classmates (only each student's ANSWER is, per
  the privacy model in `class-assignment.ts`), so team-key sharing is consistent
  with both `private` and `collaborative` assignments.
- Pull: the existing relay pull + `materializeLabView` write the method to
  `users/<instructor>/methods/<templateMethodId>.json` on the student's device.
- Open: `openAssignmentNotebook` adds a method attachment
  `{ method_id: templateMethodId, owner: <instructor> }` to the created notebook
  (alongside the existing `template_method_id`, which becomes a redundant
  back-link). `MethodTabs` then renders the instructor's protocol via the
  existing cross-owner resolution.
- Editing: the attachment owner is the instructor, not the student, so the
  protocol is shown READ-ONLY to the student (a method they follow, not author).
  This matches the intent: the assignment protocol is the instructor's.

Cost: small. No Task JSON shape change (`method_attachments` already exists). No
materializer change. The changes are (1) extend `planAssignmentFanout` /
`pi-actions` to also emit a method share, and (2) have `openAssignmentNotebook`
push the cross-owner attachment.

Open edges:
- Method id collision: the instructor's `templateMethodId` is a number from the
  instructor's namespace. Because the attachment carries `owner = instructor`,
  `attachmentKey`/`resolveMethodForAttachment` already disambiguate it from any
  student-local method that happens to share the numeric id. No remap needed.
- A method can reference attachments/figures of its own. Those sub-assets are not
  covered here; the first pass renders the method text + steps only. If the
  instructor's protocol embeds images, surfacing those is a follow-up (they would
  also need to be shared + materialized).

### Option B: copy-by-value (snapshot the method into the student's namespace)

- Carry the full method payload on the `class_assignment` record (a snapshot, not
  just the id), the same way the checklist is already copied onto the assignment
  rather than referenced.
- At open, write a NEW student-owned method (`users/<student>/methods/<newId>.json`
  with a student-namespace id) and attach it via the student's own
  `method_attachments` / `method_ids`.

Pros: the student gets a fully local, editable copy; no dependency on the relay
method share arriving before the student opens.
Cons: heavier. Duplicates protocol content per student; needs a student-namespace
id allocation + remap; the `class_assignment` record grows to carry the whole
method body; edits drift from the instructor's source. Editability is arguably the
WRONG default for an assignment protocol.

## Recommendation

Option A (reference-attach, read-only protocol). It reuses the materializer and
the cross-owner attachment renderer that already exist, needs no Task shape change
and no id remap, and keeps a single source of truth for the protocol. The student
follows the instructor's protocol rather than forking an editable copy, which is
the correct posture for a graded/assigned method.

## Plan (Option A)

1. Authoring share. [LANDED 2026-06-20, pure core.] Extend the assignment fan-out
   so assigning a method also publishes the method record shared to the roster.
   - `class-assignment.ts`: `InstructorMethodShare` descriptor + `methodShare?` on
     `AssignmentFanoutPlan` (owner = instructor, recordType = "method", methodId =
     templateMethodId, sharedWith = same roster), emitted only when
     `templateMethodId` is set. Pure, unit-tested, flag-off-safe. DONE.
   - The live writer (`pi-actions.ts`) calls the existing method-share path with
     that descriptor. No new relay primitive. STILL TO WIRE.
2. Student-open attach. `openAssignmentNotebook` adds
   `method_attachments: [{ method_id: plan.templateMethodId, owner: assignment.instructor }]`
   to the `tasksApi.create` call when a template method exists, AND adds
   `templateMethodId` to `method_ids`. Keep `template_method_id` as the back-link.

   COUPLING (discovered during Part 1). The read-time normalizer in
   `local-api.ts` (around line 852) enforces the invariant
   `∀ a ∈ method_attachments: a.method_id ∈ method_ids` and DROPS any attachment
   whose method_id is absent from method_ids. So the attachment only survives if
   `templateMethodId` is also in `method_ids`. But a bare `method_ids` entry for a
   method that has NOT yet been shared+materialized renders "No methods attached"
   (which is exactly why the original `class-student-open.ts` deliberately did NOT
   add it to method_ids). Therefore step 2 MUST land together with step 1's live
   wiring (so the method is shared before any student opens) — it cannot ship in
   isolation, and is intentionally NOT landed yet.
3. Read-only guard. Confirm `MethodTabs` shows the instructor-owned attachment
   read-only for the student (attachment owner != current user). If the remove/X
   affordance is reachable, gate it for class notebooks (the student cannot detach
   the instructor's protocol), mirroring the Part 1 checklist gate.
4. Tests.
   - `class-assignment.test.ts`: the fan-out emits a method share with owner =
     instructor and the roster's share list, and emits none when there is no
     `templateMethodId`. DONE.
   - `class-student-open.test.ts`: the created notebook carries the cross-owner
     method attachment (and the matching method_ids entry) when the assignment has
     a template method. TODO with step 2.
5. Verify (browser, flag on, two users): instructor assigns a method to a class;
   student opens; the Method tab renders the instructor's protocol; the student
   cannot edit or detach it; the Details-tab checklist (Part 1) ticks.

## Status (2026-06-20)

- Part 1 (checklist render): DONE + tsc 0 + vitest green. The experiment Details
  tab now renders the assignment checklist (`isClassAssignmentNotebook` gate in
  `class-student-open.ts`, consumed by `TaskDetailPopup`).
- Part 2 step 1 (pure `methodShare` descriptor): DONE + tested.
- Part 2 steps 1-live, 2, 3: the thin I/O follow-up, must land together (see the
  coupling note above). Grant selected Option A on 2026-06-20.

## Scope guards honored

- No on-disk Task JSON shape change. `method_attachments` and
  `template_method_id` already exist on `Task`.
- Everything stays behind `NEXT_PUBLIC_CLASS_MODE`.
- The `class_assignment` record shape is unchanged under Option A (Option B would
  have grown it; flagged here for the record). The new `methodShare` descriptor is
  a fan-out PLAN field, not a stored record shape.

## Decision needed from Grant

Option A (reference-attach, read-only) vs Option B (copy-by-value, editable). The
plan above assumes A.
