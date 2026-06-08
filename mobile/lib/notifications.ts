// Local notification helpers for lab timers. Fully on-device, no network. The
// OS banner that fires when a timer finishes is a bonus on top of the in-app
// live countdown, so every function here fails soft. If the notifications
// module is unavailable (some Expo Go edge), or permission is denied, the
// callers still get a working timer, they just lose the background alert.
//
// SDK 54 expo-notifications APIs used here (per the v54 docs):
//   - requestPermissionsAsync(): asks for the OS grant, returns a status object.
//   - scheduleNotificationAsync({ content, trigger }) with a timeInterval
//     trigger { type: SchedulableTriggerInputTypes.TIME_INTERVAL, seconds,
//     repeats: false } to fire N seconds from now. Returns the scheduled id.
//   - cancelScheduledNotificationAsync(id): drops a pending notification.
// Local scheduled notifications DO fire in Expo Go on SDK 54 (only remote push
// requires a development build), so this works in Expo Go.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

// Loaded lazily and guarded so a missing native module never crashes a screen.
// The module is required up front but wrapped, since on web or an odd Expo Go
// build the import could be unavailable.
let Notifications: typeof import('expo-notifications') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch {
  Notifications = null;
}

// Ask for the OS notification grant. Returns true when granted. Safe to call
// repeatedly, the OS only prompts the first time. Returns false (never throws)
// when the module is unavailable.
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (existing.canAskAgain === false) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

// Schedule a one-shot notification to fire fireInSeconds from now. Returns the
// scheduled notification id, or null when permission is missing, the module is
// unavailable, or scheduling fails. A null return is the signal that the OS
// alert will not arrive, the in-app timer carries on regardless.
export async function scheduleTimerNotification(
  label: string,
  fireInSeconds: number,
): Promise<string | null> {
  if (!Notifications) return null;
  if (fireInSeconds <= 0) return null;
  const granted = await ensureNotificationPermission();
  if (!granted) return null;
  try {
    const title = label.trim().length > 0 ? label.trim() : 'Lab timer';
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: 'Timer finished.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(fireInSeconds),
        repeats: false,
      },
    });
    return id;
  } catch {
    return null;
  }
}

// Cancel a pending timer notification by id. A no-op when the id is null, the
// module is unavailable, or the notification already fired or was cancelled.
export async function cancelTimerNotification(
  id: string | null | undefined,
): Promise<void> {
  if (!Notifications || !id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already gone or not cancellable, nothing to do.
  }
}
