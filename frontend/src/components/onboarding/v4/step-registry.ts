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
 *   P5 → home-create-project through the wiki-pointer cluster's
 *        terminal beat wiki-pointer-back-demo (universal §6.1-6.12)
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
 * Terminal step (`tour-goodbye`) lives here as a normal walkthrough
 * registry entry. Cleanup retirement 2026-05-22: the prior
 * `phase4-cleanup` grid was retired; the new terminal step is a
 * standard BeakerBot speech + manualAdvance("Let's go") that triggers
 * the auto-cleanup + animation outro via a sibling overlay host (no
 * special-case controller rendering required).
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
// R4 Lab Overview tour cluster (R4 Lab Mode retirement, 2026-05-23): the
// 6 placeholder step bodies (lab-overview-intro through lab-overview-exit)
// that R4 shipped were throwaway. Grant chose nuke-now-rebuild-fresh ahead
// of the Mira-substrate walkthrough redesign, so the imports + registry
// entries + tests + tour-targets have been removed. The Lab Overview
// surface itself (R3's production widget canvas) is untouched; only the
// walkthrough cluster is gone.
import { onEnterGanttGoalsOverview } from "./steps/walkthrough/lib/on-enter-helpers";

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
// Each id in TOUR_STEP_ORDER between "home-create-project" and the
// wiki-pointer cluster's terminal beat ("wiki-pointer-back-demo") maps
// to a real body here. Setup steps (P4), conditional
// walkthroughs (P6), lab tour (P7), and the cleanup grid (P8) still
// render placeholders until their dispatching phase lands.
// ---------------------------------------------------------------------
// v4 tour structural manager (Wave 1, 2026-05-27): the four page-intro
// narration steps (home-page-intro / project-page-intro /
// settings-page-intro / search-page-intro) are retired. Grant's
// 2026-05-27 script rewrite folds each page's framing into the
// surrounding step's speech, so the standalone intros are redundant.
// `settings-page-intro` is replaced by `settings-intro` (different id,
// different position) and lives below alongside other Wave 1 skeletons.
// Top-level New Project rework (dashboard-newproject-tour bot, 2026-05-29):
// the §6.1 cluster now opens on the TRIGGER beat directly (the create
// affordance is a persistent top-level toolbar button). The prior OPEN-WIDGET
// beat import (`homeOpenProjectsWidgetStep`) is removed with that retired step.
import { homeCreateProjectStep } from "./steps/walkthrough/HomeCreateProjectStep";
import { homeCreateProjectFillStep } from "./steps/walkthrough/HomeCreateProjectFillStep";
import { projectOverviewNavStep } from "./steps/walkthrough/ProjectOverviewNavStep";
import { projectOverviewStep } from "./steps/walkthrough/ProjectOverviewStep";
// v4 tour structural manager (Wave 1, 2026-05-27): the
// `project-overview-typing-demo` skeleton split off the BEAKERBOT_DEMO
// half of `project-overview-prose` (it types into the Overview
// textarea). Wave 2 filled in speech + cursor scripts.
import { projectOverviewTypingDemoStep } from "./steps/walkthrough/ProjectOverviewTypingDemoStep";
import { projectOverviewContextStep } from "./steps/walkthrough/ProjectOverviewContextStep";
// 2026-06-03 (tour-merge): the `project-overview-exit` step was removed.
// It glided to the notification bell with no click, then duplicated by
// `notifications-intro`. Its route handoff (/workbench) + lead-in framing
// folded into `notifications-intro`, which now spotlights the bell.
// v4 tour structural manager (Wave 1, 2026-05-27): the
// `notifications-intro` narration beat sits before notifications-bell so
// BeakerBot can frame the bell + inbox pair before the user has to click.
import { notificationsIntroStep } from "./steps/walkthrough/NotificationsIntroStep";
import { notificationsBellStep } from "./steps/walkthrough/NotificationsBellStep";
import { notificationsSilenceStep } from "./steps/walkthrough/NotificationsSilenceStep";
import { notificationsDeleteStep } from "./steps/walkthrough/NotificationsDeleteStep";
import { methodsCategoryPromptStep } from "./steps/walkthrough/MethodsCategoryPromptStep";
import { methodsCategoryOpenStep } from "./steps/walkthrough/MethodsCategoryOpenStep";
import { methodsCategoryStep } from "./steps/walkthrough/MethodsCategoryStep";
import { methodsOpenPickerStep } from "./steps/walkthrough/MethodsOpenPickerStep";
// v4 tour structural manager (Wave 1, 2026-05-27): `methods-file-vs-markdown`
// retired. Grant's new script reshapes §6.4b around two interactive
// builders (PCR + LC Gradient); the prior explainer beat is folded into
// surrounding speech.
import { methodsBreadthStep } from "./steps/walkthrough/MethodsBreadthStep";
// §6.4b Grant 2026-05-21 rework: PCR sub-steps (edit / add-cycle /
// confirm-cycle) dropped from the active flow. The bodies stay in the
// repo for now, easy to bring back if Grant changes his mind on the
// detail level. Removed from TOUR_STEP_ORDER and TOUR_STEPS.
// v4 tour structural manager (Wave 1, 2026-05-27): re-introduce
// `methods-lc-demo` as a Wave 1 skeleton. Sits between methods-type-tour
// (PCR) and methods-create (markdown). Wave 2 fills speech + cursor.
import { methodsLcDemoStep } from "./steps/walkthrough/MethodsLcDemoStep";
import { methodsCreateStep } from "./steps/walkthrough/MethodsCreateStep";
// v4 tour structural manager (Wave 1, 2026-05-27): `workbench-page-intro`
// retired (page framing folded into workbench-create-experiment-open) +
// `workbench-create-experiment` retired (Grant's explicit `[DROP]` marker
// in the new script). Only the user-action open step survives.
// USER_ACTION refactor 2026-05-27 (Grant hand-walk): the single
// `workbench-create-experiment-open` step is now the FIRST of four
// user-driven beats (open, name, project, submit). All four exports
// live in WorkbenchCreateExperimentOpenStep.tsx.
import {
  workbenchCreateExperimentOpenStep,
  workbenchCreateExperimentNameStep,
  workbenchCreateExperimentProjectStep,
  workbenchCreateExperimentSubmitStep,
} from "./steps/walkthrough/WorkbenchCreateExperimentOpenStep";
// §6.6 method-attachment split (2026-05-21): the original
// `methodAttachmentStep` was split into 4 popup-mount-safe sub-steps.
// Re-export glue lives in MethodAttachmentStep.tsx for back-compat.
import { methodAttachmentOpenStep } from "./steps/walkthrough/MethodAttachmentOpenStep";
import { methodAttachmentTabStep } from "./steps/walkthrough/MethodAttachmentTabStep";
import { methodAttachmentAttachStep } from "./steps/walkthrough/MethodAttachmentAttachStep";
import { methodAttachmentNotesStep } from "./steps/walkthrough/MethodAttachmentNotesStep";
// v4 tour structural manager (Wave 1, 2026-05-27): `experiment-tabs-overview`
// retired. Grant's new script folds the tab framing into the surrounding
// step's speech so the standalone overview beat is redundant.
// §6.7 hybrid editor cluster. Inline-editor collapse (onboarding-inline
// bot 2026-06-02): the markdown editor is now INLINE-ONLY. The old
// markdown deep-dive (HE-1 through HE-11) taught the retired hybrid
// click-to-edit-blocks interaction and typed into the now-dormant hybrid
// editor, so those ~15 step bodies were deleted and replaced by the
// single `inlineEditorStep` below. The remaining cluster beats
// (notes-vs-results, editor-scope, focus enter/exit, save-concept) teach
// concepts / separate features and survive unchanged.
import { hybridNotesVsResultsStep } from "./steps/walkthrough/HybridNotesVsResultsStep";
// v4 tour structural manager (Wave 1, 2026-05-27): the `hybrid-editor-scope`
// beat sits after HE-0 (notes-vs-results) so BeakerBot can frame the editor
// as the same one used everywhere before the inline editor beat. It also
// demos the popup's fullscreen toggle (hybrid editor demo fix manager,
// 2026-05-27, Grant hand-walk).
import { hybridEditorScopeStep } from "./steps/walkthrough/HybridEditorScopeStep";
// Writing Focus Mode (FOCUS_WRITING_MODE_DESIGN.md §9, focus-writing-mode
// build bot 2026-05-29). Two universal BEAKERBOT_DEMO beats: enter sits
// between hybrid-editor-scope and the inline editor beat; exit sits between
// hybrid-save-concept and workbench-notes-intro.
import { hybridFocusEnterStep } from "./steps/walkthrough/HybridFocusEnterStep";
import { hybridFocusExitStep } from "./steps/walkthrough/HybridFocusExitStep";
// Inline-editor collapse (onboarding-inline bot 2026-06-02): the single
// narration beat replacing HE-1..HE-11. Spotlights the live CodeMirror 6
// surface (data-tour-target="inline-editor-surface") and teaches "just
// type, your markdown renders as you go" + one line on Save checkpoint.
import { inlineEditorStep } from "./steps/walkthrough/InlineEditorStep";
// §6.7 hybrid-save-concept (hybrid-save-concept manager 2026-05-27): NEW
// pure-narration beat between hybrid-file-attach and workbench-notes-intro.
// Covers manual save, version control, and the unsaved-changes warning.
import { hybridSaveConceptStep } from "./steps/walkthrough/HybridSaveConceptStep";
// §6.7b Workbench Notes + Lists expansion (Workbench expansion manager
// 2026-05-22, collapsed to 5 beats by Workbench fix manager R1
// 2026-05-22). Five universal steps that sit between §6.7 hybrid
// editor (terminal beat `hybrid-file-attach`) and §6.8 Gantt
// (`gantt-intro`). Teaches the standalone Notes panel + the Lists
// panel on /workbench. R1 pacing fix folded the prior
// `workbench-list-add-items` beat into `workbench-list-create-shell`.
import {
  workbenchNotesIntroStep,
  workbenchNotesCreateStep,
  workbenchListsIntroStep,
  workbenchListCreateShellStep,
  workbenchListMarkDoneStep,
} from "./steps/walkthrough/WorkbenchNotesListsSteps";
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
  ganttShareUserClicksShareStep,
  ganttShareUserFillsDialogStep,
  ganttShareUserSavesDialogStep,
  ganttShareProfileSwitchStep,
  ganttShareUserSeesEditStep,
} from "./steps/walkthrough/GanttShareClusterSteps";
import { ganttGoalsStep } from "./steps/walkthrough/GanttGoalsStep";
// v4 tour structural manager (Wave 1, 2026-05-27): new `settings-intro`
// narration beat replaces the retired `settings-page-intro`. Sits between
// gantt-goals-overview and personalization-animations. Wave 2 fills speech.
import { settingsIntroStep } from "./steps/walkthrough/SettingsIntroStep";
import { animationPickerStep } from "./steps/walkthrough/AnimationPickerStep";
import {
  settingsColorStep,
  // settingsMoreStep is retained in the SettingsColorStep.tsx export
  // surface with @deprecated JSDoc (Settings manager 2026-05-22 §6.10
  // phase redesign) but NOT wired into the registry — the seven new
  // settings-tour-* beats replace its single pointer beat with per-
  // surface narration.
} from "./steps/walkthrough/SettingsColorStep";
// §6.10 Settings phase redesign 2026-05-22 (Settings manager). Seven
// new narration beats spotlight each Settings surface (folder /
// calendar / telegram / account-type toggle / visible tabs / streak /
// re-run welcome tour). Three are conditional; the others are
// universal. See SettingsTourBeats.tsx for the per-step bodies.
import {
  settingsTourFolderStep,
  // settingsTourCalendarStep retired 2026-05-27 (Grant hand-walk):
  // confusing "head over to Calendar tab" instruction while tour
  // page-lock kept user on /settings. Body kept @deprecated in
  // SettingsTourBeats.tsx for git history.
  settingsTourTelegramStep,
  settingsTourAccountTypeToggleStep,
  settingsTourVisibleTabsStep,
  settingsTourStreakStep,
  settingsTourRerunStep,
} from "./steps/walkthrough/SettingsTourBeats";
// §6.10 AI Helper split (Settings manager 2026-05-22). The prior
// single `ai-helper-deep-explain` body splits into three manual-
// advance beats: size-diff (with paused cursor between Full → Medium
// → Minimal clicks), paste use case (with the Copy click), and the
// agentic use case (pure narration). `settingsAiHelperStep` survives
// in its file with @deprecated JSDoc but no longer wires through the
// registry.
import { settingsAiHelperSizeDiffStep } from "./steps/walkthrough/SettingsAiHelperSizeDiffStep";
// v4 tour structural manager (Wave 1, 2026-05-27): new
// `ai-helper-size-options` BEAKERBOT_DEMO splits off the cursor-cycles-
// through-tabs portion of `ai-helper-size-diff`. Same gate, same spotlight.
import { aiHelperSizeOptionsStep } from "./steps/walkthrough/AiHelperSizeOptionsStep";
import { settingsAiHelperUseCasePasteStep } from "./steps/walkthrough/SettingsAiHelperUseCasePasteStep";
import { settingsAiHelperUseCaseAgenticStep } from "./steps/walkthrough/SettingsAiHelperUseCaseAgenticStep";
// v4 tour structural manager (Wave 1, 2026-05-27): `search-page-intro`
// retired; Grant's new script folds the page framing into the existing
// `search-demo` speech so the standalone intro is redundant.
import { searchStep } from "./steps/walkthrough/SearchStep";
// §6.12 Wiki pointer multi-beat redesign 2026-05-22 (Wiki pointer manager).
// The legacy single `wikiPointerStep` body is replaced by a 4-beat cluster:
// intro (speech) -> icon spotlight -> click-demo (cursor click on `?` icon
// navigates into the wiki) -> back-demo (cursor click on "Back to app"
// returns the user to where they started). The retired `wikiPointerStep`
// export survives in WikiPointerStep.tsx with @deprecated JSDoc; it is
// NOT mapped through the registry.
import {
  wikiPointerIntroStep,
  wikiPointerIconSpotlightStep,
  wikiPointerClickDemoStep,
  wikiPointerBackDemoStep,
} from "./steps/walkthrough/WikiPointerStep";
// Cleanup retirement 2026-05-22: `phase4-cleanup` is gone from
// TOUR_STEP_ORDER; the terminal step is now `tour-goodbye` (auto-
// cleanup + animation outro). The body is a standard walkthrough step
// (manualAdvance with "Let's go") so the registry maps it the same
// way as the universal walkthrough steps below.
import { tourGoodbyeStep } from "./steps/cleanup/TourGoodbyeStep";

