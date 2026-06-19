# BeakerBot auto-offers a plan for multi-step work, design doc

Date 2026-06-19. Status: proposed (design of record for sign-off, no code yet). Related: `[[project_beakerbot_resumable_plan_card]]`, `[[project_beakerbot_workflow_macros]]`.

## The discovery

BeakerBot has two execution modes (a manual header toggle): step-by-step (the default) and whole-plan. Real usage shows the plan mode is never discovered, so every request, including genuine multi-step workflows, runs step-by-step. For a four-step pipeline that means four separate confirms with the model deliberating between each, which reads as slow and naggy. The fix is not "always step-by-step" and not "default to plan". It is to keep step-by-step as the calm default for single asks and let BeakerBot OFFER a plan, on its own, the moment a request is genuinely multi-step. Single ask stays step-by-step, workflow gets one plan card.

## Why this needs two parts (the current behavior)

The machinery already exists but does not combine the way users would expect:
- `propose_plan` (a coordination tool, `PROPOSE_PLAN_TOOL_NAME`) lets the model lay out plain-word steps; the loop renders the plan card, the user approves once, and `planState.approved` flips true.
- BUT the gate (`gateToolCall` in `agent-loop.ts`) deliberately makes step mode ignore `planState.approved`. In step mode every action and previewable step is confirmed individually, EVEN inside an approved plan. So today, proposing a plan only buys the one-approval experience when the user has already manually switched to plan mode, which they never do.

So the model has no reason to propose a plan in step mode (it would not help), and the user never sees the card. Two changes fix it.

## Part A: BeakerBot offers the plan (system prompt)

When BeakerBot is about to fulfil a request that is a genuine multi-step pipeline, it calls `propose_plan` FIRST and lets the user approve the whole thing, instead of running it step-by-step.

What counts as multi-step (propose a plan):
- The request needs TWO OR MORE non-trivial actions (writes), or a mixed chain of actions and previewable steps that clearly belong together. Example: "filter this table to the treated rows, run a t-test, plot it, and drop the result in my notes."

What does NOT (stay step-by-step, no plan card):
- A single action ("change my date format", "add a task"). One step is just one step.
- Pure reads or navigation, however many ("summarize my experiments then show me the overdue ones"). Reads and navigation never gate in either mode, so a plan adds nothing.
- An exploratory or ambiguous ask where the steps are not yet known. Propose a plan only when the steps are concrete.

The model already knows how to call `propose_plan`; this is a prompt instruction about WHEN to reach for it (proactively, in the default mode), not a new tool.

## Part B: an approved offered-plan runs as a plan for that turn (loop)

When the user approves a plan the model offered, that plan's non-destructive steps run free for that turn, even though the persisted mode is step. After the turn, the user is back in step-by-step. The persisted preference is never changed.

Concretely in `gateToolCall`: when `planState.approved` is true because the user approved a `propose_plan` THIS turn, honor it in step mode the same way plan mode already does (non-destructive actions and previewable steps proceed). The destructive hard-stop is unchanged and absolute: a destructive step still pops its own confirm even inside an approved plan, in both modes. This is a per-turn, consent-gated elevation, not a silent widening of the default.

The user gave informed consent by approving the visible plan card, so running the listed steps without re-confirming each one is exactly what they asked for. The card should carry a small "review each step instead" escape so a user who prefers the granular path can decline the plan and fall back to step-by-step for that request (no soft-lock).

## Safety

- Destructive steps ALWAYS confirm individually, in both modes, even inside an approved plan. Unchanged. The hard-stop is never bypassed.
- Nothing runs unattended without the explicit plan-card approval. The elevation only applies to a plan the user just approved.
- The default stays step-by-step. The elevation is per-turn and never rewrites the persisted preference, so a user who never approves a plan never leaves step-by-step.
- The plan card lists every step in plain words before approval, so consent is informed.
- Reads and navigation are unaffected (they never gated).

## Integration points (real handles)

- The plan tool: `src/lib/ai/tools/propose-plan.ts` (`proposePlanTool`, `PROPOSE_PLAN_TOOL_NAME`, `readPlanSteps`).
- The gate: `gateToolCall` + `planState` in `src/lib/ai/agent-loop.ts` (the decision table near line 440).
- The mode store: `src/lib/ai/review-mode-store.ts` (`BeakerBotReviewMode`, default "step").
- The plan card UI: `src/components/ai/BeakerBotPlanCard.tsx` (add the "review each step instead" escape).
- The prompt: `src/lib/ai/system-prompt.ts` (the WHEN-to-propose instruction).

## Decisions for Grant

1. Threshold. Offer a plan at TWO or more non-trivial actions (recommended), or only at three or more. Recommendation: two, since two confirms already feel naggy and the card is cheap.
2. Per-turn vs sticky. The elevation reverts to step-by-step after the turn (recommended), or it stays plan for the rest of the conversation once the user approves one plan. Recommendation: per-turn, it respects the default and never surprises the user later.
3. Escape on the card. Add a "review each step instead" link that declines the plan and runs the request step-by-step (recommended), so the granular path is never lost. Recommendation: yes.
4. Mixed read-and-write chains. Count only the writes toward the threshold (recommended, since reads never gate), or count previewable steps too. Recommendation: count writes plus previewable steps, since a previewable step is also something the user reviews in step mode.

## Phasing

- Phase 1: Part A (prompt instruction to offer a plan for multi-step) + Part B (honor an approved offered-plan in step mode for that turn) + the card escape. Unit-test the gate elevation against the existing decision-table tests, and that destructive still hard-stops inside an approved auto-plan.
- Phase 2: a tiny inline trace after an auto-plan runs ("ran 4 steps as a plan") so the user sees what happened, and a one-tap "save as macro" since the steps are already a plan (ties into the macros feature).
- Phase 3: learn from declines. If a user repeatedly picks "review each step instead", stop offering plans for similar shapes.

## Out of scope

- No change to the manual mode toggle; it stays for users who want to force one mode.
- No change to the destructive hard-stop, ever.
- No auto-execution without the visible plan-card approval.
- No change to macros beyond the optional "save as macro" affordance in phase 2.
