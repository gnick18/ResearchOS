import { useEffect, useState } from "react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";

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
 * flicker.
 *
 * P12 fix: on mount, hydrate `pick` from the sidecar so a Resume from
 * the mid-tour modal lands on the step with the saved answer still
 * selected. Pre-P12 the local state always started at `null` which
 * forced the user to re-click their pick after every refresh; that
 * was part of the "I keep losing my answers" complaint. We treat
 * `"maybe"` as a real saved value too — it is the default but Q1
 * sets it explicitly when initializing feature_picks, so seeing it
 * pre-selected after Resume matches what the user explicitly chose or
 * deferred. Back-stepping into this step from a later step also lands
 * the user on their previous answer.
 *
 * v4 port: same shape as v3's Q2PurchasesStep plus P12 hydration,
 * mounted on the v4 tour controller's modal-setup surface per L9.
 */
export default function Q2PurchasesStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const [pick, setPick] = useState<FeaturePicks["purchases"] | null>(
    () => sidecar?.feature_picks?.purchases ?? null,
  );

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
      <p className="text-body text-gray-700 leading-relaxed">
        Do you want to track lab purchases and reagent orders? You can
        enable the tracker now or leave it off to keep things simple.
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
