// Department tier Phase 3: the procurement billing route.
//
// GET  /api/dept/billing   -> the dept's current billing status (plan, rate, state)
// POST /api/dept/billing   -> body { labs, storageTb, poNumber? }
//   Derives the monthly rate from the built plan (deriveDeptRate, the same math
//   the dashboard preview shows) and creates or updates a send-invoice recurring
//   subscription addressed to the department.
//
// Dark unless DEPT_TIER_ENABLED; POST additionally dark unless BILLING_ENABLED,
// and a live Stripe key requires the WI sales-tax determination resolved.
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
    const storageTb = Number(body.storageTb);
    if (!Number.isFinite(labs) || !Number.isFinite(storageTb)) return null;
    if (labs < 0 || storageTb < 0) return null;
    return { labs, storageTb };
  },
  deriveMonthlyCents: (inputs) =>
    deriveDeptRate({ labs: inputs.labs, storageTb: inputs.storageTb }).totalCents,
};

export async function GET(): Promise<Response> {
  return handleOrgBillingGet(SPEC);
}

export async function POST(request: Request): Promise<Response> {
  return runOrgBillingPost(SPEC, request);
}
