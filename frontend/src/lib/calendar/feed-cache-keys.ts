/**
 * React Query cache-key constants for the external-calendar-feed layer.
 *
 * Kept in a tiny, dependency-free module (no React, no hooks, no
 * file-system imports) so it can be shared by BOTH the client hook
 * (`use-external-events.ts`) and the account-switch handler
 * (`file-system/file-system-context.tsx`) without creating an import
 * cycle. `use-external-events.ts` pulls in `useCurrentUser`, which pulls
 * in `file-system-context.tsx`; importing the prefix straight from the
 * hook into the context would close that loop.
 *
 * Why this matters: external ICS feed events (a user's linked Google /
 * iCloud / Outlook calendars) are strictly personal and must never bleed
 * across an account switch. The switch handler evicts every entry under
 * this prefix on a real user change, and the hook scopes each per-feed
 * query by currentUser, so the two sides need to agree on the exact
 * prefix string. (calendar-privacy fix, 2026-05-29)
 */
export const FEED_EVENTS_PREFIX = "calendar-feed-events";
