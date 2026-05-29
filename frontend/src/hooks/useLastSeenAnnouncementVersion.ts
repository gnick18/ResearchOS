"use client";

import { useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";

/**
 * Read the active user's `settings.lastSeenAnnouncementVersion` (whats-new
 * bot). Mirrors `useBeakerBotAnimations`: reads on mount / username
 * change, then subscribes to `onUserSettingsWritten` so a dismiss (which
 * patches the field) propagates live without a route change.
 *
 * The returned value is a small discriminated object rather than a bare
 * string because the WhatsNewManager has to distinguish three states:
 *
 *   - `{ status: "loading" }` — the disk read is in flight (or right after
 *     a username change). The manager holds off any decision so a slow
 *     read never flash-fires the popup.
 *   - `{ status: "ready", lastSeen: null }` — read resolved, but the user
 *     has NEVER recorded a version (brand-new account, or a pre-feature
 *     account on its first load). The manager records the current version
 *     SILENTLY and does NOT show the popup.
 *   - `{ status: "ready", lastSeen: "x.y.z" }` — read resolved to a stored
 *     version. The manager shows the popup iff there are newer releases.
 *
 * `null` username (signed out / picker screen) resolves to `loading` and
 * the manager renders nothing.
 */
export type LastSeenAnnouncement =
  | { status: "loading" }
  | { status: "ready"; lastSeen: string | null };

export function useLastSeenAnnouncementVersion(
  username: string | null,
): LastSeenAnnouncement {
  const [state, setState] = useState<LastSeenAnnouncement>({
    status: "loading",
  });

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: reset to loading, no I/O involved.
      setState({ status: "loading" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) {
          setState({
            status: "ready",
            lastSeen: settings.lastSeenAnnouncementVersion ?? null,
          });
        }
      } catch (err) {
        // On a failed read, treat as "nothing recorded": the manager will
        // silently record the current version and stay quiet, which is the
        // safe non-spammy default.
        console.warn(
          "[useLastSeenAnnouncementVersion] readUserSettings failed",
          err,
        );
        if (!cancelled) setState({ status: "ready", lastSeen: null });
      }
    })();

    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      setState({
        status: "ready",
        lastSeen: event.next.lastSeenAnnouncementVersion ?? null,
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  return state;
}
