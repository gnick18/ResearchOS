"use client";

import { useCallback, useEffect, useState } from "react";
import { exportFixturesToZip } from "@/lib/demo/export-fixtures-to-zip";
import {
  clearCurrentUser,
  clearDirectoryHandle,
  clearMainUser,
} from "@/lib/file-system/indexeddb-store";
import { clearDemoMode } from "@/lib/file-system/wiki-capture-mock";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal shown when the visitor clicks "Leave Demo" in `<DemoLabBanner>`
 * from inside the public `/demo` route. Two paths out:
 *
 * 1. **Save my demo edits as a starter folder.** Packs the in-memory
 *    fixture (with the user's edits) into a ZIP that mirrors the
 *    canonical `/demo-lab.zip` structure (rooted at `DemoLab/`), then
 *    redirects to `/` so the user picks the unzipped folder.
 * 2. **Discard and start fresh.** Just redirects to `/`.
 *
 * Both paths clear IndexedDB state first (stored fake directory handle
 * + current user + main user) so the post-reload `/` lands on the
 * folder picker rather than the "Reconnect to wiki-capture-fixture"
 * screen — which would never resolve because the fake handle has no
 * `queryPermission` implementation.
 */
export default function LeaveDemoModal({ isOpen, onClose }: Props) {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goHome = useCallback(async () => {
    try {
      await Promise.all([
        clearDirectoryHandle(),
        clearCurrentUser(),
        clearMainUser(),
      ]);
    } catch {
      // Best-effort cleanup; even if IndexedDB throws, the reload below
      // gives the user a way out via the folder picker.
    }
    // Clear the sticky sessionStorage flag so the next visit to `/`
    // doesn't silently re-enter demo mode from a stale flag.
    clearDemoMode();
    window.location.replace("/");
  }, []);

  const onSaveAndLeave = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    setError(null);
    try {
      const blob = await exportFixturesToZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "DemoLab-from-browser.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give Chrome a tick to actually start the download before the
      // navigation tears down the object URL.
      setTimeout(() => {
        URL.revokeObjectURL(url);
        goHome();
      }, 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      setError(message);
      setIsExporting(false);
    }
  }, [goHome, isExporting]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isExporting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isExporting, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => {
        if (!isExporting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-demo-title"
        className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-white/10 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="leave-demo-title"
          className="text-xl font-bold text-white mb-2"
        >
          Leaving the demo
        </h2>
        <p className="text-sm text-slate-300 mb-5">
          Your demo edits live in this browser tab only. Save them as a
          starter folder if you want to keep poking at them in a real
          ResearchOS session — otherwise discard and start fresh.
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onSaveAndLeave}
            disabled={isExporting}
            className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Packaging your demo lab…
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
                  />
                </svg>
                Save my demo edits as a starter folder
              </>
            )}
          </button>

          <button
            type="button"
            onClick={goHome}
            disabled={isExporting}
            className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/15 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            Discard and start fresh
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="w-full py-2 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Keep exploring the demo
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-500/15 border border-red-500/30 rounded-lg">
            <p className="text-xs text-red-300">
              Couldn&apos;t build the ZIP: {error}
            </p>
          </div>
        )}

        <p className="mt-5 text-[11px] text-slate-500 leading-relaxed">
          The ZIP unzips to a folder called <code>DemoLab</code>. On the
          next screen, pick that folder via &ldquo;Link Existing
          Folder&rdquo; to keep working.
        </p>
      </div>
    </div>
  );
}
