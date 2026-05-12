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
  "Still here. OneDrive folders are slow on first connect — it's the OS, not us.",
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

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      setReadCount(fileService.getReadCount());
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => clearInterval(tick);
  }, [stage]);

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
      <div className="max-w-md w-full mx-4 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-5">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>

        <h2 className="text-xl font-semibold text-white mb-2">{title}</h2>

        {subtitle && (
          <p className="text-sm text-slate-400 mb-4 leading-relaxed">{subtitle}</p>
        )}

        <div className="flex items-center justify-center gap-3 text-xs text-slate-500 mb-3">
          {showReadCount && (
            <span className="px-2 py-0.5 bg-slate-800/60 rounded-full">
              {readCount} {readCount === 1 ? "file" : "files"} read
            </span>
          )}
          <span className="px-2 py-0.5 bg-slate-800/60 rounded-full">
            {elapsedSec}s
          </span>
        </div>

        {showReassurance && (
          <p className="text-xs text-slate-500 italic mt-6 transition-opacity duration-300">
            {REASSURANCE_MESSAGES[reassuranceIdx]}
          </p>
        )}
      </div>
    </div>
  );
}
