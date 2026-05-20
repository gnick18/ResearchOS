import { useEffect, useState } from "react";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";

interface Q2Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

/**
 * Q2: track lab purchases? Yes / No / Maybe later. Persists
 * `feature_picks.purchases`.
 *
 * The initial feature_picks object (built by Q1) defaults every Q2-Q5
 * field to "maybe", which means the radio visually starts pre-selected
 * even before the user has interacted. To honor the brief's "Next
 * disabled until a pick is made" rule, this component tracks a local
 * `hasInteracted` flag and gates Next on it (not on the sidecar value).
 * Back-stepping into this step from a later step resets `hasInteracted`,
 * so the user re-confirms the answer before Next re-enables.
 */
export default function Q2PurchasesStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: Q2Props) {
  const picks = sidecar?.feature_picks ?? null;
  const current = picks?.purchases ?? "maybe";
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    setNextDisabled(!hasInteracted);
  }, [hasInteracted, setNextDisabled]);

  const handleChange = async (next: FeaturePicks["purchases"]) => {
    setHasInteracted(true);
    await patchSidecar((cur) => {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, purchases: next },
      };
    });
  };

  return (
    <div data-step-id="setup-q2" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        Some folks like tracking every reagent, antibody, and overpriced
        pipette tip. Some folks would rather forget the receipts exist. Do
        you want a Purchases tab?
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="q2-purchases"
          value="yes"
          selected={hasInteracted && current === "yes"}
          onChange={(v) => void handleChange(v)}
          label="Yes"
          description="Show the Purchases tab and walk me through the purchase flow during the tour."
        />
        <RadioCard
          name="q2-purchases"
          value="no"
          selected={hasInteracted && current === "no"}
          onChange={(v) => void handleChange(v)}
          label="No"
          description="Hide the Purchases tab. I can turn it on later from Settings."
        />
        <RadioCard
          name="q2-purchases"
          value="maybe"
          selected={hasInteracted && current === "maybe"}
          onChange={(v) => void handleChange(v)}
          label="Maybe later"
          description="Hide it for now. Same as No, but a friendlier no."
        />
      </div>
    </div>
  );
}
