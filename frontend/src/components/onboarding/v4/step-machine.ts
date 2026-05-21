/**
 * Pure step-ordering + conditional-gating logic for the Onboarding v4
 * tour controller. No React imports, no I/O, no side effects — fully
 * vitest-able and re-usable from dev tools / debug consoles.
 *
 * Sourced from ONBOARDING_V4_PROPOSAL.md §6 (Phase 2 walkthrough steps)
 * + L16 (conditional gating on `feature_picks`) + L19/L20 (lab tour
 * minimal scope).
 *
 * P1 only owns the step ORDER + gates; step BODIES (real speech /
 * cursorScripts / completion contracts) land in P4 (setup port), P5
 * (universal walkthrough), P6 (conditional walkthroughs), P7 (lab).
 * The machine treats every id as an opaque label and trusts the renderer
 * (TourController.tsx) to draw a placeholder card when the body is still
 * unimplemented.
 */
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import type { TourStepId } from "./step-types";

/**
 * Canonical forward order for the v4 tour. The machine walks this list
 * and filters out gated steps via `isStepGatedOut`. New steps added in
 * P5-P7 must be inserted here at the correct logical position so the
 * forward / backward traversal stays consistent.
 *
 * Grouped (for readability — readers shouldn't depend on the boundaries,
 * use `isSetupPhaseStep` / `isWalkthroughPhaseStep` etc. instead):
 *
 *   Phase 1 — modal setup     : "welcome" + Q1-Q6 (+ Q1a/Q1b for lab)
 *   Phase 2 — in-product tour : home → project → notifications →
 *                               methods → workbench → hybrid editor →
 *                               gantt → settings → search → wiki
 *   Phase 2b — conditional    : telegram / purchases / calendar
 *   Phase 2c — lab tour       : prompt → spawn fake user → permission
 *                               practice
 *   Phase 4 — cleanup grid    : "phase4-cleanup"
 *
 * Order matches the proposal §6 sub-sections (6.1 → 6.17). The
 * personalization steps (color + animation + ai-helper) cluster onto
 * the Settings page deep-dive per §6.10. The "More in settings" pointer
 * intentionally lives between the color pick and the AI Helper deep
 * explain to give the speech bubble a beat to land before the longer
 * AI Helper monologue.
 */
