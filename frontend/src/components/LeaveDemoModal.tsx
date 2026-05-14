"use client";

import { useCallback, useEffect } from "react";
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
 * Modal shown when the visitor clicks "Leave Demo" in `<DemoLabBanner>` or
 * `<FloatingLeaveDemoButton>` from inside the public `/demo` route.
 *
 * Single confirm-and-go-home path: the demo is a play sandbox — edits live in
 * the current browser tab only, survive refreshes, and get reset on the way
 * out. No save-as-ZIP affordance (intentionally removed — keeping the demo
 * lightweight + ephemeral is the point).
 *
 * Clears IndexedDB state first (stored fake directory handle + current user +
 * main user) so the post-reload `/` lands on the folder picker rather than the
 * "Reconnect to wiki-capture-fixture" screen — which would never resolve
 * because the fake handle has no `queryPermission` implementation. Then clears
 * the sticky sessionStorage flag so the next visit to `/` doesn't silently
 * re-enter demo mode from a stale flag.
 */
export default function LeaveDemoModal({ isOpen, onClose }: Props) {
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
    clearDemoMode();
    window.location.replace("/");
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-demo-title"
        className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-white/10 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="leave-demo-title"
          className="text-xl font-bold text-white mb-2"
        >
          Leave the demo?
        </h2>
        <p className="text-sm text-slate-300 mb-5">
          Your demo edits live in this browser tab only. Leaving will reset
          everything and return you to the folder picker.
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={goHome}
            className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Leave demo
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-xs text-slate-400 hover:text-white transition-colors"
          >
            Keep exploring the demo
          </button>
        </div>
      </div>
    </div>
  );
}
