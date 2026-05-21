import { useEffect, useState } from "react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "../walkthrough/lib/SpeechBubble";
import { appendArtifact } from "../walkthrough/lib/wizard-artifacts";
import { BEAKERBOT_DISPLAY_NAME } from "./lib/beakerbot-user";
import {
  encodeLabTaskId,
  findLabTask,
} from "./lib/lab-artifacts";

/**
 * L8: Lab purchases tour (conditional on Q2 === "yes", gated in the
 * state machine).
 *
 * BeakerBot "creates" a sample purchase request authored as
 * BeakerBot so the user sees a teammate's request appear on the Lab
 * purchases page. The request is registered as a `lab_task` artifact
 * (role `purchase-demo`) inside the wizard for Phase 4 visibility.
 * The actual request record is simulated for P3a (same rationale as
 * L2 / L4 — see lab-artifacts.ts).
 */

interface L8Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const REQUEST_NAME = "Pipette tips, 200uL filter";
const REQUEST_PRICE = "$84";

export default function L8LabPurchases({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: L8Props) {
  const existing = findLabTask(sidecar, "purchase-demo");
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(existing === null);
  }, [existing, setNextDisabled]);

  useEffect(() => {
    if (existing || registering) return;
    let cancelled = false;
    void (async () => {
      setRegistering(true);
      try {
        await patchSidecar((cur) =>
          appendArtifact(cur, {
            type: "lab_task",
            id: encodeLabTaskId("purchase-demo"),
            cleanup_default: "discard",
          }),
        );
      } catch (err) {
        if (!cancelled) {
          console.error("[onboarding-v3] L8 purchase register failed", err);
          setError("Couldn't drop in the sample request. Try again.");
        }
      } finally {
        if (!cancelled) setRegistering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [existing, patchSidecar, registering]);

  return (
    <div data-step-id="L8" className="space-y-4">
      <SpeechBubble>
        Lab Mode&apos;s Purchases tab aggregates every teammate&apos;s
        requests. Watch — I&apos;ll drop a sample request in as me, and
        you&apos;ll see it labeled with my name and color.
      </SpeechBubble>

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Lab Purchases, preview
        </div>
        <div className="flex items-center gap-3" data-l8-request>
          <div
            aria-hidden
            className="w-2.5 h-2.5 rounded-full bg-sky-500 flex-shrink-0"
          />
          <div className="flex-1 text-sm">
            <div className="font-medium text-gray-900">{REQUEST_NAME}</div>
            <div className="text-xs text-gray-500">
              {REQUEST_PRICE} • requested by {BEAKERBOT_DISPLAY_NAME}
            </div>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200 rounded">
            Pending approval
          </span>
        </div>
      </div>

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
