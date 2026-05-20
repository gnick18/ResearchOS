import { useEffect, useState } from "react";
import { goalsApi } from "@/lib/local-api";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import {
  appendArtifact,
  findArtifact,
} from "./lib/wizard-artifacts";

/**
 * W11: Goals tour (conditional walkthrough).
 *
 * Fires only when `feature_picks.goals === "yes"`.
 *
 * BeakerBot creates a sample high-level goal and links it to W1&apos;s
 * project. The brief frames this as "demos linking it to W3&apos;s
 * experiment" but the goals data model attaches goals to projects via
 * `project_id`, not directly to tasks/experiments. The linkage is
 * indirect: the goal lives on the project, the experiment lives on the
 * same project, so they&apos;re bound by shared project context. We
 * surface that relationship in BeakerBot&apos;s copy rather than
 * inventing a non-existent task linkage API.
 *
 * If no project artifact exists yet (user skipped W1), the goal is
 * created as a personal goal (`project_id: null`). Goals are
 * lightweight enough that the L9 auto-prerequisite machinery doesn&apos;t
 * need a `ensureGoalArtifact` helper — nothing downstream depends on
 * a goal.
 *
 * Artifact: `{ type: "goal", id: <goal-id>, cleanup_default: "keep" }`.
 */

interface W11Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const DEFAULT_GOAL_NAME = "Finish first experiment";

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function plusDays(base: Date, days: number): string {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function W11GoalsTourStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W11Props) {
  const existing = findArtifact(sidecar, "goal");
  const projectArtifact = findArtifact(sidecar, "project");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(existing === null);
  }, [existing, setNextDisabled]);

  const handleCreate = async () => {
    if (creating || existing) return;
    setCreating(true);
    setError(null);
    try {
      const finalName = name.trim() || DEFAULT_GOAL_NAME;
      const today = new Date();
      const goal = await goalsApi.create({
        project_id: projectArtifact ? Number(projectArtifact.id) : null,
        name: finalName,
        start_date: todayLocal(),
        end_date: plusDays(today, 30),
      });
      await patchSidecar((cur) =>
        appendArtifact(cur, {
          type: "goal",
          id: String(goal.id),
          cleanup_default: "keep",
        }),
      );
    } catch (err) {
      console.error("[onboarding-v3] W11 goal create failed", err);
      setError("Couldn't create the sample goal. Try again or skip this step.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-step-id="W11" className="space-y-4">
      <SpeechBubble>
        Goals keep the big picture visible. I&apos;ll spin up a sample one
        on the same project your experiment lives in, so the two are
        connected through that project. You can add SMART sub-goals,
        change dates, or kill it from the Goals tab later.
      </SpeechBubble>

      {existing ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Goal created on{" "}
          {projectArtifact
            ? "the same project as your experiment"
            : "your account (no project link)"}
          . Open the Goals tab whenever you want to fill in SMART sub-goals.
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            Goal name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={DEFAULT_GOAL_NAME}
            disabled={creating}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create the goal"}
          </button>
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
