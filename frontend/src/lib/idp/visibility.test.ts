// Check-ins Phase 3. The per-section sharing read gate. This is the privacy
// guarantee, so it is tested HARD: owner full access, mentor sees only shared
// sections, the values reflection is always hidden, a non-shared viewer is
// denied entirely.

import { describe, expect, it } from "vitest";
import { normalizeIdpForViewer, stripIdpForMirror } from "./visibility";
import type { IDP } from "../types";
import type { Viewer } from "../sharing/unified";

function makeIdp(overrides: Partial<IDP> = {}): IDP {
  return {
    id: "idp-1",
    owner: "mira",
    career_stage: "grad",
    self_assessment: {
      ratings: { "comm::scientific-writing": { self: 2, importance: 5 } },
      responsibilities: "Two cloning projects for Aim 2.",
    },
    career_exploration: {
      aspirations: "Tenure-track faculty.",
      target_path: "Academic PI",
    },
    goals: [
      { id: "g1", text: "Submit the Aim 1 manuscript", term: "short", priority: "high" },
    ],
    action_plan: [
      {
        id: "r1",
        objective: "Take the scientific writing workshop",
        approach: "Grad-school short course",
        target_date: "2026-09-15",
        outcome: "A full Aim 1 draft",
        status: "in_progress",
        synced_task_id: null,
      },
    ],
    mentor_review: {
      comment: "",
      reviewed_by: null,
      reviewed_at: null,
      revisit_date: "2027-06-04",
    },
    values_reflection: { note: "Work-life balance over prestige." },
    shared_sections: {
      self_assessment: false,
      career_exploration: false,
      goals: true,
      action_plan: true,
    },
    mentor: "alex",
    shared_with: [{ username: "alex", level: "read" }],
    created_at: "2026-06-04T00:00:00.000Z",
    updated_at: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

const mira: Viewer = { username: "mira", account_type: "lab" };
const alex: Viewer = { username: "alex", account_type: "lab" };
const stranger: Viewer = { username: "sam", account_type: "lab" };
const labHead: Viewer = { username: "pi", account_type: "lab_head" };

describe("normalizeIdpForViewer", () => {
  it("returns the full record (including values) to the owner", () => {
    const out = normalizeIdpForViewer(makeIdp(), mira);
    expect(out).not.toBeNull();
    expect(out!.values_reflection).toEqual({ note: "Work-life balance over prestige." });
    expect(out!.self_assessment.responsibilities).toContain("cloning");
    expect(out!.goals).toHaveLength(1);
  });

  it("shows the mentor ONLY the shared sections", () => {
    const out = normalizeIdpForViewer(makeIdp(), alex);
    expect(out).not.toBeNull();
    // Shared: goals + action plan come through.
    expect(out!.goals).toHaveLength(1);
    expect(out!.action_plan).toHaveLength(1);
    // Not shared: self-assessment + career exploration are blanked.
    expect(out!.self_assessment.ratings).toEqual({});
    expect(out!.self_assessment.responsibilities).toBe("");
    expect(out!.career_exploration.aspirations).toBe("");
    expect(out!.career_exploration.target_path).toBe("");
  });

  it("ALWAYS strips the values reflection for the mentor, even were a section shared", () => {
    const out = normalizeIdpForViewer(makeIdp(), alex);
    expect(out!.values_reflection).toBeNull();
  });

  it("never leaks values even if every section is shared", () => {
    const idp = makeIdp({
      shared_sections: {
        self_assessment: true,
        career_exploration: true,
        goals: true,
        action_plan: true,
      },
    });
    const out = normalizeIdpForViewer(idp, alex);
    expect(out!.self_assessment.responsibilities).toContain("cloning");
    expect(out!.values_reflection).toBeNull();
  });

  it("denies a viewer who is not in shared_with entirely", () => {
    expect(normalizeIdpForViewer(makeIdp(), stranger)).toBeNull();
  });

  it("denies a lab head who is not an explicit share recipient (PI sees only a status line)", () => {
    expect(normalizeIdpForViewer(makeIdp(), labHead)).toBeNull();
  });

  it("does not mutate the input record when filtering", () => {
    const idp = makeIdp();
    normalizeIdpForViewer(idp, alex);
    expect(idp.values_reflection).toEqual({ note: "Work-life balance over prestige." });
    expect(idp.self_assessment.responsibilities).toContain("cloning");
  });
});

// Multi-lab P3: the PUSH-time strip. The mirror copy must never carry content
// the trainee did not share, so the private bytes never leave the device.
describe("stripIdpForMirror — push-time privacy", () => {
  it("ALWAYS drops the values reflection before the mirror", () => {
    const out = stripIdpForMirror(makeIdp());
    expect(out.values_reflection).toBeNull();
  });

  it("keeps the SHARED sections but blanks the UNshared ones", () => {
    // makeIdp shares goals + action_plan, withholds self_assessment +
    // career_exploration.
    const out = stripIdpForMirror(makeIdp());
    expect(out.goals).toHaveLength(1);
    expect(out.action_plan).toHaveLength(1);
    // Withheld content is blanked, so the raw bytes never reach R2.
    expect(out.self_assessment.responsibilities).toBe("");
    expect(out.self_assessment.ratings).toEqual({});
    expect(out.career_exploration.aspirations).toBe("");
    expect(out.career_exploration.target_path).toBe("");
  });

  it("blanks EVERY section when the IDP is shared with no one", () => {
    // A not-yet-shared IDP (shared_with empty) exposes nothing, even sections
    // flagged shared, so the mirror copy carries zero private content.
    const idp = makeIdp({
      shared_with: [],
      shared_sections: {
        self_assessment: true,
        career_exploration: true,
        goals: true,
        action_plan: true,
      },
    });
    const out = stripIdpForMirror(idp);
    expect(out.goals).toEqual([]);
    expect(out.action_plan).toEqual([]);
    expect(out.self_assessment.responsibilities).toBe("");
    expect(out.career_exploration.aspirations).toBe("");
    expect(out.values_reflection).toBeNull();
  });

  it("PRESERVES the shared_with gate so pullLabView still surfaces only to named recipients", () => {
    const out = stripIdpForMirror(makeIdp());
    expect(out.shared_with).toEqual([{ username: "alex", level: "read" }]);
    expect(out.owner).toBe("mira");
    expect(out.shared_sections.goals).toBe(true);
  });

  it("does not mutate the input record", () => {
    const idp = makeIdp();
    stripIdpForMirror(idp);
    expect(idp.values_reflection).toEqual({ note: "Work-life balance over prestige." });
    expect(idp.self_assessment.responsibilities).toContain("cloning");
  });
});
