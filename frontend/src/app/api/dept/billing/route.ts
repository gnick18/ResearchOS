// Department tier Phase 3: the procurement billing route.
//
// GET  /api/dept/billing   -> the dept's current billing status (plan, rate, state)
// POST /api/dept/billing   -> body { labs, storageGb, poNumber? }
//   Derives the monthly rate from the built plan (deriveDeptRate, the same
//   cost-recovery math the dashboard preview and /pricing show) and creates or
//   updates a send-invoice recurring subscription addressed to the department.
//
// Dark unless DEPT_TIER_ENABLED; POST additionally dark unless BILLING_ENABLED.
// Sales tax is handled by Stripe Tax (automatic_tax), no manual gate.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import { deriveDeptRate } from "@/lib/dept/plan";
import { ensureDeptSchema, getDepartmentByAdmin } from "@/lib/billing/dept";
import {
  handleOrgBillingGet,
  runOrgBillingPost,
  type OrgBillingSpec,
} from "@/lib/billing/org-billing-route";

export const runtime = "nodejs";

const SPEC: OrgBillingSpec = {
  tier: "department",
  enabled: DEPT_TIER_ENABLED,
  resolveEntity: async (adminOwnerKey) => {
    await ensureDeptSchema();
    const dept = await getDepartmentByAdmin(adminOwnerKey);
    return dept ? { entityId: dept.deptId, name: dept.name } : null;
  },
  parsePlanInputs: (body) => {
    const labs = Number(body.labs);
    const storageGb = Number(body.storageGb);
    if (!Number.isFinite(labs) || !Number.isFinite(storageGb)) return null;
    if (labs < 0 || storageGb < 0) return null;
    return { labs, storageGb, international: body.international ? 1 : 0 };
  },
  deriveMonthlyCents: (inputs) =>
    deriveDeptRate({
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
