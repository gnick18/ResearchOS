"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { fileService } from "@/lib/file-system/file-service";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import LeaveDemoModal from "@/components/LeaveDemoModal";

const DISMISS_KEY = "researchOS.demoLabBannerDismissed";

type DemoMarker = {
  is_demo?: boolean;
  lab_title?: string;
  version?: string;
};

/**
 * Thin persistent warning bar shown across every page when the visitor
 * is in the public in-browser demo (the `/demo` route) OR when the
 * connected folder is the on-disk Demo Lab (detected by
 * `_demo_marker.json`). The two sources are unioned: the in-browser
 * demo flips the banner on immediately, the on-disk check is a
 * fall-through for the "downloaded the zip, picked the folder" path.
 *
 * Inside the in-browser demo we also surface a "Leave Demo" CTA that
 * opens `<LeaveDemoModal>` — a single confirm-and-go-home path. The
 * demo is intentionally an ephemeral play sandbox; there's no
 * save-as-ZIP affordance.
 */
export default function DemoLabBanner() {
  const pathname = usePathname();
  const { isConnected, directoryName } = useFileSystem();
  const [isOnDiskDemo, setIsOnDiskDemo] = useState(false);
  const [isInBrowserDemo, setIsInBrowserDemo] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  useEffect(() => {
    try {
      const ss = typeof window !== "undefined" ? window.sessionStorage : null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of dismissal state from sessionStorage on mount
      setDismissed(ss?.getItem(DISMISS_KEY) === "1");
    } catch {
      // sessionStorage can throw in privacy modes — leave dismissed=false.
    }
  }, []);

  // Re-evaluate demo mode on every pathname change so a hard-nav round
  // trip — e.g., the `<OpenDocsButton>` plain `<a href>` to `/wiki/...`
  // and back — doesn't leave a stale `isInBrowserDemo=false` after the
  // browser back. The sessionStorage flag persists across the trip;
  // re-reading it here keeps the banner in sync.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local React state with the external sessionStorage demo flag on every route change
    setIsInBrowserDemo(getDemoMode());
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    if (!isConnected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear demo flag synchronously when fs disconnects
      setIsOnDiskDemo(false);
      return;
    }
    (async () => {
      try {
        const marker = await fileService.readJson<DemoMarker>("_demo_marker.json");
        if (!cancelled) setIsOnDiskDemo(!!marker?.is_demo);
      } catch {
        if (!cancelled) setIsOnDiskDemo(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, directoryName]);

  const isDemo = isInBrowserDemo || isOnDiskDemo;
  if (!isDemo || dismissed) return null;

  const onDismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignore.
    }
    setDismissed(true);
  };

  return (
    <>
      <div
        role="status"
        className="w-full bg-amber-100 border-b border-amber-300 text-amber-950 text-sm px-4 py-2 flex items-center gap-3"
      >
        <span className="text-base leading-none" aria-hidden="true">🧪</span>
        <span className="flex-1">
          <strong className="font-semibold">You&apos;re viewing the Demo Lab.</strong>{" "}
          {isInBrowserDemo
            ? "Edits stay in this browser tab and disappear on reload. Save them as a starter folder before you leave."
            : "This data is fake, generated for tutorial purposes. Connect a different folder to use ResearchOS for real research."}{" "}
          <a
            href="/wiki/getting-started/connecting-your-folder"
            className="underline font-medium hover:text-amber-900"
          >
            Learn more →
          </a>
        </span>
        {isInBrowserDemo && (
          <button
            type="button"
            onClick={() => setShowLeaveModal(true)}
            className="text-xs px-2.5 py-1 rounded bg-amber-900 text-amber-50 hover:bg-amber-800 font-medium transition-colors"
          >
            Leave Demo
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs px-2 py-1 rounded border border-amber-400/60 hover:bg-amber-200 transition-colors"
          aria-label="Dismiss demo lab banner for this session"
        >
          Dismiss
        </button>
      </div>

      <LeaveDemoModal
        isOpen={showLeaveModal}
        onClose={() => setShowLeaveModal(false)}
      />
    </>
  );
}
