import { create } from "zustand";
import type { ViewMode, HighLevelGoal } from "./types";
import { coerceAnimationType } from "@/components/animations";

export type AnimationType =
  | "celebration"
  | "rock"
  | "space"
  | "underwater"
  | "sports"
  | "science"
  | "plants"
  | "animals"
  | "fungi"
  | "scary"
  // "none" = the user opted out of the per-task celebration entirely.
  // DynamicAnimation renders nothing for it.
  | "none";

export type CalendarViewMode = "month" | "week" | "day";

// Subset of UserSettings that mirrors into in-memory store state. The full
// settings document lives on disk (users/{username}/settings.json) and is
// loaded into here by FileSystemProvider on login.
export interface SettingsHydration {
  animationType: AnimationType;
  viewMode: ViewMode;                  // GANTT default
  calendarViewMode: CalendarViewMode;  // Calendar default
  showShared: boolean;
  visibleTabs: string[];
  defaultLandingTab: string;
  sidebarShowTasks: boolean;
  sidebarShowCalendarEvents: boolean;
  sidebarEventsHorizonDays: number;
  coloredHeader: boolean;
  offlineMode: boolean;
}

interface ConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  lastConnectedAt: number | null;
}

/** The task whose detail popup is currently open. Read imperatively by the
 *  Telegram image router to decide where an inbound photo lands. */
export interface ActiveTask {
  id: number;
  owner: string;
  name: string;
}

/** The note whose detail popup is currently open. Mirrors `ActiveTask` so the
 *  Telegram image router can see "a note is open right now" the same way it
 *  sees "an experiment is open right now". Both can be set simultaneously when
 *  the user has a note popped over a task popup; the bot's first prompt
 *  disambiguates with an A/B picker in that case. */
export interface ActiveNote {
  id: number;
  owner: string;
  title: string;
}

interface AppState extends ConnectionState {
  activeTask: ActiveTask | null;
  setActiveTask: (task: ActiveTask | null) => void;
  /** Which editor tab is visible in the open TaskDetailPopup. Null when no
   *  experiment popup is open. Written by TaskDetailPopup, read by
   *  FocusContextPublisher to include the correct tab in the sealed focus
   *  context it sends to paired phones. */
  activeTaskTab: "notes" | "results" | "other" | null;
  setActiveTaskTab: (tab: "notes" | "results" | "other" | null) => void;
  activeNote: ActiveNote | null;
  setActiveNote: (note: ActiveNote | null) => void;

  // Composite `${owner}:${id}` keys (mirrors taskKey shape in lib/types.ts
  // and the /search-page form-layer fix at ab1548a8). A raw `number[]`
  // collides across owners: alex's project 1 and morgan's project 1 both
  // look like `1`, so both projects' rows leak through whichever the user
  // picked. Pages that filter against this array should reach for
  // `matchesAnyProjectFilter` in lib/search/filterKey.ts rather than
  // calling `.includes(task.project_id)`.
  selectedProjectIds: string[];
  toggleProject: (key: string) => void;
  setSelectedProjects: (keys: string[]) => void;
  /**
   * Project filter mode.
   *  - `"all"`: Gantt shows every active project; the toolbar dropdown renders
   *    every checkbox as checked. `selectedProjectIds` is ignored in this mode.
   *  - `"explicit"`: Gantt shows only the projects whose composite keys appear
   *    in `selectedProjectIds`. An empty `selectedProjectIds` in this mode
   *    means "show nothing", which is the Clear button state.
   *
   * The mode flips to `"explicit"` automatically when the user toggles any
   * single project, so the chip-style "click to scope" gesture still works.
   * The Select all / Clear buttons in the dropdown flip the mode explicitly.
   */
  projectFilterMode: "all" | "explicit";
  setProjectFilterMode: (mode: "all" | "explicit") => void;

  selectedTags: string[];
  toggleTag: (tag: string) => void;

  showShared: boolean;
  setShowShared: (show: boolean) => void;

  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  ganttStartDate: string | null;
  setGanttStartDate: (date: string | null) => void;
  ganttNavigateWeeks: (weeks: number) => void;

  // Composite (owner, id) key — see `taskKey()` in `lib/types.ts`. A raw
  // numeric id is not unique across the shared-with-me aggregator output.
  editingTaskKey: string | null;
  setEditingTaskKey: (key: string | null) => void;
  isCreatingTask: boolean;
  setIsCreatingTask: (v: boolean) => void;
  newTaskStartDate: string | null;
  setNewTaskStartDate: (date: string | null) => void;
  restrictedTaskType: "experiment" | "purchase" | "list" | null;
  setRestrictedTaskType: (type: "experiment" | "purchase" | "list" | null) => void;

