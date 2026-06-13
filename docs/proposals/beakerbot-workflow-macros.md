# BeakerBot workflow macros

BeakerAI lane, 2026-06-13. Status: design, mockup-first, NOT built. The last
remaining BeakerBot B-list item (the resumable plan card is the other).

## What this is

A workflow macro is a saved, named, ordered sequence of BeakerBot steps that a
user can replay with one command. It is the user-authored, persisted cousin of
`propose_plan`. Where `propose_plan` builds a one-off plan the model reasons out
on the spot, a macro is a plan the user kept, so a routine they run every week
(pull the lab digest, draft the summary note, set up next week's tasks) becomes
one `/macro` instead of one paragraph re-typed every Monday.

The slash-command registry was built for this. Its own header note says the shape
is kept extensible so a future pass can "grow the list or let PIs register lab
macros without a rewrite." This is that pass.

## Locked decisions (Grant, 2026-06-13)

1. **Execution = deterministic replay.** A macro stores a fixed ordered list of
   concrete steps that replay in order through the same tool path, under one
   approval, WITHOUT re-asking per routine step. Reproducibility is the lab value.
   A genuinely destructive or outward-facing step (delete, send, share, pay, or
   anything the destructive heuristic flags) STILL pops its own confirm at the
   moment it runs, exactly as inside an approved `propose_plan`. Macro approval
   covers the routine steps only.
2. **Authoring = both, record-first.** The primary path is capturing a macro from
   a real conversation after it ran ("Save these steps as a macro"). The secondary
   path is a hand editor to name, reorder, edit, or remove the captured steps. The
   editor is also the way to author one from scratch.
3. **Scope = personal first, lab-shared next.** v1 stores macros per-user in the
   connected folder. The on-disk shape and the registry carry a `scope` field from
   day one so a PI can later register a lab-shared macro without a data migration.

## Where it plugs into the real code

- **Storage.** A new `JsonStore<StoredMacro>` entity `beakerbot_macros`, files at
  `users/<u>/beakerbot_macros/<id>.json`, ids from the per-user `_counters.json`.
  This mirrors `beaker-chats-store.ts` exactly, same no-folder-connected fallback
  (macros live in memory when there is no folder, like chats do).
- **Registry / invocation.** Macros surface in the existing `/` slash menu, in a
  "Your macros" group below the six curated commands. Curated commands prefill the
  composer and let the model interpret. A macro does NOT prefill prose, it stages a
  macro run directly (see runner below), because the steps are already fixed.
- **Runner.** A new `lib/ai/macro-runner.ts`. It reuses the agent loop's gate
  decision (the same logic that decides PROCEED vs confirm vs hard-stop) and the
  same per-tool `execute`, but it drives the recorded steps itself instead of the
  model. The happy path never calls the model, so a macro run is fast and exactly
  reproducible. The runner sets a run-level `planState.approved = true` after the
  single Run approval so routine steps do not re-ask, and lets `decideGate`'s
  destructive hard-stop override that per step.
- **Live steps panel.** Each step reports running / done / failed through the
  existing `ToolStep` panel. On a failed step the run stops and reports which step
  failed and why, it does not silently continue.

## Data shape (proposed)

```ts
type MacroStep = {
  tool: string;                     // registry tool name, e.g. "lab_digest"
  args: Record<string, unknown>;    // the recorded arguments
  label: string;                    // the human sentence shown in the run card
};

type StoredMacro = {
  id: number;
  name: string;                     // the /token, lowercase, no spaces
  description: string;              // one-line menu row
  steps: MacroStep[];
  scope: "personal";                // future: "lab"
  createdAt: number;
  updatedAt: number;
};
```

## Recording a macro from a chat

After a turn completes, a "Save as macro" affordance appears on the run (in the
steps panel summary). It captures, in order, the action and data tools that ran in
that turn (the deterministic ones, for example `lab_digest`, `summarize_notes`,
`write_note`, `setup_experiment`, `transform_table`), with the exact args the model
called them with, plus the `propose_plan` step labels when the run had a plan. Pure
read-only navigation noise (`read_page`) is dropped from the captured sequence so
the macro is the meaningful steps, not the clicks between them. The capture opens
the editor pre-filled so the user names it and trims anything before saving.

## The relative-argument question (v1 decision + fast-follow)

Some tools take time- or context-relative arguments (a date range like "this
week", "the current table"). v1 records args **verbatim**, so a digest macro
recorded today freezes today's dates. This is honest deterministic replay and the
editor lets the user change a frozen arg. The editor flags any argument that looks
date-like with a small "fixed date" marker so the freeze is never a surprise.

Fast-follow (not v1): a small set of known relative tokens (date presets such as
`this_week`, `last_month`) stored as the token, not the resolved dates, and
re-resolved at run time. This is the only part of the "hybrid, model-filled slots"
option we carry forward, kept narrow and deterministic. Called out here so the v1
data shape (args as recorded) does not have to change to add it later.

## Run flow

1. User picks `/my-macro` from the slash menu.
2. A Macro Run card appears in chat, showing the macro name and its ordered step
   labels, with a single Run / Cancel (the same one-approval shape as a
   `propose_plan` card, labeled as a macro so the user knows it is a saved routine).
3. On Run, the runner executes the steps in order. Routine steps run without
   re-asking. A destructive or outward step pops its own confirm at that step.
4. The steps panel shows progress. On completion BeakerBot posts a one-line
   confirmation. On a failed step it stops and says which step failed.

## Editing and managing macros

- **Editor sheet.** Name, one-line description, and the ordered steps. Each step
  can be edited (its label), reordered (drag), toggled off, or removed. Reachable
  from the save-time capture and from the manager. Authoring from scratch is the
  same sheet with an empty step list and an "Add step" picker over the tool set.
- **Manager.** A "Macros" view listing the user's saved macros with Run, Edit,
  Duplicate, and Delete. A second, empty "Lab macros" section is shown disabled
  with a "coming soon" note, so the personal-first / lab-next shape is visible and
  the future home is obvious. Delete trashes (recoverable), it does not hard-delete.

## Safety

- The destructive hard-stop is never bypassed by macro approval. This is the same
  guarantee `propose_plan` already gives, reused, not re-implemented.
- A macro that references a tool no longer in the registry (renamed, removed)
  skips that step with a visible warning rather than failing the whole run, and the
  editor surfaces the dangling step so the user can fix it.
- Macros never call the model on the happy path, so a macro cannot drift into a
  different action than the one the user saved. What you saved is what runs.
- No-interpretation rule is unaffected. Macros only replay tools the user already
  approved once. They add no new analysis or conclusions.

## Build phases (after mockup sign-off)

1. **Store + types.** `beakerbot-macros-store.ts` (mirror chats store), `StoredMacro`
   types, unit tests for create/list/save/delete and the no-folder fallback.
2. **Runner.** `macro-runner.ts` reusing the gate + execute, with tests covering
   routine-replay, destructive-step self-confirm, dangling-tool skip, failed-step
   stop.
3. **Slash-menu integration.** "Your macros" group in the existing menu, macro
   selection stages a run instead of prefilling.
4. **Record affordance + editor + manager UI.** The capture button, the editor
   sheet, the manager view.

Each phase lands on local main at a coherent checkpoint so Grant can dogfood on
:3000.

Macro lane, BeakerAI.
