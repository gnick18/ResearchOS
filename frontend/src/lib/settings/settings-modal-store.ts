// Global state for the in-app Settings popup.
//
// "Settings" (from the avatar menu) opens the settings body as a living popup
// OVER the current page, with that page hazy/blurred behind it and an
// Apple-style zoom-from-the-clicked-icon animation, the same treatment as the
// Profile settings + public-profile popups. The /settings route still exists as
// a direct-link fallback. This store carries whether the popup is open and the
// screen point the open was triggered from.

import { create } from "zustand";

/** A screen-space point (viewport coordinates) the popup animates out from. */
export interface OpenOrigin {
  x: number;
  y: number;
}

interface SettingsModalState {
  /** True while the Settings popup is open. */
  isOpen: boolean;
  /** The point the open was triggered from, for the zoom animation. */
  origin: OpenOrigin | null;
  open: (origin?: OpenOrigin | null) => void;
  close: () => void;
}

export const useSettingsModal = create<SettingsModalState>((set) => ({
  isOpen: false,
  origin: null,
  open: (origin = null) => set({ isOpen: true, origin }),
  close: () => set({ isOpen: false, origin: null }),
}));
