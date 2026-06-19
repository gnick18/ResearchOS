// Lab-to-recipient resolution for collaboration CTAs (Phase 2, lab-site network
// presence).
//
// The collaboration actions (Send data, Reach out, Request data, Find people)
// need to address a lab as a ShareRecipient. The spec-locked decision is PI as
// recipient: the lab's PI handle is the delivery target, reusing the existing
// researcher-recipient machinery with no new lab-inbox identity.
//
// For the demo lab the PI is the well-known DEMO_LAB_PI fixture (handle "mira",
// name "Dr. Mira Castellanos"). For any other slug this returns null so callers
// can gracefully omit the share CTA rather than presenting an unresolvable target.
// Real-lab profile resolution is Phase 4 (requires a lab_sites profile column).
//
// This module also exports labSamePath, a tiny pure helper that builds a
// same-origin href for a lab page path given a linkBase computed by the server
// route. linkBase is "" on the cookie-isolated subdomain (<slug>.research-os.com)
// and "/<slug>" on the app origin (research-os.app), so the helper produces the
// correct href on both origins without reading window.location.
//
// This module is pure (no IO, no Next.js), so it is unit-testable in isolation
// and safe to import from both client components and unit tests.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import type { ShareRecipient } from "@/lib/social/share-recipient";
import {
  isDemoLabSlug,
  DEMO_LAB_PI,
  DEMO_KEY_FINGERPRINT,
  type DemoLabMember,
} from "@/lib/social/demo-lab";

/**
 * Build a ShareRecipient from a lab-member (PI) record. The fingerprint is the
 * lab-level fingerprint (the same one shown on the directory card trust badge)
 * because before Popup ships a per-person fingerprint-routed sealed send, the
 * relay mailbox is email-keyed and the fingerprint here is a verification aid
 * rather than an encryption address.
 */
export function labMemberToRecipient(
  member: DemoLabMember,
  keyFingerprint: string,
): ShareRecipient {
  return {
    displayName: member.name,
    handle: member.handle,
    fingerprint: keyFingerprint,
    // The demo lab has a seeded published key (the same one shown on the card).
    // For a real lab this would check the lab_sites profile; set false until
    // Phase 4 fills that column.
    hasPublishedKey: true,
  };
}

/**
 * Resolve a lab slug to its PI as a ShareRecipient.
 *
 * Returns null when the slug is not a known lab or when the lab has not yet
 * published a profile (Phase 4 generalization). The caller should hide the
 * share CTA rather than rendering a broken button.
 *
 * Demo lab (DEMO_LAB_SLUG) always resolves. Every other slug returns null until
 * a real-lab profile layer is added.
 */
export function resolveLabRecipient(slug: string): ShareRecipient | null {
  if (isDemoLabSlug(slug)) {
    return labMemberToRecipient(DEMO_LAB_PI, DEMO_KEY_FINGERPRINT);
  }
  // Phase 4 will query the lab_sites profile row for PI handle + fingerprint and
  // build the recipient from there. Until then, non-demo labs have no resolvable
  // share target.
  return null;
}

/**
 * Build the deep-link URL that the lab page sends a visitor to for the
 * "Send data to this lab" action.
 *
 * The lab page is cookie-isolated (.com origin) so the actual RecipientShareDialog
 * CANNOT run there. Instead, we link to the app origin with ?share=<slug> so the
 * app-origin NetworkShareHandler can resolve the recipient and open the dialog.
 *
 * @param appOrigin  The canonical app origin (e.g. "https://research-os.app").
 *                   Accepts a configured NEXT_PUBLIC_APP_BASE_URL value or a live
 *                   window.location.origin fallback. Pass the result of
 *                   canonicalAppOrigin() from lib/app-origin.ts at call time so
 *                   this function remains pure and unit-testable.
 * @param slug       The lab slug to share to.
 */
export function buildLabShareDeepLink(appOrigin: string, slug: string): string {
  const base = appOrigin.replace(/\/+$/, "");
  return `${base}/network?share=${encodeURIComponent(slug)}`;
}

/**
 * Build the deep-link URL for "Reach out for collaboration". Points to the PI's
 * researcher profile on the app origin where a visitor can contact or share with
 * the PI directly via the existing ResearcherProfileModal share flow.
 */
export function buildPiProfileDeepLink(
  appOrigin: string,
  piHandle: string,
): string {
  const base = appOrigin.replace(/\/+$/, "");
  return `${base}/u/${encodeURIComponent(piHandle)}`;
}

/**
 * Build the deep-link URL for "Request data from this lab". Points to a
 * pre-addressed compose on the app origin. Per the locked spec decision, this
 * is a deep link only, not a cookie-free POST. The ?compose=request&to=<handle>
 * param gives the app origin enough context to pre-fill the compose form once
 * one exists; for now it lands on the PI's profile page.
 */
export function buildRequestDataDeepLink(
  appOrigin: string,
  piHandle: string,
): string {
  const base = appOrigin.replace(/\/+$/, "");
  return `${base}/u/${encodeURIComponent(piHandle)}?compose=request`;
}

// ---------------------------------------------------------------------------
// Origin-aware same-origin link builder
// ---------------------------------------------------------------------------

/**
 * Build a same-origin href for a lab page, using a linkBase from labLinkBase.
 *
 * linkBase is "" when the request is served from the cookie-isolated lab subdomain
 * (<slug>.research-os.com) and "/<slug>" when served from the app origin
 * (research-os.app/<slug>), so the returned href is correct on both origins without
 * any client-side window.location read (no hydration mismatch).
 *
 * subPath is the page path relative to the lab root (e.g. "people", "papers/x").
 * An empty subPath means the lab home, which returns linkBase || "/" so both origins
 * produce a navigable root link (the subdomain home = "/" and the app origin = "/<slug>").
 *
 * Examples (linkBase = "" means subdomain, linkBase = "/fakeyeast-lab" means app origin):
 *   labSamePath("",              "")         -> "/"
 *   labSamePath("/fakeyeast-lab","")         -> "/fakeyeast-lab"
 *   labSamePath("",              "people")   -> "/people"
 *   labSamePath("/fakeyeast-lab","people")   -> "/fakeyeast-lab/people"
 *   labSamePath("",              "papers/x") -> "/papers/x"
 *   labSamePath("/fakeyeast-lab","papers/x") -> "/fakeyeast-lab/papers/x"
 */
export function labSamePath(linkBase: string, subPath: string): string {
  // Normalize: strip any trailing slash from linkBase and any leading slash from subPath.
  const base = linkBase.replace(/\/+$/, "");
  const sub = subPath.replace(/^\/+/, "");
  if (sub === "") {
    // Home: prefer the explicit base; fall back to "/" on the subdomain (base = "").
    return base || "/";
  }
  return `${base}/${sub}`;
}

/**
 * The same-origin link base for a lab's pages, chosen by the cutover flag.
 *
 * Returns "" when the lab is served from its cookie-isolated subdomain (the
 * research-os.com cutover is live, so the slug is already the host and same-origin
 * links must be slug-less). Returns "/<slug>" on the app origin (the pre-cutover
 * path form and local dev), where the slug is still a path segment. Pairs with
 * labSamePath. comOriginEnabled is the build-inlined LAB_SITES_COM_ORIGIN_ENABLED
 * flag, passed in (not read here) so this stays pure and unit-testable. This is the
 * same origin choice LabSiteSwitcher makes, kept in one tested place.
 */
export function labLinkBase(slug: string, comOriginEnabled: boolean): string {
  return comOriginEnabled ? "" : `/${slug}`;
}
