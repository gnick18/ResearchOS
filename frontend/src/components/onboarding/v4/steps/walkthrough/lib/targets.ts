/**
 * Centralized `data-tour-target` selector registry for the Onboarding
 * v4 universal walkthrough (P5 — see ONBOARDING_V4_PROPOSAL.md §6).
 *
 * Each entry corresponds to a real product surface the walkthrough
 * anchors to. The step bodies use these constants to declare their
 * spotlight targets; the product-surface JSX (Home page New Project
 * button, Workbench new-task button, Settings color swatches, etc.)
 * sets the matching `data-tour-target="..."` attribute.
 *
 * Centralizing the names here keeps two things in sync without
 * grep-hunting: the step body declares it wants a selector, and the
 * product surface page sets the attribute. Renames happen in one place.
 *
 * Naming convention: kebab-case, page-prefixed (`home-`, `workbench-`,
 * `methods-`, `gantt-`, `settings-`, `search-`, `wiki-`, `editor-`).
 * Avoid generic names that could collide (`button` → `home-new-project`).
 *
 * The helper `targetSelector(name)` wraps the literal `[data-tour-target="..."]`
 * CSS selector so callers don't repeat the boilerplate.
 */

export const TOUR_TARGETS = {
  // §6.1 Home + first project
  homeNewProject: "home-new-project",
  homeProjectCreateForm: "home-project-create-form",
  homeProjectNameInput: "home-project-name-input",
  homeProjectWeekendToggle: "home-project-weekend-toggle",
  homeProjectCreateSubmit: "home-project-create-submit",

  // §6.2 Project route Overview prose
  projectOverviewTextarea: "project-overview-textarea",
  // §6.2c project route topbar — sticky header containing the project
  // name, tags, and action buttons (edit, share, archive, delete). The
  // §6.2 context sub-step (`project-overview-context`) spotlights this
  // so BeakerBot can call out "your project's tags, name, and shape live
  // here" alongside the Overview textarea below. Anchor lives in
  // `ProjectRoute.tsx` on the sticky topbar div that already has
  // `data-testid="project-route-topbar"`.
  projectOverviewTopbar: "project-overview-topbar",

  // §6.3 Notifications. Split into three sub-steps (bell → silence →
  // delete) so the user actually exercises each affordance on the test
  // notification before the tour moves on. "silence" maps to the
  // "Mark as read" button (closest functional analog: muting the unread
  // bell badge), "delete" maps to the row's "Dismiss" (X) button.
  notificationsBell: "notifications-bell",
  notificationSilence: "notification-silence",
  notificationDelete: "notification-delete",

  // §6.4 Methods page
  methodsAddCategory: "methods-add-category",
  methodsCategoryNameInput: "methods-category-name-input",
  // §6.4 cursor demo (Grant 2026-05-21 follow-up): the demo was typing
  // the picked label but never clicking submit, so the modal sat open
  // waiting for the user. The cursor now clicks "Create Empty" which
  // creates the category without auto-cascading into the method picker
  // (the next step `methods-open-picker` opens it separately).
  methodsCategoryCreateEmpty: "methods-category-create-empty",
  // §6.4 v4 sec 6.4 redesign: the demo step types the user-picked
  // category name into the "New Category" modal. `methodsAddCategory`
  // covers the page-header "+ New Category" button; the alias key
  // below documents the demo intent. Same selector value so the
  // product surface only sets one attribute.
  methodsNewCategoryButton: "methods-add-category",
  methodsNewMethod: "methods-new-method",
  // §6.4 open-picker beat (sub-bot, 2026-05-21): the "+ New Method"
  // button anchor used by the dedicated `methods-open-picker` step that
  // sits between category creation and the type-tour. The older
  // `methodsNewMethod` constant is kept for backwards compat (the
  // breadth step already references it as the picker-open click target).
  methodsNewMethodButton: "methods-new-method-button",
  methodsTypePicker: "methods-type-picker",
  methodsTypeMarkdown: "method-type-markdown",
  // §6.4b deep-demo (sub-bot v4 sec 6.4b upgrade, 2026-05-21): replaces
  // the prior 7-tile hover sweep with two focused builder demos (PCR +
  // LC Gradient). The cursor clicks INTO each builder and exercises
  // ~3-4 affordances so users see that these editors are interactive
  // (not text forms). See MethodsBreadthStep / MethodsPcrEditStep /
  // MethodsPcrAddCycleStep / MethodsLcDemoStep for the per-step bodies.
  // PCR editor (InteractiveGradientEditor.tsx) affordances:
  methodsTypePcrTile: "method-type-pcr",
  methodsTypeLcGradientTile: "method-type-lc-gradient",
  pcrEditToggle: "pcr-edit-toggle",
  pcrAddCycle: "pcr-add-cycle",
  pcrAddCycleConfirm: "pcr-add-cycle-confirm",
  // §6.4b viewport-anchor (sub-bot 2026-05-21): the WHOLE PCR builder
  // card inside CreateMethodModal — description text + Thermal Gradient
  // heading + InteractiveGradientEditor + Reaction Recipe table. The
  // smaller per-action targets (pcrEditToggle, pcrAddCycle) only get
  // the button in view, but Grant wants the whole card visible during
  // the demo. Used via `TourStep.viewportAnchor` to scroll the inner
  // modal scroll container so the card's top sits at the viewport top.
  pcrEditorWrapper: "pcr-editor-wrapper",
  lcEditorWrapper: "lc-editor-wrapper",
  // LC Gradient editor (LcGradientEditor.tsx) affordances. `lcStepRow0`
  // is the first gradient-step row (the modal seeds with a 2-step
  // default; index 0 = the t=0 starting point). `lcAddStep` is the
  // table footer's "+ Add step" button which appends a new row and
  // the recharts line picks up the new data point automatically.
  lcGradientChart: "lc-gradient-chart",
  lcStepRow0: "lc-step-row-0",
  lcAddStep: "lc-add-step",
  methodsCreateForm: "methods-create-form",
  methodsCreateNameInput: "methods-create-name-input",
  // §6.4d sub-bot 2026-05-21: the Folder input doubles as the category
  // selector in the methods grouping (folders ARE categories — see
  // `app/methods/page.tsx`'s grouped-by-folder render). The cursor demo
  // types the user's earlier-picked label here so the funny markdown
  // method lands under the category they chose in §6.4a.
  methodsCreateCategoryInput: "methods-create-category-input",
  methodsCreateBodyInput: "methods-create-body-input",
  methodsCreateSubmit: "methods-create-submit",

  // §6.5 Workbench experiment creation
  workbenchNewExperiment: "workbench-new-experiment",
  workbenchExperimentNameInput: "workbench-experiment-name-input",
  workbenchExperimentSubmit: "workbench-experiment-submit",

  // §6.7b Workbench Notes + Lists expansion (Workbench expansion manager
  // 2026-05-22). 6 new steps sit between §6.7 hybrid editor and §6.8
  // Gantt, teaching the standalone Notes panel + Lists panel. Targets
  // below stamp the page-level tab buttons, the per-panel create
  // affordances, and a render-scoped first-card / first-item latch
  // pattern (same shape as `labModeExperimentsFirstCard`) so the cursor
  // can deterministically reach the BeakerBot-just-created list and its
  // first item without colliding with whatever else the user has.
  workbenchExperimentsTab: "workbench-experiments-tab",
  workbenchNotesTab: "workbench-notes-tab",
  workbenchListsTab: "workbench-lists-tab",
  workbenchNewNoteButton: "workbench-new-note-button",
  workbenchNewListButton: "workbench-new-list-button",
  /** First list card rendered on the Workbench Lists panel. Render-
   *  scoped latch wrapper stamps this attribute on the first card across
   *  every section so the workbench-list-add-items cursor can target
   *  the just-created list deterministically. */
  workbenchListCardFirst: "workbench-list-card-first",
  /** Add-item input inside TaskDetailPopup's Sub-tasks tab. Stamped on
   *  the existing "Add item..." input so the workbench-list-add-items
   *  cursor can type into it. */
  workbenchListAddItemInput: "workbench-list-add-item-input",
  /** First sub-task checkbox inside TaskDetailPopup's Sub-tasks list.
   *  Render-scoped latch (first item only) so the workbench-list-mark-
   *  done cursor checks the right box. */
  workbenchListItemCheckbox: "workbench-list-item-checkbox",
  /** "Mark as complete" button on TaskDetailPopup's parent-task header.
   *  Same button the user clicks to mark a list (parent task) done.
   *  The workbench-list-mark-done cursor clicks this after toggling one
   *  sub-task to demonstrate both moves. */
  workbenchListMarkCompleteButton: "workbench-list-mark-complete",

  // §6.6 Method attachment
  experimentMethodsTab: "experiment-methods-tab",
  experimentAttachMethod: "experiment-attach-method",
  // §6.6 (v4 missing-anchors sub-bot 2026-05-21): the first method tile
  // inside the MethodPicker that opens when the user clicks "Attach
  // Method". MethodPicker also stamps
  // `experiment-attach-method-picker-method-{idx}` on every subsequent
  // tile so future steps can target a specific method by index.
  experimentAttachMethodPickerFirstMethod:
    "experiment-attach-method-picker-first-method",
  experimentVariationNotes: "experiment-variation-notes",

  // §6.7 Hybrid editor
  experimentNotesTab: "experiment-notes-tab",
  hybridEditorTextarea: "hybrid-editor-textarea",
  hybridEditorImageStrip: "hybrid-editor-image-strip",
  hybridEditorResizeHandle: "hybrid-editor-resize-handle",
  // §6.7 resize redesign (Grant 2026-05-21): the popover is click-to-
  // pick-percentage, not a drag-corner handle. Cursor clicks the embedded
  // image to open the popover, then clicks the 50% radio.
  hybridEditorEmbeddedImage: "hybrid-editor-embedded-image",
  hybridEditorResizePercent50: "hybrid-editor-resize-percent-50",

  // §6.8 Gantt
  ganttTimeline: "gantt-timeline",
  ganttNewTaskButton: "gantt-new-task-button",
  ganttFirstTaskBar: "gantt-first-task-bar",
  ganttGoalsButton: "gantt-goals-button",
  // §6.8 chained-deps cascade marker (v4 §6.8 cascade polish sub-bot
  // 2026-05-21): the cursor needs a SPECIFIC day cell ~5-7 days in the
  // future so the cascade-reschedule drag drops at a clearly later date
  // (instead of the timeline's center, which produces only a tiny shift).
  // GanttChart stamps this on the day-HEADER element whose date matches
  // today + 7 days, so the marker is unique (headers render once per
  // visible date; row cells render once per row). The cursor script in
  // GanttDependenciesStep targets it as the third drag's destination.
  ganttLaterDateMarker: "gantt-later-date-marker",
  // §6.8 Gantt redesign (Gantt manager 2026-05-22): two throwaway demo
  // experiment bars used in the dependency-teaching sub-cluster. Replace
  // the legacy three-bar BeakerBot-Boil/Brew/Sip chain with a two-bar
  // chain (A + B) plus the user's own existing experiment.
  ganttBarFakeA: "gantt-bar-fake-a",
  ganttBarFakeB: "gantt-bar-fake-b",
  // The user's own existing experiment bar — re-using ganttFirstTaskBar
  // would conflict on existing tests that rely on the legacy meaning.
  // We stamp this dedicated attribute on the experiment created in §6.5
  // so the new Gantt cluster can target it explicitly.
  ganttBarUserExperiment: "gantt-bar-user-experiment",
  // §6.8 share-cluster (lab only): the shared experiment from BeakerBot
  // and the share-back affordances inside the task popup.
  ganttBarSharedExperiment: "gantt-bar-shared-experiment",
  taskPopupShareButton: "task-popup-share-button",
  // Gantt fix manager R1 (P0 #2): the notes-tab + textarea targets here
  // re-use the existing §6.7 hybrid-editor attribute values so the
  // share-cluster allow-list passes through on the SAME elements that
  // already get stamped. The previous values ("task-popup-notes-tab"
  // and "task-popup-notes-textarea") never appeared on any product
  // surface, so every click on the popup tripped the page-lock's
  // wrong-click handler. Mapping these constants to
  // "experiment-notes-tab" + "hybrid-editor-textarea" fixes that
  // without needing to stamp duplicate attributes on the popup chrome.
  taskPopupNotesTab: "experiment-notes-tab",
  taskPopupNotesTextarea: "hybrid-editor-textarea",
  // Share-dialog affordances. The dialog is the standard ShareDialog
  // shared across the app; we stamp the user-row + permission radios
  // for the cursor's allow-list.
  shareDialog: "share-dialog",
  shareDialogUserRow: "share-dialog-user-row",
  shareDialogPermissionEdit: "share-dialog-permission-edit",
  shareDialogConfirm: "share-dialog-confirm",
  // Dependency-type picker (GanttChart). Stamped on the "Start after" /
  // "Start before" buttons of the modal that opens after a bar→bar drag.
  // Used by `gantt-deps-user`'s page-lock allow-list so the user can
  // actually click through to FS-mode after dropping Fake B on the
  // user's experiment. Gantt fix manager R1 (P0 #3).
  ganttDepPickerStartAfter: "gantt-dep-picker-start-after",
  ganttDepPickerStartBefore: "gantt-dep-picker-start-before",
  ganttDepPickerStartSame: "gantt-dep-picker-start-same",
  // User picker (top-right floating cluster) — used by the real
  // profile-switch step. AppShell renders the user-switch button via
  // <Tooltip>; we stamp the inner <button> for the cursor's click.
  userPickerButton: "user-picker-button",
  // The user-login-screen modal renders a row per available user; we
  // stamp the row for the BeakerBot lab user so the cursor can click
  // it to perform the real switch.
  userPickerOption: "user-picker-option",

  // §6.9 Animation picker.
  /** @deprecated post-Gantt-declutter (2026-05-23). The animation picker
   *  no longer lives on the Gantt toolbar; use `settingsAnimationPicker`
   *  instead. Kept on the constants object so any stragglers still
   *  resolve to a (non-rendered) selector rather than a build break. */
  ganttAnimationPicker: "gantt-animation-picker",
  /** Animation picker section inside `/settings` (the inline 2-column
   *  grid of theme tiles). Stamped on the SectionShell that wraps the
   *  picker so the v4 tour spotlight wraps the whole card. */
  settingsAnimationPicker: "settings-animation-picker",

  // §6.10 Settings
  settingsColorPicker: "settings-color-picker",
  /** "Tint header with my color" toggle in the Profile section. The v4 tour
   *  used to demo color-picking here (auto-click a swatch). Now that users
   *  pick their color during user creation via UserColorPickerPopup, the
   *  walkthrough beat re-points at this toggle and invites users to play
   *  with the chrome tint + tweak colors if they want before moving on.
   *  Stamped on a div wrapper around the ToggleRow so the spotlight wraps
   *  the whole row. */
  settingsColorTintToggle: "settings-color-tint-toggle",
  settingsAiHelperSection: "settings-ai-helper-section",
  settingsAiHelperTabFull: "settings-ai-helper-tab-full",
  settingsAiHelperTabMedium: "settings-ai-helper-tab-medium",
  settingsAiHelperTabMinimal: "settings-ai-helper-tab-minimal",
  settingsAiHelperCopy: "settings-ai-helper-copy",
  // §6.10 Settings phase redesign 2026-05-22 (Settings manager).
  // New spotlight anchors for the 7 settings-tour-* narration beats that
  // expand §6.10 from 3 steps to 11. Each beat scrolls + narrates a
  // single Settings surface so the user learns where each capability
  // lives without clicking through. Anchors stamp the SectionShell (or
  // its inner row) so the spotlight wraps the whole card.
  //
  // Calendar feeds + lab-mode-toggle don't have a dedicated Settings
  // section yet; their tour beats fall back to narration-only (no
  // targetSelector) until the surfaces ship. FOLLOW-UP comments in the
  // step bodies tag the wire-up site.
  settingsFolderSection: "settings-folder-section",
  settingsTelegramSection: "settings-telegram-section",
  settingsTabsSection: "settings-tabs-section",
  settingsStreakSection: "settings-streak-section",
  settingsRerunSection: "settings-rerun-section",
  // Optional secondary-color swatch (gradient feature, in flight at
  // a621daf4). The primary palette swatch already carries
  // `data-color-swatch="<hex>"` which the cursor demo targets first;
  // the secondary palette will reuse the same attribute under a
  // dedicated wrapper. Until the gradient sub-bot lands, this anchor
  // resolves to nothing and the page-lock allow-list falls back to the
  // existing primary palette.
  settingsColorPickerSecondary: "settings-color-picker-secondary",
  settingsColorPickerClearSecondary: "settings-color-picker-clear-secondary",

  // §6.11 Search
  searchInput: "search-input",

  // §6.12 Wiki
  wikiNavTab: "wiki-nav-tab",
  // §6.12 Wiki — "Back to app" button on the slim WikiTopBar that sits
  // above every /wiki/* page. Wiki pointer multi-beat redesign 2026-05-22
  // (Wiki pointer manager): the §6.12 click-demo navigates the cursor to
  // a wiki page; the follow-up back-demo cursor-clicks this button to
  // route the user back to wherever they started.
  wikiBackToApp: "wiki-back-to-app",

  // §6.2→6.3 transition (Grant 2026-05-21): BeakerBot glides to the Home
  // tab and the controller programmatically navigates back to "/" so
  // §6.3 notifications fires from the home surface, not from inside the
  // project page. Visible "exiting the project" beat per Grant.
  homeNavTab: "home-nav-tab",

  // §6.14 Purchases — anchors for the BeakerBot cursor-driven demo on
  // /purchases (HR sub-bot 2026-05-22 R2 rebuild). The demo clicks
  // "+ New Purchase" to open NewPurchaseModal, types the item name +
  // vendor + price + quantity + funding string into the form, and
  // clicks Save. The form's submit handler drives the real API path
  // and dispatches `tour:purchase-created` so the step's onEnter
  // listener captures the task + line item + funding-string artifacts.
  purchasesNewButton: "purchases-new-button",
  purchasesForm: "purchases-form",
  purchasesFormName: "purchases-form-name",
  purchasesFormVendor: "purchases-form-vendor",
  purchasesFormPrice: "purchases-form-price",
  purchasesFormQuantity: "purchases-form-quantity",
  purchasesFormFunding: "purchases-form-funding",
  purchasesFormSubmit: "purchases-form-submit",
  // §6.14 Purchases redesign 2026-05-22 (Purchases manager): the
  // DemoPurchasesViewer fullscreen overlay + its spending-dashboard
  // anchor + the dismiss button. The cursor demo inside the viewer
  // scrolls to the dashboard anchor, then hovers each chart center.
  // The dismiss button anchor is allow-listed in the
  // `purchases-back-to-real` page-lock so the user's Back click lands
  // even with the lock active.
  demoPurchasesViewer: "demo-purchases-viewer",
  demoSpendingDashboard: "demo-spending-dashboard",
  demoPurchasesBackButton: "demo-purchases-back-button",
  // §6.14 Purchases fix manager R1: the SpendingDashboard breakdown
  // lens toggle (Project / Vendor / Category). The `-toggle` anchor is
  // the wrapper for cursor glide; each `-lens-<key>` button drives a
  // visible lens switch so demo-charts speech beats land on the right
  // chart. Lives on SpendingDashboard.tsx, so it shows up in both the
  // real /purchases page and the DemoPurchasesViewer overlay.
  spendingBreakdownLensToggle: "spending-breakdown-lens-toggle",
  spendingBreakdownLensProject: "spending-breakdown-lens-project",
  spendingBreakdownLensVendor: "spending-breakdown-lens-vendor",
  spendingBreakdownLensCategory: "spending-breakdown-lens-category",

  // §6.16 lab-permission-practice real-Workbench cursor demo (HR sub-bot
  // 2026-05-22). The cursor drives a real interaction against the
  // BeakerBot-shared experiment cards on /workbench instead of a paper-
  // doll inline card. Each target only fires for cards whose owner ===
  // BEAKERBOT_LAB_USERNAME (the spawn step's fake teammate) so the
  // attribute can't accidentally collide with a real share from another
  // teammate.
  workbenchSharedEditExperiment: "workbench-shared-edit-experiment",
  workbenchSharedViewExperiment: "workbench-shared-view-experiment",
  // §6.16 cursor demo: the experiment popup's affordances the cursor
  // drives during the real-Workbench permission demo. The popup is the
  // ordinary `TaskDetailPopup`; these attributes only render once per
  // popup mount so a single shared selector resolves the active popup
  // regardless of which task was clicked.
  taskPopupEditButton: "task-popup-edit-button",
  taskPopupNameInput: "task-popup-name-input",
  taskPopupSaveButton: "task-popup-save-button",
  taskPopupDeleteButton: "task-popup-delete-button",
  taskPopupClose: "task-popup-close",

  // §6.7 hybrid-editor redesign (HE-0 notes-vs-results + new sub-steps).
  // Hybrid editor manager 2026-05-22: appended NEW anchors only; existing
  // §6.7 entries above (experimentNotesTab, hybridEditorTextarea, image
  // strip, embedded image, resize percent) keep their values.
  // HE-0 spotlight: the tab container with both Notes + Results tabs
  // visible so BeakerBot can call out the two-store mental model. The
  // results tab itself is also addressable for the glide-between-tabs
  // demo cursor script.
  experimentTabContainer: "experiment-tab-container",
  experimentResultsTab: "experiment-results-tab",
  // HE-3 markdown overview spotlight: the helper panel inside the
  // hybrid editor that lists shortcuts + the style guide. Lives on the
  // left of the editor body; rendered by HybridMarkdownEditor.tsx in
  // both the empty-state and the populated-state branches.
  hybridEditorShortcutBar: "hybrid-editor-shortcut-bar",

  // ----- R4 Lab Overview targets — RETIRED 2026-05-23. The 4 anchors
  // here (labOverviewCanvas / labOverviewSidebar / labOverviewAddWidget /
  // labOverviewShareButton) pointed at the now-deleted 6-step Lab
  // Overview walkthrough cluster. The cluster was throwaway placeholder
  // R4 code; Grant chose nuke-now-rebuild-fresh ahead of the
  // Mira-substrate walkthrough redesign. The data-tour-target attributes
  // on WidgetCanvas + SidebarWidgetRail have been stripped to match.
} as const;

export type TourTargetName = (typeof TOUR_TARGETS)[keyof typeof TOUR_TARGETS];

/**
 * Build the CSS selector for a `data-tour-target` constant. Step bodies
 * call this when they declare `targetSelector` on their `TourStep`
 * entry, or when they pass a selector string to `waitForElement`.
 */
export function targetSelector(name: TourTargetName): string {
  return `[data-tour-target="${name}"]`;
}
