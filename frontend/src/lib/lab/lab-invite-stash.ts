// Lab tier Phase 8e: persist a pending invite across onboarding.
//
// A brand-new user who opens an invite link has no folder/identity yet, so they
// cannot accept immediately. We stash the invite fragment in localStorage so it
// survives the folder-connect + identity-create + OAuth round-trips, then the
// app-wide LabInviteResume banner brings them back to /lab/join to accept.
//
// We store the raw URL hash fragment (base64url payload), not a parsed object,
// so the consumer decodes + re-validates it exactly as if it came from the URL.
//
// Phase 4B token invites stash a bare server token in sessionStorage instead (the
// /lab/join page writes it before a sign-in round trip). Onboarding needs ONE
// question answered across both shapes: "did this visitor arrive via an invite,
// so they must JOIN a lab and never be pushed to create their own?". That is what
// readPendingLabInvite / hasPendingLabInvite below answer.
//
// No emojis, no em-dashes, no mid-sentence colons.

import {
  decodeInviteFragment,
  isInviteExpired,
} from "./lab-invite";

const KEY = "ros:pendingLabInvite";

// The bare-token (Phase 4B) stash key. Owned here so the /lab/join page and the
// onboarding readers agree on one string instead of each holding a copy.
export const LAB_TOKEN_STASH_KEY = "lab-token-invite-pending";

const BARE_TOKEN_RE = /^[0-9a-f]{64}$/;

export function stashInviteFragment(fragment: string): void {
  try {
    if (fragment) localStorage.setItem(KEY, fragment);
  } catch {
    // localStorage can throw in private mode / disabled storage; the invite
    // simply will not persist across onboarding, which is acceptable.
  }
}

export function readStashedInviteFragment(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearStashedInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Read the stashed Phase 4B bare server token, or null when absent / malformed. */
export function readStashedLabToken(): string | null {
  try {
    const t = (sessionStorage.getItem(LAB_TOKEN_STASH_KEY) ?? "").trim();
    return BARE_TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** A pending invite the visitor arrived with, distilled to what onboarding shows. */
export interface PendingLabInvite {
  /** The head's username/handle, for display. Empty for a bare server token. */
  headUsername: string;
  /** The lab's display name when the signed payload carries one, else null. */
  labName: string | null;
  /** The labId when known (signed payload); null for a bare server token. */
  labId: string | null;
}

/**
 * Whether the visitor arrived via a lab invite that is still pending, and the
 * display fields onboarding needs. True for either shape:
 *   - a valid, unexpired signed invite fragment in localStorage (stashed by the
 *     /lab/join page so it survives the folder-connect + sign-in round trips), or
 *   - a bare Phase 4B server token in sessionStorage.
 *
 * Onboarding reads this to keep an invited user on the JOIN path and never funnel
 * them into creating their own lab (the spurious-second-lab bug). Returns null
 * when there is no pending invite. Safe on the server (storage reads are guarded),
 * where it returns null.
 */
export function readPendingLabInvite(): PendingLabInvite | null {
  const frag = readStashedInviteFragment();
  if (frag) {
    const decoded = decodeInviteFragment(frag);
    if (decoded && !isInviteExpired(decoded, Date.now())) {
      return {
        headUsername: decoded.headUsername,
        labName: decoded.labName ?? null,
        labId: decoded.labId,
      };
    }
  }
  if (readStashedLabToken()) {
    return { headUsername: "", labName: null, labId: null };
  }
  return null;
}

/** Convenience boolean form of {@link readPendingLabInvite}. */
export function hasPendingLabInvite(): boolean {
  return readPendingLabInvite() !== null;
}
