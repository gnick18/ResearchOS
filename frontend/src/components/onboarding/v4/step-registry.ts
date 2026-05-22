/**
 * Step-body registry for the Onboarding v4 tour controller.
 *
 * P1 ships PLACEHOLDER bodies — every entry declares the right id +
 * pose default + a manual completion type + the conditional gate (so
 * step-machine.ts can drive the order). Real `speech`, `cursorScript`,
 * `targetSelector`, and `completion` contracts land in:
 *
 *   P4 → setup-q1 / setup-q2..q6 (port v3 setup step bodies onto the
 *        v4 tour controller modal surface). 2026-05-22 drop: setup-q1a
 *        (lab storage) + setup-q1b (lab connect info) removed; lab
 *        storage decision moved to pre-onboarding §6.4.
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
// Onboarding v4 §6.14 Purchases redesign 2026-05-22 (Purchases manager).
// The single `purchasesConditionalStep` body is replaced by an 8-step
// cluster: 4 Phase-1 steps that teach on the user's empty page, then 4
// Phase-2 steps that warp into a read-only DemoPurchasesViewer over
// Alex's account to teach the analytics surface. Legacy
// `purchasesConditionalStep` export is retained (as an alias to
// `purchasesFormFillStep`) for back-compat with importers expecting
// the artifact-spawning body.
import {
  purchasesIntroStep,
  purchasesCreateButtonClickStep,
  purchasesFormFillStep,
  purchasesAutocompleteDemoStep,
  purchasesDemoWarpPromptStep,
  purchasesDemoViewerStep,
  purchasesDemoChartsStep,
  purchasesBackToRealStep,
} from "./steps/walkthrough/PurchasesConditionalStep";
import { calendarConditionalStep } from "./steps/walkthrough/CalendarConditionalStep";
import { linksConditionalStep } from "./steps/walkthrough/LinksConditionalStep";
// §6.8 Gantt redesign + lab tour retirement (Gantt manager 2026-05-22):
// `buildLabPromptStep`, `buildLabSpawnStep`, `buildLabPermissionPracticeStep`
// no longer participate in the tour graph. Their .tsx files remain in
// `steps/lab/` with @deprecated JSDoc for git-history reference; the
// imports are dropped here so unused-export warnings don't accumulate.
import { buildLabCleanupStep } from "./steps/lab/LabAutoCleanupStep";
// §6.16 Phase 2c Lab Mode tour cluster (Lab Mode redesign 2026-05-22).
// 12 new step bodies that mount the DemoLabModeViewer overlay and walk
// each lab-mode tab. All gate on `picks.account_type === "lab"`.
import { labModePromptStep } from "./steps/lab-mode/LabModePromptStep";
import { labModeIntroStep } from "./steps/lab-mode/LabModeIntroStep";
import { labModeWarpToDemoStep } from "./steps/lab-mode/LabModeWarpToDemoStep";
import { labModeActivityStep } from "./steps/lab-mode/LabModeActivityStep";
import { labModeGanttStep } from "./steps/lab-mode/LabModeGanttStep";
import { labModeExperimentsStep } from "./steps/lab-mode/LabModeExperimentsStep";
import { labModePurchasesStep } from "./steps/lab-mode/LabModePurchasesStep";
import { labModeRoadmapsStep } from "./steps/lab-mode/LabModeRoadmapsStep";
import { labModeMethodsStep } from "./steps/lab-mode/LabModeMethodsStep";
import { labModeNotesStep } from "./steps/lab-mode/LabModeNotesStep";
import { labModeSearchStep } from "./steps/lab-mode/LabModeSearchStep";
import { labModeExitStep } from "./steps/lab-mode/LabModeExitStep";
import {
  onEnterGanttGoalsOverview,
  onEnterHybridEditorImageDrop,
} from "./steps/walkthrough/lib/on-enter-helpers";

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
import { projectOverviewContextStep } from "./steps/walkthrough/ProjectOverviewContextStep";
import { projectOverviewExitStep } from "./steps/walkthrough/ProjectOverviewExitStep";
import { notificationsBellStep } from "./steps/walkthrough/NotificationsBellStep";
import { notificationsSilenceStep } from "./steps/walkthrough/NotificationsSilenceStep";
import { notificationsDeleteStep } from "./steps/walkthrough/NotificationsDeleteStep";
import { methodsCategoryPromptStep } from "./steps/walkthrough/MethodsCategoryPromptStep";
import { methodsCategoryOpenStep } from "./steps/walkthrough/MethodsCategoryOpenStep";
import { methodsCategoryStep } from "./steps/walkthrough/MethodsCategoryStep";
import { methodsOpenPickerStep } from "./steps/walkthrough/MethodsOpenPickerStep";
import { methodsBreadthStep } from "./steps/walkthrough/MethodsBreadthStep";
// §6.4b Grant 2026-05-21 rework: PCR sub-steps (edit / add-cycle /
// confirm-cycle) dropped from the active flow. The bodies stay in the
// repo for now — easy to bring back if Grant changes his mind on the
// detail level. Removed from TOUR_STEP_ORDER and TOUR_STEPS.
import { methodsLcDemoStep } from "./steps/walkthrough/MethodsLcDemoStep";
import { methodsCreateStep } from "./steps/walkthrough/MethodsCreateStep";
import { workbenchCreateExperimentOpenStep } from "./steps/walkthrough/WorkbenchCreateExperimentOpenStep";
import { workbenchCreateExperimentStep } from "./steps/walkthrough/WorkbenchCreateExperimentStep";
// §6.6 method-attachment split (2026-05-21): the original
// `methodAttachmentStep` was split into 4 popup-mount-safe sub-steps.
// Re-export glue lives in MethodAttachmentStep.tsx for back-compat.
import { methodAttachmentOpenStep } from "./steps/walkthrough/MethodAttachmentOpenStep";
import { methodAttachmentTabStep } from "./steps/walkthrough/MethodAttachmentTabStep";
import { methodAttachmentAttachStep } from "./steps/walkthrough/MethodAttachmentAttachStep";
import { methodAttachmentNotesStep } from "./steps/walkthrough/MethodAttachmentNotesStep";
// §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22): the
// prior 4 sub-steps (shortcuts / paragraphs / image-drop / resize) are
// retired. Their .tsx files stay in tree with @deprecated JSDoc tags
// and no longer mount via the registry. New shape: 12 sub-steps from
// HE-0 through HE-11, plus an in-tour branch gate at HE-2.
import { hybridNotesVsResultsStep } from "./steps/walkthrough/HybridNotesVsResultsStep";
import { hybridMarkdownIntroStep } from "./steps/walkthrough/HybridMarkdownIntroStep";
import { hybridMarkdownFamiliarityStep } from "./steps/walkthrough/HybridMarkdownFamiliarityStep";
import { hybridMarkdownOverviewStep } from "./steps/walkthrough/HybridMarkdownOverviewStep";
import { hybridEditorMechanicStep } from "./steps/walkthrough/HybridEditorMechanicStep";
import { hybridBoldStep } from "./steps/walkthrough/HybridBoldStep";
import { hybridItalicStep } from "./steps/walkthrough/HybridItalicStep";
import { hybridUnderlineStep } from "./steps/walkthrough/HybridUnderlineStep";
import { hybridH1Step } from "./steps/walkthrough/HybridH1Step";
import { hybridH2Step } from "./steps/walkthrough/HybridH2Step";
import { hybridH3Step } from "./steps/walkthrough/HybridH3Step";
import { hybridShortcutsStep } from "./steps/walkthrough/HybridShortcutsStep";
import { hybridImageAttachStep } from "./steps/walkthrough/HybridImageAttachStep";
import { hybridImageDragInStep } from "./steps/walkthrough/HybridImageDragInStep";
import { hybridImageResizeStep } from "./steps/walkthrough/HybridImageResizeStep";
import { hybridFileAttachStep } from "./steps/walkthrough/HybridFileAttachStep";
// §6.8 Gantt redesign (Gantt manager 2026-05-22): the legacy
// `ganttIntroStep` (`gantt-task-types`) and `ganttDependenciesStep`
// (`gantt-chained-deps`) were retired. The new arc splits Gantt
// teaching into 6 universal sub-steps + a 7-step lab-only share
// cluster + relocated goals overview. See ONBOARDING_V4_GANTT_REDESIGN.md.
import { ganttIntroStep } from "./steps/walkthrough/GanttIntroStep";
import { ganttExistingExperimentStep } from "./steps/walkthrough/GanttExistingExperimentStep";
import { ganttDragDropStep } from "./steps/walkthrough/GanttDragDropStep";
import { ganttDepsBeakerBotStep } from "./steps/walkthrough/GanttDepsBeakerBotStep";
import { ganttDepsUserStep } from "./steps/walkthrough/GanttDepsUserStep";
import { ganttDepsCascadeStep } from "./steps/walkthrough/GanttDepsCascadeStep";
import {
  ganttShareIntroStep,
  ganttShareBeakerBotSpawnStep,
  ganttShareBeakerBotSharesStep,
  ganttShareUserExploresStep,
  ganttShareUserSharesBackStep,
  ganttShareProfileSwitchStep,
  ganttShareUserSeesEditStep,
} from "./steps/walkthrough/GanttShareClusterSteps";
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
  [projectOverviewContextStep.id]: projectOverviewContextStep,
  [projectOverviewExitStep.id]: projectOverviewExitStep,
  [notificationsBellStep.id]: notificationsBellStep,
  [notificationsSilenceStep.id]: notificationsSilenceStep,
  [notificationsDeleteStep.id]: notificationsDeleteStep,
  [methodsCategoryPromptStep.id]: methodsCategoryPromptStep,
  [methodsCategoryOpenStep.id]: methodsCategoryOpenStep,
  [methodsCategoryStep.id]: methodsCategoryStep,
  [methodsOpenPickerStep.id]: methodsOpenPickerStep,
  [methodsBreadthStep.id]: methodsBreadthStep,
  [methodsLcDemoStep.id]: methodsLcDemoStep,
  [methodsCreateStep.id]: methodsCreateStep,
  [workbenchCreateExperimentOpenStep.id]: workbenchCreateExperimentOpenStep,
  [workbenchCreateExperimentStep.id]: workbenchCreateExperimentStep,
  [methodAttachmentOpenStep.id]: methodAttachmentOpenStep,
  [methodAttachmentTabStep.id]: methodAttachmentTabStep,
  [methodAttachmentAttachStep.id]: methodAttachmentAttachStep,
  [methodAttachmentNotesStep.id]: methodAttachmentNotesStep,
  // §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22).
  // 12 sub-steps wired in TOUR_STEP_ORDER order. Legacy bodies retired.
  [hybridNotesVsResultsStep.id]: hybridNotesVsResultsStep,
  [hybridMarkdownIntroStep.id]: hybridMarkdownIntroStep,
  [hybridMarkdownFamiliarityStep.id]: hybridMarkdownFamiliarityStep,
  [hybridMarkdownOverviewStep.id]: hybridMarkdownOverviewStep,
  [hybridEditorMechanicStep.id]: hybridEditorMechanicStep,
  [hybridBoldStep.id]: hybridBoldStep,
  [hybridItalicStep.id]: hybridItalicStep,
  [hybridUnderlineStep.id]: hybridUnderlineStep,
  [hybridH1Step.id]: hybridH1Step,
  [hybridH2Step.id]: hybridH2Step,
  [hybridH3Step.id]: hybridH3Step,
  [hybridShortcutsStep.id]: hybridShortcutsStep,
  [hybridImageAttachStep.id]: hybridImageAttachStep,
  [hybridImageDragInStep.id]: hybridImageDragInStep,
  [hybridImageResizeStep.id]: hybridImageResizeStep,
  [hybridFileAttachStep.id]: hybridFileAttachStep,
  // §6.8 Gantt redesign (Gantt manager 2026-05-22). The 4-step legacy
  // arc (gantt-task-types / gantt-drag-drop / gantt-chained-deps /
  // gantt-goals-overview) is replaced by 14 sub-steps.
  [ganttIntroStep.id]: ganttIntroStep,
  [ganttExistingExperimentStep.id]: ganttExistingExperimentStep,
  [ganttDragDropStep.id]: ganttDragDropStep,
  [ganttDepsBeakerBotStep.id]: ganttDepsBeakerBotStep,
  [ganttDepsUserStep.id]: ganttDepsUserStep,
  [ganttDepsCascadeStep.id]: ganttDepsCascadeStep,
  // Lab-only share cluster — gated by isStepGatedOut on
  // picks.account_type === "lab".
  [ganttShareIntroStep.id]: ganttShareIntroStep,
  [ganttShareBeakerBotSpawnStep.id]: ganttShareBeakerBotSpawnStep,
  [ganttShareBeakerBotSharesStep.id]: ganttShareBeakerBotSharesStep,
  [ganttShareUserExploresStep.id]: ganttShareUserExploresStep,
  [ganttShareUserSharesBackStep.id]: ganttShareUserSharesBackStep,
  [ganttShareProfileSwitchStep.id]: ganttShareProfileSwitchStep,
  [ganttShareUserSeesEditStep.id]: ganttShareUserSeesEditStep,
  // Goals overview — RELOCATED to after the share cluster. Conditional
  // on picks.goals === "yes" (step-machine.ts gating unchanged).
  [ganttGoalsStep.id]: ganttGoalsStep,
  [animationPickerStep.id]: animationPickerStep,
  [settingsColorStep.id]: settingsColorStep,
  [settingsMoreStep.id]: settingsMoreStep,
  [settingsAiHelperStep.id]: settingsAiHelperStep,
  [searchStep.id]: searchStep,
  [wikiPointerStep.id]: wikiPointerStep,
  // §6.16 Phase 2c Lab Mode tour cluster (Lab Mode redesign 2026-05-22).
  // Order matches TOUR_STEP_ORDER: prompt → intro → warp → 8 tab beats
  // → exit. Each step's conditionalOn gates on account_type === "lab".
  [labModePromptStep.id]: labModePromptStep,
  [labModeIntroStep.id]: labModeIntroStep,
  [labModeWarpToDemoStep.id]: labModeWarpToDemoStep,
  [labModeActivityStep.id]: labModeActivityStep,
  [labModeGanttStep.id]: labModeGanttStep,
  [labModeExperimentsStep.id]: labModeExperimentsStep,
  [labModePurchasesStep.id]: labModePurchasesStep,
  [labModeRoadmapsStep.id]: labModeRoadmapsStep,
  [labModeMethodsStep.id]: labModeMethodsStep,
  [labModeNotesStep.id]: labModeNotesStep,
  [labModeSearchStep.id]: labModeSearchStep,
  [labModeExitStep.id]: labModeExitStep,
};

/**
 * Build a real Phase 1 modal-setup step body from the setup descriptor
 * map. P4 populates every Phase 1 step id (welcome + setup-q1 +
 * setup-q2..q6) here so the modal-setup surface sees full speech +
 * pose + a manual completion contract.
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
// §6.14 Purchases redesign 2026-05-22 (Purchases manager): the legacy
// single-id "purchases" body is replaced by the 8-step cluster.
// `step-machine.ts` drives ordering via the explicit ids in
// `TOUR_STEP_ORDER`; the registry just maps each id to its body.
TOUR_STEPS["purchases-intro"] = purchasesIntroStep;
TOUR_STEPS["purchases-create-button-click"] = purchasesCreateButtonClickStep;
TOUR_STEPS["purchases-form-fill"] = purchasesFormFillStep;
TOUR_STEPS["purchases-autocomplete-demo"] = purchasesAutocompleteDemoStep;
TOUR_STEPS["purchases-demo-warp-prompt"] = purchasesDemoWarpPromptStep;
TOUR_STEPS["purchases-demo-viewer"] = purchasesDemoViewerStep;
TOUR_STEPS["purchases-demo-charts"] = purchasesDemoChartsStep;
TOUR_STEPS["purchases-back-to-real"] = purchasesBackToRealStep;
TOUR_STEPS["calendar"] = calendarConditionalStep;
// Lab Links manager 2026-05-22: links conditional walkthrough added
// alongside the existing telegram / purchases / calendar conditionals.
// Gated by picks.links === "yes".
TOUR_STEPS["links"] = linksConditionalStep;

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

// Gantt redesign 2026-05-22 (Gantt manager): only `lab-cleanup` survives
// from the prior lab tour cluster. `lab-prompt`, `lab-spawn-beakerbot`,
// and `lab-permission-practice` have been retired from `TOUR_STEP_ORDER`;
// patching their entries here would be a dead write.
patchLabStep("lab-cleanup", buildLabCleanupStep());

// §6.10 onEnter side-effects. The step body files in
// `walkthrough/GanttDependenciesStep.tsx` +
// `walkthrough/HybridEditorImageDropStep.tsx` don't own these hooks
// directly because both spawns depend on an "active project /
// experiment" id that the step body can't resolve in isolation. We
// wire them here so the body files stay unit-testable without
// pulling in `projectsApi` / `tasksApi` / `fileService` mocks.
//
// Both hooks are idempotent + best-effort; see
// `lib/on-enter-helpers.ts` for the exact contracts. TourController
// catches throws + logs, but the hooks themselves also swallow so a
// partial failure produces a no-op step instead of a tour-wedge.
// §6.8 Gantt redesign 2026-05-22 (Gantt manager): the old
// `gantt-chained-deps` onEnter hook is retired. Its replacement
// (`gantt-deps-beakerbot`) owns its own onEnter directly via the
// `buildWalkthroughStep` slot, so no patch is needed here.
// §6.7 redesign 2026-05-22 (Hybrid editor manager): the onEnter that
// seeds the BeakerBot selfie blob now hangs off `hybrid-image-attach`
// (HE-8) instead of the retired `hybrid-editor-image-drop` id. Same
// helper, new owner step.
TOUR_STEPS["hybrid-image-attach"] = {
  ...TOUR_STEPS["hybrid-image-attach"],
  onEnter: async (ctx) => {
    await onEnterHybridEditorImageDrop(ctx);
  },
};

// §6.8 `gantt-goals-overview` onEnter — spawns a placeholder personal
// goal so the cursor's click on the goals affordance reveals a real
// goal overlay instead of an empty one. HR-dispatched: v4 §6.8 Gantt
// modal+goal sub-bot 2026-05-21. The goal is artifact-tracked
// (cleanup_default: "discard") so Phase 4 cleanup wipes it.
TOUR_STEPS["gantt-goals-overview"] = {
  ...TOUR_STEPS["gantt-goals-overview"],
  onEnter: async (ctx) => {
    await onEnterGanttGoalsOverview(ctx);
  },
};

/**
 * Look up the registered step body for an id. Returns `undefined` when
 * the id isn't in the registry — useful for the controller's
 * "render a generic placeholder card" fallback during P1-P3.
 */
export function getStep(id: TourStepId): TourStep | undefined {
  return TOUR_STEPS[id];
}
