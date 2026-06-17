// Department-head copilot tools (Tier 1 admin copilot, see
// docs/proposals/2026-06-17-beakerbot-department-copilot.md).
//
// These are the dept-scoped read tools BeakerBot offers a department head on the
// /department portal. They operate ONLY on what the portal already exposes, the
// aggregate roster, usage, and billing rate, never any lab's research data. Same
// house rules as every BeakerBot tool: the tool owns every number, the model only
// narrates, and it never interprets (no "this lab is underperforming", just the
// counts and the dollar figures).
//
// Read-only. The consented invite-mint action is a separate, gated tool added
// later. No emojis, no em-dashes, no mid-sentence colons.

import type { AiTool } from "./types";
import { COORDINATION_TOOLS } from "./registry";
import { loadDeptRoster } from "@/lib/dept/dept-admin-membership";
import { deriveDeptRate, centsToUsd } from "@/lib/dept/plan";

const BYTES_PER_GB = 1024 * 1024 * 1024;

/** The slice of /api/dept/usage these tools read. Other fields are ignored. */
interface DeptUsageShape {
  department: { deptId: string; name: string } | null;
  totalBytes: number;
  totalSyncs: number;
  labCount: number;
  labs: Array<{ labId?: string; name: string; bytes: number; syncs: number }>;
}

/**
 * Fetch the department usage aggregate. Returns null when there is no department
 * or the request fails, so the tools degrade to a clear "no department" answer
 * rather than throwing. Injected fetch keeps it testable.
 */
async function loadDeptUsage(
  fetchImpl: typeof fetch = fetch,
): Promise<DeptUsageShape | null> {
  try {
    const res = await fetchImpl("/api/dept/usage");
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DeptUsageShape> & {
      enabled?: boolean;
    };
    if (!data || !data.department) return null;
    return {
      department: data.department,
      totalBytes: data.totalBytes ?? 0,
      totalSyncs: data.totalSyncs ?? 0,
      labCount: data.labCount ?? (data.labs?.length ?? 0),
      labs: Array.isArray(data.labs) ? data.labs : [],
    };
  } catch {
    return null;
  }
}

function gb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_GB) * 100) / 100;
}

// ---------------------------------------------------------------------------
// dept_roster_glance
// ---------------------------------------------------------------------------

