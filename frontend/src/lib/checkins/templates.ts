// Check-ins Phase 3b (checkins-phase3b bot, 2026-06-12). See
// docs/proposals/checkins-revamp.md "Part 3, the academic layer"
// (the "Career-stage-aware templates" paragraph) and the approved mockup
// docs/mockups/2026-06-12-checkins-phase3-idp.html (the template gallery).
//
// A SMALL STATIC catalog of career-stage check-in templates, the method-catalog
// pattern (a hand-curated TS array, not a marketplace). About six seeds. Picking
// one in the new-check-in dialog seeds the space title + cadence defaults and a
// few starter AGENDA items (OneOnOneActionItems) so a new space is not blank.
//
// This is pure data + pure selectors, no I/O. The seeding itself happens in the
// dialog (it calls oneOnOnesApi.create then oneOnOnesApi.addActionItem per seed).

/** A template's cadence hint, mapped onto `OneOnOne.cadence.every` on create. */
export type CheckinTemplateCadence = "week" | "2weeks" | "month";

/** A career-stage / relationship check-in template. */
export interface CheckinTemplate {
  /** Stable id (used as the picker value). */
  id: string;
  /** Display name (matches the gallery). */
  name: string;
  /** One-line description (matches the gallery copy). */
  description: string;
  /** "pair" (a mentoring or peer 1:1) or "group" (a committee / team space).
   *  Advisory: the dialog still derives kind from the member count, but the
   *  template signals the intended shape. */
  kind: "pair" | "group";
  /** The suggested recurring cadence, applied to the space on create. */
  suggested_cadence: CheckinTemplateCadence;
  /** A few starter agenda / talking-point prompts for this stage. Seeded as
   *  undone, unassigned agenda items so a new space opens with a real agenda. */
  agenda_seeds: string[];
}

/**
 * The seed catalog. About six templates, drawn VERBATIM in intent from the
 * proposal's career-stage list and the approved gallery copy. Order is the
 * gallery order (undergrad -> grad -> postdoc -> staff -> committee ->
 * onboarding).
 */
export const CHECKIN_TEMPLATES: readonly CheckinTemplate[] = [
  {
    id: "undergrad",
    name: "Undergrad",
    description:
      "Skills, course balance, and the is-research-for-me question. Lighter self-assessment, short-term goals.",
    kind: "pair",
    suggested_cadence: "2weeks",
    agenda_seeds: [
      "Techniques and skills to learn this term",
      "Balancing research with coursework",
      "Is research the right path for me",
      "A short-term goal for the next few weeks",
    ],
  },
  {
    id: "grad",
    name: "Grad student",
    description:
      "Prelim and aims progress, committee timeline. The full IDP default set.",
    kind: "pair",
    suggested_cadence: "week",
    agenda_seeds: [
      "Prelim / qualifying exam progress",
      "Progress against the Specific Aims",
      "Committee meeting timeline",
      "Blockers I need help with",
    ],
  },
  {
    id: "postdoc",
    name: "Postdoc",
    description:
      "Independence, the job market, the first grant. Leadership and career-advancement rows.",
    kind: "pair",
    suggested_cadence: "week",
    agenda_seeds: [
      "Building toward research independence",
      "Job market and application timeline",
      "First grant or fellowship plan",
      "Mentoring and leadership in the lab",
    ],
  },
  {
    id: "staff",
    name: "Staff scientist",
    description:
      "Project and people management, deemphasizes academic job-search items.",
    kind: "pair",
    suggested_cadence: "2weeks",
    agenda_seeds: [
      "Project priorities and timelines",
      "People and resource management",
      "Skills and professional development",
      "Process improvements for the lab",
    ],
  },
  {
    id: "thesis-committee",
    name: "Thesis committee",
    description:
      "A group space on annual cadence, pre-circulate the progress report and Specific Aims.",
    kind: "group",
    suggested_cadence: "month",
    agenda_seeds: [
      "Pre-circulate the progress report and Specific Aims",
      "Progress since the last committee meeting",
      "Committee feedback and recommendations",
      "Timeline to the next milestone",
    ],
  },
  {
    id: "onboarding",
    name: "Onboarding",
    description:
      "A first check-in with the access, safety, and data-management checklist plus the cadence.",
    kind: "pair",
    suggested_cadence: "week",
    agenda_seeds: [
      "Walk through access, keys, and safety training",
      "Data-management practices and where things live",
      "Read the lab norms / compact doc",
      "Set the ongoing check-in cadence",
    ],
  },
];

/** Look up a template by id, or undefined. */
export function getCheckinTemplate(id: string): CheckinTemplate | undefined {
  return CHECKIN_TEMPLATES.find((t) => t.id === id);
}

/** Map a template's cadence hint onto the `OneOnOne.cadence` shape. */
export function templateCadence(
  template: CheckinTemplate,
): { every: CheckinTemplateCadence; weekday?: number } {
  return { every: template.suggested_cadence };
}
