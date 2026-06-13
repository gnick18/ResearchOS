// Institution tier: contained demo fixtures, one tier up from the dept demo.
//
// In demo / wiki-capture mode there is no account and no Neon, so these fixtures
// stand in: a believable university with three departments, their labs, usage,
// and a billing status. A Claude-in-Chrome agent can exercise the whole portal,
// and it doubles as the showcase reel. Billing is SIMULATED (no Stripe).
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { InstitutionRosterResult } from "./institution-admin-membership";

const GB = 1e9;

export const DEMO_INSTITUTION_ID = "demo-inst-statelab-u";
export const DEMO_INSTITUTION_NAME = "State Lab University";

export function demoInstitutionRoster(): InstitutionRosterResult {
  return {
    institution: { institutionId: DEMO_INSTITUTION_ID, name: DEMO_INSTITUTION_NAME },
    depts: [
      { deptId: "demo-dept-micro", label: "Microbiology", status: "active" },
      { deptId: "demo-dept-chem", label: "Chemistry", status: "active" },
      { deptId: "demo-dept-bioeng", label: "Biomedical Engineering", status: "active" },
      { deptId: "demo-dept-physics", label: "Physics (invited)", status: "invited" },
    ],
  };
}

interface DemoLab {
  labHeadKey: string;
  label: string | null;
  bytes: number;
  syncs: number;
}
interface DemoDept {
  deptId: string;
  name: string | null;
  bytes: number;
  syncs: number;
  labs: DemoLab[];
}

function dept(
  deptId: string,
  name: string,
  labs: [string, number, number][],
): DemoDept {
  const ls: DemoLab[] = labs.map(([label, gb, syncs]) => ({
    labHeadKey: `${deptId}-${label}`,
    label,
    bytes: Math.round(gb * GB),
    syncs,
  }));
  return {
    deptId,
    name,
    bytes: ls.reduce((s, l) => s + l.bytes, 0),
    syncs: ls.reduce((s, l) => s + l.syncs, 0),
    labs: ls,
  };
}

/** The usage rollup the institution dashboard renders (matches /api/institution/usage). */
export function demoInstitutionUsage() {
  const depts = [
    dept("demo-dept-micro", "Microbiology", [
      ["Okafor Lab", 181, 7170],
      ["Zhang Lab", 150, 5465],
      ["Reyes Lab", 146, 5340],
    ]),
    dept("demo-dept-chem", "Chemistry", [
      ["Adler Lab", 92, 3410],
      ["Iqbal Lab", 210, 6620],
    ]),
    dept("demo-dept-bioeng", "Biomedical Engineering", [
      ["Sato Lab", 340, 9120],
      ["Moreau Lab", 120, 4180],
      ["Park Lab", 88, 2990],
    ]),
  ];
  const totalBytes = depts.reduce((s, d) => s + d.bytes, 0);
  const totalSyncs = depts.reduce((s, d) => s + d.syncs, 0);
  const labCount = depts.reduce((s, d) => s + d.labs.length, 0);
  return {
    institution: { institutionId: DEMO_INSTITUTION_ID, name: DEMO_INSTITUTION_NAME },
    totalBytes,
    totalSyncs,
    deptCount: depts.length,
    labCount,
    depts,
    history: [
      { ym: "2026-01", storageBytes: Math.round(totalBytes * 0.5), syncCount: Math.round(totalSyncs * 0.48) },
      { ym: "2026-02", storageBytes: Math.round(totalBytes * 0.6), syncCount: Math.round(totalSyncs * 0.58) },
      { ym: "2026-03", storageBytes: Math.round(totalBytes * 0.69), syncCount: Math.round(totalSyncs * 0.68) },
      { ym: "2026-04", storageBytes: Math.round(totalBytes * 0.8), syncCount: Math.round(totalSyncs * 0.8) },
      { ym: "2026-05", storageBytes: Math.round(totalBytes * 0.91), syncCount: Math.round(totalSyncs * 0.9) },
      { ym: "2026-06", storageBytes: totalBytes, syncCount: totalSyncs },
    ],
  };
}

/** The billing status the dashboard starts from in demo (not yet activated). */
export function demoInstitutionBilling() {
  return {
    billingEnabled: true,
    status: "inactive" as const,
    method: "invoice" as const,
    payClass: "bank" as const,
    monthlyCents: 0,
    planInputs: {},
  };
}
