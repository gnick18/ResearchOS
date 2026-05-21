import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";

/**
 * Pure state logic for the Onboarding v3 wizard. P1 wires the
 * forward / backward step graph + the conditional gates from
 * ONBOARDING_V3_PROPOSAL.md §5 (W1-W14) and §6 (L1-L11). No I/O,
 * no React imports, no side effects: callable from anywhere
 * (component bodies, vitest, dev tools).
 *
 * Step CONTENT (the W1/W2/L4 bodies themselves) lands in P2a/b/c
 * and P3a; P1 only owns the order + gating. The state machine
 * treats every step id as an opaque label and trusts the renderer
 * to draw a placeholder when the body is unimplemented.
 */

export type SetupStepId =
  | "intro"
  | "setup-q1"
  | "setup-q1a"
  | "setup-q1b"
  | "setup-q2"
  | "setup-q3"
  | "setup-q4"
  | "setup-q5"
  | "setup-q6";

export type UniversalWalkthroughStepId =
  | "W1"
  | "W2"
  | "W3"
  | "W4"
  | "W5"
  | "W6"
  | "W7"
  | "W8"
  | "W9";

export type ConditionalWalkthroughStepId =
  | "W10"
  | "W11"
  | "W12"
  | "W13"
  | "W14";

export type LabTourStepId =
  | "lab-prompt"
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "L6"
  | "L7"
  | "L8"
  | "L9"
  | "L10"
  | "L11";

export type CleanupStepId = "phase4-cleanup";

export type WizardStep =
  | SetupStepId
  | UniversalWalkthroughStepId
  | ConditionalWalkthroughStepId
  | LabTourStepId
  | CleanupStepId;

/** Source of truth for forward order. The machine filters this by
 *  feature picks to skip steps that don't apply. */
const FULL_STEP_ORDER: WizardStep[] = [
  "intro",
  "setup-q1",
  "setup-q1a",
  "setup-q1b",
  "setup-q2",
  "setup-q3",
  "setup-q4",
  "setup-q5",
  "setup-q6",
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
  "W6",
  "W7",
  "W8",
  "W9",
  "W10",
  "W11",
  "W12",
  "W13",
  "W14",
  "lab-prompt",
  "L1",
  "L2",
  "L3",
  "L4",
  "L5",
  "L6",
  "L7",
  "L8",
  "L9",
  "L10",
  "L11",
  "phase4-cleanup",
];

/** All known step ids — useful for dev tools and tests. */
export const ALL_STEP_IDS: ReadonlyArray<WizardStep> = FULL_STEP_ORDER;

const SETUP_STEP_IDS: ReadonlySet<WizardStep> = new Set<WizardStep>([
  "intro",
  "setup-q1",
  "setup-q1a",
  "setup-q1b",
  "setup-q2",
  "setup-q3",
  "setup-q4",
  "setup-q5",
  "setup-q6",
]);

/** Mid-walkthrough opt-out signal for the Lab Mode tour. "later" defers
 *  via `lab_tour_pending` (P3b's natural-Lab-Mode-entry trigger will
 *  re-prompt), "dismiss" sets `lab_tour_dismissed_at` (permanent),
 *  "undecided" means no opt-out is persisted. The "Take Lab tour now"
 *  branch of the lab-prompt step body writes nothing and steps the
 *  wizard forward to L1 directly, so "undecided" + lab account flows
 *  through the L-steps from this reader's perspective. There is no
 *  "now" return value: the absence of an opt-out is the active state.
 *  See {@link isLabTourActive} for the gate predicate that consumes
 *  this. */
export type LabTourDecision = "later" | "dismiss" | "undecided";

/** Returns true when this step is gated by a feature pick that
 *  evaluates falsy under the given sidecar/featurePicks. The wizard
 *  walks the full step order and uses this predicate to fast-forward
 *  past inapplicable steps in both directions. */
