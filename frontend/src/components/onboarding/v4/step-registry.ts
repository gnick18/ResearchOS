/**
 * Step-body registry for the Onboarding v4 tour controller.
 *
 * P1 ships PLACEHOLDER bodies — every entry declares the right id +
 * pose default + a manual completion type + the conditional gate (so
 * step-machine.ts can drive the order). Real `speech`, `cursorScript`,
 * `targetSelector`, and `completion` contracts land in:
 *
 *   P4 → setup-q1 / setup-q1a / setup-q1b / setup-q2..q6 (port v3
 *        setup step bodies onto the v4 tour controller modal surface)
 *   P5 → home-create-project through wiki-pointer (universal §6.1-6.12)
 *   P6 → telegram + purchases + calendar (conditional §6.13-6.15)
 *   P7 → lab-prompt + lab-spawn-beakerbot + lab-permission-practice
 *      + lab-cleanup (§6.16, minimal lab tour per L19; lab-cleanup
 *        is the terminal step that auto-tombstones the fake user
 *        per L21).
 *
 * The registry is intentionally a flat map so future arc phases can do
 * a single-line `TOUR_STEPS["home-create-project"] = { ... real body }`
 * patch without touching the machine. Steps absent from the registry
 * at runtime fall back to a generic "placeholder" rendering inside the
 * controller — used to confirm the machine wires up correctly before
 * P4-P7 fill in bodies.
 *
 * Phase-2 cleanup grid step (`phase4-cleanup`) lives here too even
 * though it doesn't render BeakerBot — the controller special-cases
 * its rendering, but the registry entry keeps the step-machine happy.
 */
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import type { TourStep, TourStepId } from "./step-types";
import { TOUR_STEP_ORDER, isStepGatedOut } from "./step-machine";
import { SETUP_STEP_DESCRIPTORS } from "./steps/setup";
import { telegramConditionalStep } from "./steps/walkthrough/TelegramConditionalStep";
import { purchasesConditionalStep } from "./steps/walkthrough/PurchasesConditionalStep";
import { calendarConditionalStep } from "./steps/walkthrough/CalendarConditionalStep";
import { buildLabPromptStep } from "./steps/lab/LabPromptStep";
import { buildLabSpawnStep } from "./steps/lab/LabSpawnBeakerBotStep";
import { buildLabPermissionPracticeStep } from "./steps/lab/LabPermissionPracticeStep";
import { buildLabCleanupStep } from "./steps/lab/LabAutoCleanupStep";

/**
 * Build a placeholder step body matching the brief's "Step bodies in
 * P4+" rule. Returns a TourStep that:
 *   - shows a temporary speech string referencing the step id (so a
 *     developer running the tour in P1 sees which step is active),
 *   - poses BeakerBot in `pointing` (the default per the brief),
 *   - uses `manual` completion (a "Got it, next" button advances),
 *   - re-uses the step-machine gating predicate so a manager wiring
 *     a real body in P4-P7 doesn't accidentally drop the gate.
 */
function placeholderStep(id: TourStepId): TourStep {
  return {
    id,
    speech: `(Placeholder body for "${id}". Real content lands in P4-P7.)`,
    pose: "pointing",
    completion: {
      type: "manual",
      buttonLabel: "Got it, next",
    },
    // The placeholder retains the machine's gating predicate so a
    // manager wiring a real body in P4-P7 doesn't have to re-derive it.
    // Resolved against the actual picks at step-entry time by the
    // controller; absent picks → undefined (i.e., step always shows).
    conditionalOn: (picks: FeaturePicks | null) => !isStepGatedOut(id, picks),
  };
}

