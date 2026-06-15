"use client";

// Wizard step: fill the researcher profile. Skippable (the profile is editable
// anytime in /settings). Per the resolved Q3 default, photo upload is deferred
// to /settings, so this step captures display name and affiliation only, the
// fields the profile API (POST /api/account/profile) persists today.
//
// Short bio and optional links (ORCID / ResearchGate / website) are part of the
// researcher-social-layer profile and need the richer profile API before they
// can be captured here without dead-ending. They are intentionally not rendered
// yet, so nothing on this step is inert. See the handoff note.
//
// On Continue it saves and advances. Skip (handled by the shell) advances
// without saving.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import BeakerBot from "@/components/BeakerBot";

export interface ProfileStepProps {
  /** Advance once the profile fields are saved (or left blank and saved). */
  onSaved: () => void;
  /**
   * Test/host seam: override the network save. Returns ok plus an optional
   * error.
   */
  saveProfile?: (fields: {
    displayName: string;
    affiliation: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

async function defaultSave(fields: {
  displayName: string;
  affiliation: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    // The handle is already claimed in the prior step, so the profile row
    // exists; this update only sets the optional display fields. The API
    // requires a handle in the body, so we omit it and let the server keep the
    // claimed one by sending only the fields we are changing is not supported,
    // so we send them under the existing handle via the same POST. To stay
    // resilient we read the current handle first.
    const current = await fetch("/api/account/profile");
    const cur = (await current.json().catch(() => ({}))) as {
      profile?: { handle?: string } | null;
    };
    const handle = cur.profile?.handle;
    if (!handle) {
      // No claimed handle (should not happen after the handle step); skip the
      // save rather than error the user out of the wizard.
      return { ok: true };
    }
    const res = await fetch("/api/account/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle,
        displayName: fields.displayName,
        affiliation: fields.affiliation,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, error: data.error ?? `Could not save (HTTP ${res.status})` };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

export default function ProfileStep({
  onSaved,
  saveProfile = defaultSave,
}: ProfileStepProps) {
  const [displayName, setDisplayName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    setSaving(true);
    const result = await saveProfile({
      displayName: displayName.trim(),
      affiliation: affiliation.trim(),
    });
    setSaving(false);
    if (result.ok) {
      onSaved();
    } else {
      setError(result.error ?? "Could not save your profile.");
    }
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
        Set up your profile
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        How you appear to other researchers. All optional, and editable anytime in
        Settings, including your photo, bio, and links.
      </p>

      <div className="w-full space-y-4 text-left">
        <div>
          <label
            htmlFor="wizard-display-name"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            Display name
          </label>
          <input
            id="wizard-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Dr. Jane Researcher"
            className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
          />
        </div>
        <div>
          <label
            htmlFor="wizard-affiliation"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
          >
            Affiliation
          </label>
          <input
            id="wizard-affiliation"
            type="text"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
            placeholder="University, department, or lab"
            className="w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-[#1283c9]"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 w-full text-left text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

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
