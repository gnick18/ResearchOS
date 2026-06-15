"use client";

// Lab identity + branding: the "Set up your lab" capture step.
//
// Shown the first time a PI creates a lab, replacing the old SILENT auto-create.
// It captures the lab name (required), the PI title, and an optional logo, then
// hands them back to the parent (LabCreateResume) which provisions the lab with
// the branding and uploads the logo after the lab exists.
//
// Cancelling provisions the lab WITHOUT branding (the PI can fill it in later in
// Settings), so the step is never a soft-lock: there is always a way forward.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Reveal from "@/components/marketing/Reveal";
import BeakerBot from "@/components/BeakerBot";
import LabIdentityFields, {
  resolvePiTitle,
  type LabIdentityValue,
} from "./LabIdentityFields";
import type { PreparedLogo } from "@/lib/lab/lab-logo-image";

export interface LabSetupResult {
  labName: string;
  piTitle: string;
  piDisplay: string;
  logo: PreparedLogo | null;
}

export default function LabSetupStep({
  defaultPiDisplay,
  onSubmit,
  onSkip,
}: {
  /** Prefill for the PI name (the head's username), editable. */
  defaultPiDisplay: string;
  onSubmit: (result: LabSetupResult) => void;
  /** Provision the lab without branding (escape hatch, never a soft-lock). */
  onSkip: () => void;
}) {
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
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <MarketingBackdrop tone="soft" />
      <Reveal once className="relative z-10 w-full max-w-lg">
        <div className="rounded-2xl border border-border bg-surface/95 p-8 shadow-lg backdrop-blur">
          <div className="mb-6 flex items-center gap-4">
            <BeakerBot
              pose="cheering"
              animated
              className="h-14 w-14 shrink-0 text-sky-500"
              ariaLabel="BeakerBot, the ResearchOS assistant"
            />
            <div>
              <h1 className="text-heading font-semibold text-foreground">
                Set up your lab
              </h1>
              <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
                Give your lab an identity. Your members will see this when they
                join and while they work.
              </p>
            </div>
          </div>

          <LabIdentityFields
            value={value}
            onChange={setValue}
            logo={logo}
            onLogoChange={setLogo}
            onLogoError={setError}
          />

          {error && (
            <p className="mt-4 text-meta text-red-500 leading-relaxed" role="alert">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!nameValid}
              className="w-full rounded-md bg-brand-action px-4 py-3 text-body font-medium text-white hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create lab
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="w-full rounded-md border border-border bg-surface px-4 py-2.5 text-meta font-medium text-foreground-muted hover:bg-surface-hover"
            >
              Skip for now
            </button>
            <p className="text-center text-meta text-foreground-subtle leading-relaxed">
              You can change any of this later in Settings.
            </p>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
