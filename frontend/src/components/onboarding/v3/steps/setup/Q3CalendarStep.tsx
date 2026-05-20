import { useEffect, useState } from "react";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";

interface Q3Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

/**
 * Q3: want calendar feeds? Yes / No / Maybe later. Persists
 * `feature_picks.calendar`. Same hasInteracted-gated Next pattern as Q2.
 */
export default function Q3CalendarStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: Q3Props) {
  const picks = sidecar?.feature_picks ?? null;
  const current = picks?.calendar ?? "maybe";
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    setNextDisabled(!hasInteracted);
  }, [hasInteracted, setNextDisabled]);

  const handleChange = async (next: FeaturePicks["calendar"]) => {
    setHasInteracted(true);
    await patchSidecar((cur) => {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, calendar: next },
      };
    });
  };

  return (
    <div data-step-id="setup-q3" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        ResearchOS can subscribe to calendar feeds (Google, Outlook, iCloud,
        ICS files from your university). Want me to show you that flow and
        turn on the Calendar tab?
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="q3-calendar"
          value="yes"
          selected={hasInteracted && current === "yes"}
          onChange={(v) => void handleChange(v)}
          label="Yes"
          description="Show the Calendar tab and walk me through subscribing to a feed."
        />
        <RadioCard
          name="q3-calendar"
          value="no"
          selected={hasInteracted && current === "no"}
          onChange={(v) => void handleChange(v)}
          label="No"
          description="Hide the Calendar tab. I can turn it on later from Settings."
        />
        <RadioCard
          name="q3-calendar"
          value="maybe"
          selected={hasInteracted && current === "maybe"}
          onChange={(v) => void handleChange(v)}
          label="Maybe later"
          description="Hide it for now. Ask me again sometime."
        />
      </div>
    </div>
  );
}
