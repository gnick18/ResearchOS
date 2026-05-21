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
 * `feature_picks.calendar`. Local-pick state pattern to avoid the
 * sidecar-write-latency flicker (see Q2 docstring for the full why).
 */
export default function Q3CalendarStep({
  sidecar: _sidecar,
  setNextDisabled,
  patchSidecar,
}: Q3Props) {
  const [pick, setPick] = useState<FeaturePicks["calendar"] | null>(null);

  useEffect(() => {
    setNextDisabled(pick === null);
  }, [pick, setNextDisabled]);

  const handleChange = (next: FeaturePicks["calendar"]) => {
    setPick(next);
    void patchSidecar((cur) => {
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
          selected={pick === "yes"}
          onChange={handleChange}
          label="Yes"
          description="Show the Calendar tab and walk me through subscribing to a feed."
        />
        <RadioCard
          name="q3-calendar"
          value="no"
          selected={pick === "no"}
          onChange={handleChange}
          label="No"
          description="Hide the Calendar tab. I can turn it on later from Settings."
        />
        <RadioCard
          name="q3-calendar"
          value="maybe"
          selected={pick === "maybe"}
          onChange={handleChange}
          label="Maybe later"
          description="Hide it for now. Ask me again sometime."
        />
      </div>
    </div>
  );
}
