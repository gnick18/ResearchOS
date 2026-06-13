// Department tier: contained demo fixtures.
//
// The dept admin portal normally reads a real Neon roster + usage rollup behind a
// signed-in admin account. In demo / wiki-capture mode there is no account and no
// Neon, so these fixtures stand in: a believable Department of Microbiology with
// three labs, their usage, and a billing status. This lets a Claude-in-Chrome
// agent exercise the whole portal, and doubles as the showcase reel.
//
// Billing is SIMULATED here (no Stripe). The dashboard skips the network and
// "activate" just flips the local status, so the demo never charges anyone.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { DeptRosterResult } from "./dept-admin-membership";

const GB = 1e9;

/** A fixed dept id so every demo surface agrees on the same entity. */
export const DEMO_DEPT_ID = "demo-dept-micro";
export const DEMO_DEPT_NAME = "Department of Microbiology";

export function demoDeptRoster(): DeptRosterResult {
  return {
    department: { deptId: DEMO_DEPT_ID, name: DEMO_DEPT_NAME },
    labHeads: [
      { memberKey: "demo-lab-okafor", label: "Okafor Lab", status: "active" },
      { memberKey: "demo-lab-zhang", label: "Zhang Lab", status: "active" },
      { memberKey: "demo-lab-reyes", label: "Reyes Lab", status: "active" },
      { memberKey: "demo-lab-singh", label: "Singh Lab (invited)", status: "invited" },
    ],
  };
}

interface DemoAccount {
  memberKey: string;
  label: string | null;
  isHead: boolean;
  bytes: number;
  syncs: number;
}
interface DemoLab {
  labHeadKey: string;
  label: string | null;
  bytes: number;
  syncs: number;
  accounts: DemoAccount[];
}

function lab(
  labHeadKey: string,
  label: string,
  accounts: [string, number, number, boolean][],
): DemoLab {
  const accts: DemoAccount[] = accounts.map(([l, gb, syncs, isHead]) => ({
    memberKey: `${labHeadKey}-${l}`,
    label: l,
    isHead,
    bytes: Math.round(gb * GB),
    syncs,
  }));
  return {
    labHeadKey,
    label,
    bytes: accts.reduce((s, a) => s + a.bytes, 0),
    syncs: accts.reduce((s, a) => s + a.syncs, 0),
    accounts: accts,
  };
}

/** The usage rollup the dept dashboard renders (matches /api/dept/usage). */
export function demoDeptUsage() {
  const labs = [
    lab("demo-lab-okafor", "Okafor Lab", [
      ["Dr. Okafor (PI)", 41, 1820, true],
      ["A. Brenner", 88, 3110, false],
      ["L. Mwangi", 52, 2240, false],
    ]),
    lab("demo-lab-zhang", "Zhang Lab", [
      ["Dr. Zhang (PI)", 30, 1450, true],
      ["P. Costa", 120, 4015, false],
    ]),
    lab("demo-lab-reyes", "Reyes Lab", [
      ["Dr. Reyes (PI)", 60, 2380, true],
      ["S. Haddad", 47, 1670, false],
      ["T. Nilsson", 39, 1290, false],
    ]),
  ];
  const totalBytes = labs.reduce((s, l) => s + l.bytes, 0);
  const totalSyncs = labs.reduce((s, l) => s + l.syncs, 0);
  return {
    department: { deptId: DEMO_DEPT_ID, name: DEMO_DEPT_NAME },
    totalBytes,
    totalSyncs,
    labCount: labs.length,
    labs,
    history: [
      { ym: "2026-01", storageBytes: Math.round(totalBytes * 0.55), syncCount: Math.round(totalSyncs * 0.5) },
      { ym: "2026-02", storageBytes: Math.round(totalBytes * 0.64), syncCount: Math.round(totalSyncs * 0.62) },
      { ym: "2026-03", storageBytes: Math.round(totalBytes * 0.71), syncCount: Math.round(totalSyncs * 0.7) },
      { ym: "2026-04", storageBytes: Math.round(totalBytes * 0.83), syncCount: Math.round(totalSyncs * 0.84) },
      { ym: "2026-05", storageBytes: Math.round(totalBytes * 0.92), syncCount: Math.round(totalSyncs * 0.93) },
      { ym: "2026-06", storageBytes: totalBytes, syncCount: totalSyncs },
    ],
  };
}

/** The billing status the dashboard starts from in demo (not yet activated, so the
 *  agent can drive the activate flow). billingEnabled true so the controls show. */
export function demoDeptBilling() {
  return {
    billingEnabled: true,
    status: "inactive" as const,
    method: "invoice" as const,
    payClass: "bank" as const,
    monthlyCents: 0,
    planInputs: {},
  };
}
