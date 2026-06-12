# BeakerBot review modes (step-by-step vs whole-plan)

Status: design locked by Grant 2026-06-12, NOT built. Mockup-before-build per the UI-review rule. Owner: BeakerAI.

## Why

BeakerBot can already chain a real pipeline (filter and merge a table with wrangle_table, run a stat test, make plots, write a note with the analysis code via get_analysis_code). What it cannot do yet is show the user a block for each step so they approve the pipeline as it runs. The current control is a two-way ask/auto toggle that only gates ACTION tools (wrangle_table, write_note, experiment writes); the stat, plot, and model-comparison tools are deliberately non-gated and run immediately. So "approve each step" is only half true today, and the ask/auto split is a muddy distinction (Grant: there should never really be a true auto mode).

## The model (replaces ask/auto)

One control with two modes. There is no silent unattended mode.

- **Step-by-step** (default, the hero experience). Every meaningful step shows its own rich preview block and waits for the user to confirm before it runs. Steps that show a block: relational transforms (wrangle_table, today), stat tests (run_datahub_analysis), model comparison (compare_models), plots (make_datahub_graph), note writes (write_note, today). The user sees exactly what each step will do, with a live preview of the result where the engine can compute one cheaply, then approves or rejects that step.
- **Whole-plan**. The model proposes the ENTIRE pipeline up front as one plan (the propose_plan surface, extended to list the data steps), the user confirms once, then every step runs start to finish without per-step interruption. A single-step request is just a one-line plan.

In both modes the destructive / outward-facing hard-stop still fires its own final confirm at the moment it runs (delete, send, share, pay), exactly as today. Removing auto never removes that.

## What changes in code

1. **Review-mode store** replaces autonomy-store.ts. `BeakerBotReviewMode = "step" | "plan"`, default `"step"`, localStorage-mirrored (ros.beakerbot.reviewMode), same synchronous getter the agent loop needs. Coerce unknown values to the safe default ("step", the most transparent).
2. **Tool capability flag.** Add `previewable?: boolean` to AiTool. Mark run_datahub_analysis, compare_models, make_datahub_graph previewable. (Action tools are already gated; previewable marks the run-immediately tools that should ALSO gate in step mode.)
3. **Sync preview builders.** Each previewable tool gains a describeAction-style preview using the cached table content (the same cache list_datahub_tables populates), so the loop can render the block synchronously without running the tool. run_datahub_analysis already has describeRunAnalysis to reuse; make_datahub_graph and compare_models need one each.
4. **Loop gate.** In gateToolCall: a previewable (even if not `action`) tool gates when reviewMode === "step" and an approver exists. In "plan" mode it runs once the plan is approved (the existing planState.approved path), or pops a single confirm for a lone step.
5. **Header control.** Replace the ask/auto toggle in BeakerSearchAskHeader with the two-mode control (step / plan).

## Rich preview block (the visible payoff)

Each step's block shows: the step label and a one-line description, the inputs it will act on (table, columns, model ids, graph kind), and a LIVE preview where cheap (the wrangle_table per-op preview is the bar). For a stat test the preview is the resolved test name plus the groups; for a plot it is the figure kind plus the columns; for a model comparison the two models plus nested yes/no. Approve runs the step and renders its result embed inline; Reject skips it and tells the model so it can adapt.

## Open question for the mockup review

- Default mode: step-by-step is proposed as the default (most transparent, matches the marketing claim). Confirm vs whole-plan-as-default.
- Whether whole-plan should still render each step's result inline as it runs (read-only, no confirm) so the user watches it happen, or just a final summary.

## Verification

Engine + loop + store + tool previews are unit-testable (gate decision table, preview builders, store coercion). The header control and the rich block rendering need a browser; mockup first, then Grant's :3000 pass after build.