  isCreatingGoal: boolean;
  setIsCreatingGoal: (v: boolean) => void;
  editingGoal: HighLevelGoal | null;
  setEditingGoal: (goal: HighLevelGoal | null) => void;

  bulkMoveData: {
    taskId: number;
    newStartDate: string;
    affectedCount: number;
    warnings: string[];
  } | null;
  setBulkMoveData: (data: AppState["bulkMoveData"]) => void;

  animationType: AnimationType;
  setAnimationType: (type: AnimationType) => void;

  calendarViewMode: CalendarViewMode;
  setCalendarViewMode: (mode: CalendarViewMode) => void;

  visibleTabs: string[];
  setVisibleTabs: (tabs: string[]) => void;

  defaultLandingTab: string;
  setDefaultLandingTab: (href: string) => void;

  sidebarShowTasks: boolean;
  setSidebarShowTasks: (v: boolean) => void;

  sidebarShowCalendarEvents: boolean;
  setSidebarShowCalendarEvents: (v: boolean) => void;

  sidebarEventsHorizonDays: number;
  setSidebarEventsHorizonDays: (days: number) => void;

  coloredHeader: boolean;
  setColoredHeader: (v: boolean) => void;

  offlineMode: boolean;
  setOfflineMode: (v: boolean) => void;

  hydrateFromSettings: (s: SettingsHydration) => void;
  resetSettingsToDefaults: () => void;

  ganttLoading: boolean;
  ganttLoadingMessage: string;
  setGanttLoading: (loading: boolean, message?: string) => void;

  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setConnectionError: (error: string | null) => void;
}

// Default tab list mirrors NAV_ITEMS in lib/nav.ts. Kept inline (instead of
// importing) to avoid a circular load between store and nav consumers.
const DEFAULT_VISIBLE_TABS = [
  "/",
  "/workbench",
  "/gantt",
  "/methods",
  "/purchases",
  "/calendar",
  "/search",
  "/links",
];

