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
// The member avatars are the lab's active members who have claimed a public
// handle (capped); the true total stays memberCount. Any failure resolves to
// null (or an empty roster) so a hiccup just falls back to the bare page.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { DemoLabCard } from "./demo-lab";
import { getSiteBySlug } from "./lab-site-db";
import {
  getListedLabByPiKey,
  getBindingByHash,
  getProfileByFingerprint,
} from "@/lib/sharing/directory/db";
import { getAccountProfile } from "@/lib/account/account-profile";
import { listLabMembers } from "@/lib/billing/lab";

// Cap on the member avatars resolved for the public header. The true total still
// comes from memberCount; this only bounds the per-member handle lookups.
const MEMBER_AVATAR_CAP = 12;

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
    // The verified institutional domain lives on the PI's directory profile,
    // keyed by their key fingerprint. It is already null for consumer providers
    // (gmail, etc.), so an empty string here just hides the badge.
    const dirProfile = binding?.fingerprint
      ? await getProfileByFingerprint(binding.fingerprint).catch(() => null)
      : null;

    // Public member roster: the lab's ACTIVE members who have CLAIMED a public
    // handle (an unclaimed member has no public identity to show, so they are
    // counted in memberCount but not listed). Capped, and a failure just yields
    // an empty list (PI plus count still renders).
    const roster = await listLabMembers(ownerKey).catch(() => []);
    const activeKeys = roster
      .filter((m) => m.status === "active")
      .slice(0, MEMBER_AVATAR_CAP)
      .map((m) => ({ key: m.memberOwnerKey, label: m.label }));
    const resolved = await Promise.all(
      activeKeys.map(async ({ key, label }) => {
        const p = await getAccountProfile(key).catch(() => null);
        if (!p?.handle) return null;
        return {
          handle: p.handle,
          name: p.displayName || p.handle,
          role: label || "Member",
        };
      }),
    );
    const members = resolved.filter((m): m is NonNullable<typeof m> => m !== null);

    return {
      slug: site.labSlug,
      name: lab.name,
      tagline: lab.institution ?? "",
      pi: {
        handle: profile?.handle ?? "",
        name: lab.piDisplayName || profile?.displayName || lab.name,
        role: "Principal investigator",
      },
      members,
      memberCount: lab.memberCount,
      verifiedDomain: dirProfile?.affiliationDomain ?? "",
      keyFingerprint: binding?.fingerprint ?? "",
    };
  } catch {
    return null;
  }
}