// ---------------------------------------------------------------------
// P5 universal-walkthrough step body imports (§6.1 - §6.12)
//
// Each id in TOUR_STEP_ORDER between "home-create-project" and
// "wiki-pointer" maps to a real body here. Setup steps (P4), conditional
// walkthroughs (P6), lab tour (P7), and the cleanup grid (P8) still
// render placeholders until their dispatching phase lands.
// ---------------------------------------------------------------------
import { homeCreateProjectStep } from "./steps/walkthrough/HomeCreateProjectStep";
import { homeCreateProjectFillStep } from "./steps/walkthrough/HomeCreateProjectFillStep";
import { projectOverviewNavStep } from "./steps/walkthrough/ProjectOverviewNavStep";
import { projectOverviewStep } from "./steps/walkthrough/ProjectOverviewStep";
import { notificationsStep } from "./steps/walkthrough/NotificationsStep";
import { methodsCategoryStep } from "./steps/walkthrough/MethodsCategoryStep";
import { methodsBreadthStep } from "./steps/walkthrough/MethodsBreadthStep";
import { methodsCreateStep } from "./steps/walkthrough/MethodsCreateStep";
import { workbenchCreateExperimentStep } from "./steps/walkthrough/WorkbenchCreateExperimentStep";
import { methodAttachmentStep } from "./steps/walkthrough/MethodAttachmentStep";
import { hybridEditorShortcutsStep } from "./steps/walkthrough/HybridEditorShortcutsStep";
import { hybridEditorParagraphsStep } from "./steps/walkthrough/HybridEditorParagraphsStep";
import { hybridEditorImageDropStep } from "./steps/walkthrough/HybridEditorImageDropStep";
import { hybridEditorResizeStep } from "./steps/walkthrough/HybridEditorResizeStep";
import { ganttIntroStep } from "./steps/walkthrough/GanttIntroStep";
import { ganttDragDropStep } from "./steps/walkthrough/GanttDragDropStep";
import { ganttDependenciesStep } from "./steps/walkthrough/GanttDependenciesStep";
import { ganttGoalsStep } from "./steps/walkthrough/GanttGoalsStep";
import { animationPickerStep } from "./steps/walkthrough/AnimationPickerStep";
import {
  settingsColorStep,
  settingsMoreStep,
} from "./steps/walkthrough/SettingsColorStep";
import { settingsAiHelperStep } from "./steps/walkthrough/SettingsAiHelperStep";
import { searchStep } from "./steps/walkthrough/SearchStep";
import { wikiPointerStep } from "./steps/walkthrough/WikiPointerStep";

/** P5 step body map. Keys must match `TOUR_STEP_ORDER` entries (the
 *  step-machine drives ordering, this map drives body lookup). Adding
 *  a key here without a matching `TOUR_STEP_ORDER` entry means the
 *  step is never reached; vice versa means the controller renders a
 *  placeholder. */
const WALKTHROUGH_STEP_BODIES: Record<string, TourStep> = {
  [homeCreateProjectStep.id]: homeCreateProjectStep,
  [homeCreateProjectFillStep.id]: homeCreateProjectFillStep,
  [projectOverviewNavStep.id]: projectOverviewNavStep,
  [projectOverviewStep.id]: projectOverviewStep,
  [notificationsStep.id]: notificationsStep,
  [methodsCategoryStep.id]: methodsCategoryStep,
  [methodsBreadthStep.id]: methodsBreadthStep,
  [methodsCreateStep.id]: methodsCreateStep,
  [workbenchCreateExperimentStep.id]: workbenchCreateExperimentStep,
  [methodAttachmentStep.id]: methodAttachmentStep,
  [hybridEditorShortcutsStep.id]: hybridEditorShortcutsStep,
  [hybridEditorParagraphsStep.id]: hybridEditorParagraphsStep,
  [hybridEditorImageDropStep.id]: hybridEditorImageDropStep,
  [hybridEditorResizeStep.id]: hybridEditorResizeStep,
  [ganttIntroStep.id]: ganttIntroStep,
  [ganttDragDropStep.id]: ganttDragDropStep,
  [ganttDependenciesStep.id]: ganttDependenciesStep,
  [ganttGoalsStep.id]: ganttGoalsStep,
  [animationPickerStep.id]: animationPickerStep,
  [settingsColorStep.id]: settingsColorStep,
  [settingsMoreStep.id]: settingsMoreStep,
  [settingsAiHelperStep.id]: settingsAiHelperStep,
  [searchStep.id]: searchStep,
  [wikiPointerStep.id]: wikiPointerStep,
};

/**
 * Build a real Phase 1 modal-setup step body from the setup descriptor
 * map. P4 populates every Phase 1 step id (welcome + setup-q1 +
 * setup-q1a + setup-q1b + setup-q2..q6) here so the modal-setup surface
 * sees full speech + pose + a manual completion contract.
 *
 * The body component itself is mounted by the modal-setup shell via the
 * `SETUP_STEP_DESCRIPTORS` lookup, not by this TourStep record. The
 * TourStep here owns the BeakerBot-side metadata (speech bubble, pose,
 * completion contract); the modal body lives in `./steps/setup/`.
 */
