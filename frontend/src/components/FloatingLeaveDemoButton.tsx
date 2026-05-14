"use client";

import { useEffect, useState } from "react";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import LeaveDemoModal from "./LeaveDemoModal";

/**
 * Always-visible, undismissable Leave Demo affordance. Renders at
 * providers level so it shows across every route while the demo's
 * sticky `sessionStorage` flag is set — including wiki pages (so users
 * who bounce between `/wiki/features/methods` and `/methods` keep a
 * one-click escape hatch).
 *
 * Why not the banner: the existing `<DemoLabBanner>` is dismissible and
 * easy to overlook. This is the backup.
 */
export default function FloatingLeaveDemoButton() {
  const [show, setShow] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    setShow(getDemoMode());
  }, []);

  if (!show) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-medium shadow-xl flex items-center gap-2 transition-colors"
        aria-label="Leave demo"
      >
        <span aria-hidden>🚪</span>
        <span>Leave Demo</span>
      </button>
      <LeaveDemoModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
