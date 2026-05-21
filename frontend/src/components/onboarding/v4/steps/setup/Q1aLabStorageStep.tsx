import { useEffect } from "react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";

/**
 * Q1a (lab only): where will the lab data live? Five-option radio.
 * Gated by the step machine on `account_type === "lab"`, so this
 * component assumes picks is already non-null and has account_type set.
 *
 * v4 port: identical to v3's Q1aLabStorageStep, mounted under the v4
 * tour controller's modal-setup surface per L9.
 */
export default function Q1aLabStorageStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const picks = sidecar?.feature_picks ?? null;
  const current = picks?.lab_storage ?? null;

  useEffect(() => {
    setNextDisabled(current === null || current === undefined);
  }, [current, setNextDisabled]);

  const handleChange = async (
    next: NonNullable<FeaturePicks["lab_storage"]>,
  ) => {
    await patchSidecar((cur) => {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, lab_storage: next },
      };
    });
  };

  return (
    <div data-step-id="setup-q1a" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        Every lab member needs to point their ResearchOS at the same folder.
        Pick where that shared folder lives. (Storage providers handle the
        sync; ResearchOS just reads and writes files.)
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="lab-storage"
          value="local"
          selected={current === "local"}
          onChange={(v) => void handleChange(v)}
          label="Local disk only"
          description="Each lab member picks their own local folder. Good for testing or for labs with bespoke sync setups."
        />
        <RadioCard
          name="lab-storage"
          value="google_drive"
          selected={current === "google_drive"}
          onChange={(v) => void handleChange(v)}
          label="Google Drive shared folder"
          description="A folder shared with the lab via Google Drive."
        />
        <RadioCard
          name="lab-storage"
          value="onedrive"
          selected={current === "onedrive"}
          onChange={(v) => void handleChange(v)}
          label="OneDrive shared folder"
          description="A folder shared with the lab via Microsoft OneDrive."
        />
        <RadioCard
          name="lab-storage"
          value="box"
          selected={current === "box"}
          onChange={(v) => void handleChange(v)}
          label="Box shared folder"
          description="A folder shared with the lab via Box."
        />
        <RadioCard
          name="lab-storage"
          value="deferred"
          selected={current === "deferred"}
          onChange={(v) => void handleChange(v)}
          label="I'll figure it out later"
          description="Skip this for now. ResearchOS works on a local folder until you're ready to switch."
        />
      </div>
    </div>
  );
}
