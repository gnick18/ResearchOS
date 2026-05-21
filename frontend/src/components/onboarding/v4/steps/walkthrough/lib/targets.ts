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

  // §6.3 Notifications
  notificationsBell: "notifications-bell",

  // §6.4 Methods page
  methodsAddCategory: "methods-add-category",
  methodsCategoryNameInput: "methods-category-name-input",
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
  methodsTypeMarkdown: "methods-type-markdown",
  methodsCreateForm: "methods-create-form",
  methodsCreateNameInput: "methods-create-name-input",
  methodsCreateBodyInput: "methods-create-body-input",
  methodsCreateSubmit: "methods-create-submit",

  // §6.5 Workbench experiment creation
  workbenchNewExperiment: "workbench-new-experiment",
  workbenchExperimentNameInput: "workbench-experiment-name-input",
  workbenchExperimentSubmit: "workbench-experiment-submit",

  // §6.6 Method attachment
  experimentMethodsTab: "experiment-methods-tab",
  experimentAttachMethod: "experiment-attach-method",
  experimentVariationNotes: "experiment-variation-notes",

  // §6.7 Hybrid editor
  experimentNotesTab: "experiment-notes-tab",
  hybridEditorTextarea: "hybrid-editor-textarea",
  hybridEditorImageStrip: "hybrid-editor-image-strip",
  hybridEditorResizeHandle: "hybrid-editor-resize-handle",

  // §6.8 Gantt
  ganttTimeline: "gantt-timeline",
  ganttNewTaskButton: "gantt-new-task-button",
  ganttFirstTaskBar: "gantt-first-task-bar",
  ganttGoalsButton: "gantt-goals-button",

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
