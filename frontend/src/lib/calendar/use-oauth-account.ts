"use client";

import { useCallback, useEffect, useState } from "react";
import {
  clearTokens,
  readTokens,
  type OAuthTokens,
} from "./oauth-tokens-store";
import {
  listCalendars as listGoogleCalendars,
  type GoogleCalendarListItem,
} from "./google-client";
import {
  listCalendars as listOutlookCalendars,
  type OutlookCalendarListItem,
} from "./microsoft-client";
import { connectProvider } from "./oauth-connect";

/**
 * Shared hook that powers the Connect-Google and Connect-Outlook cards in
 * the calendar modal. Owns the per-provider token + calendar-list state,
 * plus the connect / disconnect lifecycle. Calendar-feed CRUD stays in
 * the parent so it can de-dupe IDs across providers and reuse colors.
 */

export type OAuthProviderKey = "google" | "outlook";

/** Minimal shape every provider's calendar-list endpoint maps onto. The
 *  underlying API returns extra fields but we don't need them at the UI
 *  layer — the modal only renders a name, color hint, and a couple flags. */
export interface OAuthCalendar {
  id: string;
  name: string;
  /** True for the provider's default / primary calendar (highlighted). */
  primary: boolean;
  /** Provider-suggested color in `#rrggbb` form, used when no other
   *  user-chosen color exists yet. May be null when the provider didn't
   *  hand one back. */
  colorHint: string | null;
  /** Optional access-role label ("reader", etc.); shown as a small chip so
   *  the user can tell a read-only-shared calendar from one they own. */
  accessLabel: string | null;
}

function adaptGoogle(c: GoogleCalendarListItem): OAuthCalendar {
  return {
    id: c.id,
    name: c.summary,
    primary: !!c.primary,
    colorHint: c.backgroundColor ?? null,
    accessLabel: c.accessRole && c.accessRole !== "owner" ? c.accessRole : null,
  };
}

function adaptOutlook(c: OutlookCalendarListItem): OAuthCalendar {
  return {
    id: c.id,
    name: c.name,
    primary: !!c.isDefaultCalendar,
    colorHint: c.hexColor ?? null,
    accessLabel: c.canEdit === false ? "read-only" : null,
  };
}

async function fetchCalendars(
  username: string,
  provider: OAuthProviderKey,
): Promise<OAuthCalendar[]> {
  if (provider === "google") {
    const raw = await listGoogleCalendars(username);
    return raw.map(adaptGoogle);
  }
  const raw = await listOutlookCalendars(username);
  return raw.map(adaptOutlook);
}

export interface UseOAuthAccountResult {
  tokens: OAuthTokens | null;
  calendars: OAuthCalendar[];
  busy: boolean;
  error: string | null;
  /** Open the OAuth popup; persist tokens; pull calendar list. */
  connect: () => Promise<void>;
  /** Clear tokens (caller should also delete feeds tied to this provider). */
  disconnect: () => Promise<void>;
  /** Re-fetch the calendar list — surface after toggling enable/disable
   *  on a feed, for instance, so the UI never gets stale. */
  refresh: () => Promise<void>;
}

export function useOAuthAccount(
  username: string | null,
  provider: OAuthProviderKey,
): UseOAuthAccountResult {
  const [tokens, setTokens] = useState<OAuthTokens | null>(null);
  const [calendars, setCalendars] = useState<OAuthCalendar[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!username) return;
    try {
      const cals = await fetchCalendars(username, provider);
      setCalendars(cals);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Couldn't fetch your ${provider} calendars.`);
    }
  }, [username, provider]);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      const t = await readTokens(username, provider);
      if (cancelled) return;
      setTokens(t);
      if (t) {
        try {
          const cals = await fetchCalendars(username, provider);
          if (!cancelled) setCalendars(cals);
        } catch (err) {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : `Couldn't fetch your ${provider} calendars.`,
            );
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, provider]);

  const connect = useCallback(async () => {
    if (!username) return;
    setBusy(true);
    setError(null);
    try {
      const next = await connectProvider(username, provider);
      setTokens(next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }, [username, provider, refresh]);

  const disconnect = useCallback(async () => {
    if (!username) return;
    setBusy(true);
    try {
      await clearTokens(username, provider);
      setTokens(null);
      setCalendars([]);
    } finally {
      setBusy(false);
    }
  }, [username, provider]);

  return { tokens, calendars, busy, error, connect, disconnect, refresh };
}
