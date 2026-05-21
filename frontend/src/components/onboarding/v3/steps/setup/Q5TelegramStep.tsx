import { useEffect, useState } from "react";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";

interface Q5Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

/**
 * Q5: want a Telegram bot for image inbox? Yes / No / Maybe later.
 * Persists `feature_picks.telegram`. Local-pick state pattern to avoid
 * the sidecar-write-latency flicker (see Q2 docstring for the full why).
 *
 * Note: this step ONLY captures the user's intent. The actual Telegram
 * pair flow runs in W12 (P2c), conditional on `picks.telegram === "yes"`.
 */
export default function Q5TelegramStep({
  sidecar: _sidecar,
  setNextDisabled,
  patchSidecar,
}: Q5Props) {
  const [pick, setPick] = useState<FeaturePicks["telegram"] | null>(null);

  useEffect(() => {
    setNextDisabled(pick === null);
  }, [pick, setNextDisabled]);

  const handleChange = (next: FeaturePicks["telegram"]) => {
    setPick(next);
    void patchSidecar((cur) => {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, telegram: next },
      };
    });
  };

  return (
    <div data-step-id="setup-q5" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        Lab benches are messy. Snap a gel photo on your phone, send it to
        the ResearchOS Telegram bot, and the image lands in your inbox
        ready to attach to an experiment note. Want me to set that up
        during the tour?
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="q5-telegram"
          value="yes"
          selected={pick === "yes"}
          onChange={handleChange}
          label="Yes"
          description="Walk me through pairing the bot during the tour."
        />
        <RadioCard
          name="q5-telegram"
          value="no"
          selected={pick === "no"}
          onChange={handleChange}
          label="No"
          description="Skip the Telegram bot. I can pair it later from Settings."
        />
        <RadioCard
          name="q5-telegram"
          value="maybe"
          selected={pick === "maybe"}
          onChange={handleChange}
          label="Maybe later"
          description="Skip for now. The bot will still be there if I change my mind."
        />
      </div>
    </div>
  );
}
