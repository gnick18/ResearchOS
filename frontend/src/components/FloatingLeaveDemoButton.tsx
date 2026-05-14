"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import LeaveDemoModal from "./LeaveDemoModal";

/**
 * Always-visible, undismissable Leave Demo affordance. Renders at
 * providers level so it shows across every route while the demo's
 * sticky `sessionStorage` flag is set — including wiki pages (so users
 * who bounce between `/wiki/features/methods` and `/methods` keep a
 * one-click escape hatch).
 *
 * Re-reads `getDemoMode()` on every pathname change so demo state
 * survives a hard-nav round trip (e.g., `<OpenDocsButton>`'s plain
 * `<a href>` to a wiki page, then browser back). Without the pathname
 * dep, a stale-state BFCache restore or a freshly-mounted-too-early
 * read could leave `show=false` even though the sessionStorage flag is
 * still set, so the button silently disappears.
 *
 * Why not the banner: the existing `<DemoLabBanner>` is dismissible and
 * easy to overlook. This is the backup.
 */
export default function FloatingLeaveDemoButton() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local React state with the external sessionStorage demo flag on every route change
    setShow(getDemoMode());
  }, [pathname]);

  if (!show) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="fixed bottom-20 right-4 z-50 px-4 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-medium shadow-xl flex items-center gap-2 transition-colors focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2"
        aria-label="Leave demo"
      >
        <svg
          aria-hidden
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
          />
        </svg>
        <span>Leave Demo</span>
      </button>
      <LeaveDemoModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
