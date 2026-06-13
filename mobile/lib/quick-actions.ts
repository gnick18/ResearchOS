/**
 * Home-screen quick actions (long-press the app icon) for fast capture.
 *
 * Three shortcuts, registered at runtime so we need no per-platform static icon
 * assets:
 *   - Quick photo  -> the scan / capture screen (/scan)
 *   - Quick note   -> a new note (/note)
 *   - Start timer  -> the timers tab (/(tabs)/timers)
 *
 * We register them with setItems() on startup, expose the route map, and resolve
 * an Action to a route. Both the initial action (cold start) and the runtime
 * listener are wired in app/_layout.tsx. Everything is guarded so a missing
 * native module (web, an odd Expo Go build) never crashes anything.
 *
 * Icons use the library's built-in Apple system icon names on iOS; Android shows
 * the title without a glyph unless static assets are bundled. No emojis.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import type { Href } from 'expo-router';

// Loaded lazily and guarded so a missing native module never breaks startup.
let QuickActions: typeof import('expo-quick-actions') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  QuickActions = require('expo-quick-actions');
} catch {
  QuickActions = null;
}

// Stable action ids; the route map keys off these so the contract is explicit.
export const QUICK_ACTION_PHOTO = 'quick_photo';
export const QUICK_ACTION_NOTE = 'quick_note';
export const QUICK_ACTION_TIMER = 'quick_timer';

// id -> route. Kept in one place so the listener and the initial-action handler
// route identically.
const ROUTE_BY_ID: Record<string, Href> = {
  [QUICK_ACTION_PHOTO]: '/scan',
  [QUICK_ACTION_NOTE]: '/note',
  [QUICK_ACTION_TIMER]: '/(tabs)/timers',
};

/** Resolve a quick action to its route, or null if unknown. */
export function routeForQuickAction(action: { id?: string } | null | undefined): Href | null {
  if (!action?.id) return null;
  return ROUTE_BY_ID[action.id] ?? null;
}

/**
 * Register the three shortcuts on the app icon. Best-effort and idempotent, safe
 * to call on every startup. Uses built-in Apple icon names where supported.
 */
export async function registerQuickActions(): Promise<void> {
  if (!QuickActions) return;
  try {
    await QuickActions.setItems([
      {
        id: QUICK_ACTION_PHOTO,
        title: 'Quick photo',
        subtitle: 'Scan a page or capture an image',
        icon: 'capturePhoto',
      },
      {
        id: QUICK_ACTION_NOTE,
        title: 'Quick note',
        subtitle: 'Jot a bench note',
        icon: 'compose',
      },
      {
        id: QUICK_ACTION_TIMER,
        title: 'Start timer',
        subtitle: 'Open the lab timers',
        icon: 'time',
      },
    ]);
  } catch {
    // Unsupported platform or transient failure, the app works without shortcuts.
  }
}

/** The action that cold-started the app, if any. */
export function getInitialQuickAction(): { id?: string } | undefined {
  if (!QuickActions) return undefined;
  try {
    return QuickActions.initial ?? undefined;
  } catch {
    return undefined;
  }
}

/** Subscribe to quick actions chosen while the app is already running. */
export function addQuickActionListener(
  cb: (action: { id?: string }) => void,
): { remove: () => void } {
  if (!QuickActions) return { remove: () => {} };
  try {
    return QuickActions.addListener(cb);
  } catch {
    return { remove: () => {} };
  }
}
