import { fileService } from "@/lib/file-system/file-service";

/**
 * Per-user calendar-notification preferences.
 *
 * Stored as `users/{username}/_notification-prefs.json`. Browser-side only —
 * reminders fire via `setTimeout` while a tab is open and the
 * `Notification.permission` is `granted`. No server push, no Service Worker
 * background scheduling (would require a push server we don't run).
 */

const SCHEMA_VERSION = 1;

export interface NotificationPrefs {
  version: number;
  /** Master switch. */
  enabled: boolean;
  /** Minutes before event start to fire the reminder (e.g. 15). */
  offsetMinutes: number;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  version: SCHEMA_VERSION,
  enabled: false,
  offsetMinutes: 15,
};

/** The offsets surfaced in the settings UI. */
export const OFFSET_CHOICES: Array<{ value: number; label: string }> = [
  { value: 1, label: "1 minute" },
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 1440, label: "1 day" },
];

function prefsPath(username: string): string {
  return `users/${username}/_notification-prefs.json`;
}

export async function readPrefs(username: string): Promise<NotificationPrefs> {
  const data = await fileService.readJson<NotificationPrefs>(prefsPath(username));
  if (!data) return DEFAULT_PREFS;
  return {
    version: data.version ?? SCHEMA_VERSION,
    enabled: !!data.enabled,
    offsetMinutes: typeof data.offsetMinutes === "number" ? data.offsetMinutes : 15,
  };
}

export async function writePrefs(
  username: string,
  prefs: NotificationPrefs
): Promise<void> {
  await fileService.writeJson(prefsPath(username), {
    ...prefs,
    version: SCHEMA_VERSION,
  });
}
