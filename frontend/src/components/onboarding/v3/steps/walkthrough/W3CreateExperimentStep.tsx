import { useEffect, useState } from "react";
import { tasksApi } from "@/lib/local-api";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import { ensureProjectArtifact } from "./lib/auto-prerequisite";
import {
  appendArtifact,
  findArtifact,
} from "./lib/wizard-artifacts";

/**
 * W3: Create your first experiment (universal walkthrough).
 *
 * The experiment lands inside W1's project. If the user skipped W1,
 * `ensureProjectArtifact` runs on mount and silently spins up an
 * `[Auto] My First Project` placeholder before the experiment is
 * created. The placeholder artifact carries `cleanup_default:
 * "discard"` and a parallel `auto:W1` entry in `skipped_steps`.
 *
 * Default name "My First Experiment"; users can type their own. The
 * experiment is created with `task_type: "experiment"` and a single-
 * day duration starting today (matching the default `tasksApi.create`
 * uses when other call sites omit a date).
 *
 * Next is gated until the experiment exists.
 */

interface W3Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const DEFAULT_NAME = "My First Experiment";

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function W3CreateExperimentStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W3Props) {
  const existing = findArtifact(sidecar, "experiment");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoPrereqRan, setAutoPrereqRan] = useState(false);

  useEffect(() => {
    setNextDisabled(existing === null);
  }, [existing, setNextDisabled]);

  useEffect(() => {
    if (autoPrereqRan || existing) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureProjectArtifact(sidecar, patchSidecar);
      } catch (err) {
        console.warn("[onboarding-v3] W3 auto-prereq W1 failed", err);
      } finally {
        if (!cancelled) setAutoPrereqRan(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoPrereqRan, existing, sidecar, patchSidecar]);

  const handleCreate = async () => {
    if (creating || existing) return;
    setCreating(true);
    setError(null);
    try {
      const projectArtifact = findArtifact(sidecar, "project");
      const projectId = projectArtifact ? Number(projectArtifact.id) : null;
      const finalName = name.trim() || DEFAULT_NAME;
      const experiment = await tasksApi.create({
        project_id: projectId ?? null,
        name: finalName,
        start_date: todayLocal(),
        duration_days: 1,
        task_type: "experiment",
      });
      await patchSidecar((cur) =>
        appendArtifact(cur, {
          type: "experiment",
          id: String(experiment.id),
          cleanup_default: "keep",
        }),
      );
    } catch (err) {
      console.error("[onboarding-v3] W3 experiment create failed", err);
      setError("Couldn't create the experiment. Try again or skip this step.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-step-id="W3" className="space-y-4">
      <SpeechBubble>
        Now for the main event: an experiment. This is where your day-to-day
        work lives, with notes, results, and a method attached. Name it
        whatever you want.
      </SpeechBubble>

      {existing ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Experiment ready. Next we&apos;ll wire your method to it.
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            Experiment name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={DEFAULT_NAME}
            disabled={creating}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create experiment"}
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
