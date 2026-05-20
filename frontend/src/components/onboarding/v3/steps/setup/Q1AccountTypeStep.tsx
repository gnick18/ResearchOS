import { useEffect } from "react";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import { initialFeaturePicks } from "./feature-picks-init";
import RadioCard from "./RadioCard";

interface Q1Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

/**
 * Q1: solo or lab? Single-select radio. Writes
 * `feature_picks.account_type` on pick. Q1 is the first step that
 * persists a pick, so it constructs the initial FeaturePicks object via
 * {@link initialFeaturePicks} when the sidecar's feature_picks is still
 * null. Subsequent Q steps spread + override on the existing object.
 */
export default function Q1AccountTypeStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: Q1Props) {
  const picks = sidecar?.feature_picks ?? null;
  const current = picks?.account_type ?? null;

  useEffect(() => {
    setNextDisabled(current === null);
  }, [current, setNextDisabled]);

  const handleChange = async (next: FeaturePicks["account_type"]) => {
    await patchSidecar((cur) => {
      const base = cur.feature_picks ?? initialFeaturePicks(next);
      return {
        ...cur,
        feature_picks: { ...base, account_type: next },
      };
    });
  };

  return (
    <div data-step-id="setup-q1" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        First call: are you flying solo, or is this for a whole lab? No
        wrong answer, and you can flip it later in Settings.
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="account-type"
          value="solo"
          selected={current === "solo"}
          onChange={(v) => void handleChange(v)}
          label="Solo"
          description="Just me on my account. Could be a startup, an independent project, or a personal research bench."
        />
        <RadioCard
          name="account-type"
          value="lab"
          selected={current === "lab"}
          onChange={(v) => void handleChange(v)}
          label="Lab"
          description="Multiple people working together in a shared data folder."
        />
      </div>
    </div>
  );
}
