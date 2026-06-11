// Open/closed store for the app-wide BeakerBot docked panel (ai docking bot,
// 2026-06-11).
//
// BeakerBot is mounted ONCE at the AppShell level so its conversation state (in
// useAiChat, which lives inside BeakerBotPanel) survives client-side route
// changes. The panel must stay mounted across navigation, so its open/closed
// state cannot live in per-route component state. This tiny zustand store holds
// that flag, read by the always-mounted panel and toggled by the summon button.
//
// Conversation persistence note, the panel stays mounted whether open or closed
// (it is hidden with a transform when closed, not unmounted), so the messages and
// loop history in useAiChat are never torn down. This is what lets
// spotlight_ui_element navigate the user from one page to another while the chat
// they were reading stays exactly where it was.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { create } from "zustand";

interface BeakerBotPanelStore {
  /** True while the docked panel is open (expanded). */
  isOpen: boolean;
  /** Open the panel. */
  open: () => void;
  /** Close (collapse) the panel. The panel stays mounted, so the conversation
   *  is preserved for the next open. */
  close: () => void;
  /** Toggle open/closed. The summon button calls this. */
  toggle: () => void;
}

export const useBeakerBotPanel = create<BeakerBotPanelStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
