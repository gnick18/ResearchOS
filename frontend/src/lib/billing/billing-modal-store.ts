// The open/close store for the consolidated billing popup (Cloud storage &
// billing). One living popup owns every billing surface, solo and lab, so it is
// reached from a single launcher rather than scattered across Settings.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { createPopupStore } from "@/lib/ui/create-popup-store";

export const useBillingModal = createPopupStore();
