import { useEffect, useMemo, useState } from "react";
import { tasksApi } from "@/lib/local-api";
import type { Task } from "@/lib/types";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import { ensureExperimentArtifact } from "./lib/auto-prerequisite";
import { useTypewriter } from "./lib/use-typewriter";
import { findArtifact } from "./lib/wizard-artifacts";

/**
 * W7: Search tour (universal walkthrough).
 *
 * BeakerBot live-types a query that matches W3's experiment name into
 * a simulated search input inside the wizard, then the wizard surfaces
 * a single hit (the experiment we just created) using the same
 * `tasksApi.get` read the real Search page would use. The brief asks
 * us to "open Search tab" — same constraint as W5: navigating away
 * breaks the modal. We render the search-mirror INSIDE the wizard so
 * the user gets the visual moment of search-typing-then-hit without
 * leaving the flow.
 *
 * No artifact is logged: a search query is a transient action.
 *
 * Next is gated until the typewriter finishes.
 */

interface W7Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

export default function W7SearchTourStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W7Props) {
  const experimentArtifact = findArtifact(sidecar, "experiment");
  const [experiment, setExperiment] = useState<Task | null>(null);
  const [autoPrereqRan, setAutoPrereqRan] = useState(false);

  useEffect(() => {
    if (autoPrereqRan) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureExperimentArtifact(sidecar, patchSidecar);
      } catch (err) {
        console.warn("[onboarding-v3] W7 auto-prereq W3 failed", err);
      } finally {
        if (!cancelled) setAutoPrereqRan(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoPrereqRan, sidecar, patchSidecar]);

  useEffect(() => {
    if (!experimentArtifact) {
      setExperiment(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const t = await tasksApi.get(Number(experimentArtifact.id));
        if (!cancelled) setExperiment(t ?? null);
      } catch (err) {
        console.warn("[onboarding-v3] W7 experiment read failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [experimentArtifact]);

  const query = useMemo(
    () => experiment?.name ?? "My First Experiment",
    [experiment],
  );

  const { revealed, done } = useTypewriter(query, {
    cadenceMs: 95,
    key: query,
    active: experiment !== null,
  });

  useEffect(() => {
    setNextDisabled(!done);
  }, [done, setNextDisabled]);

  return (
    <div data-step-id="W7" className="space-y-4">
      <SpeechBubble>
        Lose something? Search finds it. Watch me type your experiment&apos;s
        name, then look how the result lights up. The real Search tab does
        the same thing, with filters for method, project, dates, the whole
        kit.
      </SpeechBubble>

      <div className="space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white">
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35m1.35-5.65a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <span
            data-w7-query
            className="font-mono text-sm text-gray-900 flex-1"
          >
            {revealed}
            {!done && <span className="animate-pulse">|</span>}
          </span>
        </div>

        {done && experiment ? (
          <div
            data-w7-result
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
          >
            <p className="text-xs text-emerald-700 font-medium uppercase tracking-wide">
              1 result
            </p>
            <p className="text-sm font-medium text-emerald-900 mt-0.5">
              {experiment.name}
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Experiment · starts {experiment.start_date}
            </p>
          </div>
        ) : (
          <p className="text-xs text-gray-400">
            {experiment ? "Typing..." : "Waiting on your experiment..."}
          </p>
        )}
      </div>
    </div>
  );
}