export const TOUR_STEP_ORDER: readonly TourStepId[] = [
  // ----- Phase 1: modal setup (per §4.1, §6 intro, L9 "stays modal-contained")
  "welcome",
  "setup-q1",
  "setup-q1a",
  "setup-q1b",
  "setup-q2",
  "setup-q3",
  "setup-q4",
  "setup-q5",
  "setup-q6",

  // ----- Phase 2: universal walkthrough (§6.1 - §6.12)
  // Home + first project (§6.1). Split into TRIGGER (highlight the
  // button + advance when the form opens) + FILL (explain name +
  // color + the seven-day-week toggle + advance on
  // `projectsApi.create`). See HomeCreateProjectStep.tsx for the
  // split rationale.
  "home-create-project",
  "home-create-project-fill",
  // Project route Overview prose (§6.2). Split into NAV (cursor clicks
  // the project card on home + advances on `tour:project-route-entered`)
  // + PROSE (cursor types the placeholder hypothesis into the Overview
  // textarea on the project page). The split mirrors §6.1's trigger /
  // fill pattern; a single cursor script can't span the navigation
  // because the in-product overlay unmounts on route change. See
  // ProjectOverviewNavStep.tsx for the split rationale.
  "project-overview-nav",
  "project-overview-prose",
  // Transition beat (Grant 2026-05-21): cursor glides to the Home nav
  // tab and the controller pushes the browser back to "/" so §6.3
  // notifications fires from the home surface, not from inside the
  // project page. Avoids the jarring "still in /workbench/projects/123
  // but suddenly talking about the bell" cut. See
  // ProjectOverviewExitStep.tsx for the rationale.
  "project-overview-exit",
  // Notifications universal moment (§6.3). Split into three beats so
  // the user actually opens the inbox, silences the row, and dismisses
  // it before moving on — see ONBOARDING_V4_PROPOSAL.md §6.3 (Grant's
  // 2026-05-21 design feedback "be smarter than a Got it button").
  "notifications-bell",      // §6.3a: open the inbox
  "notifications-silence",   // §6.3b: mark-as-read (mute the bell badge)
  "notifications-delete",    // §6.3c: dismiss the row
  // Methods page deep-dive (§6.4)
  // sec 6.4 redesign (Grant 2026-05-21): split the original
  // category step into a prompt (BeakerBot asks the user what kind of
  // technique they do) + a demo (cursor types the user's pick and
  // saves). The picker lives in MethodsCategoryPromptStep.tsx; the
  // demo retains the `methods-category` id.
  // Then the open-picker beat (Grant 2026-05-21) bridges to the type-
  // breadth wall of speech by having BeakerBot click "+ New Method" so
  // the modal mounts before the next step fires.
  "methods-category-prompt", // §6.4a-prompt (interactive picker)
  // Grant 2026-05-21 rethink: separate the user-action open-click from
  // BeakerBot's type+submit demo. The user clicks "+ New Category"
  // themselves; the cursor then takes over to type the picked label and
  // click Create Empty.
  "methods-category-open",   // §6.4a-open (user opens the modal)
  "methods-category",        // §6.4a-demo (cursor types + clicks Create Empty)
  "methods-open-picker",     // §6.4 bridge (click New Method, modal mounts)
  // §6.4b deep-demo (v4 sec 6.4b upgrade sub-bot 2026-05-21): replaces
  // the prior 7-tile hover sweep with five sub-steps that click INTO
  // the PCR and LC Gradient builders and exercise real affordances so
  // users see these are interactive editors (not text forms). Speech-
  // first compound paragraph stays on `methods-type-tour`.
  "methods-type-tour",       // §6.4b-1: intro speech + click PCR tile
  "methods-pcr-edit",        // §6.4b-2: click Edit Cycle in PCR toolbar
  "methods-pcr-add-cycle",   // §6.4b-3: click + Add Cycle (modal opens)
  "methods-pcr-confirm-cycle", // §6.4b-4: confirm Add (new cycle drops in)
  "methods-lc-demo",         // §6.4b-5: click LC tile, hover chart, Add step
  "methods-create",          // §6.4d (BeakerBot's funny markdown method)
  // Workbench experiment creation (§6.5)
  "workbench-create-experiment",
  // Method attachment + variation notes + snapshot teach (§6.6).
  // Split into 4 popup-mount-safe sub-steps (2026-05-21, HR-dispatched):
  // the original single `experiment-attach-method` step's cursor script
  // spanned the popup-mount boundary and the second click either timed
  // out or fired on a stale DOM. Same class of bug as §6.2's
  // route-spanning script. See MethodAttachmentStep.tsx for the split.
  "experiment-attach-method-open",    // §6.6a click workbench row → open popup
  "experiment-attach-method-tab",     // §6.6b click Methods tab inside popup
  "experiment-attach-method-attach",  // §6.6c click Attach + pick funny method
  "experiment-attach-method-notes",   // §6.6d type variation note + mental model
  // Hybrid editor — shortcuts + paragraph chunks + image drops + resize (§6.7)
  // P5 split the original single `hybrid-editor` id into four sub-steps
  // matching the proposal's four cursor scripts (FLAG to master: this
  // adds three new ids; the machine treats each as part of the
  // walkthrough phase so no gate update is needed).
  "hybrid-editor",
  "hybrid-editor-paragraphs",
  "hybrid-editor-image-drop",
  "hybrid-editor-resize",
  // Gantt page deep-dive (§6.8)
  "gantt-task-types",
  "gantt-drag-drop",
  "gantt-chained-deps",
  "gantt-goals-overview",
  // Personalization on the Gantt toolbar (§6.9)
  "personalization-animations",
  // Settings deep-dive (§6.10)
  "personalization-color",
  "settings-more",
  "ai-helper-deep-explain",
  // Search (§6.11)
  "search-demo",
  // Wiki pointer outro (§6.12)
  "wiki-pointer",

  // ----- Phase 2b: conditional walkthroughs (§6.13 - §6.15)
  // Order matches Grant's voice-to-text: telegram first (since it can
  // dovetail into hybrid editor image), then purchases, then calendar.
  "telegram",
  "purchases",
  "calendar",

  // ----- Phase 2c: lab tour (§6.16, conditional on Q1=lab)
  "lab-prompt",
  "lab-spawn-beakerbot",
  "lab-permission-practice",
  // §6.16c auto-cleanup (L21): tombstones the fake BeakerBot user +
  // shared tasks. Runs as a dedicated terminal lab step so back-
  // stepping inside the cluster (permission-practice → spawn) does
  // not prematurely tear down the fake teammate.
  "lab-cleanup",

  // ----- Phase 4: cleanup grid (§6.17)
  "phase4-cleanup",
];

