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
 * The radio's visual state reads from a local `pick` value, NOT from the
 * sidecar's `feature_picks.purchases`. The sidecar is the eventual
 * persistence target but writes are async (50-200ms via fileService
 * .tmp+move), so reading the sidecar between click and write completion
 * shows the previous value briefly and flickers the "Maybe later" radio
 * because the initial feature_picks object defaults every Q2-Q5 field
 * to "maybe". Single-source-of-truth on the local pick eliminates the
 * flicker. Back-stepping into this step from a later step remounts the
 * component, so `pick` resets to null and the user re-confirms before
 * Next re-enables.
 */
export default function Q2PurchasesStep({
  sidecar: _sidecar,
  setNextDisabled,
  patchSidecar,
}: Q2Props) {
  const [pick, setPick] = useState<FeaturePicks["purchases"] | null>(null);

  useEffect(() => {
    setNextDisabled(pick === null);
  }, [pick, setNextDisabled]);

  const handleChange = (next: FeaturePicks["purchases"]) => {
    setPick(next);
    void patchSidecar((cur) => {
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
          selected={pick === "yes"}
          onChange={handleChange}
          label="Yes"
          description="Show the Purchases tab and walk me through the purchase flow during the tour."
        />
        <RadioCard
          name="q2-purchases"
          value="no"
          selected={pick === "no"}
          onChange={handleChange}
          label="No"
          description="Hide the Purchases tab. I can turn it on later from Settings."
        />
        <RadioCard
          name="q2-purchases"
          value="maybe"
          selected={pick === "maybe"}
          onChange={handleChange}
          label="Maybe later"
          description="Hide it for now. Same as No, but a friendlier no."
        />
      </div>
    </div>
  );
}
