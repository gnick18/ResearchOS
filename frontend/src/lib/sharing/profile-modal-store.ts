// Global state for the in-app researcher profile popup.
//
// When a profile is opened from within the app (the avatar menu, a search
// result), it renders as a living popup OVER the current page, with that page
// hazy and blurred behind it, instead of navigating away. This store carries
// which profile is open and the screen point the open was triggered from, so
// the popup can animate in from that point (the Apple-style zoom-from-icon
// effect). The shareable /researchers/[fingerprint] route still exists as the
// standalone fallback for direct links.

import { create } from "zustand";

/** A screen-space point (viewport coordinates) the popup animates out from. */
export interface OpenOrigin {
  x: number;
  y: number;
}

interface ProfileModalState {
  /** The compact fingerprint of the open profile, or null when closed. */
  fingerprint: string | null;
  /** The point the open was triggered from, for the zoom-out animation. */
  origin: OpenOrigin | null;
  open: (fingerprint: string, origin?: OpenOrigin | null) => void;
  close: () => void;
}

export const useProfileModal = create<ProfileModalState>((set) => ({
  fingerprint: null,
  origin: null,
  open: (fingerprint, origin = null) => set({ fingerprint, origin }),
  close: () => set({ fingerprint: null, origin: null }),
}));
