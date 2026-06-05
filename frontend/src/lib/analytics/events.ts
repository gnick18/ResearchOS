// Privacy-safe custom analytics events (Vercel Web Analytics).
//
// These are anonymous FEATURE-USAGE counters, never per-user tracking. They let
// the Vercel Analytics dashboard answer "how often is a share sent" or "how many
// profiles get published" WITHOUT a cookie, an identifier, or anything that
// could re-identify a person.
//
// PRIVACY CONTRACT (do not break it):
//   - Event names are a fixed, short allow-list (see the functions below).
//   - Properties are LOW-CARDINALITY enums / booleans only. Never pass an email,
//     name, ORCID, fingerprint, title, free text, id, count, or timestamp, or
//     anything else that could identify or re-identify a person or a single
//     action. A boolean or a 5-value enum is fine, a string a user typed is not.
//   - No counts or sizes either, those can fingerprint a specific event.
//
// Vercel Web Analytics is itself cookieless and anonymous; these events keep it
// that way. They ride the SAME Offline Mode gate as the page-view + Speed
// Insights telemetry (see OfflineGatedAnalytics.tsx), so a user who has promised
// themselves zero outbound stays at zero outbound.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { track } from "@vercel/analytics";

import { useAppStore } from "@/lib/store";

export type ShareItemKind =
  | "note"
  | "experiment"
  | "method"
  | "project"
  | "sequence"
  | "other";

export type ShareDestination = "existing_user" | "email_invite";

/**
 * Fires one custom event, guarded three ways so telemetry can never crash,
 * leak, or break a user action:
 *   1. No-op on the server (track is a browser API; this module is imported by
 *      transport code that also runs during SSR / build).
 *   2. No-op when Offline Mode is on (mirrors OfflineGatedAnalytics unmounting
 *      the SDK, so the zero-outbound promise holds for custom events too).
 *   3. Swallows any error (a telemetry failure must never surface to the user).
 */
function emit(
  name: string,
  props?: Record<string, string | number | boolean>,
): void {
  if (typeof window === "undefined") return;
  try {
    if (useAppStore.getState().offlineMode) return;
    track(name, props);
  } catch {
    // Telemetry is best-effort and must never break the calling flow.
  }
}

/**
 * A cross-boundary share was delivered. `kind` is the item type (a fixed enum)
 * and `destination` is whether it went to an existing ResearchOS user or out as
 * an email invite to a non-user. No recipient, no title, no size.
 */
export function trackShareSent(
  kind: ShareItemKind,
  destination: ShareDestination,
): void {
  emit("share_sent", { kind, destination });
}

/**
 * A directory profile was published (or re-saved). The booleans capture whether
 * the profile carries an ORCID and an affiliation, useful adoption signal, with
 * no name, institution, or ORCID value attached.
 */
export function trackProfilePublished(opts: {
  hasOrcid: boolean;
  hasAffiliation: boolean;
}): void {
  emit("profile_published", {
    has_orcid: opts.hasOrcid,
    has_affiliation: opts.hasAffiliation,
  });
}

/** A new sharing identity was created on a device. Bare count, no properties. */
export function trackIdentityCreated(): void {
  emit("identity_created");
}

/** A user linked an ORCID iD to their identity. Bare count, no properties. */
export function trackOrcidLinked(): void {
  emit("orcid_linked");
}
