// Client-side fetchers + shared types for the billing popup. Thin wrappers over
// the /api/billing routes so the components stay declarative.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** A plan the user can pick (flat bundle plan). */
export interface PlanOption {
  id: string;
  name: string;
  storageBytes: number;
  activityWritesPerMonth: number;
  priceCents: number;
}

export interface BillingStatus {
  enabled: boolean;
  signedIn?: boolean;
  active: boolean;
  usedBytes: number;
  freeBytes: number;
  capBytes: number;
  quotaBytes: number;
  // Flat-plan fields (the live model).
  planId?: string;
  planName?: string;
  plans?: PlanOption[];
  activityWrites?: number;
  activityAllowance?: number;
}

export interface LabRosterEntry {
  memberKey: string;
  /** The email the PI typed for this member (PI-only display label). */
  label: string | null;
  status: "invited" | "active" | "declined";
  usageVisible: boolean;
  usedBytes: number | null;
  /** This month's write activity for the member (PI sees it). */
  writes: number | null;
  /** 'directory' = real data-lab member; 'invite' = billing-only collaborator. */
  source?: "directory" | "invite";
}

export interface LabStatus {
  enabled: boolean;
  signedIn?: boolean;
  /** Whether the caller can pick a lab plan. */
  canSponsor: boolean;
  /** Whether the caller currently sponsors their lab (on a paid lab plan). */
  labBilling: boolean;
  // The lab's flat plan (the single control), like individual plans.
  labPlanId: string;
  labPlanName: string;
  labPlans: PlanOption[];
  labCapBytes: number;
  labActivityAllowance: number;
  sponsoredOwners: number;
  aggregateUsedBytes: number;
  aggregateWrites: number;
  /** The flat lab-plan price (cents), 0 on the free lab plan. */
  estimatedChargeCents: number;
  roster: LabRosterEntry[];
  /** The lab owner-key that sponsors the caller as a member, or null. */
  sponsoredByLab: string | null;
  pendingInvites: { labKey: string }[];
  freeBytes: number;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function fetchBillingStatus(): Promise<BillingStatus | null> {
  return getJson<BillingStatus>("/api/billing/status");
}

export function fetchLabStatus(): Promise<LabStatus | null> {
  return getJson<LabStatus>("/api/billing/lab");
}

export interface PlanResult {
  ok: boolean;
  /** Stripe Checkout url to finish a paid plan, when present. */
  url?: string;
  error?: string;
}

/**
 * Choose a plan. The free plan applies immediately; a paid plan returns a Stripe
 * Checkout url the caller redirects to. Mirrors the bundle "one control" model.
 *
 * payClass sets the price: "card" pays the list price, "bank" gets the discount
 * for paying by bank debit (ACH/SEPA), enforced at Checkout. Defaults to card.
 */
export async function choosePlan(
  planId: string,
  payClass: "card" | "bank" = "card",
): Promise<PlanResult> {
  try {
    const res = await fetch("/api/billing/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, payClass }),
    });
    const b = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
    if (res.ok) return { ok: true, url: b.url };
    return { ok: false, error: b.error };
  } catch {
    return { ok: false };
  }
}

export interface LabActionResult {
  ok: boolean;
  needsCheckout?: boolean;
  error?: string;
}

async function postLab(
  url: string,
  body: unknown,
  method = "POST",
): Promise<LabActionResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const b = (await res.json().catch(() => ({}))) as {
      needsCheckout?: boolean;
      error?: string;
    };
    return { ok: false, needsCheckout: b.needsCheckout, error: b.error };
  } catch {
    return { ok: false };
  }
}

/** PI invites a member by email. */
export function inviteMember(email: string): Promise<LabActionResult> {
  return postLab("/api/billing/lab/members", { email });
}

/** PI removes a member or rescinds an invite. */
export function removeMember(email: string): Promise<LabActionResult> {
  return postLab("/api/billing/lab/members", { email }, "DELETE");
}

/** Member accepts or declines a lab invite, optionally opting into usage view. */
export function respondToInvite(
  labKey: string,
  action: "accept" | "decline",
  usageVisible?: boolean,
): Promise<LabActionResult> {
  return postLab("/api/billing/lab/respond", { labKey, action, usageVisible });
}

// ---------------------------------------------------------------------------
// Unified PI roster (the one-roster-with-billing-chip view).
// ---------------------------------------------------------------------------

/** A member's billing state relative to the PI's pool. */
export type LabBillingStatus = "active" | "pending" | "unbilled" | "no_identity";

/** A data-lab member, annotated with their billing chip. */
export interface UnifiedRosterMember {
  username: string | null;
  pubkey: string;
  memberKey: string | null;
  billingStatus: LabBillingStatus;
  usageVisible: boolean;
  usedBytes: number | null;
  writes: number | null;
}

/** A billing-only sponsored collaborator (a seat with no folder access). */
export interface SponsoredCollaboratorEntry {
  memberKey: string;
  label: string | null;
  status: "invited" | "active" | "declined";
  usageVisible: boolean;
  usedBytes: number | null;
  writes: number | null;
}

export interface UnifiedLabRoster {
  enabled: boolean;
  members: UnifiedRosterMember[];
  sponsored: SponsoredCollaboratorEntry[];
  sponsoredOwners: number;
  aggregateUsedBytes: number;
  aggregateWrites: number;
  freeBytes: number;
}

/** The DO-roster shape the PI's client reads from getLabRemote (non-head). */
export interface DataRosterMember {
  pubkey: string;
  username?: string;
}

/**
 * Fetches the unified PI roster: the data-lab members (from the DO roster the
 * caller passes) each annotated with a billing chip, plus billing-only sponsored
 * collaborators and the pool aggregate. Returns null when billing is off or the
 * request fails, so the caller can fall back gracefully.
 */
export async function fetchLabRoster(
  members: DataRosterMember[],
): Promise<UnifiedLabRoster | null> {
  try {
    const res = await fetch("/api/billing/lab/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ members }),
    });
    if (!res.ok) return null;
    return (await res.json()) as UnifiedLabRoster;
  } catch {
    return null;
  }
}
