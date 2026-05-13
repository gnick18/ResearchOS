import { create } from "zustand";
import type { CalendarView } from "@/components/calendar/utils";

/**
 * Cross-component nav for the calendar page.
 *
 * The sidebar lives in AppShell while view/date state lives on the calendar
 * page. When the sidebar wants to jump the main view (e.g. clicking an
 * upcoming event), it sets `pendingJump`; the calendar page subscribes,
 * applies the jump to its local state, and calls `clearJump`.
 */
interface CalendarNavState {
  pendingJump: { view: CalendarView; dateStr: string } | null;
  jumpTo: (view: CalendarView, dateStr: string) => void;
  clearJump: () => void;
}

export const useCalendarNavStore = create<CalendarNavState>((set) => ({
  pendingJump: null,
  jumpTo: (view, dateStr) => set({ pendingJump: { view, dateStr } }),
  clearJump: () => set({ pendingJump: null }),
}));