const STEP_INDEX: ReadonlyMap<TourStepId, number> = new Map(
  TOUR_STEP_ORDER.map((id, i) => [id, i]),
);

/** Setup phase 1 step ids (modal-contained per L9). */
const SETUP_STEP_IDS: ReadonlySet<TourStepId> = new Set<TourStepId>([
  "welcome",
  "setup-q1",
  "setup-q1a",
  "setup-q1b",
  "setup-q2",
  "setup-q3",
  "setup-q4",
  "setup-q5",
  "setup-q6",
]);

/** Lab tour step ids (gated on Q1=lab + lab-prompt decision). */
const LAB_STEP_IDS: ReadonlySet<TourStepId> = new Set<TourStepId>([
  "lab-prompt",
  "lab-spawn-beakerbot",
  "lab-permission-practice",
  "lab-cleanup",
]);

/** True when this step is one of the Phase 1 modal setup questions. */
export function isSetupPhaseStep(step: TourStepId): boolean {
  return SETUP_STEP_IDS.has(step);
}

/** True when this step belongs to the conditional lab tour cluster. */
export function isLabPhaseStep(step: TourStepId): boolean {
  return LAB_STEP_IDS.has(step);
}

/**
 * Returns true when this step should be skipped under the current
 * feature picks (gating per L16). The machine walks the full order and
 * uses this predicate to fast-forward in both directions.
 *
 * Mirrors `WizardStepMachine.isStepSkippedByGate` for v3, adapted to
 * the v4 step ids + the simplified lab tour scope (L19 dropped v3's
 * L5-L10 sub-tours, so we only gate the lab cluster as a whole on
 * account_type === "lab").
 */
export function isStepGatedOut(
  step: TourStepId,
  picks: FeaturePicks | null,
): boolean {
  // Phase 1 lab sub-questions: only fire when account_type=lab. While
  // picks is null (welcome → setup-q1) we err toward hiding them so an
  // unfinished Q1 doesn't pull in unwanted lab-specific prompts.
  if (step === "setup-q1a" || step === "setup-q1b") {
    return picks?.account_type !== "lab";
  }

  // Phase 2 conditional walkthroughs (§6.13 - §6.15).
  if (step === "telegram") return picks?.telegram !== "yes";
  if (step === "purchases") return picks?.purchases !== "yes";
  if (step === "calendar") return picks?.calendar !== "yes";

  // §6.8 goals overview sub-step: only show when picks.goals === "yes".
  // The other Gantt sub-steps (task types intro, drag-drop, chained
  // deps) fire for everyone — they teach core Gantt mechanics, not the
  // goals overlay feature.
  if (step === "gantt-goals-overview") return picks?.goals !== "yes";

  // §6.10 AI Helper deep-explain: only fire when AI Helper is opted in
  // (full / medium / minimal). "no" and "maybe" route around the
  // deep-explain monologue.
  if (step === "ai-helper-deep-explain") {
    const v = picks?.ai_helper;
    if (!v) return true;
    return v === "no" || v === "maybe";
  }

  // Lab tour cluster — entire cluster gates on account_type === "lab".
  // P7 will additionally consult `lab_tour_pending` /
  // `lab_tour_dismissed_at` from the sidecar inside the lab-prompt step
  // body (per §6.16 now/later/dismiss branching), but the machine-level
  // gate only knows about the feature pick. Defer the runtime decision
  // to the step body, same shape as v3 P3a did via
  // `getLabTourDecision`.
  if (LAB_STEP_IDS.has(step)) {
    return picks?.account_type !== "lab";
  }

  return false;
}

