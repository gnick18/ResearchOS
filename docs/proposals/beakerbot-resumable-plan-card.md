# BeakerBot resumable plan card

BeakerAI lane, 2026-06-13. Status: design, needs a scope decision before build. The
last BeakerBot B-list item (workflow macros shipped; this is the other).

## What it is

Today the plan card (`propose_plan`) is fire-and-forget. The model proposes steps
as human sentences, the user hits one Approve, and the model then free-runs the
whole sequence in a single agent-loop turn. The card never shows which step is
running, and if a step fails partway the only recovery is to ask again and restart
the whole plan.

The gui-gaps backlog calls for two things (`docs/proposals/beakerbot-gui-gaps.md`):

> Live progress in the plan card, resume from a failed step. The whole-plan card
> should tick off each step as it runs and resume from a failed step rather than
> restart the whole thing.

## Why it is not trivial (the architecture today)

`propose_plan` steps are HUMAN SENTENCES ("Go to the Methods page", "Click New
Method"). After Approve, the loop sets a run-level `planState.approved = true` and
the MODEL carries the steps out with `go_to_page` / `read_page` / `click_element` /
the data tools. There is NO binding between a plan step and a tool call, the model
decides how many calls each sentence takes. So "tick step 2 as done" has no
reliable signal today, and the loop keeps nothing after the turn ends, so there is
nothing to resume from.

This is the highest-risk code in BeakerBot (it has had prod-breaking bugs). Any
change here must not regress the existing approve-and-run path.

## The load-bearing fork: how do we know which step is running?

1. **Model-signaled steps (precise).** Add a tiny coordination tool
   `mark_plan_step(index, status)` (or reuse the existing per-step review blocks
   from the step review mode) and instruct the model, in the system prompt, to mark
   each plan step started/done as it works. Gives accurate live ticks AND an exact
   resume point. Cost: one new tool + system-prompt guidance + loop handling, and
   it leans on the model actually calling it (gpt-oss is weak at tool-calling, kimi
   is fine).
2. **Heuristic ticks (approximate).** Advance the step pointer when the model
   completes an action tool, mapping sequentially. No model cooperation needed, but
   the tick is fuzzy when a step is more or fewer than one tool call.
3. **Persist + resume only (no live tick).** Leave execution as-is, but persist the
   approved plan + a best-effort completed-count; when the turn ends with steps
   left (error, max-iterations, user stop), show a "Resume plan, N steps left"
   affordance that re-sends the remaining steps to the model. Smallest change,
   delivers the "resume from where it stopped" half without precise ticking.

## Proposed design (pending the fork choice)

- **Active-plan state** in `conversation-store`: `{ steps, currentIndex, status }`,
  persisted with the thread so a resume survives a reload (mirrors how chats and
  macros persist).
- **Live plan card** (extends the existing `kind:"plan"` approval card): each step
  shows queued / running / done / failed, the same vocabulary the macro runner and
  steps panel already use, so the visual language is consistent.
- **On a failed step**: the card stops at that step, shows the error, and offers
  Resume (continue from the failed step) and Cancel (drop the rest). Resume re-runs
  from `currentIndex`, not from the top.
- **Reuse, do not duplicate**: the macro runner already models per-step
  running/done/failed/skip with a stop-on-fail contract. The plan card is the
  model-driven cousin; its step status vocabulary and card layout should match the
  macro Run card so the two read as one family.

## Safety (unchanged guarantees)

- The destructive hard-stop still fires per step even inside an approved/resumed
  plan (same as today and as the macro runner).
- Resume re-sends only the remaining steps the user already approved, it never
  expands scope or invents new steps.

## Recommendation

Mockup-first, like workflow macros. The card is a UI surface AND it touches the
risky loop, so seeing the states (running ticks, failed step, resume) before any
agent-loop change de-risks it and lets the fork (precise vs heuristic vs
resume-only) be decided against a concrete picture. Then build in phases:
active-plan state + card states first, the chosen tracking mechanism second,
resume re-entry last, each verified on the demo server like macros.

Macro lane, BeakerAI.
