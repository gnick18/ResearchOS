"use client";

// import overlay bot — centered, blocking progress modal shown during a
// multi-file sequence import. Replaces the tiny inline "Importing N of M…"
// line with a reassuring full-screen overlay: a BeakerBot working animation,
// a determinate progress bar, the live count, and a calm "stay on this page"
// warning. It has no close control while active (it is a progress modal, not
// a dismissible dialog) and the parent unmounts it the moment the import
// finishes (success or error). Rendered via a portal to document.body so the
// backdrop covers the whole viewport regardless of where the page's own
// scroll/overflow containers sit.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import BeakerBot from "@/components/BeakerBot";

export interface ImportProgress {
  /** Files written so far. */
  done: number;
  /** Total files in this import batch. */
  total: number;
}

export interface ImportProgressOverlayProps {
  /** Live progress, or null when no multi-file import is running. The overlay
   *  only renders when this is non-null AND total > 1 — a single-file import
   *  keeps the existing inline status line and never shows the big modal. */
  progress: ImportProgress | null;
}

export default function ImportProgressOverlay({
  progress,
}: ImportProgressOverlayProps) {
  // Portals need the DOM, so gate on a mounted flag to stay SSR-safe (the
  // sequences page is a client route, but the component must not call
  // document.body during the server render pass).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Single-file imports keep the inline status only; the big modal is for the
  // multi-file / folder case where the user is waiting on a real batch.
  if (!mounted || !progress || progress.total <= 1) return null;

  const { done, total } = progress;
  // Clamp so a stray over-count never paints a bar past 100% or below 0.
  const safeDone = Math.min(Math.max(done, 0), total);
  const fraction = total > 0 ? safeDone / total : 0;
  const percent = Math.round(fraction * 100);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Importing sequences"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      {/* Backdrop. No onClick to dismiss — this is a blocking progress modal,
          so clicking outside must not cancel an in-flight import. */}
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-surface-raised px-6 py-7 text-center ros-popup-card-shadow">
        {/* BeakerBot, working away. The `thinking` pose loops a gentle
            head-tilt with an ellipsis thought bubble, which reads as
            "processing" without the alarm of a spinner. */}
        <div className="flex justify-center">
          <BeakerBot
            pose="thinking"
            className="h-20 w-20 text-sky-500"
            ariaLabel="BeakerBot importing your sequences"
          />
        </div>

        <h2 className="mt-4 text-title font-semibold text-foreground">
          Importing sequences
        </h2>

        {/* Live count + percent. aria-live announces each step to screen
            readers without re-reading the whole dialog. */}
        <p
          aria-live="polite"
          className="mt-1 text-body text-foreground-muted"
        >
          Importing {safeDone} of {total} files ({percent}%)
        </p>

        {/* Determinate progress bar. The track is a calm gray, the fill is
            the brand sky, width driven by the done/total fraction. */}
        <div
          className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={safeDone}
        >
          <div
            className="h-full rounded-full bg-sky-500 transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
            data-testid="import-progress-bar-fill"
          />
        </div>

        {/* Calm but clear warning. No close button, no cancel — the only way
            out is to let it finish. */}
        <p className="mt-5 text-meta text-foreground-muted">
          Keep this tab open and stay on this page until the import finishes.
        </p>
      </div>
    </div>,
    document.body,
  );
}
