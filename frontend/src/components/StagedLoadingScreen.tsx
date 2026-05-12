"use client";

import { useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import type { LoadingStage } from "@/lib/file-system/file-system-context";

interface StagedLoadingScreenProps {
  /**
   * What phase of startup we're in. When null, falls back to a generic
   * "Loading…" message so callers can use this for early-boot too.
   */
  stage: LoadingStage;
  /** Optional override for the main heading. */
  heading?: string;
}

const STAGE_MESSAGES: Record<NonNullable<LoadingStage>, string> = {
  "opening-picker": "Opening the folder picker",
  connecting: "Connecting to your folder",
  "verifying-permission": "Verifying read/write access",
  "validating-folder": "Inspecting folder contents",
  "discovering-users": "Discovering users",
  preparing: "Preparing your workspace",
};

const STAGE_SUBTITLES: Record<NonNullable<LoadingStage>, string> = {
  "opening-picker":
    "Asking the OS for a folder dialog. If your research folder lives in OneDrive / iCloud / Dropbox, this step can take 15-60 seconds the first time — the OS has to spin up its file provider. This is not a freeze.",
  connecting: "Waiting for the system to hand us a folder handle…",
  "verifying-permission": "If your browser shows a prompt, click Allow.",
  "validating-folder":
    "Cloud folders are slow on first read while the OS catches up. This is normal.",
  "discovering-users": "Scanning users/ for everyone with data here.",
  preparing: "Loading projects, tasks, and recent activity.",
};

// Rotated every few seconds during long stages so the user can tell the
// screen is still alive (not frozen by Chrome).
const REASSURANCE_MESSAGES = [
  "Still here. Cloud folders are slow on first connect — it's the OS, not us.",
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
}: StagedLoadingScreenProps) {
  const [readCount, setReadCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [reassuranceIdx, setReassuranceIdx] = useState(0);

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

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-xl w-full mx-4 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-6">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white"></div>
        </div>

        {/* Indeterminate progress bar that runs on the compositor thread so it
            keeps animating even when the main thread is blocked by the OS
            folder picker. */}
        <div className="relative h-1.5 w-full max-w-sm mx-auto bg-slate-800/60 rounded-full overflow-hidden mb-6">
          <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-staged-loading-sweep" />
        </div>

        <h2 className="text-2xl font-semibold text-white mb-3">{title}</h2>

        {/* The opening-picker stage has its own dedicated callout below,
            so skip the generic subtitle there to avoid saying the same
            thing twice. */}
        {subtitle && stage !== "opening-picker" && (
          <p className="text-base text-slate-200 mb-5 leading-relaxed">{subtitle}</p>
        )}

        {stage === "opening-picker" && (
          <div className="mb-5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-left">
            <p className="text-base font-semibold text-amber-300 mb-1">
              ⚠️ Don&apos;t refresh the page
            </p>
            <p className="text-sm text-amber-100/90 leading-relaxed">
              The OS folder picker may look frozen — there is no spinner in the
              system dialog. This is normal for OneDrive / iCloud / Dropbox
              folders. Refreshing will throw away progress and you&apos;ll have
              to start over.
            </p>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 text-sm text-slate-300 mb-3">
          {showReadCount && (
            <span className="px-3 py-1 bg-slate-800/60 rounded-full">
              {readCount} {readCount === 1 ? "file" : "files"} read
            </span>
          )}
          <span className="px-3 py-1 bg-slate-800/60 rounded-full">
            {elapsedSec}s elapsed
          </span>
        </div>

        {showReassurance && (
          <p className="text-sm text-slate-300 italic mt-6 transition-opacity duration-300">
            {REASSURANCE_MESSAGES[reassuranceIdx]}
          </p>
        )}
      </div>

      <style>{`
        @keyframes staged-loading-sweep {
          0% { left: -33%; }
          100% { left: 100%; }
        }
        .animate-staged-loading-sweep {
          animation: staged-loading-sweep 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
