"use client";

import { useEffect } from "react";
import { isForceControlsMode } from "@/lib/file-system/wiki-capture-mock";

/**
 * Wiki-screenshot fixture infrastructure (screenshot fixture infra
 * manager, 2026-05-24).
 *
 * Mounted once at the app root inside `<Providers>`. Strictly gated to
 * `?wikiCapture=…` mode (no real-data path):
 *
 *   `?forceControls=1` -> add the `force-hover-controls` class to
 *      `<body>` so CSS that hides controls behind `:hover` can also
 *      reveal them when this ancestor class is present. Static
 *      screenshot tools (Playwright, Puppeteer) can't fire `:hover`
 *      without a real cursor, so otherwise-hidden hover-only controls
 *      stay invisible in capture mode. Scoped CSS lives next to each
 *      hover rule (today: LabRoster).
 *
 * The flag requires `isWikiCaptureMode()` to be true; the helper in
 * `wiki-capture-mock.ts` already enforces that gate, so this component
 * is a no-op outside the fixture.
 *
 * The old `?unlockSession=1` edit-session synth was removed with the PI
 * edit-mode feature.
 */
export default function WikiCaptureBodyClass() {
  // Body class for force-hover-controls.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isForceControlsMode()) return;
    document.body.classList.add("force-hover-controls");
    return () => {
      document.body.classList.remove("force-hover-controls");
    };
  }, []);

  return null;
}
