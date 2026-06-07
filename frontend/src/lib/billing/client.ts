// Client-side fetchers + shared types for the billing popup. Thin wrappers over
// the /api/billing routes so the components stay declarative.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export interface CapOption {
  gb: number;
  maxCostCents: number;
}

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
  // Metered fields, kept only for the a-la-carte comparison anchor.
  rateCents?: number;
  minChargeCents?: number;
  estimatedChargeCents?: number;
  capOptions?: CapOption[];
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

/** Starts Stripe checkout, returning the redirect URL or null. */
export async function startCheckout(): Promise<string | null> {
  try {
    const res = await fetch("/api/billing/checkout", { method: "POST" });
    const body = (await res.json()) as { url?: string };
    return body.url ?? null;
  } catch {
    return null;
  }
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
 */
export async function choosePlan(planId: string): Promise<PlanResult> {
  try {
    const res = await fetch("/api/billing/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
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

export interface CapResult {
  ok: boolean;
  needsCheckout?: boolean;
}

export async function setCap(capGb: number): Promise<CapResult> {
  try {
    const res = await fetch("/api/billing/cap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capGb }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 409) {
      const b = (await res.json()) as { needsCheckout?: boolean };
      return { ok: false, needsCheckout: b.needsCheckout };
    }
    return { ok: false };
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

/** PI turns lab billing on or off. */
export function setLabBilling(on: boolean): Promise<LabActionResult> {
  return postLab("/api/billing/lab", { on });
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
