"use client";

import { useEffect, useState } from "react";
import {
  getEditSession,
  subscribeEditSession,
} from "@/lib/lab/edit-session";

/**
 * React subscription to the module-scoped lab-head edit session
 * (Lab Head Phase 5 — `lab head Phase 5 manager`, 2026-05-23).
 *
 * The session itself lives at module scope in `@/lib/lab/edit-session`
 * so route changes don't clobber it (decision #4 — survives nav). This
 * hook is a thin React adaptor that subscribes once on mount and emits
 * the snapshot on every tick.
 *
 * Consumers:
 *   - Popups (`TaskDetailPopup`, `NoteDetailPopup`, `PurchaseEditor`)
 *     gate write inputs behind `state === "unlocked"` and render the
 *     "Request edit" button when locked.
 *   - The timer banner reads `remainingMs` + formats via
 *     `formatRemaining`.
 *   - Settings → Lab Head reads `state` + `active` for the "Active
 *     session" status indicator.
 */
export function useEditSession() {
  const [snapshot, setSnapshot] = useState(getEditSession);

  useEffect(() => {
    return subscribeEditSession(setSnapshot);
  }, []);

  return snapshot;
}

/**
 * Derived, page-agnostic reader for the live edit session, for surfaces that
 * need to gate a privileged lab-head action without a Lab-Overview parent to
 * prop-drill the session id (e.g. the Purchases BeakerSearch "Approve this
 * purchase" command). Reads the same module singleton as `useEditSession`, so
 * any page reads it reactively.
 *
 * Returns the canonical liveness shape so consumers never re-derive it (and so
 * none of them check the wrong field):
 *   - `isLive`     true only while a session is unlocked (not idle/locked/expired).
 *   - `sessionId`  the live session id to hand to a gated pi-action, else null.
 *   - `username`   the lab head who unlocked, else null.
 *
 * SECURITY NOTE. This is a READ-side convenience only. The gate still lives in
 * `pi-actions.ts` (`assertLiveSession`), so a stale or spoofed `sessionId` is
 * rejected server-side regardless of what a palette renders. Surfaces must NOT
 * auto-unlock the session from a command; unlocking stays the deliberate,
 * password-gated step in `startEditSession`.
 */
export function useLiveEditSession(): {
  isLive: boolean;
  sessionId: string | null;
  username: string | null;
} {
  const snapshot = useEditSession();
  const isLive = snapshot.state === "unlocked" && snapshot.active !== null;
  return {
    isLive,
    sessionId: isLive ? snapshot.active!.id : null,
    username: isLive ? snapshot.active!.username : null,
  };
}
