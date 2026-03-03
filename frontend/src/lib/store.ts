import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewMode, HighLevelGoal } from "./types";

// Animation types available for selection
export type AnimationType = 
  | "celebration"  // Confetti, unicorns, rainbows
  | "rock"         // Guitars, lightning, skulls
  | "space"        // Stars, planets, rockets, aliens
  | "underwater"   // Fish, bubbles, jellyfish, coral
  | "sports"       // Balls, trophies, whistles, medals
  | "science"      // Atoms, DNA, beakers, molecules
  | "plants"       // Flowers, leaves, seeds, trees
  | "animals"      // Paw prints, feathers, birds, butterflies
  | "fungi"        // Mushrooms, spores, mycelium
  | "scary";       // Skulls, vampires, monsters, ghosts

interface AppState {
  // Selected projects for filtering
  selectedProjectIds: number[];
  toggleProject: (id: number) => void;
  setSelectedProjects: (ids: number[]) => void;

  // Selected tags for filtering
  selectedTags: string[];
  toggleTag: (tag: string) => void;

  // GANTT view mode
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  // GANTT start date (a Monday, or null to use current week)
  ganttStartDate: string | null;
  setGanttStartDate: (date: string | null) => void;
  // Navigate forward/backward by weeks
  ganttNavigateWeeks: (weeks: number) => void;

  // Task creation/edit modal
  editingTaskId: number | null;
  setEditingTaskId: (id: number | null) => void;
  isCreatingTask: boolean;
  setIsCreatingTask: (v: boolean) => void;
  newTaskStartDate: string | null;
  setNewTaskStartDate: (date: string | null) => void;
  // Restrict task type (e.g., only "experiment" from experiments page)
  restrictedTaskType: "experiment" | "purchase" | "list" | null;
  setRestrictedTaskType: (type: "experiment" | "purchase" | "list" | null) => void;

  // High-level goal creation/edit modal
  isCreatingGoal: boolean;
  setIsCreatingGoal: (v: boolean) => void;
  editingGoal: HighLevelGoal | null;
  setEditingGoal: (goal: HighLevelGoal | null) => void;

  // Bulk move confirmation
  bulkMoveData: {
    taskId: number;
    newStartDate: string;
    affectedCount: number;
    warnings: string[];
  } | null;
  setBulkMoveData: (data: AppState["bulkMoveData"]) => void;

  // Animation settings (single type for all animations)
  animationType: AnimationType;
  setAnimationType: (type: AnimationType) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
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

      viewMode: "2week",
      setViewMode: (mode) => set({ viewMode: mode }),

      ganttStartDate: null,
      setGanttStartDate: (date) => set({ ganttStartDate: date }),
      ganttNavigateWeeks: (weeks) =>
        set((s) => {
          if (!s.ganttStartDate) {
            // If no custom start date, start from current week's Monday
            const today = new Date();
            const monday = new Date(today);
            monday.setDate(today.getDate() - today.getDay() + 1);
            monday.setDate(monday.getDate() + weeks * 7);
            return {
              ganttStartDate: monday.toISOString().split("T")[0],
            };
          }
          // Navigate from current start date
          const current = new Date(s.ganttStartDate);
          current.setDate(current.getDate() + weeks * 7);
          return {
            ganttStartDate: current.toISOString().split("T")[0],
          };
        }),

      editingTaskId: null,
      setEditingTaskId: (id) => set({ editingTaskId: id }),
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

      // Animation setting (single type with default)
      animationType: "rock",
      setAnimationType: (type) => set({ animationType: type }),
    }),
    {
      name: "research-os-settings",
      partialize: (state) => ({
        animationType: state.animationType,
      }),
    }
  )
);
