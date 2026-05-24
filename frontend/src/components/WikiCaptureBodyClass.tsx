"use client";

import { useEffect } from "react";
import {
  isForceControlsMode,
  isUnlockSessionMode,
} from "@/lib/file-system/wiki-capture-mock";
import {
  getEditSession,
  startEditSession,
  resetEditSession,
} from "@/lib/lab/edit-session";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Wiki-screenshot fixture infrastructure (screenshot fixture infra
 * manager, 2026-05-24).
 *
 * Mounted once at the app root inside `<Providers>`. Two responsibilities,
 * both strictly gated to `?wikiCapture=…` mode (no real-data path):
 *
 *   1. `?forceControls=1` -> add the `force-hover-controls` class to
 *      `<body>` so CSS that hides controls behind `:hover` can also
 *      reveal them when this ancestor class is present. Static
 *      screenshot tools (Playwright, Puppeteer) can't fire `:hover`
 *      without a real cursor, so otherwise-hidden hover-only controls
 *      stay invisible in capture mode. Scoped CSS lives next to each
 *      hover rule (today: LabRoster).
 *
 *   2. `?unlockSession=1` -> synthesize an unlocked lab-head edit
 *      session for the active fixture user so the announcements
 *      composer, LabRoster archive controls, and any other
 *      `useEditSession`-gated surface renders in the post-unlock state
 *      for screenshot capture.
 *
 * Both flags require `isWikiCaptureMode()` to be true; the helpers in
 * `wiki-capture-mock.ts` already enforce that gate, so this component
 * is a no-op outside the fixture.
 */
export default function WikiCaptureBodyClass() {
  const { currentUser } = useCurrentUser();

  // Body class for force-hover-controls.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isForceControlsMode()) return;
    document.body.classList.add("force-hover-controls");
    return () => {
      document.body.classList.remove("force-hover-controls");
    };
  }, []);

  // Synthesize an unlocked edit session for the active fixture user.
  // Re-runs when currentUser changes so a fixture-mode user switch
  // (e.g. capture script switches from alex to mira) lands with a
  // freshly-unlocked session for the new user.
  useEffect(() => {
    if (!isUnlockSessionMode()) return;
    if (!currentUser) return;
    const snap = getEditSession();
    if (snap.state === "unlocked" && snap.active?.username === currentUser) {
      // Already unlocked for the right user; nothing to do.
      return;
    }
    startEditSession(currentUser);
    return () => {
      // Best-effort cleanup if the flag flips off mid-session. In
      // practice the flag is sticky until tab close, so the cleanup
      // mostly runs only on currentUser change.
      resetEditSession();
    };
  }, [currentUser]);

  return null;
}