export function isStepSkippedByGate(
  step: WizardStep,
  picks: FeaturePicks | null,
  sidecar: OnboardingSidecar | null,
): boolean {
  // Phase 1 setup: q1a/q1b only fire when account_type === lab. The
  // wizard writes account_type to picks at the end of setup-q1, so
  // while picks is null (intro → setup-q1) we err on the side of
  // showing q1a/q1b only when explicitly opted in.
  if (step === "setup-q1a" || step === "setup-q1b") {
    return picks?.account_type !== "lab";
  }

  // Phase 2 conditional W10-W14.
  if (step === "W10") return picks?.purchases !== "yes";
  if (step === "W11") return picks?.goals !== "yes";
  if (step === "W12") return picks?.telegram !== "yes";
  if (step === "W13") return picks?.calendar !== "yes";
  if (step === "W14") {
    // ai_helper is gated by §5: fires when picks.ai_helper is full,
    // medium, or minimal. The "no" and "maybe" values skip it.
    const v = picks?.ai_helper;
    if (!v) return true;
    return v === "no" || v === "maybe";
  }

  // Lab tour gate. lab-prompt only fires for lab accounts. L1-L11
  // only fire when the user picked "now" at lab-prompt — the renderer
  // for lab-prompt (P3a, LabPromptStep) writes `lab_tour_pending` /
  // `lab_tour_dismissed_at` into the sidecar via patchSidecar; the
  // "now" branch writes nothing and falls through to L1. P3a migrated
  // the reader off the P1 sentinel-in-skipped_steps scheme onto the
  // real sidecar fields that P0 already shipped for exactly this
  // purpose; the default is "undecided" so an unfinished lab-prompt
  // never lets the state machine wander into L1-L11 on its own.
  if (step === "lab-prompt") {
    return picks?.account_type !== "lab";
  }
  if (
    step === "L1" ||
    step === "L2" ||
    step === "L3" ||
    step === "L4" ||
    step === "L5" ||
    step === "L6" ||
    step === "L7" ||
    step === "L9" ||
    step === "L10" ||
    step === "L11"
  ) {
    if (picks?.account_type !== "lab") return true;
    return !isLabTourActive(sidecar);
  }
  if (step === "L8") {
    if (picks?.account_type !== "lab") return true;
    if (!isLabTourActive(sidecar)) return true;
    return picks?.purchases !== "yes";
  }

  return false;
}

/** Read the lab-tour pick from the sidecar. P3a migrated this reader
 *  off the P1 sentinel-strings-in-`wizard_resume_state.skipped_steps`
 *  scheme onto the real sidecar fields P0 shipped for exactly this
 *  purpose:
 *
 *    - `lab_tour_dismissed_at` set → "dismiss" (terminal; never fires
 *      again automatically per L18)
 *    - `lab_tour_pending: true`    → "later" (P3b's natural-Lab-Mode-
 *      entry trigger reads the same flag and re-prompts)
 *    - neither set                 → "undecided" by default. The
 *      lab-prompt step body writes nothing on the "Now" branch so the
 *      state machine flows straight through to L1; on Later/Dismiss
 *      it patches the corresponding sidecar field before transitioning,
 *      and `getNextStep` consults this reader on the next render to
 *      route around L1-L11 to phase4-cleanup.
 *
 *  Default flipped from "now" → "undecided" in P3a so an unfinished
 *  lab-prompt no longer pulls a partial walkthrough into the lab tour.
 *  P1's "now" default was only kept so the universal smoke test walked
 *  the full graph; the real step body now drives the decision. */
export function getLabTourDecision(
  sidecar: OnboardingSidecar | null,
): LabTourDecision {
  if (!sidecar) return "undecided";
  if (sidecar.lab_tour_dismissed_at) return "dismiss";
  if (sidecar.lab_tour_pending) return "later";
  return "undecided";
}

