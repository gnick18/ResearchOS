"use client";

// App-origin deep-link handler for lab collaboration CTAs (Phase 2, lab-site
// network presence).
//
// Reads the ?share=<slug> query param from the /network URL. When the param is
// present and a ShareRecipient can be resolved (demo lab only in Phase 2, real
// labs in Phase 4), it opens RecipientShareDialog pre-addressed to the lab's PI.
//
// WHY this approach is safe and Suspense-compatible. The codebase avoids
// useSearchParams at the root because it forces a Suspense boundary and can
// break the static-export prerender. The established pattern (lib/providers.tsx)
// uses useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) to read
// window.location.search reactively, subscribing to both popstate and the custom
// researchos:locationchange event. This component follows that exact pattern.
//
// COOKIE ISOLATION NOTE. This component only mounts on the APP ORIGIN
// (research-os.app), never on the .com lab-site origin. RecipientShareDialog
// needs the session (senderEmail from useSharingIdentity) and the local folder
// (ownerUsername from useFileSystem); those are only available on the app origin.
// The lab-page CTAs deep-link here precisely so the dialog runs with both.
//
// Gate logic mirrors ResearcherProfileModal: needs SOCIAL_LAYER_ENABLED plus a
// ready sharing identity plus a connected folder. If any are missing the dialog
// simply does not open (the visitor lands on /network normally).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useSyncExternalStore, useState } from "react";

import RecipientShareDialog from "@/components/social/RecipientShareDialog";
import { SOCIAL_LAYER_ENABLED } from "@/lib/social/config";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { resolveLabRecipient } from "@/lib/social/lab-collab";

// ---------------------------------------------------------------------------
// Reactive ?share= param reader (same pattern as useSignInProvider)
// ---------------------------------------------------------------------------

/** Custom event fired by the client router on every client-side navigation.
 *  Defined in providers.tsx; duplicated here so this file is self-contained
 *  and can be unit-tested without providers.tsx. */
const LOC_CHANGE_EVENT = "researchos:locationchange";

/**
 * Reactive, Suspense-safe read of the ?share=<slug> query param.
 *
 * Returns the slug string when the param is present and non-empty, otherwise
 * null. Subscribes to both popstate and the custom locationchange event so an
 * in-session router.push("?share=...") from a directory card also triggers a
 * re-render without a hard navigation.
 */
function useShareSlugParam(): string | null {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("popstate", onChange);
    window.addEventListener(LOC_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(LOC_CHANGE_EVENT, onChange);
    };
  }, []);

  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined"
        ? (new URLSearchParams(window.location.search).get("share") ?? null)
        : null,
    () => null,
  );
}

// ---------------------------------------------------------------------------
// Handler component
// ---------------------------------------------------------------------------

/**
 * Mounts on /network (app origin) to intercept the ?share=<slug> deep link
 * emitted by the lab-page collaboration CTAs and open RecipientShareDialog
 * pre-addressed to the lab's PI.
 *
 * Renders nothing when the param is absent, when the slug cannot be resolved
 * to a ShareRecipient, or when the gate conditions are not met (flag off, no
 * identity, no folder). The component is intentionally invisible except for the
 * dialog it may open.
 */
export default function NetworkShareHandler() {
  const slug = useShareSlugParam();
  const identity = useSharingIdentity();
  const { currentUser } = useFileSystem();
  const [dismissed, setDismissed] = useState(false);

  // Resolve the slug to a recipient. Returns null for unknown / non-demo slugs.
  const recipient = slug ? resolveLabRecipient(slug) : null;

  // Gate: must match the same conditions as ResearcherProfileModal.canShare.
  const canShare =
    SOCIAL_LAYER_ENABLED &&
    !!identity.email &&
    !!currentUser &&
    !!recipient &&
    !dismissed;

  if (!canShare || !identity.email || !currentUser) return null;

  return (
    <RecipientShareDialog
      recipient={recipient}
      senderEmail={identity.email}
      ownerUsername={currentUser}
      onClose={() => setDismissed(true)}
    />
  );
}
