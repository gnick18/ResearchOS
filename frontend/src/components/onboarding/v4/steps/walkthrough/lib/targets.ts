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
  // §6.2 project-overview rollup sections — REMOVED (tour-teardown audit
  // 2026-06-03). The `project-overview-rollup` narration beat was dropped
  // when Results / Methods / Activity became hide-when-empty tabs (the
  // real-tabs redesign, beta bug #4); on a fresh project the wrapper held
  // no rolled-up sections, so the spotlight rect was empty. The step is
  // gone from TOUR_STEP_ORDER and the `project-overview-rollup-sections`
  // anchor was stripped from ProjectRoute.tsx, so this constant is
  // deleted rather than left dangling.
  // §6.2c project route topbar: sticky header containing the project
  // name, tags, and action buttons (edit, share, archive, delete). This
  // anchor used to back the `project-overview-context` beat, which the
  // 2026-06-03 tour-simplification collapse removed (the four §6.2 beats
  // folded into the single `project-overview-typing-demo` beat). The
  // anchor is now orphaned but kept harmless so the project page div
  // stamp does not need touching. Anchor lives in `ProjectRoute.tsx` on
  // the sticky topbar div that already has
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
  // §6.4b-0 (methods-cluster sub-bot 2026-05-26): the common-case
  // file-attach card is `method-type-pdf` per the registry slug. The
  // file-vs-markdown explainer mentions PDF in its speech but the
  // spotlight targets the Markdown card (one rect per step).
  methodsTypePdf: "method-type-pdf",
  // §6.4b deep-demo (sub-bot v4 sec 6.4b upgrade, 2026-05-21): replaces
  // the prior 7-tile hover sweep with two focused builder demos (PCR +
  // LC Gradient). The cursor clicks INTO each builder and exercises
  // ~3-4 affordances so users see that these editors are interactive
  // (not text forms). The per-step PCR / LC builder bodies were retired
  // 2026-06-03 (HR / tour-simplification); these target keys remain.
  // PCR editor (InteractiveGradientEditor.tsx) affordances:
  methodsTypePcrTile: "method-type-pcr",
  methodsTypeLcGradientTile: "method-type-lc-gradient",
  pcrEditToggle: "pcr-edit-toggle",
  pcrAddCycle: "pcr-add-cycle",
  pcrAddCycleConfirm: "pcr-add-cycle-confirm",
  // §6.4b PCR live-edit demo (methods-cluster sub-bot 2026-05-26):
  // Grant's brief asks for "2 edits to the gradient to show them that
  // its editable". The cursor demo clicks Edit Cycle, clicks "+ Add
  // Step" to open the StepEditPopup, then targets the popup's three
  // inputs (name / temperature / duration) and the Save button. The
  // editor's existing add-step flow seeds default values so we have
  // something to overwrite via a callback action (typeInto would
  // append, not replace).
  pcrAddStep: "pcr-add-step",
  pcrStepNameInput: "pcr-step-name-input",
  pcrStepTempInput: "pcr-step-temp-input",
  pcrStepDurationInput: "pcr-step-duration-input",
  pcrStepSave: "pcr-step-save",
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
  /** Project picker (the native <select>) inside TaskModal. The §6.5
   *  cursor demo selects the user's §6.1-created project here BEFORE
   *  typing the name, so the experiment files into that project instead
   *  of the default Miscellaneous bucket (experiment-create sub-bot,
   *  2026-05-26). */
  workbenchExperimentProjectSelect: "workbench-experiment-project-select",
  workbenchExperimentNameInput: "workbench-experiment-name-input",
  workbenchExperimentSubmit: "workbench-experiment-submit",

  // §6.7b Workbench Notes + Lists expansion (Workbench expansion manager
  // 2026-05-22). Steps sit between §6.7 editor cluster and §6.8
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
  /** "Add a list item..." input inside the TaskModal's list-mode body
   *  (the inline sub-task editor that renders when task_type === "list").
   *  The workbench-list-create-shell cursor types each of the three
   *  demo items into this input one by one (workbench-list create-shell
   *  fix manager 2026-05-27 — modal now mediates list creation, the
   *  prior in-card inline-spawn shortcut no longer works because the
   *  TaskModal sits on top of the workbench panel). */
  workbenchListModalItemInput: "workbench-list-modal-item-input",
  /** "Add" button next to the list-items input inside the TaskModal's
   *  list-mode body. Cursor clicks this between item entries so the
   *  modal commits each sub-task into local state before the Create
   *  List submit fires. */
  workbenchListModalItemAdd: "workbench-list-modal-item-add",
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

  // §6.7 editor cluster
  experimentNotesTab: "experiment-notes-tab",
  // Retained for legacy cursor-script references; no longer stamped on a
  // live DOM node (the hybrid editor was removed 2026-06-04).
  hybridEditorTextarea: "hybrid-editor-textarea",
  // §6.7 inline editor (onboarding-inline collapse 2026-06-02): the live
  // CodeMirror 6 surface (InlineMarkdownEditor inside LiveMarkdownEditor),
  // the sole editor. Stamped on the wrapper div around InlineMarkdownEditor;
  // present in both the normal and focus-mode mounts (the focus overlay
  // portals the same subtree).
  inlineEditorSurface: "inline-editor-surface",
  hybridEditorImageStrip: "hybrid-editor-image-strip",
  hybridEditorResizeHandle: "hybrid-editor-resize-handle",
  // §6.7 resize redesign (Grant 2026-05-21): the popover is click-to-
  // pick-percentage, not a drag-corner handle. Cursor clicks the embedded
  // image to open the popover, then clicks the 50% radio.
  hybridEditorEmbeddedImage: "hybrid-editor-embedded-image",
  hybridEditorResizePercent50: "hybrid-editor-resize-percent-50",
  // §6.7 demo: the "+ Add paragraph" affordance (retired with the hybrid
  // editor 2026-06-04; key retained for script compat).
  hybridEditorAddParagraph: "hybrid-editor-add-paragraph",
  // §6.7 the experiment-popup fullscreen toggle button.
  taskPopupFullscreen: "task-popup-fullscreen",
  // Writing Focus Mode (FOCUS_WRITING_MODE_DESIGN.md §9). The enter
  // button lives in the LiveMarkdownEditor toolbar next to the Edit /
  // Preview toggle; the exit button lives in the focus-mode overlay's
  // top-right. The two universal enter / exit beats glide to and click
  // these so BeakerBot demos clearing the chrome and bringing it back.
  hybridEditorFocusToggle: "hybrid-editor-focus-toggle",
  hybridEditorFocusExit: "hybrid-editor-focus-exit",

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
  // shared across the app; we stamp the user-row, the "Add" button
  // (which moves the picked user into the share list), and the Save /
  // Confirm button for the cursor's allow-list.
  //
  // Walkthrough audit fix manager (2026-05-25): dropped the dead
  // `shareDialogPermissionEdit` constant. Its value
  // (`share-dialog-permission-edit`) was never stamped on any product
  // surface, so allow-listing it had no effect. The default permission
  // on the add row is already "edit", so most users never touch the
  // toggle and the share-back path doesn't need the radio in scope.
  // Added `shareDialogAdd` (matching the existing
  // `data-tour-target="share-dialog-add"` on the Add button in
  // ShareDialog.tsx) since the user MUST click Add to move BeakerBot
  // into the share list before Confirm becomes meaningful.
  shareDialog: "share-dialog",
  shareDialogUserRow: "share-dialog-user-row",
  shareDialogAdd: "share-dialog-add",
  shareDialogConfirm: "share-dialog-confirm",
  // Dependency-type picker (GanttChart). Stamped on the "Start after" /
  // "Start before" buttons of the modal that opens after a bar→bar drag.
  // Used by `gantt-deps-user`'s page-lock allow-list so the user can
  // actually click through to FS-mode after dropping Fake B on the
  // user's experiment. Gantt fix manager R1 (P0 #3).
  ganttDepPickerStartAfter: "gantt-dep-picker-start-after",
  ganttDepPickerStartBefore: "gantt-dep-picker-start-before",
  ganttDepPickerStartSame: "gantt-dep-picker-start-same",
  // Inbox badge — the small "Inbox" pill in the AppShell top-right
  // cluster that opens the InboxPanel. Replaces the legacy
  // `data-testid='inbox-tab'` selector (Lab Inbox concept was renamed;
  // the prior testid no longer existed in source). Walkthrough audit
  // fix manager (2026-05-25).
  inboxBadge: "inbox-badge",

  // User picker (top-right floating cluster), used by the real
  // profile-switch step. AppShell renders the user-switch button via
  // <Tooltip>; we stamp the inner <button> for the cursor's click.
  //
  // Walkthrough audit fix manager (2026-05-25): removed the dead
  // `userPickerOption` constant. It belonged to an older
  // profile-switch flow (the user-login-screen modal) that the v4
  // tour no longer drives. The cursor never targeted it and no
  // product surface stamped the matching attribute.
  userPickerButton: "user-picker-button",

  // §6.9 Animation picker.
  //
  // Walkthrough audit fix manager (2026-05-25): removed the dead
  // `ganttAnimationPicker` constant (the Gantt toolbar picker was
  // deleted in the 2026-05-23 declutter). The live picker lives in
  // /settings and is addressed by `settingsAnimationPicker` below.
  /** Animation picker section inside `/settings` (the inline 2-column
   *  grid of theme tiles). Stamped on the SectionShell that wraps the
   *  picker so the v4 tour spotlight wraps the whole card. */
  settingsAnimationPicker: "settings-animation-picker",

  // §6.10 Settings
  settingsColorPicker: "settings-color-picker",
  /** Wraps both the color picker (primary + secondary swatches) AND the
   *  tint header toggle. Used by §6.10 `personalization-color` step so
   *  the spotlight encompasses the whole section the user can play
   *  with, not just the toggle row. */
  settingsColorAndTint: "settings-color-and-tint",
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

  /** §6.15 Calendar — the Linked Calendars button in the top-right of
   *  the /calendar page. Tour points at it when explaining that the
   *  user can link a feed later. */
  calendarLinkedFeedsButton: "calendar-linked-feeds-button",

  // §6.11 Search
  searchInput: "search-input",
  searchSubmit: "search-submit",

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

  // PI Home migration (pi-walkthrough hardening, 2026-05-29): the Lab
  // Overview top-nav tab. AppShell stamps this on the /lab-overview nav
  // entry, which is rendered ONLY for lab_head (PI) accounts. For a PI
  // the Home tab is hidden by default, so the §6.2→6.3 transition step
  // glides to / spotlights this tab instead of the (absent) Home tab.
  // See `homeOrLabOverviewNavSelector` below.
  labOverviewNavTab: "lab-overview-nav-tab",

  // Widget-framework teardown v2 (2026-06-02): the §6.2b Home widgets
  // walkthrough anchors (homeWidgetCanvas / homeWidgetTile /
  // homeWidgetAddButton / homeWidgetCatalog / homeWidgetCatalogItem /
  // homeWidgetDragHandle / homeWidgetEditToggle / homeWidgetExpandButton)
  // were removed with the customizable widget canvas they targeted.

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
  // HE-3 markdown overview spotlight (retired with the hybrid editor 2026-06-04).
  // Key retained for script compat.
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