/** True when the L1-L11 step bodies should render. Active iff the
 *  user has not explicitly opted out (Later or Dismiss). "undecided"
 *  is treated as active so the universal walkthrough flows straight
 *  into the lab tour from W14 / lab-prompt without a sentinel write
 *  for the "Now" pick — the brief's writer contract says Now writes
 *  nothing and proceeds, so any non-opted-out lab user reaches L1
 *  through this predicate. */
export function isLabTourActive(
  sidecar: OnboardingSidecar | null,
): boolean {
  const decision = getLabTourDecision(sidecar);
  return decision !== "later" && decision !== "dismiss";
}

/** Compute the next applicable step. Returns `"phase4-cleanup"` once
 *  the last applicable W / L / setup step has been consumed. Returns
 *  `null` if `current` is `"phase4-cleanup"` (the wizard's onComplete
 *  handler fires when the cleanup step exits, not when the machine
 *  hits a sentinel). */
export function getNextStep(
  current: WizardStep,
  sidecar: OnboardingSidecar | null,
  picks: FeaturePicks | null,
): WizardStep | null {
  if (current === "phase4-cleanup") return null;
  const startIndex = FULL_STEP_ORDER.indexOf(current);
  if (startIndex < 0) {
    return "intro";
  }
  for (let i = startIndex + 1; i < FULL_STEP_ORDER.length; i++) {
    const candidate = FULL_STEP_ORDER[i];
    if (!isStepSkippedByGate(candidate, picks, sidecar)) {
      return candidate;
    }
  }
  return "phase4-cleanup";
}

/** Compute the previous applicable step. Returns `null` if `current`
 *  is the first applicable step (typically `"intro"`). Back-stepping
 *  off the head of the queue is a no-op; the UI hides the Back button
 *  in that state. */
export function getPreviousStep(
  current: WizardStep,
  sidecar: OnboardingSidecar | null,
  picks: FeaturePicks | null,
): WizardStep | null {
  const startIndex = FULL_STEP_ORDER.indexOf(current);
  if (startIndex <= 0) return null;
  for (let i = startIndex - 1; i >= 0; i--) {
    const candidate = FULL_STEP_ORDER[i];
    if (!isStepSkippedByGate(candidate, picks, sidecar)) {
      return candidate;
    }
  }
  return null;
}

/** Total applicable step count for the progress indicator. Filters
 *  the full order through `isStepSkippedByGate` once. */
export function totalSteps(
  sidecar: OnboardingSidecar | null,
  picks: FeaturePicks | null,
): number {
  let n = 0;
  for (const step of FULL_STEP_ORDER) {
    if (!isStepSkippedByGate(step, picks, sidecar)) n++;
  }
  return n;
}

/** Index of the current step among applicable steps (1-based for
 *  "Step X of Y" display). Returns 0 if the step is itself gated out
 *  (defensive — shouldn't happen on a normal flow but covers an
 *  in-flight feature_picks mutation). */
export function stepIndex(
  current: WizardStep,
  sidecar: OnboardingSidecar | null,
  picks: FeaturePicks | null,
): number {
  let idx = 0;
  for (const step of FULL_STEP_ORDER) {
    if (isStepSkippedByGate(step, picks, sidecar)) continue;
    idx++;
    if (step === current) return idx;
  }
  return 0;
}

/** True when this step is one of the Phase 1 setup questions. The
 *  wizard uses this to gate which steps render setup-question UI
 *  vs walkthrough demos. */
export function isSetupStep(step: WizardStep): boolean {
  return SETUP_STEP_IDS.has(step);
}

/** True when this step creates an artifact future steps may depend
 *  on. P2b consumes this to silently auto-create the prerequisite
 *  when the user clicks "Skip this step". P1 just enumerates the
 *  ids so the metadata exists at the same code site as the step
 *  order. */
export function stepCreatesPrerequisite(step: WizardStep): boolean {
  // W1 creates the project; W2 the method; W3 the experiment. W4
  // depends on W2 + W3, W5 depends on W3.
  return step === "W1" || step === "W2" || step === "W3";
}
