"use client";

import { useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import BetaNotice from "@/components/BetaNotice";
import { IntroBubbleBot } from "@/components/onboarding/oauth-first/IntroBubbleBot";
import LandingBackdrop from "@/components/onboarding/oauth-first/LandingBackdrop";
import { useTheme } from "@/lib/theme/use-theme";
import type { LoadingStage } from "@/lib/file-system/file-system-context";

interface StagedLoadingScreenProps {
  /**
   * What phase of startup we're in. When null, falls back to a generic
   * "Loading…" message so callers can use this for early-boot too.
   */
  stage: LoadingStage;
  /** Optional override for the main heading. */
  heading?: string;
  /**
   * Escape hatch for a stuck connect (2026-06-07). When provided, a "choose a
   * different folder" affordance appears after the load has been running a
   * while (cloud folders on files-on-demand can hang for a long time). It
   * should disconnect + reset to the connect screen so the user can pick a
   * different, ideally local, folder. Omitted on early-boot / non-connect uses.
   */
  onPickDifferentFolder?: () => void;
}

const STAGE_MESSAGES: Record<NonNullable<LoadingStage>, string> = {
  "opening-picker": "Opening the folder picker",
  connecting: "Connecting to your folder",
  "verifying-permission": "Verifying read/write access",
  "validating-folder": "Inspecting folder contents",
  "discovering-users": "Discovering users",
  "warming-cache": "Warming up…",
  preparing: "Preparing your workspace",
};

const STAGE_SUBTITLES: Record<NonNullable<LoadingStage>, string> = {
  "opening-picker":
    "Asking the OS for a folder dialog. If your research folder lives in OneDrive / iCloud / Dropbox, this step can take 15-60 seconds the first time, while the OS spins up its file provider. This is not a freeze.",
  connecting: "Waiting for the system to hand us a folder handle…",
  "verifying-permission": "If your browser shows a prompt, click Allow.",
  "validating-folder": "Reading what is already in the folder.",
  "discovering-users": "Scanning users/ for everyone with data here.",
  "warming-cache": "Checking cached file versions against disk.",
  preparing: "Loading projects, tasks, and recent activity.",
};

// Rotated every few seconds during long stages so the user can tell the
// screen is still alive (not frozen by Chrome).
const REASSURANCE_MESSAGES = [
  "Tip: once it's loaded, everything after this stays snappy.",
  "Your data is being read directly from disk — no server in the middle.",
  "Big folder? The first scan can take a minute. Subsequent loads are faster.",
];

/**
 * Shown during the (occasionally minute-long) initial file-system connect.
 * Counts FSA reads as they happen via `fileService.getReadCount()` so the
 * user sees motion even when no individual file read is fast.
 */
export default function StagedLoadingScreen({
  stage,
  heading,
  onPickDifferentFolder,
}: StagedLoadingScreenProps) {
  const [readCount, setReadCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [reassuranceIdx, setReassuranceIdx] = useState(0);
  const { resolved } = useTheme();
  const isDark = resolved === "dark";

  // Run once on mount — don't reset on stage transitions so the elapsed
  // counter shows the real wall-clock time the user has been waiting.
  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      setReadCount(fileService.getReadCount());
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    // Rotate the reassurance line every ~6 seconds once we've been waiting a
    // while. Skip until 4 seconds have elapsed so quick loads don't flash it.
    if (elapsedSec < 4) return;
    const rot = setInterval(() => {
      setReassuranceIdx((i) => (i + 1) % REASSURANCE_MESSAGES.length);
    }, 6000);
    return () => clearInterval(rot);
  }, [elapsedSec]);

  const title = heading ?? (stage ? STAGE_MESSAGES[stage] : "Loading ResearchOS");
  const subtitle = stage ? STAGE_SUBTITLES[stage] : null;
  const showReadCount = readCount > 0;
  const showReassurance = elapsedSec >= 4;
  // Surface the escape hatch only after the load has clearly stalled (8s), so a
  // normal fast connect never shows it. A cloud folder on files-on-demand can
  // sit here for a long time; this lets the user bail to a different folder.
  const showEscapeHatch = !!onPickDifferentFolder && elapsedSec >= 8;

  return (
    <div
      data-testid="staged-loading-screen"
      className="light-scope fixed inset-0 flex items-center justify-center overflow-hidden bg-white"
    >
      {/* Shared deck backdrop, unifying the loader every user passes through with
          the OAuth-first landing (radial wash, masked dot grid, drifting auroras
          + floating beakers, rainbow bars). */}
      <LandingBackdrop />

      <div className="relative max-w-xl w-full mx-4 text-center">
        {/* The bubbling BeakerBot is the brand loading mark (Grant 2026-06-11),
            in place of the old gradient-square spinner. It loops, so it fits any
            load duration, and the progress bar below still signals real motion. */}
        <div className="mb-6 flex justify-center">
          <IntroBubbleBot size="lg" />
        </div>

        {/* Indeterminate progress bar that runs on the compositor thread so it
            keeps animating even when the main thread is blocked by the OS
            folder picker or heavy boot work. It MUST animate `transform` (GPU
            compositor) — never `left`/`width` (main-thread layout), or the
            sweep stutters and freezes the moment the main thread is busy. */}
        <div className="relative h-1.5 w-full max-w-sm mx-auto bg-black/5 dark:bg-white/10 rounded-full overflow-hidden mb-6">
          <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-brand-action to-brand-purple rounded-full animate-staged-loading-sweep" />
        </div>

        <h2 className="text-heading font-semibold text-foreground mb-3">{title}</h2>

        {/* The opening-picker stage has its own dedicated callout below,
            so skip the generic subtitle there to avoid saying the same
            thing twice. */}
        {subtitle && stage !== "opening-picker" && (
          <p className="text-title text-foreground-muted mb-5 leading-relaxed">{subtitle}</p>
        )}

        {stage === "opening-picker" && (
          <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-500/10 px-4 py-3 text-left">
            <p className="flex items-center gap-1.5 text-title font-semibold text-amber-700 dark:text-amber-300 mb-1">
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Don&apos;t refresh the page
            </p>
            <p className="text-body text-amber-800 dark:text-amber-200/90 leading-relaxed">
              The OS folder picker may look frozen — there is no spinner in the
              system dialog. This is normal for OneDrive / iCloud / Dropbox
              folders. Refreshing will throw away progress and you&apos;ll have
              to start over.
            </p>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 text-body text-foreground-muted mb-3">
          {showReadCount && (
            <span className="px-3 py-1 bg-white border border-[#e3ecf6] dark:bg-surface-raised dark:border-border rounded-full">
              {readCount} {readCount === 1 ? "file" : "files"} read
            </span>
          )}
          <span className="px-3 py-1 bg-white border border-[#e3ecf6] dark:bg-surface-raised dark:border-border rounded-full">
            {elapsedSec}s elapsed
          </span>
        </div>

        {showReassurance && (
          <p className="text-body text-foreground-muted italic mt-6 transition-opacity duration-300">
            {REASSURANCE_MESSAGES[reassuranceIdx]}
          </p>
        )}

        {/* Escape hatch for a stalled cloud-folder connect. OneDrive / Box
            files-on-demand can leave this spinning indefinitely while the OS
            fetches placeholder files; this lets the user bail and pick a
            different (ideally local) folder instead of being trapped. */}
        {showEscapeHatch && (
          <div className="mt-7">
            <button
              type="button"
              onClick={onPickDifferentFolder}
              data-testid="staged-loading-pick-different-folder"
              className="text-body font-medium text-brand-action hover:text-brand-purple underline underline-offset-4 transition-colors"
            >
              Taking too long? Choose a different folder
            </button>
            <p className="text-meta text-foreground-muted mt-2">
              A folder on your local disk connects instantly.
            </p>
          </div>
        )}

        {/* Temporary beta notice (Grant 2026-05-28). While ResearchOS is
            pre-1.0, set expectations and invite feedback on the screen
            every user passes through on the way in. Shared component so the
            copy stays in sync with the folder-setup notice. Remove (or
            soften) once we ship 1.0. */}
        <BetaNotice tone={isDark ? "dark" : "light"} className="mt-8" />
      </div>

      <style>{`
        /* translateX runs on the GPU compositor, so the sweep keeps gliding
           even while the main thread is pinned by boot work. The bar is 1/3 of
           the track (w-1/3) anchored at left:0, so -100%→300% of its own width
           sweeps it from fully off-left to fully off-right. */
        @keyframes staged-loading-sweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        .animate-staged-loading-sweep {
          animation: staged-loading-sweep 1.4s ease-in-out infinite;
          will-change: transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-staged-loading-sweep { animation-duration: 2.8s; }
        }
      `}</style>
    </div>
  );
}