function setupStep(id: TourStepId): TourStep {
  const d = SETUP_STEP_DESCRIPTORS[id];
  if (!d) {
    // Defensive fallback. Should never fire because every entry in
    // SETUP_STEP_IDS has a descriptor; if a future contributor adds a
    // setup step id to the machine but forgets the descriptor, this
    // keeps the controller from blowing up.
    return placeholderStep(id);
  }
  return {
    id,
    speech: d.speech,
    pose: d.pose,
    completion: {
      type: "manual",
      // Welcome's modal Next-button label is "Let's go" per v3 parity;
      // the rest use the default "Next" label which the modal shell
      // resolves itself.
      buttonLabel: id === "welcome" ? "Let's go" : "Next",
    },
    // Welcome owns expectedRoute "/" so Restart (from V4ResumePrompt or
    // Settings re-run) navigates to home BEFORE the modal paints. The
    // modal itself is page-agnostic, but the in-product walkthrough that
    // follows Q6 lives on home, and the user shouldn't see anything
    // weird underneath the setup modal in the meantime. Per Grant's
    // 2026-05-21 feedback: "if the user's ever starting the tutorial
    // from the beginning, just automatically take them to the home page."
    expectedRoute: id === "welcome" ? "/" : undefined,
    conditionalOn: (picks: FeaturePicks | null) => !isStepGatedOut(id, picks),
  };
}

/**
 * The v4 tour step registry. Each id resolves in priority order:
 *   1. P4 setup step (modal-setup phase, via SETUP_STEP_DESCRIPTORS)
 *   2. P5 universal walkthrough step body (§6.1 - §6.12)
 *   3. Placeholder (P6/P7/P8 fill remaining slots)
 *
 * The type is `Record<TourStepId, TourStep>` so a real body just
 * overwrites the placeholder at the matching key. Iteration order
 * is NOT load-bearing, the machine drives ordering via
 * `TOUR_STEP_ORDER`, not via this registry.
 */
export const TOUR_STEPS: Record<TourStepId, TourStep> = Object.fromEntries(
  TOUR_STEP_ORDER.map((id) => {
    if (SETUP_STEP_DESCRIPTORS[id]) return [id, setupStep(id)];
    if (WALKTHROUGH_STEP_BODIES[id]) return [id, WALKTHROUGH_STEP_BODIES[id]];
    return [id, placeholderStep(id)];
  }),
);

// P6: conditional walkthrough bodies (§6.13 - §6.15). One-line per
// step so a future P5/P7 patch can land alongside without merge pain.
// Each real body retains the same `id` + matching `conditionalOn`
// predicate the placeholder used, so step-machine.ts's gating contract
// continues to apply.
TOUR_STEPS["telegram"] = telegramConditionalStep;
TOUR_STEPS["purchases"] = purchasesConditionalStep;
TOUR_STEPS["calendar"] = calendarConditionalStep;

// P7 — real lab tour bodies (§6.16, minimal scope per L19). The
// placeholders are overwritten in-place so iteration order +
// step-machine gating stay identical to P1.
//
// We preserve the placeholder's `conditionalOn` predicate by reading
// it off the existing entry rather than re-deriving via
// `isStepGatedOut` — that keeps the gating logic single-sourced in
// the machine (one less moving part to keep in sync).
function patchLabStep(id: TourStepId, body: TourStep): void {
  const existing = TOUR_STEPS[id];
  TOUR_STEPS[id] = {
    ...body,
    conditionalOn: existing?.conditionalOn,
  };
}

patchLabStep("lab-prompt", buildLabPromptStep());
patchLabStep("lab-spawn-beakerbot", buildLabSpawnStep());
patchLabStep("lab-permission-practice", buildLabPermissionPracticeStep());
patchLabStep("lab-cleanup", buildLabCleanupStep());

/**
 * Look up the registered step body for an id. Returns `undefined` when
 * the id isn't in the registry — useful for the controller's
 * "render a generic placeholder card" fallback during P1-P3.
 */
export function getStep(id: TourStepId): TourStep | undefined {
  return TOUR_STEPS[id];
}
