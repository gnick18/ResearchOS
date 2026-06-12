// Check-ins Phase 3. Unit coverage for the IDP competency catalog: stage-preset
// filtering and the strengths / growth-areas summary derivation.

import { describe, expect, it } from "vitest";
import {
  COMPETENCY_GROUPS,
  allSkillIds,
  skillVisibleForStage,
  deriveCompetencySummary,
} from "./competencies";

describe("competency catalog", () => {
  it("has the 6 named groups verbatim from the mockup", () => {
    expect(COMPETENCY_GROUPS.map((g) => g.id)).toEqual([
      "research",
      "comm",
      "pdm",
      "lead",
      "rcr",
      "career",
    ]);
  });

  it("gives every skill a stable, unique id", () => {
    const ids = allSkillIds();
    expect(new Set(ids).size).toBe(ids.length);
    // ids are group-prefixed slugs.
    expect(ids).toContain("comm::scientific-writing");
    expect(ids).toContain("career::job-search-and-interviewing");
  });

  it("hides grant-writing, budget, mentoring-others, and job-search for undergrads", () => {
    const find = (label: string) =>
      COMPETENCY_GROUPS.flatMap((g) => g.skills).find((s) => s.label === label)!;
    expect(skillVisibleForStage(find("Grant and proposal writing"), "undergrad")).toBe(false);
    expect(skillVisibleForStage(find("Budget and resource management"), "undergrad")).toBe(false);
    expect(skillVisibleForStage(find("Mentoring others"), "undergrad")).toBe(false);
    expect(skillVisibleForStage(find("Job search and interviewing"), "undergrad")).toBe(false);
    // but core rows show.
    expect(skillVisibleForStage(find("Experimental design"), "undergrad")).toBe(true);
  });

  it("surfaces job-search and negotiation for postdocs and staff", () => {
    const find = (label: string) =>
      COMPETENCY_GROUPS.flatMap((g) => g.skills).find((s) => s.label === label)!;
    expect(skillVisibleForStage(find("Job search and interviewing"), "postdoc")).toBe(true);
    expect(skillVisibleForStage(find("Negotiation"), "staff")).toBe(true);
    expect(skillVisibleForStage(find("Job search and interviewing"), "grad")).toBe(false);
  });
});

describe("deriveCompetencySummary", () => {
  it("classifies self>=4 as a strength and self<=2 as a growth area", () => {
    const ratings = {
      "research::experimental-design": { self: 5, importance: 4 },
      "comm::scientific-writing": { self: 2, importance: 5 },
      "comm::presenting-and-talks": { self: 3, importance: 4 },
    };
    const s = deriveCompetencySummary(ratings, "grad");
    expect(s.strengths).toContain("Experimental design");
    expect(s.growthAreas.map((g) => g.label)).toContain("Scientific writing");
    // self=3 is neither.
    expect(s.strengths).not.toContain("Presenting and talks");
    expect(s.growthAreas.map((g) => g.label)).not.toContain("Presenting and talks");
  });

  it("sorts growth areas by the importance-minus-self gap and flags big gaps", () => {
    const ratings = {
      "comm::scientific-writing": { self: 2, importance: 5 }, // gap 3
      "career::networking": { self: 2, importance: 3 }, // gap 1
    };
    const s = deriveCompetencySummary(ratings, "grad");
    expect(s.growthAreas[0].label).toBe("Scientific writing");
    expect(s.growthAreas[0].gap).toBe(3);
    expect(s.growthAreas[0].bigGap).toBe(true);
    expect(s.growthAreas[1].bigGap).toBe(false);
  });

  it("ignores rows hidden for the active stage", () => {
    const ratings = {
      // Job search is hidden for grad; even rated high it must not appear.
      "career::job-search-and-interviewing": { self: 5, importance: 5 },
    };
    const s = deriveCompetencySummary(ratings, "grad");
    expect(s.strengths).not.toContain("Job search and interviewing");
  });

  it("skips unrated (null self) rows", () => {
    const ratings = {
      "research::experimental-design": { self: null, importance: 4 },
    };
    const s = deriveCompetencySummary(ratings, "grad");
    expect(s.strengths).toHaveLength(0);
    expect(s.growthAreas).toHaveLength(0);
  });
});
