"use client";

// Wizard step: claim the @handle for the researcher directory. Required (not
// skippable) for free and lab accounts, per the spec's skip table. On a
// successful claim (POST /api/account/profile) the step advances. The handle can
// be changed later in /settings.
//
// On mount it fetches any suggested handle (derived from the verified email) and
// prefills the input, matching the existing AccountHome claim form.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";

export interface HandleStepProps {
  /** Advance to the next step once the handle is claimed. */
  onClaimed: (handle: string) => void;
  /**
   * Test/host seam: override the network claim. Returns ok plus an optional
   * error so a preview or test can drive the step without a live API.
   */
  claimHandle?: (handle: string) => Promise<{ ok: boolean; error?: string }>;
  /** Test/host seam: override the suggested-handle fetch. */
  fetchSuggestion?: () => Promise<string>;
}

async function defaultClaim(handle: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/account/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, error: data.error ?? `Could not claim (HTTP ${res.status})` };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

async function defaultSuggestion(): Promise<string> {
  try {
    const res = await fetch("/api/account/profile");
    const data = (await res.json().catch(() => ({}))) as {
      suggestedHandle?: string;
    };
    return data.suggestedHandle ?? "";
  } catch {
    return "";
  }
}

export default function HandleStep({
  onClaimed,
  claimHandle = defaultClaim,
  fetchSuggestion = defaultSuggestion,
}: HandleStepProps) {
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const suggestion = await fetchSuggestion();
      if (alive && suggestion) setHandle(suggestion);
    })();
    return () => {
      alive = false;
    };
  }, [fetchSuggestion]);

  const submit = async () => {
    const trimmed = handle.trim().replace(/^@/, "");
    if (!trimmed) {
      setError("Pick a handle to continue.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await claimHandle(trimmed);
    setSaving(false);
    if (result.ok) {
      onClaimed(trimmed);
    } else {
      setError(result.error ?? "Could not claim that handle.");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        Claim your handle
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        This is how other researchers find you in the directory. You can change it
        later in Settings.
      </p>

      <div className="w-full text-left">
        <label
          htmlFor="wizard-handle"
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-muted"
        >
          Your handle
        </label>
        <div className="flex items-center rounded-xl border border-border bg-surface-raised focus-within:ring-2 focus-within:ring-[#1283c9]">
          <span className="pl-3 text-sm font-semibold text-foreground-muted">@</span>
          <input
            id="wizard-handle"
            type="text"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="your-handle"
            className="w-full bg-transparent px-1 py-2.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none"
          />
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving || !handle.trim()}
        className="mt-6 w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Claiming..." : "Claim handle and continue"}
      </button>
    </div>
  );
}
