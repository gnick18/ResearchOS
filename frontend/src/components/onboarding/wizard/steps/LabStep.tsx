"use client";

// Wizard step: set up the lab (PI / lab Create track). Reuses LabIdentityFields
// (the same name + PI title + optional logo block as the existing LabSetupStep
// and the Settings lab editor) inside the embedded stepper frame.
//
// Lab name is required (the shell does not skip-list this step, per the spec).
// On Continue it hands the captured identity to the host via onSubmit; the host
// stashes it so the existing LabCreateResume provisions the lab with this
// branding after the account and folder are in place (the same path the chooser
// used). Member invite links are generated later from the lab portal, so this
// step captures identity only, matching the spec note "invites can be done
// later".
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import BeakerBot from "@/components/BeakerBot";
import LabIdentityFields, {
  resolvePiTitle,
  type LabIdentityValue,
} from "@/components/lab/LabIdentityFields";
import type { PreparedLogo } from "@/lib/lab/lab-logo-image";

export interface LabStepResult {
  labName: string;
  piTitle: string;
  piDisplay: string;
  logo: PreparedLogo | null;
}

export interface LabStepProps {
  /** Prefill for the PI display name (the head's name), editable. */
  defaultPiDisplay?: string;
  /** Advance once the lab identity is captured. */
  onSubmit: (result: LabStepResult) => void;
}

export default function LabStep({ defaultPiDisplay = "", onSubmit }: LabStepProps) {
  const [value, setValue] = useState<LabIdentityValue>({
    labName: "",
    piTitlePreset: "Dr.",
    piTitleCustom: "",
    piDisplay: defaultPiDisplay,
  });
  const [logo, setLogo] = useState<PreparedLogo | null>(null);
  const [error, setError] = useState<string>("");

  const nameValid = value.labName.trim().length > 0;

  const submit = () => {
    if (!nameValid) {
      setError("Give your lab a name to continue.");
      return;
    }
    onSubmit({
      labName: value.labName.trim(),
      piTitle: resolvePiTitle(value),
      piDisplay: value.piDisplay.trim() || defaultPiDisplay,
      logo,
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
      <div className="mb-3 h-16 w-16">
        <BeakerBot
          pose="cheering"
          alive
          className="h-full w-full text-sky-400"
          ariaLabel="BeakerBot"
        />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        Set up your lab
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        Give your lab an identity. Members see this when they join. You can invite
        people and change any of this later from the lab settings.
      </p>

      <div className="w-full text-left">
        <LabIdentityFields
          value={value}
          onChange={setValue}
          logo={logo}
          onLogoChange={setLogo}
          onLogoError={setError}
        />
      </div>

      {error && (
        <p className="mt-3 w-full text-left text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!nameValid}
        className="mt-6 w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Continue
      </button>
    </div>
  );
}