export const deptRosterGlanceTool: AiTool = {
  name: "dept_roster_glance",
  description:
    "Get the department's roster: the department name and every lab head on the plan with their status (active, invited, or declined). Call this to answer who is on the department, how many labs are active, or who has a pending invite. Aggregate admin data only, never any lab's research. Read-only.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => {
    const roster = await loadDeptRoster();
    if (!roster.department) {
      return {
        hasDepartment: false,
        note: "This account does not administer a department.",
      };
    }
    const active = roster.labHeads.filter((h) => h.status === "active");
    const invited = roster.labHeads.filter((h) => h.status === "invited");
    const declined = roster.labHeads.filter((h) => h.status === "declined");
    return {
      hasDepartment: true,
      department: roster.department.name,
      activeLabs: active.length,
      invitedLabs: invited.length,
      declinedLabs: declined.length,
      labHeads: roster.labHeads.map((h) => ({
        label: h.label ?? h.memberKey,
        status: h.status,
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// dept_usage_glance
// ---------------------------------------------------------------------------

export const deptUsageGlanceTool: AiTool = {
  name: "dept_usage_glance",
  description:
    "Get the department's storage and sync usage aggregated by lab, plus the department totals. Use this to answer which lab is driving storage cost, how much storage the department uses, or how active each lab is. Returns each lab's storage in GB and sync count, sorted by storage (largest first). Aggregate usage only, never any lab's research data. Read-only.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => {
    const usage = await loadDeptUsage();
    if (!usage) {
      return {
        hasDepartment: false,
        note: "No department usage is available for this account.",
      };
    }
    const labs = usage.labs
      .map((l) => ({ lab: l.name, storageGB: gb(l.bytes), syncs: l.syncs }))
      .sort((a, b) => b.storageGB - a.storageGB);
    return {
      hasDepartment: true,
      department: usage.department?.name ?? "",
      labCount: usage.labCount,
      totalStorageGB: gb(usage.totalBytes),
      totalSyncs: usage.totalSyncs,
      labs,
    };
  },
};

// ---------------------------------------------------------------------------
// dept_plan_explainer
// ---------------------------------------------------------------------------

export const deptPlanExplainerTool: AiTool = {
  name: "dept_plan_explainer",
  description:
    "Explain the department's monthly rate, broken into its parts (the storage recovery cost, the per-lab sustaining contribution, and any international processing) in US dollars. When activeLabs or storageGB are omitted, it uses the department's CURRENT active-lab count and total storage. Pass explicit numbers to price a hypothetical (for example what 10 labs and 500 GB would cost). The tool owns the math; relay the figures without adding a verdict. Read-only.",
  parameters: {
    type: "object",
    properties: {
      activeLabs: {
        type: "number",
        description:
          "Number of active labs to price. Omit to use the department's current active labs.",
      },
      storageGB: {
        type: "number",
        description:
          "Pooled storage in GB to price. Omit to use the department's current total storage.",
      },
      international: {
        type: "boolean",
        description:
          "Whether the payer is outside the US (higher processing). Defaults to false.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    let activeLabs =
      typeof args.activeLabs === "number" ? args.activeLabs : undefined;
    let storageGB =
      typeof args.storageGB === "number" ? args.storageGB : undefined;
    const international = args.international === true;

    // Fill missing inputs from the department's current state.
    if (activeLabs === undefined) {
      const roster = await loadDeptRoster();
      activeLabs = roster.department
        ? roster.labHeads.filter((h) => h.status === "active").length
        : 0;
    }
    if (storageGB === undefined) {
      const usage = await loadDeptUsage();
      storageGB = usage ? gb(usage.totalBytes) : 0;
    }

    const rate = deriveDeptRate({ activeLabs, storageGB, international });
    return {
      activeLabs,
      storageGB,
      international,
      storageRecovery: centsToUsd(rate.recoveryCents),
      perLabSustaining: centsToUsd(rate.sustainCents),
      internationalProcessing: centsToUsd(rate.intlFeeCents),
      monthlyTotal: centsToUsd(rate.totalCents),
    };
  },
};

// ---------------------------------------------------------------------------
// dept_report_scaffold
// ---------------------------------------------------------------------------

export const deptReportScaffoldTool: AiTool = {
  name: "dept_report_scaffold",
  description:
    "Assemble a department summary for an annual or institutional report: the department name, the active and invited lab counts, total storage and activity, and a per-lab usage table. Aggregate admin and usage data only, never any lab's research content. Returns a structured scaffold for the department head to write the narrative around. Read-only.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => {
    const [roster, usage] = await Promise.all([
      loadDeptRoster(),
      loadDeptUsage(),
    ]);
    if (!roster.department) {
      return {
        hasDepartment: false,
        note: "This account does not administer a department.",
      };
    }
    const active = roster.labHeads.filter((h) => h.status === "active");
    const invited = roster.labHeads.filter((h) => h.status === "invited");
    const labs = (usage?.labs ?? [])
      .map((l) => ({ lab: l.name, storageGB: gb(l.bytes), syncs: l.syncs }))
      .sort((a, b) => b.storageGB - a.storageGB);
    return {
      hasDepartment: true,
      department: roster.department.name,
      activeLabs: active.length,
      invitedLabs: invited.length,
      totalStorageGB: usage ? gb(usage.totalBytes) : 0,
      totalSyncs: usage?.totalSyncs ?? 0,
      labs,
    };
  },
};

/**
 * The dept-scoped tool set. Surfaced on the department portal's BeakerBot mount,
 * not in the global research-shell tool set.
 */
export const DEPT_TOOLS: AiTool[] = [
  deptRosterGlanceTool,
  deptUsageGlanceTool,
  deptPlanExplainerTool,
  deptReportScaffoldTool,
];

/**
 * The full scope BeakerBot runs with on the department portal: the dept tools
 * plus the coordination tools (propose-plan, ask-user) so it can clarify and
 * sequence. NOT the research-shell read/action tools, which do not apply here.
 */
export const DEPT_SCOPE_TOOLS: AiTool[] = [...DEPT_TOOLS, ...COORDINATION_TOOLS];
