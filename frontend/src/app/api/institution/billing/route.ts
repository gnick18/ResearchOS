// Institution tier Phase 3: the procurement billing route, one tier up from
// /api/dept/billing.
//
// GET  /api/institution/billing  -> current billing status (plan, rate, state)
// POST /api/institution/billing  -> body { depts, storageTb, poNumber? }
//   Derives the monthly rate (deriveInstitutionRate, the same math the dashboard
//   preview shows) and creates or updates a send-invoice recurring subscription
//   addressed to the institution.
//
// Dark unless INSTITUTION_TIER_ENABLED; POST additionally dark unless
// BILLING_ENABLED, and a live Stripe key requires the WI sales-tax determination
// resolved.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";
import { deriveInstitutionRate } from "@/lib/institution/plan";
import {
  ensureInstitutionSchema,
  getInstitutionByAdmin,
} from "@/lib/billing/institution";
import {
  handleOrgBillingGet,
  runOrgBillingPost,
  type OrgBillingSpec,
} from "@/lib/billing/org-billing-route";

export const runtime = "nodejs";

const SPEC: OrgBillingSpec = {
  tier: "institution",
  enabled: INSTITUTION_TIER_ENABLED,
  resolveEntity: async (adminOwnerKey) => {
    await ensureInstitutionSchema();
    const inst = await getInstitutionByAdmin(adminOwnerKey);
    return inst ? { entityId: inst.institutionId, name: inst.name } : null;
  },
  parsePlanInputs: (body) => {
    const depts = Number(body.depts);
    const storageTb = Number(body.storageTb);
    if (!Number.isFinite(depts) || !Number.isFinite(storageTb)) return null;
    if (depts < 0 || storageTb < 0) return null;
    return { depts, storageTb };
  },
  deriveMonthlyCents: (inputs) =>
    deriveInstitutionRate({ depts: inputs.depts, storageTb: inputs.storageTb })
      .totalCents,
};

export async function GET(): Promise<Response> {
  return handleOrgBillingGet(SPEC);
}

export async function POST(request: Request): Promise<Response> {
  return runOrgBillingPost(SPEC, request);
}
