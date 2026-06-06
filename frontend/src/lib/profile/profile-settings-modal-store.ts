// Global state for the in-app Profile settings popup.
//
// "Profile settings" used to navigate to the /profile route (a full screen
// swap). It now opens as a living popup OVER the current page, with that page
// hazy and blurred behind it, and an Apple-style zoom-from-the-clicked-icon
// animation, the same treatment as the public-profile popup
// (profile-modal-store). The /profile route still exists as a direct-link
// fallback. This store carries whether the popup is open and the screen point
// the open was triggered from so the popup can grow out of / collapse back to it.

import { create } from "zustand";

/** A screen-space point (viewport coordinates) the popup animates out from. */
export interface OpenOrigin {
  x: number;
  y: number;
}

interface ProfileSettingsModalState {
  /** True while the Profile settings popup is open. */
  isOpen: boolean;
  /** The point the open was triggered from, for the zoom animation. */
  origin: OpenOrigin | null;
  open: (origin?: OpenOrigin | null) => void;
  close: () => void;
}

export const useProfileSettingsModal = create<ProfileSettingsModalState>(
  (set) => ({
    isOpen: false,
    origin: null,
    open: (origin = null) => set({ isOpen: true, origin }),
    close: () => set({ isOpen: false, origin: null }),
  }),
);
