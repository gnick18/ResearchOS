import { useEffect, useState } from "react";
import { tasksApi } from "@/lib/local-api";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import {
  ensureExperimentArtifact,
  ensureMethodArtifact,
} from "./lib/auto-prerequisite";
import {
  decodeMethodSource,
  findArtifact,
} from "./lib/wizard-artifacts";

/**
 * W4: Link the W2 method to the W3 experiment (universal walkthrough).
 *
 * BeakerBot walks the user through the link UI. The brief offers a
 * "Link it for me" button as a backup; we use it as the primary
 * affordance inside the wizard (the real link UI lives on the
 * experiment detail page and would require a navigation away from
 * the modal, which breaks the wizard's resume contract). The user
 * still gets the conceptual moment of clicking "Link it" — just
 * inside the modal.
 *
 * Auto-prerequisites: if either W2 (method) or W3 (experiment) was
 * skipped, the corresponding `ensure*Artifact` helper runs first and
 * the link still works. No new artifact is logged here — the link
 * mutates the experiment's `method_ids`, which Phase 4 cleanup will
 * restore by detaching the method when the user discards either side.
 *
 * Next is gated until either (a) the link is in place, or (b) Skip is
 * used (handled by the shell).
 */

interface W4Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

export default function W4LinkMethodStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W4Props) {
  const methodArtifact = findArtifact(sidecar, "method");
  const experimentArtifact = findArtifact(sidecar, "experiment");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoPrereqRan, setAutoPrereqRan] = useState(false);

  useEffect(() => {
    setNextDisabled(!linked);
  }, [linked, setNextDisabled]);

  useEffect(() => {
    if (autoPrereqRan) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureMethodArtifact(sidecar, patchSidecar);
        await ensureExperimentArtifact(sidecar, patchSidecar);
      } catch (err) {
        console.warn("[onboarding-v3] W4 auto-prereqs failed", err);
      } finally {
        if (!cancelled) setAutoPrereqRan(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoPrereqRan, sidecar, patchSidecar]);

  const handleLink = async () => {
    if (busy || linked || !methodArtifact || !experimentArtifact) return;
    setBusy(true);
    setError(null);
    try {
      const decoded = decodeMethodSource(methodArtifact.id);
      const methodId = decoded ? decoded.methodId : Number(methodArtifact.id);
      const experimentId = Number(experimentArtifact.id);
      await tasksApi.addMethod(experimentId, methodId);
      setLinked(true);
    } catch (err) {
      console.error("[onboarding-v3] W4 link failed", err);
      setError("Couldn't link the method. Try again or skip this step.");
    } finally {
      setBusy(false);
    }
  };

  const ready = methodArtifact !== null && experimentArtifact !== null;

  return (
    <div data-step-id="W4" className="space-y-4">
      <SpeechBubble>
        Time to wire the method to the experiment. In the real app you click
        the little book icon on the experiment to attach a method. I&apos;ll
        run it through here so you can see what happens.
      </SpeechBubble>

      {linked ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Method linked. The experiment now knows what protocol to use.
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            Click the button below and I&apos;ll attach your method to your
            experiment. Open the experiment from your Workbench afterward and
            you&apos;ll see it listed under Methods.
          </p>
          <button
            type="button"
            onClick={() => void handleLink()}
            disabled={busy || !ready}
            className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {busy ? "Linking..." : "Link it for me"}
          </button>
          {!ready && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Hang tight, BeakerBot is setting up the pieces it needs.
            </p>
          )}
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
