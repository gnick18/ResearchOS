// GENERATED FILE, do not edit by hand (ai spotlight bot).
//
// Source of truth: the static data-tour-target anchors in frontend/src.
// Regenerate with: node frontend/scripts/generate-ui-anchor-manifest.mjs
//
// This manifest backs BeakerBot's find_ui_element and spotlight_ui_element tools.
// Each entry points the assistant at a page and a stable selector it can navigate
// to and highlight. Dynamic/templated anchors and shared-modal anchors are
// excluded by the generator (see the script header for the why).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

export type UiAnchor = {
  // The data-tour-target value. The spotlight tool builds the selector
  // [data-tour-target="<id>"] from this.
  id: string;
  // Human label, "<thing> (<area>)", used by find_ui_element's fuzzy search and
  // by BeakerBot when it narrates what it is showing.
  label: string;
  // The route to navigate to before highlighting, derived from the anchor's area.
  page: string;
};

export const UI_ANCHORS: UiAnchor[] = [
  { id: "calendar-linked-feeds-button", label: "Linked feeds button (Calendar)", page: "/calendar" },
  { id: "gantt-dep-picker-start-after", label: "Dep picker start after (Gantt timeline)", page: "/gantt" },
  { id: "gantt-dep-picker-start-before", label: "Dep picker start before (Gantt timeline)", page: "/gantt" },
  { id: "gantt-dep-picker-start-same", label: "Dep picker start same (Gantt timeline)", page: "/gantt" },
  { id: "gantt-first-task-bar", label: "First task bar (Gantt timeline)", page: "/gantt" },
  { id: "gantt-goals-button", label: "Goals button (Gantt timeline)", page: "/gantt" },
  { id: "gantt-new-task-button", label: "New task button (Gantt timeline)", page: "/gantt" },
  { id: "gantt-project-filter", label: "Project filter (Gantt timeline)", page: "/gantt" },
  { id: "gantt-project-filter-standalone", label: "Project filter standalone (Gantt timeline)", page: "/gantt" },
  { id: "gantt-timeline", label: "Timeline (Gantt timeline)", page: "/gantt" },
  { id: "methods-add-category", label: "Add category (Methods library)", page: "/methods" },
  { id: "methods-category-create-empty", label: "Category create empty (Methods library)", page: "/methods" },
  { id: "methods-category-name-input", label: "Category name input (Methods library)", page: "/methods" },
  { id: "methods-create-body-input", label: "Create body input (Methods library)", page: "/methods" },
  { id: "methods-create-category-input", label: "Create category input (Methods library)", page: "/methods" },
  { id: "methods-create-form", label: "Create form (Methods library)", page: "/methods" },
  { id: "methods-create-name-input", label: "Create name input (Methods library)", page: "/methods" },
  { id: "methods-create-submit", label: "Create submit (Methods library)", page: "/methods" },
  { id: "methods-new-method-button", label: "New method button (Methods library)", page: "/methods" },
  { id: "methods-section-my", label: "Section my (Methods library)", page: "/methods" },
  { id: "methods-section-shared", label: "Section shared (Methods library)", page: "/methods" },
  { id: "methods-template-library-button", label: "Template library button (Methods library)", page: "/methods" },
  { id: "methods-type-picker", label: "Type picker (Methods library)", page: "/methods" },
  { id: "purchases-form", label: "Form (Purchases)", page: "/purchases" },
  { id: "purchases-form-category", label: "Form category (Purchases)", page: "/purchases" },
  { id: "purchases-form-funding", label: "Form funding (Purchases)", page: "/purchases" },
  { id: "purchases-form-name", label: "Form name (Purchases)", page: "/purchases" },
  { id: "purchases-form-price", label: "Form price (Purchases)", page: "/purchases" },
  { id: "purchases-form-quantity", label: "Form quantity (Purchases)", page: "/purchases" },
  { id: "purchases-form-reorder", label: "Form reorder (Purchases)", page: "/purchases" },
  { id: "purchases-form-submit", label: "Form submit (Purchases)", page: "/purchases" },
  { id: "purchases-form-vendor", label: "Form vendor (Purchases)", page: "/purchases" },
  { id: "purchases-new-button", label: "New button (Purchases)", page: "/purchases" },
  { id: "search-input", label: "Input (Search)", page: "/search" },
  { id: "search-submit", label: "Submit (Search)", page: "/search" },
  { id: "settings-account-type-toggle", label: "Account type toggle (Settings)", page: "/settings" },
  { id: "settings-ai-helper-copy", label: "Ai helper copy (Settings)", page: "/settings" },
  { id: "settings-color-picker", label: "Color picker (Settings)", page: "/settings" },
  { id: "settings-color-picker-clear-secondary", label: "Color picker clear secondary (Settings)", page: "/settings" },
  { id: "settings-folder-section", label: "Folder section (Settings)", page: "/settings" },
  { id: "settings-streak-section", label: "Streak section (Settings)", page: "/settings" },
  { id: "settings-tab-lab", label: "Tab lab (Settings)", page: "/settings" },
  { id: "settings-tab-personal", label: "Tab personal (Settings)", page: "/settings" },
  { id: "user-picker-button", label: "Picker button (Settings)", page: "/settings" },
  { id: "workbench-experiment-name-input", label: "Experiment name input (Workbench)", page: "/workbench" },
  { id: "workbench-experiment-project-select", label: "Experiment project select (Workbench)", page: "/workbench" },
  { id: "workbench-experiment-submit", label: "Experiment submit (Workbench)", page: "/workbench" },
  { id: "workbench-experiments-tab", label: "Experiments tab (Workbench)", page: "/workbench" },
  { id: "workbench-list-add-item-input", label: "List add item input (Workbench)", page: "/workbench" },
  { id: "workbench-list-card-first", label: "List card first (Workbench)", page: "/workbench" },
  { id: "workbench-list-mark-complete", label: "List mark complete (Workbench)", page: "/workbench" },
  { id: "workbench-list-modal-item-add", label: "List modal item add (Workbench)", page: "/workbench" },
  { id: "workbench-list-modal-item-input", label: "List modal item input (Workbench)", page: "/workbench" },
  { id: "workbench-lists-tab", label: "Lists tab (Workbench)", page: "/workbench" },
  { id: "workbench-new-experiment", label: "New experiment (Workbench)", page: "/workbench" },
  { id: "workbench-new-list-button", label: "New list button (Workbench)", page: "/workbench" },
  { id: "workbench-new-note-button", label: "New note button (Workbench)", page: "/workbench" },
  { id: "workbench-notes-tab", label: "Notes tab (Workbench)", page: "/workbench" },
  { id: "workbench-oneonone-tab", label: "1:1 tab (Workbench)", page: "/workbench" },
  { id: "workbench-projects-tab", label: "Projects tab (Workbench)", page: "/workbench" },
  { id: "workbench-shared-experiments", label: "Shared experiments (Workbench)", page: "/workbench" },
];
