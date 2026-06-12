"use client";

import { useEffect, useRef } from "react";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import { runScript, teardownDemoCursor } from "@/lib/demo-video/engine";
import { DEMO_CLIPS } from "@/lib/demo-video/scripts";

/**
 * Auto-plays a welcome-video clip script when the URL carries `?demo=<clipId>`
 * (alongside the demo / `?record=1` recording surface). Renders the engine's
 * animated cursor and drives the real UI deterministically so a screen capture
 * is smooth and reproducible.
 *
 * Replay hotkey: press the backtick key (`) to re-run the current clip without
 * a full reload (no loading screen between takes). Useful in fullscreen, where
 * there is no address bar to re-navigate. Ignored while typing in a field.
 *
 * Gated to demo / wiki-capture mode so it can never run for a real user. The
 * clip id is read from `window.location.search` in an effect (not
 * useSearchParams) to stay Suspense/static-export safe like the rest of this
 * provider tree.
 */
export default function DemoVideoAutoplay() {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isDemoOrWikiCapture()) return;
    const clipId = new URLSearchParams(window.location.search).get("demo");
    if (!clipId) return;
    const steps = DEMO_CLIPS[clipId];
    if (!steps) {
      // eslint-disable-next-line no-console
      console.warn(`[demo-video] no clip named "${clipId}"`, Object.keys(DEMO_CLIPS));
      return;
    }

    function play() {
      abortRef.current?.abort();
      teardownDemoCursor();
      const controller = new AbortController();
      abortRef.current = controller;
      runScript(steps, {
        signal: controller.signal,
        onStep: (label) => {
          // eslint-disable-next-line no-console
          console.log(`[demo-video:${clipId}] ${label}`);
        },
      }).catch((err) => {
        if ((err as Error)?.name !== "AbortError") {
          // eslint-disable-next-line no-console
          console.error(`[demo-video:${clipId}]`, err);
        }
      });
    }

    // Give the demo app a beat to finish its loading screen before the cursor
    // starts; each step also waits for its own target, so this is just slack.
    const startTimer = window.setTimeout(play, 1500);

    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (e.key === "`" && !typing) {
        e.preventDefault();
        play();
      }
    }
    window.addEventListener("keydown", onKey);

    return () => {
      window.clearTimeout(startTimer);
      window.removeEventListener("keydown", onKey);
      abortRef.current?.abort();
      teardownDemoCursor();
    };
  }, []);

  return null;
}
