"use client";

import { useEventReminders } from "@/lib/calendar/use-event-reminders";

/**
 * Invisible component mounted in AppShell that schedules calendar event
 * reminder timers for the current user across every page (not just the
 * /calendar route). Renders nothing.
 */
export default function ReminderRunner() {
  useEventReminders();
  return null;
}
