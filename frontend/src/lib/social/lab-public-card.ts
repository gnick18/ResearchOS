// The public network-presence card for a REAL lab (Phase 4 of the lab-site
// network-presence plan, docs/proposals/2026-06-19-lab-site-network-presence.md).
//
// The enriched lab page (header, collaboration CTAs, citation) was demo-only. This
// assembles the same DemoLabCard shape for a real lab from data that ALREADY
// exists, so it needs NO lab_sites schema change (the plan's Q4 is avoided):
//   - getSiteBySlug:        slug -> the lab owner key (the PI's owner key)
//   - getListedLabByPiKey:  directory_labs name, PI display, member count,
//                           institution, and the LISTED opt-in (private labs
//                           return null, so an unlisted lab gets no public card)
//   - getAccountProfile:    the PI's @handle (and display name fallback)
//   - getBindingByHash:     the PI key fingerprint for the trust badge
//
// Members are shown as the PI plus a count (memberCount); the full per-member
// @handle roster is a later enrichment, not needed for the first real-lab cut.
// Any failure resolves to null so a hiccup just falls back to the bare page.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { DemoLabCard } from "./demo-lab";
import { getSiteBySlug } from "./lab-site-db";
import { getListedLabByPiKey, getBindingByHash } from "@/lib/sharing/directory/db";
import { getAccountProfile } from "@/lib/account/account-profile";

/**
 * The public card for a real lab by slug, or null when the slug has no lab site,
 * the lab is not publicly listed, or anything fails. Listed-only keeps the public
 * presence opt-in.
 */
export async function getLabPublicCard(slug: string): Promise<DemoLabCard | null> {
  try {
    const site = await getSiteBySlug(slug);
    if (!site) return null;
    const ownerKey = site.labOwnerKey;

    const lab = await getListedLabByPiKey(ownerKey);
    if (!lab) return null; // unlisted or no directory lab row, stays private

    const [profile, binding] = await Promise.all([
      getAccountProfile(ownerKey).catch(() => null),
      getBindingByHash(ownerKey).catch(() => null),
    ]);

    return {
      slug: site.labSlug,
      name: lab.name,
      tagline: lab.institution ?? "",
      pi: {
        handle: profile?.handle ?? "",
        name: lab.piDisplayName || profile?.displayName || lab.name,
        role: "Principal investigator",
      },
      members: [],
      memberCount: lab.memberCount,
      verifiedDomain: "",
      keyFingerprint: binding?.fingerprint ?? "",
    };
  } catch {
    return null;
  }
}
