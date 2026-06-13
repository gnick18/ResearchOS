"use client";

// useAccountCapabilities (capabilities bot, 2026-06-13).
//
// THE single source of truth for "what can this account do." Surfaces read
// NAMED capabilities (canShare, canUseAI, ...) instead of recombining the raw
// primitives (identity status, build flags) by hand. The capability -> primitive
// RULES live in this one file, so a rule change ("AI is now free for solo") is a
// one-line edit here, not a 15-file hunt.
//
// Spec: docs/proposals/2026-06-13-unified-account-capabilities.md (Phase 1).
// Decisions LOCKED by Grant:
//   - BeakerBot AI is ACCOUNT-ONLY: canUseAI = AI_ASSISTANT_ENABLED && account.
//   - Off-capability default: HIDE deep-in-flow controls, show a gentle UPSELL
//     at discovery surfaces. The model centralizes which upsell maps to which
//     capability so it is consistent everywhere.
//
// This is a CLIENT hook (it reads useSharingIdentity, which reads the folder).
// Only call it from client components. For a server-component caller, gate at
// the nearest client child.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import { useMemo } from "react";

import { useSharingIdentity } from "./useSharingIdentity";
import { AI_ASSISTANT_ENABLED } from "@/lib/ai/config";
import {
  isRealSharingEnabled,
  isOAuthPublishAvailable,
} from "@/lib/sharing/oauth-availability";
import { EXTERNAL_COLLAB_ENABLED } from "@/lib/loro/config";
import { isBillingEnabled } from "@/lib/billing/config";

// The coarse headline ("the one var"). Set it and the screen changes; the
// fine-grained canX flags below derive from this plus the feature flags.
//   solo    = identity status "none"          (no account here, fully local)
//   locked  = identity status "needs-restore" (account exists, key not on hand)
//   account = identity status "ready"         (account ready, send/receive work)
// While the identity is still loading we report "solo" so nothing flashes a
// premature account-only control; the hook re-renders to "account" once the
// read settles. (A capability appearing late is safe; a dead control is not.)
export type AccountMode = "solo" | "locked" | "account";

export interface AccountCapabilities {
  mode: AccountMode;
  /** Account exists AND is in the directory (has an email). */
  isPublished: boolean;
  email: string | null;

  // Derived, named capabilities. The RULES live HERE, once.
  /** Share a record with people (the Share button, deep-in-flow -> hide when off). */
  canShare: boolean;
  /** Pair the companion phone app (solo/locked show the setup/unlock path). */
  canPairPhone: boolean;
  /** Use the pooled cloud copy / cross-machine sync. */
  canUseCloud: boolean;
  /** Publish a public profile (account AND already in the directory). */
  canPublishProfile: boolean;
  /** Route notifications to email. */
  canEmailNotify: boolean;
  /** Route notifications to the companion phone. */
  canPhoneNotify: boolean;
  /** Use BeakerBot AI. ACCOUNT-ONLY by Grant's lock, also needs the build flag. */
  canUseAI: boolean;
  /** Collaborate with people outside your folder (cross-boundary send + inbox). */
  canCollabExternally: boolean;
  /** The cross-boundary inbox is usable (account with an email to receive at). */
  canAccessInbox: boolean;

  // Pass-throughs for the rare surface that genuinely needs the raw flag.
  aiEnabled: boolean;
  billingEnabled: boolean;
  oauthAvailable: boolean;
}

export function useAccountCapabilities(): AccountCapabilities {
  const { status, email, published } = useSharingIdentity();

  return useMemo<AccountCapabilities>(() => {
    // status -> coarse mode. "loading" reads as "solo" (see the type comment):
    // never flash an account-only control before the read settles.
    const mode: AccountMode =
      status === "ready"
        ? "account"
        : status === "needs-restore"
          ? "locked"
          : "solo";

    const isAccount = mode === "account";
    const isPublished = isAccount && published;

    // Raw build/server flags, read once.
    const aiEnabled = AI_ASSISTANT_ENABLED;
    const billingEnabled = isBillingEnabled();
    const oauthAvailable = isOAuthPublishAvailable();
    const realSharing = isRealSharingEnabled();

    return {
      mode,
      isPublished,
      email: email ?? null,

      // ── The capability -> primitive rules (one place) ──────────────────────
      // Plain account-gated capabilities. Solo/locked show a setup/unlock path
      // or a gentle upsell at discovery surfaces, never a dead control.
      canShare: isAccount,
      canPairPhone: isAccount,
      canUseCloud: isAccount,
      canEmailNotify: isAccount,
      canPhoneNotify: isAccount,

      // Publishing a public profile additionally needs the directory listing.
      canPublishProfile: isAccount && isPublished,

      // BeakerBot AI is ACCOUNT-ONLY (Grant's lock) and still needs the flag.
      canUseAI: aiEnabled && isAccount,

      // Cross-boundary collaboration needs the build flag, real sharing wired,
      // an account, AND a directory listing to send/receive against. This is the
      // ONE rule that replaces the two divergent conditions in the old call
      // sites (UnifiedShareDialog vs SharedWithMeTab).
      canCollabExternally:
        EXTERNAL_COLLAB_ENABLED && realSharing && isAccount && isPublished,

      // The inbox is usable once there is an account with an email to land at.
      canAccessInbox: isAccount && !!email,

      // Pass-throughs.
      aiEnabled,
      billingEnabled,
      oauthAvailable,
    };
  }, [status, email, published]);
}
