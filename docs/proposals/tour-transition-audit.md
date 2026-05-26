# Tour Transition Audit (transition-intro sub-bot, 2026-05-26)

## Background

Grant's standing principle: "When we transition between pages we MUST explain
with a transition from BeakerBot introducing the page." Every time the v4
walkthrough moves to a new route, the user needs a brief BeakerBot narration
explaining what the page is for + the core concepts they will encounter,
BEFORE any cursor demo or interaction.

Audit walks `TOUR_STEP_ORDER` in `frontend/src/components/onboarding/v4/step-machine.ts`
and identifies every step where `expectedRoute` differs from the prior step's
`expectedRoute`. For each transition, checks whether the FIRST step on the
new route is a pure narration step (no `cursorScript`, manual advance,
multi-sentence pedagogical prose).

Coordination note: the methods cluster is being touched by a parallel sub-bot
(adding a file-vs-markdown intro before §6.4 PCR demo). Per the brief, this
audit treats `/methods` as covered and skips it.

## Audit table

Status legend:
- COVERED: first step on the new route is a pure-narration intro that
  explains the page concept.
- COVERED-MIXED: first step has narration that explains the page concept,
  but is interleaved with a cursor demo. Still readable, but adds a pure
  intro per the "err on the side of adding" rule.
- MISSING: first step on the new route has zero conceptual intro, jumps
  straight to a cursor demo or user-action click.
- SKIP: covered by another sub-bot in flight (methods).

| # | Transition | First step on new route | Has pure intro? | Status | Action |
|---|---|---|---|---|---|
| 1 | setup-wrapup (modal) -> `/` | `home-create-project` (user-action: click + New Project) | NO | MISSING | Add `home-page-intro` |
| 2 | `/` -> `/workbench/projects/<id>` (dyn) | `project-overview-prose` (cursor demo, has speech narrating "your project's overview page", but mixed with cursor typing) | PARTIAL | COVERED-MIXED | Add `project-page-intro` as a pure narration beat right after `project-overview-nav` |
| 3 | `/workbench/projects/<id>` -> `/` | `home-widgets-canvas-intro` (pure narration) | YES | COVERED | None |
| 4 | `/` -> `/methods` | `methods-category-prompt` | n/a | SKIP | Covered by methods-cluster sub-bot |
| 5 | `/methods` -> `/workbench` | `workbench-create-experiment-open` (user-action: click + New Experiment) | NO | MISSING | Add `workbench-page-intro` |
| 6 | `/workbench` -> `/gantt` | `gantt-intro` (pure narration) | YES | COVERED | None |
| 7 | `/gantt` -> `/settings` | `personalization-animations` (cursor demo) | NO | MISSING | Add `settings-page-intro` |
| 8 | `/settings` -> `/search` | `search-demo` (cursor demo with speech, but speech is mixed with the cursor type-action) | NO | MISSING | Add `search-page-intro` |
| 9 | `/search` -> `/wiki` (dyn wiki page) | `wiki-pointer-intro` (pure narration) | YES | COVERED | None |
| 10 | `/wiki` -> `/purchases` (conditional) | `purchases-intro` (pure narration) | YES | COVERED | None |
| 11 | `/purchases` -> `/calendar` (conditional) | `calendar` (pure narration with concept) | YES | COVERED | None |
| 12 | `/calendar` -> `/links` (conditional) | `links` (pure narration with concept) | YES | COVERED | None |
| 13 | telegram modal | n/a (modal-contained) | n/a | n/a | None |
| 14 | lab-cleanup, tour-goodbye | n/a (modal-contained) | n/a | n/a | None |

## Notes on edge cases

- `notifications-bell`, `notifications-silence`, `notifications-delete` all
  fire on `/` via a popup overlay. No route change; not a transition.
- `experiment-attach-method-*` steps are popup-portaled on `/workbench`.
  Not a transition.
- `hybrid-*` steps are popup-portaled on `/workbench`. Not a transition.
  The hybrid cluster owns its own intro story via `hybrid-notes-vs-results`
  + `hybrid-markdown-intro` (a multi-beat conceptual setup before the
  cursor mechanics fire).
- `workbench-notes-*` and `workbench-list-*` are subsequent /workbench steps
  after the experiment popup closes; the workbench page intro added here
  fires once at the page entry, then later steps can reference it.
- `project-overview-nav` is the BeakerBot cursor that clicks the project
  card on home. Its `expectedRoute` is `/`. The transition lands on the
  dynamic project route AFTER the cursor click completes, so we treat
  `project-overview-prose` as the "first step on the new route".

## Backfill scope

Five new pure-narration intro steps to add:

1. `home-page-intro` (between `setup-wrapup` and `home-create-project`)
2. `project-page-intro` (between `project-overview-nav` and `project-overview-prose`)
3. `workbench-page-intro` (between `methods-create` and `workbench-create-experiment-open`)
4. `settings-page-intro` (between `personalization-animations`... wait, animations IS the first /settings step. So insert BEFORE `personalization-animations`, i.e. between `gantt-goals-overview` and `personalization-animations`)
5. `search-page-intro` (between `ai-helper-use-case-agentic` and `search-demo`)

Each new step:
- ID matches existing kebab-case convention.
- `expectedRoute` set to trigger route change.
- `completion: manualAdvance("Got it, next")`.
- No `cursorScript`.
- No `targetSelector` (speech-only per step-types.ts:142 "undefined target = speech-only").
- `pose: "pointing"`.
- Multi-sentence (30-60 second read), no em-dashes, no emojis, concept-first.

Voice anchor: HomeWidgetsCanvasIntroStep.tsx (§6.2 cousin) - explains
"what is this page" + "what are the core concepts you will use here"
before the cursor demos start.

## Out of scope

- Sub-steps that stay on the same route (e.g. `methods-category-open` ->
  `methods-category` both on `/methods`).
- Existing cursor-script behavior on subsequent steps.
- Methods cluster intro (parallel sub-bot in flight).
- Z-index, bubble styling, recent fix work.

Signed: transition-intro sub-bot