/** P5 step body map. Keys must match `TOUR_STEP_ORDER` entries (the
 *  step-machine drives ordering, this map drives body lookup). Adding
 *  a key here without a matching `TOUR_STEP_ORDER` entry means the
 *  step is never reached; vice versa means the controller renders a
 *  placeholder. */
const WALKTHROUGH_STEP_BODIES: Record<string, TourStep> = {
  // v4 tour structural manager (Wave 1, 2026-05-27): the 4 page-intro
  // narration entries (home / project / settings / search) are retired.
  // Their framing is folded into surrounding step speech in Grant's new
  // script. `settings-intro` is the renamed replacement for the settings
  // beat and lives in its new position lower in this map.
  // Top-level New Project rework (dashboard-newproject-tour bot, 2026-05-29):
  // the §6.1 cluster opens directly on the TRIGGER beat (spotlight the
  // top-level "+ New Project" toolbar button). The prior OPEN-WIDGET beat
  // (`home-open-projects-widget`) is retired now that the create affordance
  // is a persistent toolbar button, not a widget popup.
  [homeCreateProjectStep.id]: homeCreateProjectStep,
  [homeCreateProjectFillStep.id]: homeCreateProjectFillStep,
  [projectOverviewNavStep.id]: projectOverviewNavStep,
  [projectOverviewStep.id]: projectOverviewStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): the
  // `project-overview-typing-demo` skeleton split off the prose step's
  // BEAKERBOT_DEMO half.
  [projectOverviewTypingDemoStep.id]: projectOverviewTypingDemoStep,
  [projectOverviewContextStep.id]: projectOverviewContextStep,
  // 2026-06-03 (tour-merge): `project-overview-exit` removed; its route
  // handoff + lead-in framing folded into `notifications-intro` below.
  // v4 tour structural manager (Wave 1, 2026-05-27): the
  // `notifications-intro` narration beat sits before notifications-bell.
  [notificationsIntroStep.id]: notificationsIntroStep,
  [notificationsBellStep.id]: notificationsBellStep,
  [notificationsSilenceStep.id]: notificationsSilenceStep,
  [notificationsDeleteStep.id]: notificationsDeleteStep,
  [methodsCategoryPromptStep.id]: methodsCategoryPromptStep,
  [methodsCategoryOpenStep.id]: methodsCategoryOpenStep,
  [methodsCategoryStep.id]: methodsCategoryStep,
  [methodsOpenPickerStep.id]: methodsOpenPickerStep,
  // v4 tour structural manager (Wave 1, 2026-05-27):
  // `methods-file-vs-markdown` retired; PCR (methodsBreadthStep) +
  // new methodsLcDemoStep carry the §6.4b builders arc.
  [methodsBreadthStep.id]: methodsBreadthStep,
  [methodsLcDemoStep.id]: methodsLcDemoStep,
  [methodsCreateStep.id]: methodsCreateStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): `workbench-page-intro`
  // and `workbench-create-experiment` retired. Only the user-action
  // open-click survives in TOUR_STEP_ORDER.
  [workbenchCreateExperimentOpenStep.id]: workbenchCreateExperimentOpenStep,
  [workbenchCreateExperimentNameStep.id]: workbenchCreateExperimentNameStep,
  [workbenchCreateExperimentProjectStep.id]: workbenchCreateExperimentProjectStep,
  [workbenchCreateExperimentSubmitStep.id]: workbenchCreateExperimentSubmitStep,
  [methodAttachmentOpenStep.id]: methodAttachmentOpenStep,
  // v4 tour structural manager (Wave 1, 2026-05-27):
  // `experiment-tabs-overview` retired; framing folded into surrounding
  // step's speech.
  [methodAttachmentTabStep.id]: methodAttachmentTabStep,
  [methodAttachmentAttachStep.id]: methodAttachmentAttachStep,
  [methodAttachmentNotesStep.id]: methodAttachmentNotesStep,
  // §6.7 hybrid editor cluster. Inline-editor collapse (onboarding-inline
  // bot 2026-06-02): the HE-1..HE-11 markdown deep-dive collapsed into the
  // single `inlineEditorStep` beat. The surviving beats (notes-vs-results,
  // editor-scope, focus enter/exit, save-concept) wire in TOUR_STEP_ORDER.
  [hybridNotesVsResultsStep.id]: hybridNotesVsResultsStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): scope-narration beat
  // after HE-0.
  [hybridEditorScopeStep.id]: hybridEditorScopeStep,
  // Writing Focus Mode enter beat (between hybrid-editor-scope and the
  // inline editor beat). focus-writing-mode build bot 2026-05-29.
  [hybridFocusEnterStep.id]: hybridFocusEnterStep,
  // Inline-editor collapse (onboarding-inline bot 2026-06-02): the single
  // beat replacing HE-1..HE-11.
  [inlineEditorStep.id]: inlineEditorStep,
  // §6.7 hybrid-save-concept (hybrid-save-concept manager 2026-05-27):
  // NEW pure-narration beat closing the §6.7 editor cluster before the
  // §6.7b Notes/Lists cluster opens. Wires after hybrid-file-attach in
  // TOUR_STEP_ORDER.
  [hybridSaveConceptStep.id]: hybridSaveConceptStep,
  // Writing Focus Mode exit beat (between hybrid-save-concept and
  // workbench-notes-intro). focus-writing-mode build bot 2026-05-29.
  [hybridFocusExitStep.id]: hybridFocusExitStep,
  // §6.7b Workbench Notes + Lists expansion (Workbench expansion
  // manager 2026-05-22, collapsed to 5 beats by Workbench fix manager
  // R1 2026-05-22). Universal steps wired in TOUR_STEP_ORDER between
  // hybrid-file-attach and gantt-intro.
  [workbenchNotesIntroStep.id]: workbenchNotesIntroStep,
  [workbenchNotesCreateStep.id]: workbenchNotesCreateStep,
  [workbenchListsIntroStep.id]: workbenchListsIntroStep,
  [workbenchListCreateShellStep.id]: workbenchListCreateShellStep,
  [workbenchListMarkDoneStep.id]: workbenchListMarkDoneStep,
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
  [ganttShareUserClicksShareStep.id]: ganttShareUserClicksShareStep,
  [ganttShareUserFillsDialogStep.id]: ganttShareUserFillsDialogStep,
  [ganttShareUserSavesDialogStep.id]: ganttShareUserSavesDialogStep,
  [ganttShareProfileSwitchStep.id]: ganttShareProfileSwitchStep,
  [ganttShareUserSeesEditStep.id]: ganttShareUserSeesEditStep,
  // Goals overview — RELOCATED to after the share cluster. Conditional
  // on picks.goals === "yes" (step-machine.ts gating unchanged).
  [ganttGoalsStep.id]: ganttGoalsStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): new
  // `settings-intro` narration beat replaces the retired
  // `settings-page-intro`. Lives between gantt-goals-overview and the
  // animation picker per the new script.
  [settingsIntroStep.id]: settingsIntroStep,
  [animationPickerStep.id]: animationPickerStep,
  // §6.10 Settings phase redesign 2026-05-22 (Settings manager): the
  // prior single `settings-more` + `ai-helper-deep-explain` cluster is
  // replaced by 7 settings-tour-* narration beats + 3 ai-helper-* beats.
  // The legacy bodies survive with @deprecated tags in their files but
  // are NOT mapped here.
  [settingsColorStep.id]: settingsColorStep,
  [settingsTourFolderStep.id]: settingsTourFolderStep,
  // settingsTourCalendarStep retired 2026-05-27 (Grant hand-walk).
  [settingsTourTelegramStep.id]: settingsTourTelegramStep,
  [settingsTourAccountTypeToggleStep.id]: settingsTourAccountTypeToggleStep,
  [settingsTourVisibleTabsStep.id]: settingsTourVisibleTabsStep,
  [settingsTourStreakStep.id]: settingsTourStreakStep,
  [settingsTourRerunStep.id]: settingsTourRerunStep,
  [settingsAiHelperSizeDiffStep.id]: settingsAiHelperSizeDiffStep,
  // v4 tour structural manager (Wave 1, 2026-05-27): new
  // `ai-helper-size-options` BEAKERBOT_DEMO sits between size-diff
  // narration and use-case-paste.
  [aiHelperSizeOptionsStep.id]: aiHelperSizeOptionsStep,
  [settingsAiHelperUseCasePasteStep.id]: settingsAiHelperUseCasePasteStep,
  [settingsAiHelperUseCaseAgenticStep.id]: settingsAiHelperUseCaseAgenticStep,
  [searchStep.id]: searchStep,
  // §6.12 Wiki pointer multi-beat redesign 2026-05-22 (Wiki pointer
  // manager). 4-beat cluster wired in TOUR_STEP_ORDER order; legacy
  // single `wiki-pointer` id retired (see WikiPointerStep.tsx).
  [wikiPointerIntroStep.id]: wikiPointerIntroStep,
  [wikiPointerIconSpotlightStep.id]: wikiPointerIconSpotlightStep,
  [wikiPointerClickDemoStep.id]: wikiPointerClickDemoStep,
  [wikiPointerBackDemoStep.id]: wikiPointerBackDemoStep,
  // Cleanup retirement 2026-05-22: tour-goodbye is the new terminal
  // step; the body lives in steps/cleanup/TourGoodbyeStep.tsx alongside
  // the retired Phase 4 cleanup-grid sources (marked @deprecated).
  [tourGoodbyeStep.id]: tourGoodbyeStep,
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

// §6.8 onEnter side-effect. The Gantt goals step body can't resolve the
// active project / experiment id in isolation, so the spawn hook is wired
// here to keep the body file unit-testable without pulling in `projectsApi`
// / `tasksApi` / `fileService` mocks.
//
// The hook is idempotent + best-effort; see `lib/on-enter-helpers.ts` for
// the exact contract. TourController catches throws + logs, but the hook
// itself also swallows so a partial failure produces a no-op step instead
// of a tour-wedge.
//
// Inline-editor collapse (onboarding-inline bot 2026-06-02): the
// `hybrid-image-attach` (HE-8) onEnter that seeded the BeakerBot selfie blob
// was removed along with the HE-1..HE-11 markdown deep-dive collapse. The
// new single `inline-editor` beat is pure narration (no image-attach demo),
// so no onEnter hook is needed.

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
