// Open/close store for the in-app Profile settings popup. The avatar-menu
// "Profile settings" entry opens it; the body renders in a LivingPopup over the
// current page (the /profile route stays as a direct-link fallback). One line
// via the shared factory so every popup store stays identical.

import { createPopupStore } from "@/lib/ui/create-popup-store";

export const useProfileSettingsModal = createPopupStore();
