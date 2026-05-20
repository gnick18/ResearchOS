// frontend/src/lib/onboarding/use-case-tab-mapping.ts
//
// The locked use-case → visible-tab mapping for the Onboarding v2
// wizard. Step 7 of the wizard ("Continue") writes the union of these
// tab lists into the user's `settings.json.visibleTabs`, the same field
// that Settings → Tabs writes. Phase 0 lands the data only — the
// wizard component and the settings-write happen in Phases 1-2.
//
// The 9 use-case ids and labels are intentionally industry-friendly:
// solo_researcher / staff_scientist / undergrad_researcher exist
// alongside the academic-coded phd_experiments / postdoc / teaching
// options so a startup or independent-lab user doesn't feel like the
// product is asking them to misrepresent themselves.
//
// The mapping table is hand-picked, NOT derived. Manager-locked in the
// onboarding v2 brief; see the Phase 0 deliverables table.

import { NAV_ITEMS, ALL_TAB_HREFS, HOME_HREF } from "@/lib/nav";

/** Stable kebab-case ids for the 9 wizard options. These are written
 *  into `_onboarding.json.use_cases` and read back across builds, so
 *  rename with a migration only. */
export const USE_CASE_IDS = [
  "phd_experiments",
  "lab_manager",
  "teaching",
  "computational",
  "postdoc",
  "solo_researcher",
  "staff_scientist",
  "undergrad_researcher",
  "just_exploring",
] as const;

export interface UseCase {
  /** Stable kebab-case id (one of {@link USE_CASE_IDS}). */
  id: string;
  /** User-facing label shown on the wizard's chip-picker UI. */
  label: string;
  /** 1-sentence subtitle shown under the label on the same chip.
   *  Industry/startup-friendly framing — see file-level comment. */
  description: string;
}

/** The 9 wizard options, in display order. Order is the order the
 *  chips render on the wizard step. */
export const USE_CASES: UseCase[] = [
  {
    id: "phd_experiments",
    label: "PhD running experiments",
    description: "Running your own experiments toward a thesis",
  },
  {
    id: "lab_manager",
    label: "Lab manager",
    description: "Coordinating people, purchases, and schedules across a lab",
  },
  {
    id: "teaching",
    label: "Teaching / instructor",
    description: "Running a teaching lab or course-linked research project",
  },
  {
    id: "computational",
    label: "Computational researcher",
    description: "Dry-lab work: data, code, modeling, no benchwork",
  },
  {
    id: "postdoc",
    label: "Postdoc",
    description: "Driving your own project inside someone else's lab",
  },
  {
    id: "solo_researcher",
    label: "Solo researcher",
    description: "Head of your own small lab — industry, startup, or independent",
  },
  {
    id: "staff_scientist",
    label: "Staff scientist / researcher",
    description: "Career bench scientist on a long-running program",
  },
  {
    id: "undergrad_researcher",
    label: "Undergrad researcher",
    description: "Shadowing or supporting someone else's project",
  },
  {
    id: "just_exploring",
    label: "Just exploring",
    description: "Kicking the tires — show me everything",
  },
];

/** Manager-locked table from the Onboarding v2 Phase 0 brief. Each
 *  value is the array of NAV_ITEMS hrefs that should be in the user's
 *  `visibleTabs` after picking this use case. `/` (Home) is always
 *  included by the canonical NAV_ITEMS contract (Home can never be
 *  hidden — see `frontend/src/lib/nav.ts`).
 *
 *  `just_exploring` is intentionally absent: the helper short-circuits
 *  to the full tab list when it appears in the selection. */
export const USE_CASE_TAB_MAP: Record<string, string[]> = {
  phd_experiments: [
    "/",
    "/workbench",
    "/gantt",
    "/methods",
    "/purchases",
    "/calendar",
    "/search",
  ],
  lab_manager: [
    "/",
    "/workbench",
    "/gantt",
    "/methods",
    "/purchases",
    "/calendar",
    "/search",
    "/links",
  ],
  teaching: ["/", "/workbench", "/methods", "/calendar", "/search"],
  computational: ["/", "/workbench", "/methods", "/search"],
  postdoc: [
    "/",
    "/workbench",
    "/gantt",
    "/methods",
    "/purchases",
    "/calendar",
    "/search",
    "/links",
  ],
  // Solo researcher: no team to share with by default, so /links is hidden.
  // Refined by master 2026-05-20 (originally locked ✓, corrected to ✗). A
  // solo researcher who later grows a team can re-enable Lab Links per-tab
  // via Settings. Phase 2's tab-config step also adds a folder-state-aware
  // override (Lab Mode default-on inside multi-user folders regardless of
  // static mapping).
  solo_researcher: [
    "/",
    "/workbench",
    "/gantt",
    "/methods",
    "/purchases",
    "/calendar",
    "/search",
  ],
  staff_scientist: [
    "/",
    "/workbench",
    "/gantt",
    "/methods",
    "/purchases",
    "/calendar",
    "/search",
    "/links",
  ],
  undergrad_researcher: ["/", "/workbench", "/calendar", "/search"],
};

/** Compute the `visibleTabs` value that the wizard's Continue button
 *  should write into the user's settings.
 *
 *  Contract:
 *  - If `selected` is empty OR includes `just_exploring`, return ALL
 *    nav tabs (the "show me everything" escape hatch).
 *  - Otherwise, return the UNION of `USE_CASE_TAB_MAP[id]` for each
 *    id in `selected`, in NAV_ITEMS canonical order. `/` (Home) is
 *    always first.
 *  - Unknown ids in `selected` are silently ignored (defensive — older
 *    sidecar values shouldn't crash a future build).
 *  - Home is always present in the result even when every selected id
 *    is unknown (so the user always has a safe landing tab). */
export function tabsForUseCases(selected: string[]): string[] {
  if (selected.length === 0 || selected.includes("just_exploring")) {
    return [...ALL_TAB_HREFS];
  }
  const union = new Set<string>([HOME_HREF]);
  for (const id of selected) {
    const tabs = USE_CASE_TAB_MAP[id];
    if (!tabs) continue; // unknown id — ignore
    for (const href of tabs) union.add(href);
  }
  // Preserve NAV_ITEMS canonical order.
  return NAV_ITEMS.map((item) => item.href).filter((href) => union.has(href));
}
