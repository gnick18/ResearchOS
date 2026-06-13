// Institution tier Phase 3: the procurement billing route, one tier up from
// /api/dept/billing.
//
// GET  /api/institution/billing  -> current billing status (plan, rate, state)
// POST /api/institution/billing  -> body { labs, storageGb, poNumber? }
//   labs is the TOTAL active labs across the institution's departments, so the
//   sustaining contribution adapts to the real size of each department. Derives
//   the monthly rate (deriveInstitutionRate, the same cost-recovery math the
//   dashboard preview and /pricing show) and creates or updates a send-invoice
//   recurring subscription addressed to the institution.
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
    const labs = Number(body.labs);
    const storageGb = Number(body.storageGb);
    if (!Number.isFinite(labs) || !Number.isFinite(storageGb)) return null;
    if (labs < 0 || storageGb < 0) return null;
    return { labs, storageGb, international: body.international ? 1 : 0 };
  },
  deriveMonthlyCents: (inputs) =>
    deriveInstitutionRate({
      activeLabs: inputs.labs,
      storageGB: inputs.storageGb,
      international: inputs.international === 1,
    }).totalCents,
};

export async function GET(): Promise<Response> {
  return handleOrgBillingGet(SPEC);
}

export async function POST(request: Request): Promise<Response> {
  return runOrgBillingPost(SPEC, request);
}
