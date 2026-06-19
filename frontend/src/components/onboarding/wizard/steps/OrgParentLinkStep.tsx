"use client";

// Wizard step (department only): link the department to a parent institution.
// Skippable per the spec (can be linked later in settings).
//
// There is no institution directory-search endpoint yet (only the lab directory
// is searchable) and no parent-link persistence API, so this step accepts a
// parent-institution invite link or id the institution admin shared, and points
// the user at finishing the link from the dept settings. It does not silently
// fail: if there is nothing to link, the user skips (the shell owns Skip). See
// the handoff note for the directory-search + link API follow-up.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";

export interface OrgParentLinkStepProps {
  /** Advance after the user records a parent reference (or chooses to do it later). */
  onNext: (parentRef: string | null) => void;
}

export default function OrgParentLinkStep({ onNext }: OrgParentLinkStepProps) {
  const [ref, setRef] = useState("");

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        Link a parent institution
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        If your institution runs ResearchOS at the institution tier, paste the
        link they shared to associate this department. No institution? Skip this,
        you can link one anytime from your department settings.
      </p>

      <div className="w-full text-left">
        <label
          htmlFor="wizard-parent-ref"
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
        >
          Institution link or code (optional)
        </label>
        <input
          id="wizard-parent-ref"
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="Paste the institution link"
          className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
        />
      </div>

      <button
        type="button"
        onClick={() => onNext(ref.trim() || null)}
        className="mt-6 w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8]"
      >
        Continue
      </button>
    </div>
  );
}
