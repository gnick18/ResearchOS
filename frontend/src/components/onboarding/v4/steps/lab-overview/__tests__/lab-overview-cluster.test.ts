/**
 * R4 Lab Overview tour cluster test — asserts the 6 step ids are all
 * registered in the canonical step registry AND sit contiguously in
 * TOUR_STEP_ORDER between the conditional walkthrough cluster
 * (telegram / purchases / calendar / links) and `lab-cleanup`.
 *
 * Replaces the prior LabModeCluster.test.tsx (which exercised the
 * 12-step lab-mode-* sequence). The new cluster has no warp step, no
 * resume guard, and no `is_demo` artifact wiring — the tour runs
 * against the user's real `/lab-overview`.
 */
import { describe, expect, it } from "vitest";
import { TOUR_STEP_ORDER, isStepGatedOut } from "../../../step-machine";
import { TOUR_STEPS } from "../../../step-registry";

const CLUSTER_IDS = [
  "lab-overview-intro",
  "lab-overview-widget-canvas",
  "lab-overview-sidebar-rail",
  "lab-overview-add-widget",
  "lab-overview-sharing",
  "lab-overview-exit",
] as const;

describe("Lab Overview cluster — TOUR_STEP_ORDER membership", () => {
  it("includes every cluster step id in TOUR_STEP_ORDER", () => {
    for (const id of CLUSTER_IDS) {
      expect(TOUR_STEP_ORDER, `${id} missing from TOUR_STEP_ORDER`).toContain(id);
    }
  });

  it("sits contiguously in cluster order", () => {
    const indices = CLUSTER_IDS.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${CLUSTER_IDS[i]} must follow ${CLUSTER_IDS[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });

  it("sits before lab-cleanup", () => {
    const exitIdx = TOUR_STEP_ORDER.indexOf("lab-overview-exit");
    const cleanupIdx = TOUR_STEP_ORDER.indexOf("lab-cleanup");
    expect(exitIdx).toBeGreaterThanOrEqual(0);
    expect(cleanupIdx).toBeGreaterThan(exitIdx);
  });
});

describe("Lab Overview cluster — registry wiring", () => {
  it("registers every cluster step id in TOUR_STEPS with a real body (not a placeholder)", () => {
    for (const id of CLUSTER_IDS) {
      const body = TOUR_STEPS[id];
      expect(body, `${id} missing from TOUR_STEPS`).toBeTruthy();
      expect(body.id).toBe(id);
      // Placeholder bodies use the speech template
      // `(Placeholder body for "${id}". Real content lands in P4-P7.)`.
      // Real bodies render ReactNode speech (object/function), not a
      // string starting with "(Placeholder".
      const speech = body.speech;
      const speechIsPlaceholder =
        typeof speech === "string" && speech.startsWith("(Placeholder");
      expect(speechIsPlaceholder, `${id} still has a placeholder speech`).toBe(false);
    }
  });
});

describe("Lab Overview cluster — gating", () => {
  // setup-q1c lab head manager 2026-05-23: the gate flipped from
  // `account_type === "lab"` to `lab_head === true`. Lab members
  // (account_type=lab + lab_head=false) skip the cluster; only lab
  // heads (account_type=lab + lab_head=true) see it. The dashboard
  // customization + sharing concepts are a PI tool, not a generic
  // member tool.
  it("gates every cluster step on picks.lab_head === true", () => {
    for (const id of CLUSTER_IDS) {
      expect(
        isStepGatedOut(id, { account_type: "lab", lab_head: true }),
        `${id} should fire for lab heads`,
      ).toBe(false);
      expect(
        isStepGatedOut(id, { account_type: "lab", lab_head: false }),
        `${id} should hide for lab members`,
      ).toBe(true);
      expect(
        isStepGatedOut(id, { account_type: "lab" }),
        `${id} should hide when lab_head is undefined`,
      ).toBe(true);
      expect(isStepGatedOut(id, { account_type: "solo" }), `${id} should hide for solo`).toBe(true);
      expect(isStepGatedOut(id, null), `${id} should hide for null picks`).toBe(true);
    }
  });
});
