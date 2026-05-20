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

/** Mid-walkthrough decision the user makes at the end of Phase 2 (lab
 *  accounts only). "now" enters the L1-L11 tour, "later" defers via
 *  lab_tour_pending, "dismiss" sets lab_tour_dismissed_at. None of
 *  these branches are forced by the state machine; the lab-prompt
 *  step renderer drives the pick and getNextStep consumes it via the
 *  sidecar arg. */
export type LabTourDecision = "now" | "later" | "dismiss";

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
  // for lab-prompt is expected to write the pick into
  // sidecar.wizard_resume_state (the brief reserves the
  // implementation detail for the lab-prompt body). For P1 we treat
  // the lab tour as gated by a synthetic `lab_tour_active` flag we
  // stash on resume state; the lab-prompt placeholder defaults to
  // "now" so the universal smoke test still walks through L1-L11.
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
    return getLabTourDecision(sidecar) !== "now";
  }
  if (step === "L8") {
    if (picks?.account_type !== "lab") return true;
    if (getLabTourDecision(sidecar) !== "now") return true;
    return picks?.purchases !== "yes";
  }

  return false;
}

/** Read the lab-tour pick from the sidecar's resume state. The
 *  lab-prompt step renderer (P3a) writes a string into
 *  `wizard_resume_state.skipped_steps` with a `lab_tour_decision:`
 *  prefix so the state machine can read it back without expanding
 *  the sidecar schema. P1 defaults to "now" when no value is found
 *  so the smoke-test walks the full lab path. */
export function getLabTourDecision(
  sidecar: OnboardingSidecar | null,
): LabTourDecision {
  const skipped = sidecar?.wizard_resume_state?.skipped_steps ?? [];
  for (const entry of skipped) {
    if (entry === "lab_tour_decision:later") return "later";
    if (entry === "lab_tour_decision:dismiss") return "dismiss";
    if (entry === "lab_tour_decision:now") return "now";
  }
  return "now";
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
