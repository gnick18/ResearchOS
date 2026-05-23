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