/**
 * Next applicable step. Returns `"phase4-cleanup"` once every gated
 * step has been consumed. Returns `null` when `current` is already
 * `"phase4-cleanup"` (the controller's exit handler fires when the
 * cleanup step finishes, not when the machine hits a sentinel).
 *
 * Unknown / off-graph `current` ids fall back to the first applicable
 * step — same defensive behavior as v3.
 */
export function getNextStep(
  current: TourStepId,
  picks: FeaturePicks | null,
): TourStepId | null {
  if (current === "phase4-cleanup") return null;
  const start = STEP_INDEX.get(current);
  if (start === undefined) {
    // Unknown id → bootstrap from the first applicable step.
    for (const candidate of TOUR_STEP_ORDER) {
      if (!isStepGatedOut(candidate, picks)) return candidate;
    }
    return "phase4-cleanup";
  }
  for (let i = start + 1; i < TOUR_STEP_ORDER.length; i++) {
    const candidate = TOUR_STEP_ORDER[i];
    if (!isStepGatedOut(candidate, picks)) return candidate;
  }
  return "phase4-cleanup";
}

/**
 * Previous applicable step. Returns `null` when `current` is the first
 * applicable step (typically `"welcome"` — back-stepping off the head
 * is a no-op, and the UI hides the Back affordance in that state).
 */
export function getPreviousStep(
  current: TourStepId,
  picks: FeaturePicks | null,
): TourStepId | null {
  const start = STEP_INDEX.get(current);
  if (start === undefined || start === 0) return null;
  for (let i = start - 1; i >= 0; i--) {
    const candidate = TOUR_STEP_ORDER[i];
    if (!isStepGatedOut(candidate, picks)) return candidate;
  }
  return null;
}

/**
 * Total applicable step count under the given picks — useful for a
 * "Step X of Y" indicator in the speech bubble. Filters
 * `TOUR_STEP_ORDER` through `isStepGatedOut` once.
 */
export function totalApplicableSteps(picks: FeaturePicks | null): number {
  let n = 0;
  for (const step of TOUR_STEP_ORDER) {
    if (!isStepGatedOut(step, picks)) n++;
  }
  return n;
}

/**
 * 1-based index of `current` among applicable steps. Returns 0 when
 * `current` is itself gated out (defensive — covers an in-flight
 * `feature_picks` mutation that toggles a gate while a gated-out step
 * is somehow active).
 */
export function applicableStepIndex(
  current: TourStepId,
  picks: FeaturePicks | null,
): number {
  let idx = 0;
  for (const step of TOUR_STEP_ORDER) {
    if (isStepGatedOut(step, picks)) continue;
    idx++;
    if (step === current) return idx;
  }
  return 0;
}

/**
 * The first applicable step under the given picks — used at tour start
 * when no explicit `initialStep` is provided. Falls back to
 * `"phase4-cleanup"` if every preceding step is gated out (impossible
 * under any real `FeaturePicks` shape, but a deterministic terminus
 * matters for tests + dev tools).
 */
export function firstApplicableStep(
  picks: FeaturePicks | null,
): TourStepId {
  for (const candidate of TOUR_STEP_ORDER) {
    if (!isStepGatedOut(candidate, picks)) return candidate;
  }
  return "phase4-cleanup";
}
