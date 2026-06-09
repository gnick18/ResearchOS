// Open/close store for the Timers popup (Phase 3). The header alarm-clock button
// opens it; the body renders in a LivingPopup over the current page. One line via
// the shared factory so every popup store stays identical.

import { createPopupStore } from "@/lib/ui/create-popup-store";

export const useTimersPopup = createPopupStore();
