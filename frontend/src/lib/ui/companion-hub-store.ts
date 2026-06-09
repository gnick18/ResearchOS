// Open/close store for the Companion hub popup. The header Companion button
// opens it; the body renders in a LivingPopup over the current page. One line
// via the shared factory so every popup store stays identical.

import { createPopupStore } from "@/lib/ui/create-popup-store";

export const useCompanionHub = createPopupStore();