/**
 * Account-type-aware selector for the "back to Home" transition anchor
 * (PI Home migration, pi-walkthrough hardening 2026-05-29).
 *
 * Historically the §6.2→6.3 transition step (`project-overview-exit`,
 * removed in the 2026-06-03 tour-merge) glided the cursor to, and
 * spotlighted, the top-nav dashboard tab the user was sent back to. No
 * live walkthrough step consumes this selector anymore; it is retained
 * for any account-type-aware nav lookups that still want the dashboard
 * tab.
 *
 * Dashboard unification (dashboard-unification build, 2026-05-29): Home
 * and Lab Overview collapsed into ONE nav entry at `/`, which ALWAYS
 * renders with `data-tour-target="home-nav-tab"` (the label reads "Lab
 * Overview" for a PI, "Home" otherwise, but the tour anchor is the same).
 * The separate `lab-overview-nav-tab` entry no longer renders, so the
 * selector resolves to the single dashboard tab for every account type.
 *
 * The selector still lists BOTH anchors (`home-nav-tab` first) purely for
 * back-compat robustness: `document.querySelector` returns the first
 * match in document order, which is always the dashboard tab now. The
 * `lab-overview-nav-tab` clause is harmless dead weight kept so a stray
 * legacy mount (if any) would still resolve.
 */
export function homeOrLabOverviewNavSelector(): string {
  return `${targetSelector(TOUR_TARGETS.homeNavTab)}, ${targetSelector(
    TOUR_TARGETS.labOverviewNavTab,
  )}`;
}
