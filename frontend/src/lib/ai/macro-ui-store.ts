// Macro UI store (BeakerAI lane, 2026-06-13).
//
// A tiny shared store so the two macro surfaces stay in sync without prop
// drilling across the palette layout. The chat rail (manager) and the
// conversation ("Save as macro") both open the SAME editor through here, and both
// re-read their macro lists when a macro is created, edited, duplicated, or
// deleted (the `revision` counter). The editor sheet itself is rendered once,
// inside BeakerBotConversation, driven by `editorTarget`.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { create } from "zustand";
import type { MacroStep } from "@/lib/ai/beaker-macros-store";

// What the editor opens with. `macroId` present means edit an existing macro,
// absent means create a new one (from a capture or from scratch).
export type MacroEditorTarget = {
  macroId?: number;
  name: string;
  description: string;
  steps: MacroStep[];
};

type MacroUiState = {
  /** The macro editor target, or null when the editor is closed. */
  editorTarget: MacroEditorTarget | null;
  /** Bumped on any macro write so list surfaces re-fetch. */
  revision: number;
  openEditor: (target: MacroEditorTarget) => void;
  closeEditor: () => void;
  /** Call after a create / save / duplicate / delete so lists refresh. */
  notifyMacrosChanged: () => void;
};

export const useMacroUiStore = create<MacroUiState>((set) => ({
  editorTarget: null,
  revision: 0,
  openEditor: (target) => set({ editorTarget: target }),
  closeEditor: () => set({ editorTarget: null }),
  notifyMacrosChanged: () => set((s) => ({ revision: s.revision + 1 })),
}));
