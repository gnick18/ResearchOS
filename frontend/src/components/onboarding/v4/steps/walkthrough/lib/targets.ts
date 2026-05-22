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

  // §6.9 Animation picker (Gantt toolbar)
  ganttAnimationPicker: "gantt-animation-picker",

  // §6.10 Settings
  settingsColorPicker: "settings-color-picker",
  settingsAiHelperSection: "settings-ai-helper-section",
  settingsAiHelperTabFull: "settings-ai-helper-tab-full",
  settingsAiHelperTabMedium: "settings-ai-helper-tab-medium",
  settingsAiHelperTabMinimal: "settings-ai-helper-tab-minimal",
  settingsAiHelperCopy: "settings-ai-helper-copy",

  // §6.11 Search
  searchInput: "search-input",

  // §6.12 Wiki
  wikiNavTab: "wiki-nav-tab",

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
