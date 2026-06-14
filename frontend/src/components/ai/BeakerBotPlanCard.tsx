"use client";

// BeakerBotPlanCard (resumable plan card, 2026-06-13).
//
// The live card for a per-step-driven plan. It ticks each step as the loop runs
// it (done / running / queued) and, when a run stops with steps left, shows the
// stopped step and offers Resume (continue from there) or Cancel (drop the rest).
// The step status vocabulary matches the macro Run card so the two read as one
// family. Gated by BEAKERBOT_PLAN_STEPS_ENABLED upstream, this only renders when
// the store has an activePlan that is running or paused.
//
// House style, Icon only, no emojis / em-dashes / mid-sentence colons.

import { Icon } from "@/components/icons";
import type { ActivePlan } from "@/lib/ai/conversation-store";

export default function BeakerBotPlanCard({
  plan,
  onResume,
  onDismiss,
}: {
  plan: ActivePlan;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const total = plan.steps.length;
  const paused = plan.status === "paused";
  const doneCount = paused ? plan.index : plan.status === "done" ? total : plan.index;

  return (
    <div
      data-testid="beakerbot-plan-card"
      className={`mx-3 mb-2 overflow-hidden rounded-md border ${
        paused ? "border-amber-400" : "border-brand-action/60"
      }`}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 text-meta font-semibold ${
          paused
            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
            : "bg-brand-action/10 text-brand-action"
        }`}
      >
        <Icon
          name={paused ? "alert" : "list"}
          className="h-3.5 w-3.5"
          title=""
        />
        {paused ? `Plan stopped at step ${plan.index + 1}` : "Running the plan"}
        <span className="ml-auto text-[10px]">
          {doneCount} of {total}
        </span>
      </div>

      <ol className="m-0 list-none p-0">
        {plan.steps.map((step, i) => {
          const isDone = i < plan.index || plan.status === "done";
          const isCurrent = i === plan.index && plan.status !== "done";
          const running = isCurrent && !paused;
          const stopped = isCurrent && paused;
          return (
            <li
              key={i}
              className={`flex items-center gap-2.5 border-t border-border px-3 py-1.5 text-meta ${
                isDone
                  ? "text-foreground"
                  : isCurrent
                    ? "text-foreground"
                    : "text-foreground-muted"
              }`}
            >
              <Icon
                name={
                  isDone
                    ? "check"
                    : running
                      ? "refresh"
                      : stopped
                        ? "alert"
                        : "minus"
                }
                className={`h-3.5 w-3.5 flex-none ${
                  isDone
                    ? "text-green-600 dark:text-green-400"
                    : running
                      ? "text-brand-action"
                      : stopped
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground-muted"
                }`}
                title=""
              />
              <span className="flex-1">{step}</span>
              <span className="flex-none text-[10px] text-foreground-muted">
                {isDone ? "done" : running ? "running" : stopped ? "stopped" : "queued"}
              </span>
            </li>
          );
        })}
      </ol>

      {paused ? (
        <div className="flex gap-2 border-t border-border px-3 py-2">
          <button
            type="button"
            data-testid="beakerbot-plan-resume"
            onClick={onResume}
            className="flex-1 rounded-md bg-green-600 px-3 py-1.5 text-meta font-semibold text-white transition-colors hover:bg-green-700"
          >
            Resume from step {plan.index + 1}
          </button>
          <button
            type="button"
            data-testid="beakerbot-plan-cancel"
            onClick={onDismiss}
            className="rounded-md border border-border px-3 py-1.5 text-meta text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel the rest
          </button>
        </div>
      ) : null}
    </div>
  );
}
