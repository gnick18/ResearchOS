"use client";

// Wizard step: roster / invites. Skippable (the admin can invite from the portal
// later). Generates an invite link for the org via the existing folderless mint
// helper, which the admin copies and shares. Department orgs invite lab heads;
// institution orgs invite department admins.
//
// Minting is on demand (a button), so skipping costs nothing and a slow mint
// never blocks the wizard. The shell owns the Skip link.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";
import { Icon } from "@/components/icons";
import type { OrgKind } from "./OrgNameStep";

export interface OrgRosterStepProps {
  kind: OrgKind;
  /** The org id created in the name step. */
  orgId: string;
  /** Advance to the next step. */
  onNext: () => void;
  /**
   * Test/host seam: override the mint call. Defaults to the real folderless mint
   * helper for the kind.
   */
  mintInvite?: (orgId: string) => Promise<{ ok: boolean; link?: string; error?: string }>;
}

async function defaultMint(
  kind: OrgKind,
  orgId: string,
): Promise<{ ok: boolean; link?: string; error?: string }> {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  try {
    if (kind === "department") {
      const { mintInviteForDeptAdmin } = await import(
        "@/lib/dept/dept-admin-membership"
      );
      const r = await mintInviteForDeptAdmin({ deptId: orgId, origin });
      return { ok: true, link: r.link };
    }
    const { mintInviteForInstitutionAdmin } = await import(
      "@/lib/institution/institution-admin-membership"
    );
    const r = await mintInviteForInstitutionAdmin({ institutionId: orgId, origin });
    return { ok: true, link: r.link };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not mint the invite." };
  }
}

export default function OrgRosterStep({
  kind,
  orgId,
  onNext,
  mintInvite,
}: OrgRosterStepProps) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);

  const inviteeNoun = kind === "department" ? "lab heads" : "department admins";

  const mint = async () => {
    setError(null);
    setMinting(true);
    const mintFn = mintInvite ?? ((id: string) => defaultMint(kind, id));
    const result = await mintFn(orgId);
    setMinting(false);
    if (result.ok && result.link) {
      setLink(result.link);
    } else {
      setError(result.error ?? "Could not mint the invite link.");
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; the link is visible to copy by hand
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        Invite your {inviteeNoun}
      </h1>
      <p className="mb-6 mt-2 text-sm text-foreground-muted">
        Generate an invite link to share with your {inviteeNoun}. You can always
        mint more from the admin portal later, so skip this for now if you prefer.
      </p>

      {!link ? (
        <button
          type="button"
          onClick={() => void mint()}
          disabled={minting}
          className="w-full rounded-xl bg-[#1283c9] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0f6fa8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {minting ? "Generating..." : "Generate an invite link"}
        </button>
      ) : (
        <div className="w-full space-y-3 text-left">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {link}
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex flex-none items-center gap-1.5 rounded-lg bg-[#1283c9] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0f6fa8]"
            >
              {copied ? (
                <>
                  <Icon name="check" className="h-3.5 w-3.5" aria-hidden="true" />
                  Copied
                </>
              ) : (
                "Copy"
              )}
            </button>
          </div>
          <p className="text-xs text-foreground-muted">
            Share this link with one person. Generate more from the admin portal.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 w-full text-left text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onNext}
        className="mt-6 w-full rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-sunken"
      >
        Continue
      </button>
    </div>
  );
}
