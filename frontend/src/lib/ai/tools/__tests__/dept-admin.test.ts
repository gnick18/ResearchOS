import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the roster loader; the rate math (deriveDeptRate) stays real.
vi.mock("@/lib/dept/dept-admin-membership", () => ({
  loadDeptRoster: vi.fn(),
}));

import { loadDeptRoster } from "@/lib/dept/dept-admin-membership";
import {
  deptRosterGlanceTool,
  deptUsageGlanceTool,
  deptPlanExplainerTool,
  deptReportScaffoldTool,
  DEPT_TOOLS,
} from "../dept-admin";

const mockRoster = loadDeptRoster as unknown as ReturnType<typeof vi.fn>;

function rosterResult(over: Record<string, unknown> = {}) {
  return {
    department: { deptId: "d1", name: "Dept of Microbiology" },
    labHeads: [
      { memberKey: "k1", label: "Okafor Lab", status: "active" },
      { memberKey: "k2", label: "Zhang Lab", status: "active" },
      { memberKey: "k3", label: "Reyes Lab", status: "invited" },
    ],
    ...over,
  };
}

const GB = 1024 * 1024 * 1024;

function mockUsageFetch(body: unknown, ok = true) {
  global.fetch = vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("dept_roster_glance", () => {
  beforeEach(() => mockRoster.mockReset());

  it("returns the department, lab-head counts by status, and the list", async () => {
    mockRoster.mockResolvedValue(rosterResult());
    const res = (await deptRosterGlanceTool.execute({})) as Record<string, unknown>;
    expect(res.hasDepartment).toBe(true);
    expect(res.department).toBe("Dept of Microbiology");
    expect(res.activeLabs).toBe(2);
    expect(res.invitedLabs).toBe(1);
    expect((res.labHeads as unknown[]).length).toBe(3);
  });

  it("reports no department cleanly", async () => {
    mockRoster.mockResolvedValue({ department: null, labHeads: [] });
    const res = (await deptRosterGlanceTool.execute({})) as Record<string, unknown>;
    expect(res.hasDepartment).toBe(false);
  });
});

describe("dept_usage_glance", () => {
  it("returns per-lab storage in GB sorted largest-first, plus totals", async () => {
    mockUsageFetch({
      department: { deptId: "d1", name: "Dept of Microbiology" },
      totalBytes: 6 * GB,
      totalSyncs: 300,
      labCount: 2,
      labs: [
        { name: "Small Lab", bytes: 2 * GB, syncs: 100 },
        { name: "Big Lab", bytes: 4 * GB, syncs: 200 },
      ],
    });
    const res = (await deptUsageGlanceTool.execute({})) as Record<string, unknown>;
    expect(res.hasDepartment).toBe(true);
    expect(res.totalStorageGB).toBe(6);
    const labs = res.labs as Array<{ lab: string; storageGB: number }>;
    // Sorted largest first.
    expect(labs[0].lab).toBe("Big Lab");
    expect(labs[0].storageGB).toBe(4);
  });

  it("degrades to no-department on a failed fetch", async () => {
    mockUsageFetch({}, false);
    const res = (await deptUsageGlanceTool.execute({})) as Record<string, unknown>;
    expect(res.hasDepartment).toBe(false);
  });
});

describe("dept_plan_explainer", () => {
  it("prices explicit inputs and returns a USD breakdown", async () => {
    const res = (await deptPlanExplainerTool.execute({
      activeLabs: 5,
      storageGB: 200,
    })) as Record<string, unknown>;
    expect(res.activeLabs).toBe(5);
    expect(res.storageGB).toBe(200);
    // USD-formatted strings from centsToUsd (e.g. "$1,234").
    expect(typeof res.monthlyTotal).toBe("string");
    expect(res.monthlyTotal as string).toMatch(/^\$[\d,]+$/);
    expect(typeof res.perLabSustaining).toBe("string");
  });

  it("falls back to the department's current labs and storage when args are omitted", async () => {
    mockRoster.mockResolvedValue(rosterResult());
    mockUsageFetch({
      department: { deptId: "d1", name: "D" },
      totalBytes: 3 * GB,
      totalSyncs: 1,
      labCount: 1,
      labs: [],
    });
    const res = (await deptPlanExplainerTool.execute({})) as Record<string, unknown>;
    // 2 active labs from the roster, 3 GB from usage.
    expect(res.activeLabs).toBe(2);
    expect(res.storageGB).toBe(3);
  });
});

describe("dept_report_scaffold", () => {
  it("composes the roster and usage into a report scaffold", async () => {
    mockRoster.mockResolvedValue(rosterResult());
    mockUsageFetch({
      department: { deptId: "d1", name: "Dept of Microbiology" },
      totalBytes: 10 * GB,
      totalSyncs: 500,
      labCount: 2,
      labs: [{ name: "Okafor Lab", bytes: 7 * GB, syncs: 300 }],
    });
    const res = (await deptReportScaffoldTool.execute({})) as Record<string, unknown>;
    expect(res.hasDepartment).toBe(true);
    expect(res.department).toBe("Dept of Microbiology");
    expect(res.activeLabs).toBe(2);
    expect(res.invitedLabs).toBe(1);
    expect(res.totalStorageGB).toBe(10);
  });
});

describe("DEPT_TOOLS", () => {
  it("exports the four read-only tools with unique names", () => {
    const names = DEPT_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "dept_roster_glance",
      "dept_usage_glance",
      "dept_plan_explainer",
      "dept_report_scaffold",
    ]);
    // All read-only (no action flag).
    expect(DEPT_TOOLS.every((t) => !t.action)).toBe(true);
  });
});
