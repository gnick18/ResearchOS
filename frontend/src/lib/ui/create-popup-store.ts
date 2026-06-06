// Factory for a "living popup" open/close store.
//
// Every global popup that opens OVER the current page (Profile settings,
// Settings, ...) needs the same tiny state: is it open, and the screen point the
// open was triggered from (so the card can zoom out of / back to that icon).
// Rather than copy that zustand store per feature, each feature is one line:
//
//   export const useSettingsModal = createPopupStore();
//
// The store is then handed to <LivingPopup open={s.isOpen} origin={s.origin}
// onClose={s.close} />. Triggers call `open({ x, y })` with the click point.

import { create } from "zustand";

/** A screen-space point (viewport coordinates) the popup animates out from. */
export interface OpenOrigin {
  x: number;
  y: number;
}

export interface PopupStore {
  /** True while the popup is open. */
  isOpen: boolean;
  /** The point the open was triggered from, for the zoom animation. */
  origin: OpenOrigin | null;
  open: (origin?: OpenOrigin | null) => void;
  close: () => void;
}

/** Creates a fresh, independent living-popup store (one per feature). */
export function createPopupStore() {
  return create<PopupStore>((set) => ({
    isOpen: false,
    origin: null,
    open: (origin = null) => set({ isOpen: true, origin }),
    close: () => set({ isOpen: false, origin: null }),
  }));
}
