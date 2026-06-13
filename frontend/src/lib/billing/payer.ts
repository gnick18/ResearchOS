// The payer cascade: who actually receives the invoice for an account.
//
// The lab-level rule (resolveBillingOwner in lab.ts) answers a different question:
// where does USAGE POOL. A member pools into their lab against the PI's single
// allowance; a solo user pools into themselves. That stays exactly as is.
//
// This module answers WHO PAYS once the org tiers exist above the lab. A lab can
// be sponsored by a department, and a department by an institution, so the payer
// is the HIGHEST tier present in the chain:
//
//   member -> lab (PI) -> department -> institution
//
// Each hop is an existing active-row lookup in Neon (no DO, no crypto): the lab
// hop is getSponsoringLab, the dept hop getDeptForLabHead, the institution hop
// getInstitutionForDept. Departments and institutions are billing ENTITIES keyed
// by their generated id (dept_id / institution_id), not owner keys, so the payer
// is described by a {tier, id} pair rather than a bare owner key.
//
// FAIL-SAFE: any error collapses the whole chain to self, so a directory hiccup
// bills an account on its own (subject to a cap) rather than escaping enforcement
// or mis-routing an invoice to the wrong org.
//
// This is the pure resolution layer. Wiring a real Stripe recurring procurement
// invoice to the resolved payer is the later, gated step (Grant's Stripe products
// + WI sales-tax). See docs/proposals/2026-06-13-org-tier-billing-cascade.md.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { resolveBillingOwner } from "./lab";
import { getDeptForLabHead } from "./dept";
import { getInstitutionForDept } from "./institution";

export type BillingTier = "self" | "lab" | "department" | "institution";

export interface BillingPayer {
  /** Which tier foots the bill. */
  tier: BillingTier;
  /**
   * The payer's identifier at that tier: an owner key for self/lab, or the
   * generated dept_id / institution_id for department/institution.
   */
  id: string;
}

export interface BillingChain {
  /** The account whose bill we resolved. */
  ownerKey: string;
  /**
   * Where usage pools (the lab head's key for a member, else the account's own
   * key). Unchanged lab-level rule, surfaced here so callers do not re-resolve.
   */
  poolOwnerKey: string;
  /** The sponsoring lab head's owner key, when a lab is in the chain, else null. */
  labOwnerKey: string | null;
  /** The department sponsoring the lab, if any (generated dept_id). */
  deptId: string | null;
  /** The institution sponsoring the department, if any (generated institution_id). */
  institutionId: string | null;
  /** The entity that actually receives the invoice (highest tier present). */
  payer: BillingPayer;
}

function selfChain(ownerKey: string): BillingChain {
  return {
    ownerKey,
    poolOwnerKey: ownerKey,
    labOwnerKey: null,
    deptId: null,
    institutionId: null,
    payer: { tier: "self", id: ownerKey },
  };
}

/**
 * Resolve the full billing chain for an account: the usage pool, the sponsoring
 * lab/dept/institution (each if present), and the single payer that gets the
 * invoice. Pure over the existing Neon lookups; fail-safe to self on any error.
 */
export async function resolveBillingChain(ownerKey: string): Promise<BillingChain> {
  try {
    // Lab hop (also handles solo): a member resolves to the PI's key, a PI or solo
    // user to their own. So the lab head whose dept sponsorship we follow is the
    // pool owner, whether the caller is a member or the PI themselves.
    const poolOwnerKey = await resolveBillingOwner(ownerKey);
    const isMember = poolOwnerKey !== ownerKey;

    const deptId = await getDeptForLabHead(poolOwnerKey);
    const institutionId = deptId ? await getInstitutionForDept(deptId) : null;

    // A lab is "in the chain" when the caller is a member of one, or when the
    // caller is a lab head whose own lab is sponsored upward by a dept.
    const labOwnerKey = isMember ? poolOwnerKey : deptId ? ownerKey : null;

    let payer: BillingPayer;
    if (institutionId) payer = { tier: "institution", id: institutionId };
    else if (deptId) payer = { tier: "department", id: deptId };
    else if (isMember) payer = { tier: "lab", id: poolOwnerKey };
    else payer = { tier: "self", id: ownerKey };

    return { ownerKey, poolOwnerKey, labOwnerKey, deptId, institutionId, payer };
  } catch {
    return selfChain(ownerKey);
  }
}

/** Convenience: just the entity that pays. Fail-safe to self. */
export async function resolveBillingPayer(ownerKey: string): Promise<BillingPayer> {
  return (await resolveBillingChain(ownerKey)).payer;
}
