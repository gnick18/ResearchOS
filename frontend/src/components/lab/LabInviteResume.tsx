"use client";

// Lab tier Phase 8e: app-wide pending-invite resume banner.
//
// Mirrors SharingClaimResume. Mounted once in AppShell so it shows on every
// signed-in surface. When a user finishes onboarding (they now have a folder +
// unlocked identity) and an invite was stashed (lab-invite-stash.ts), a small
// banner brings them back to /lab/join to accept / enter the lab.
//
// Inert unless the lab tier is on, the stashed invite is valid + unexpired, the
// user has an unlocked identity, and they are not already in that same lab.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLabSession } from "@/hooks/useLabSession";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import {
  decodeInviteFragment,
  isInviteExpired,
  type LabInvitePayload,
} from "@/lib/lab/lab-invite";
import {
  readStashedInviteFragment,
  clearStashedInvite,
} from "@/lib/lab/lab-invite-stash";

export default function LabInviteResume() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const session = useLabSession();
  const [invite, setInvite] = useState<LabInvitePayload | null>(null);

  useEffect(() => {
    if (!LAB_TIER_ENABLED) return;
    if (!currentUser) return;
    // Only nudge once an identity is unlocked (they can actually accept).
    if (!getSessionIdentity()) return;
    const frag = readStashedInviteFragment();
    if (!frag) return;
    const decoded = decodeInviteFragment(frag);
    if (!decoded || isInviteExpired(decoded, Date.now())) {
      clearStashedInvite();
      return;
    }
    // Already in this lab: nothing to resume.
    const resolvedLabId = session && !session.loading ? session.labId : null;
    if (resolvedLabId === decoded.labId) {
      clearStashedInvite();
      return;
    }
    setInvite(decoded);
  }, [currentUser, session]);

  if (!invite) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4">
      <div className="flex w-full max-w-xl items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg">
        <p className="flex-1 text-meta text-foreground leading-relaxed">
          <b>{invite.headUsername}</b> invited you to join their lab.
        </p>
        <button
          type="button"
          onClick={() => router.push("/lab/join")}
          className="ros-btn-raise rounded-md bg-brand-action px-3 py-2 text-meta font-medium text-white hover:bg-brand-action/90"
        >
          Join
        </button>
        <button
          type="button"
          onClick={() => {
            clearStashedInvite();
            setInvite(null);
          }}
          className="rounded-md border border-border bg-surface px-3 py-2 text-meta font-medium text-foreground hover:bg-surface-hover"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