export const useAppStore = create<AppState>()((set) => ({
  isConnected: false,
  isConnecting: false,
  connectionError: null,
  lastConnectedAt: null,

  activeTask: null,
  setActiveTask: (task) => set({ activeTask: task }),
  activeTaskTab: null,
  setActiveTaskTab: (tab) => set({ activeTaskTab: tab }),
  activeNote: null,
  setActiveNote: (note) => set({ activeNote: note }),

  setConnected: (connected) =>
    set({
      isConnected: connected,
      lastConnectedAt: connected ? Date.now() : null,
    }),
  setConnecting: (connecting) => set({ isConnecting: connecting }),
  setConnectionError: (error) => set({ connectionError: error }),

  selectedProjectIds: [],
  // Clicking a single project flips the filter into "explicit" mode so the
  // user gets the "scope to this one" gesture in one click from the all-checked
  // default. The toolbar passes the FULL set of currently-visible project keys
  // through `toggleProject` via the wrapped onClick handler so the explicit
  // array is correctly seeded with the intended new selection.
  toggleProject: (key) =>
    set((s) => {
      if (s.projectFilterMode === "all") {
        // Coming from the implicit-all state: clicking a row scopes to just
        // that project, matching the chip-row pattern from before the
        // dropdown landed.
        return {
          projectFilterMode: "explicit",
          selectedProjectIds: [key],
        };
      }
      return {
        selectedProjectIds: s.selectedProjectIds.includes(key)
          ? s.selectedProjectIds.filter((k) => k !== key)
          : [...s.selectedProjectIds, key],
      };
    }),
  setSelectedProjects: (keys) => set({ selectedProjectIds: keys }),
  projectFilterMode: "all",
  setProjectFilterMode: (mode) =>
    set((s) =>
      mode === "all"
        ? { projectFilterMode: "all", selectedProjectIds: [] }
        : { projectFilterMode: "explicit", selectedProjectIds: s.selectedProjectIds },
    ),

  selectedTags: [],
  toggleTag: (tag) =>
    set((s) => ({
      selectedTags: s.selectedTags.includes(tag)
        ? s.selectedTags.filter((t) => t !== tag)
        : [...s.selectedTags, tag],
    })),

  showShared: true,
  setShowShared: (show) => set({ showShared: show }),

  viewMode: "2week",
  setViewMode: (mode) => set({ viewMode: mode }),

  ganttStartDate: null,
  setGanttStartDate: (date) => set({ ganttStartDate: date }),
  ganttNavigateWeeks: (weeks) =>
    set((s) => {
      if (!s.ganttStartDate) {
        const today = new Date();
        const monday = new Date(today);
        monday.setDate(today.getDate() - today.getDay() + 1);
        monday.setDate(monday.getDate() + weeks * 7);
        return {
          ganttStartDate: monday.toISOString().split("T")[0],
        };
      }
      const current = new Date(s.ganttStartDate);
      current.setDate(current.getDate() + weeks * 7);
      return {
        ganttStartDate: current.toISOString().split("T")[0],
      };
    }),

  editingTaskKey: null,
  setEditingTaskKey: (key) => set({ editingTaskKey: key }),
  isCreatingTask: false,
  setIsCreatingTask: (v) => set({ isCreatingTask: v }),
  newTaskStartDate: null,
  setNewTaskStartDate: (date) => set({ newTaskStartDate: date }),
  restrictedTaskType: null,
  setRestrictedTaskType: (type) => set({ restrictedTaskType: type }),

  isCreatingGoal: false,
  setIsCreatingGoal: (v) => set({ isCreatingGoal: v }),
  editingGoal: null,
  setEditingGoal: (goal) => set({ editingGoal: goal }),

  bulkMoveData: null,
  setBulkMoveData: (data) => set({ bulkMoveData: data }),

  animationType: "rock",
  setAnimationType: (type) => set({ animationType: type }),

  calendarViewMode: "month",
  setCalendarViewMode: (mode) => set({ calendarViewMode: mode }),

  visibleTabs: DEFAULT_VISIBLE_TABS,
  setVisibleTabs: (tabs) => set({ visibleTabs: tabs }),

  defaultLandingTab: "/",
  setDefaultLandingTab: (href) => set({ defaultLandingTab: href }),

  sidebarShowTasks: true,
  setSidebarShowTasks: (v) => set({ sidebarShowTasks: v }),

  sidebarShowCalendarEvents: false,
  setSidebarShowCalendarEvents: (v) => set({ sidebarShowCalendarEvents: v }),

  sidebarEventsHorizonDays: 7,
  setSidebarEventsHorizonDays: (days) => set({ sidebarEventsHorizonDays: days }),

  coloredHeader: true,
  setColoredHeader: (v) => set({ coloredHeader: v }),

  offlineMode: false,
  setOfflineMode: (v) => set({ offlineMode: v }),

  hydrateFromSettings: (s) =>
    set({
      // Coerce so a stale stored value (e.g. the retired "beakerbot")
      // falls back to the default "rock" rather than wedging consumers
      // that look up ANIMATION_METADATA[animationType].
      animationType: coerceAnimationType(s.animationType),
      viewMode: s.viewMode,
      calendarViewMode: s.calendarViewMode,
      showShared: s.showShared,
      visibleTabs: s.visibleTabs,
      defaultLandingTab: s.defaultLandingTab,
      sidebarShowTasks: s.sidebarShowTasks,
      sidebarShowCalendarEvents: s.sidebarShowCalendarEvents,
      sidebarEventsHorizonDays: s.sidebarEventsHorizonDays,
      coloredHeader: s.coloredHeader,
      offlineMode: s.offlineMode,
    }),

  resetSettingsToDefaults: () =>
    set({
      animationType: "rock",
      viewMode: "2week",
      calendarViewMode: "month",
      showShared: true,
      visibleTabs: DEFAULT_VISIBLE_TABS,
      defaultLandingTab: "/",
      sidebarShowTasks: true,
      sidebarShowCalendarEvents: false,
      sidebarEventsHorizonDays: 7,
      coloredHeader: true,
      offlineMode: false,
    }),

  ganttLoading: false,
  ganttLoadingMessage: "",
  setGanttLoading: (loading, message = "") =>
    set({ ganttLoading: loading, ganttLoadingMessage: message }),
}));

/** Read the legacy localStorage settings blob (Zustand persist format) and
 *  return any animation choice from it. Used once during migration when a
 *  user has no settings.json yet. Coerces stale values (e.g. "beakerbot"
 *  before it was retired) to the default. */
export function readLegacyLocalStorageSettings(): { animationType?: AnimationType } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("research-os-settings");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { animationType?: unknown } };
    const state = parsed?.state;
    if (!state) return null;
    return { animationType: coerceAnimationType(state.animationType) };
  } catch {
    return null;
  }
}
