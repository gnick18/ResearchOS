// Open/close store for the in-app Settings popup. The avatar-menu "Settings"
// entry opens it; the body renders in a LivingPopup over the current page (the
// /settings route stays as a direct-link fallback). One line via the shared
// factory so every popup store stays identical.

import { createPopupStore } from "@/lib/ui/create-popup-store";

export const useSettingsModal = createPopupStore();
