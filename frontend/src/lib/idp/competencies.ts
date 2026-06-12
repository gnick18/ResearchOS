// Check-ins Phase 3 (checkins-phase3 bot, 2026-06-12). The IDP competency
// catalog, a STATIC asset like the method catalog. The 6 groups and their skill
// rows are lifted VERBATIM from the approved mockup
// (docs/mockups/2026-06-12-checkins-phase3-idp.html, the COMP_GROUPS array) and
// the proposal's "IDP structure" section. Each skill carries the career stages
// it shows for; the preset filter on the IDP form shows a row only when its
// `stages` set includes the active stage (e.g. grant-writing / budget /
// mentoring-others are hidden for undergrads; job-search / negotiation surface
// for postdocs and staff).
//
// The `id` is a STABLE key (group id + a slug of the label) used as the key into
// `IDP.self_assessment.ratings`. It must never change once shipped (it is an
// on-disk key), so it is derived once here and frozen.

import type { CareerStage } from "../types";

const ALL: CareerStage[] = ["undergrad", "grad", "postdoc", "staff"];

/** A single competency skill row. */
export interface CompetencySkill {
  /** Stable rating key (group + slug). Never change once shipped. */
  id: string;
  label: string;
  /** Which career stages surface this row in the preset filter. */
  stages: CareerStage[];
}

/** A collapsible competency group. */
export interface CompetencyGroup {
  id: string;
  name: string;
  skills: CompetencySkill[];
}

/** Slugify a label into a stable id fragment. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function group(
  id: string,
  name: string,
  rows: Array<{ label: string; stages: CareerStage[] }>,
): CompetencyGroup {
  return {
    id,
    name,
    skills: rows.map((r) => ({
      id: `${id}::${slug(r.label)}`,
      label: r.label,
      stages: r.stages,
    })),
  };
}

/** The 6 competency groups, verbatim from the approved mockup. */
export const COMPETENCY_GROUPS: CompetencyGroup[] = [
  group("research", "Research and technical", [
    { label: "Experimental design", stages: ALL },
    { label: "Data analysis and statistics", stages: ALL },
    { label: "Reproducibility and data management", stages: ALL },
    { label: "Designing a research program", stages: ["postdoc", "staff"] },
  ]),
  group("comm", "Communication and writing", [
    { label: "Scientific writing", stages: ALL },
    { label: "Presenting and talks", stages: ALL },
    {
      label: "Grant and proposal writing",
      stages: ["grad", "postdoc", "staff"],
    },
  ]),
  group("pdm", "Project and data management", [
    { label: "Planning and prioritizing", stages: ALL },
    { label: "Budget and resource management", stages: ["postdoc", "staff"] },
  ]),
  group("lead", "Leadership and mentoring", [
    { label: "Mentoring others", stages: ["grad", "postdoc", "staff"] },
    { label: "Leading a team", stages: ["postdoc", "staff"] },
    { label: "Collaboration and teamwork", stages: ALL },
  ]),
  group("rcr", "Responsible conduct of research", [
    { label: "Research ethics and integrity", stages: ALL },
    { label: "Data ownership and sharing norms", stages: ALL },
  ]),
  group("career", "Career and professional development", [
    { label: "Networking", stages: ALL },
    { label: "Job search and interviewing", stages: ["postdoc", "staff"] },
    { label: "Negotiation", stages: ["postdoc", "staff"] },
  ]),
];

/** A short hint shown under the stage switcher, verbatim from the mockup. */
export const STAGE_HINTS: Record<CareerStage, string> = {
  undergrad:
    "Undergrad. Self-assessment and short-term goals lead; grant-writing, budget, mentoring-others, and job-search rows are hidden.",
  grad: "Grad student. The full default set, goals seeded with prelim and thesis milestones.",
  postdoc:
    "Postdoc. Leadership, independence, and job-search rows surface; this is where the career-advancement work lives.",
  staff:
    "Staff scientist. Project and people management lead; academic job-search rows recede.",
};

/** Every skill id, flat (used to seed a fresh ratings map). */
export function allSkillIds(): string[] {
  return COMPETENCY_GROUPS.flatMap((g) => g.skills.map((s) => s.id));
}

/** True when a skill row shows for the given career stage. */
export function skillVisibleForStage(
  skill: CompetencySkill,
  stage: CareerStage,
): boolean {
  return skill.stages.includes(stage);
}

/** A strength (self-rated 4 to 5) or growth area (self-rated 1 to 2) derived
 *  from the ratings, for the live self-assessment summary. */
export interface CompetencySummary {
  /** Labels of skills the trainee rated 4 or 5 (self). */
  strengths: string[];
  /** Growth areas (self-rated 1 to 2), sorted by the importance-minus-self gap
   *  (largest first). `bigGap` flags a gap of 3 or more. */
  growthAreas: Array<{ label: string; gap: number; bigGap: boolean }>;
}

/**
 * Derive the strengths / growth-areas summary from a ratings map, considering
 * only rows visible for the active stage (so a hidden row never appears in the
 * summary). Mirrors the mockup's `summaryHTML`:
 *   - self >= 4  -> strength
 *   - self <= 2  -> growth area, gap = importance - self, bigGap when gap >= 3
 * Rows with a null self-rating are skipped (not yet rated).
 */
export function deriveCompetencySummary(
  ratings: Record<string, { self: number | null; importance: number | null }>,
  stage: CareerStage,
): CompetencySummary {
  const strengths: string[] = [];
  const growthAreas: Array<{ label: string; gap: number; bigGap: boolean }> = [];

  for (const grp of COMPETENCY_GROUPS) {
    for (const skill of grp.skills) {
      if (!skillVisibleForStage(skill, stage)) continue;
      const r = ratings[skill.id];
      if (!r || r.self === null) continue;
      if (r.self >= 4) {
        strengths.push(skill.label);
      } else if (r.self <= 2) {
        const importance = r.importance ?? r.self;
        const gap = importance - r.self;
        growthAreas.push({ label: skill.label, gap, bigGap: gap >= 3 });
      }
    }
  }

  growthAreas.sort((a, b) => b.gap - a.gap);
  return { strengths, growthAreas };
}
