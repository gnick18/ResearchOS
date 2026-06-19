"use client";

// Wizard step: ask the user what they like to be called and save it as their
// preferred / greeting name. Skippable (the shell renders the Skip link; the
// name is editable anytime in Settings), so it never soft-locks the flow.
//
// The saved name is account-scoped (it follows the user across folders + devices)
// and wins over the display name's first word everywhere we greet them, so a
// "Dr. Grant Nickles" display name still greets as "Grant" rather than "Dr". When
// left blank, the greeting falls back to the honorific-stripped first name.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";

import BeakerBot from "@/components/BeakerBot";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { savePreferredName } from "@/lib/account/preferred-name";

export interface PreferredNameStepProps {
  /** Advance once the preferred name is saved (or left blank and saved). */
  onSaved: () => void;
  /**
   * Test/host seam: override the save. Returns ok so a preview or test can drive
   * the step without touching settings storage.
   */
  savePreferred?: (name: string) => Promise<{ ok: boolean }>;
}

export default function PreferredNameStep({
  onSaved,
  savePreferred,
}: PreferredNameStepProps) {
  const { currentUser } = useCurrentUser();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const doSave =
    savePreferred ?? ((value: string) => savePreferredName(currentUser ?? "", value));

  const submit = async () => {
    setSaving(true);
    await doSave(name);
    setSaving(false);
    onSaved();
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
      <div className="mb-3 h-16 w-16">
        <BeakerBot
          pose="idle"
          alive
          className="h-full w-full text-sky-400"
          ariaLabel="BeakerBot"
        />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        What do you like to be called?
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        I will greet you by this name. Most people just use a first name. You can
        change it anytime in Settings.
      </p>

      <div className="w-full text-left">
        <label
          htmlFor="wizard-preferred-name"
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
        >
          Preferred name
        </label>
        <input
          id="wizard-preferred-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="Grant"
          autoComplete="off"
          className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
        />
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        className="mt-6 w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save and continue"}
      </button>
    </div>
  );
}
