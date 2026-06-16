"use client";

import { useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";

/**
 * Privacy guard surface for the wiki-capture real-user shadowing case.
 *
 * When someone pastes `?wikiCapture=1` while a real folder + real user are
 * already connected, the provider REFUSES the fixture install and quietly
 * falls back to the real session (see the `realFolderConnected` branch in
 * `file-system-context.tsx`). Without a visible signal the person could keep
 * recording, believing they are on alex/mira/morgan fixtures, while their
 * real unpublished research data is on screen. That violates the hard
 * screenshot-privacy rule.
 *
 * This banner is the visible signal. It rides the `captureRefused` flag,
 * which is set in exactly one place (the refuse branch) and never in normal
 * use, a true fixture install on a fresh profile, or `/demo`. It cannot be
 * dismissed until the person acknowledges it, so it is hard to miss in a
 * screen recording.
 *
 * Mounted at providers level (inside FileSystemProvider) so it can read the
 * context flag and render above every route.
 */
export default function WikiCaptureRefusedBanner() {
  const { captureRefused } = useFileSystem();
  const [acknowledged, setAcknowledged] = useState(false);

  if (!captureRefused || acknowledged) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-4"
    >
      <div className="flex w-full max-w-2xl items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-5 py-4 shadow-xl">
        <svg
          aria-hidden
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m0 3.75h.008M10.34 3.94l-7.4 12.82A1.75 1.75 0 004.46 19.5h15.08a1.75 1.75 0 001.52-2.74l-7.4-12.82a1.75 1.75 0 00-3.04 0z"
          />
        </svg>
        <div className="flex-1">
          <p className="text-body font-semibold text-amber-900 dark:text-amber-300">
            Capture mode is unavailable while your real folder is connected
          </p>
          <p className="mt-1 text-body text-amber-800 dark:text-amber-300">
            Your real research data is showing, not the demo fixtures. To record
            with fixture data, open an incognito window or disconnect your folder
            first, then add the capture flag again.
          </p>
          <button
            type="button"
            onClick={() => setAcknowledged(true)}
            className="ros-btn-raise mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-amber-700 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}
