// Global open/close state for the consolidated Telegram popup.
//
// The header icon opens it, but Settings and onboarding can open it too, so the
// open/close lives in a tiny store (mirroring profile-modal-store). The origin
// point lets the popup animate in from the icon it was opened from.

import { create } from "zustand";

/** A screen-space point (viewport coordinates) the popup animates out from. */
export interface OpenOrigin {
  x: number;
  y: number;
}

interface TelegramPopupState {
  open: boolean;
  origin: OpenOrigin | null;
  openPopup: (origin?: OpenOrigin | null) => void;
  close: () => void;
}

export const useTelegramPopup = create<TelegramPopupState>((set) => ({
  open: false,
  origin: null,
  openPopup: (origin = null) => set({ open: true, origin }),
  close: () => set({ open: false, origin: null }),
}));
