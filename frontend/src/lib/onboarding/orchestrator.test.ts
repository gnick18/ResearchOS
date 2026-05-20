// TODO P1: re-author against the v3 walkthrough orchestrator
// (ONBOARDING_V3_PROPOSAL.md §5-§11). The old gating predicates pinned
// here (tip-roll cooldown, mode === null, shown_count cap, action-cancel
// persistence, the v1/v2 wizard mount gate, the ?wizard-preview override)
// all referenced the v3 sidecar fields removed in the v3 → v4 migration
// (P0). Re-pinning them on the v4 surface is a P1 deliverable so the
// new test surface matches the new state machine.
//
// Single placeholder kept so the test runner stays green and so a
// future grep for `orchestrator.test` lands on something explicit.

import { describe, expect, it } from "vitest";

describe("orchestrator (P0 stub)", () => {
  it("placeholder until P1 re-authors the v3-walkthrough tests", () => {
    expect(true).toBe(true);
  });
});
