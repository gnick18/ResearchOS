import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewMode, HighLevelGoal } from "./types";

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
  | "scary";

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

interface AppState extends ConnectionState {
  activeTask: ActiveTask | null;
  setActiveTask: (task: ActiveTask | null) => void;

  selectedProjectIds: number[];
  toggleProject: (id: number) => void;
  setSelectedProjects: (ids: number[]) => void;

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

  ganttLoading: boolean;
  ganttLoadingMessage: string;
  setGanttLoading: (loading: boolean, message?: string) => void;

  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setConnectionError: (error: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      isConnected: false,
      isConnecting: false,
      connectionError: null,
      lastConnectedAt: null,

      activeTask: null,
      setActiveTask: (task) => set({ activeTask: task }),

      setConnected: (connected) => set({
        isConnected: connected, 
        lastConnectedAt: connected ? Date.now() : null 
      }),
      setConnecting: (connecting) => set({ isConnecting: connecting }),
      setConnectionError: (error) => set({ connectionError: error }),

      selectedProjectIds: [],
      toggleProject: (id) =>
        set((s) => ({
          selectedProjectIds: s.selectedProjectIds.includes(id)
            ? s.selectedProjectIds.filter((pid) => pid !== id)
            : [...s.selectedProjectIds, id],
        })),
      setSelectedProjects: (ids) => set({ selectedProjectIds: ids }),

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

      ganttLoading: false,
      ganttLoadingMessage: "",
      setGanttLoading: (loading, message = "") => set({ ganttLoading: loading, ganttLoadingMessage: message }),
    }),
    {
      name: "research-os-settings",
      partialize: (state) => ({
        animationType: state.animationType,
      }),
    }
  )
);
