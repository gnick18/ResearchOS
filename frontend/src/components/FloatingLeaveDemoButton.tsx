"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  getDemoMode,
  isRecordingMode,
  isTutorialMode,
  isWikiCaptureMode,
} from "@/lib/file-system/wiki-capture-mock";
import { Icon } from "@/components/icons";
import LeaveDemoModal from "./LeaveDemoModal";
import { DEMO_PILL_CLASS } from "./demo/floatingPill";

/**
 * The quiet escape hatch from the public `/demo`. Renders at providers
 * level so it shows across every route while the demo's sticky
 * `sessionStorage` flag is set — including wiki pages (so users who
 * bounce between `/wiki/features/methods` and `/methods` keep a one-click
 * way out).
 *
 * Why a small pill instead of the old loud orange cluster: the demo is now
 * meant to read like a real lab (for marketing-video capture and for
 * visitors who want to look around without a banner shouting "DEMO"). The
 * primary "Leave demo" entry now lives in the user/avatar menu; this pill
 * is the always-visible backup so there is still a one-click exit on every
 * surface, but it sits small and muted in the corner rather than dominating
 * the screen. We never remove the escape entirely.
 *
 * Re-reads `getDemoMode()` on every pathname change so demo state survives a
 * hard-nav round trip (e.g., `<OpenDocsButton>`'s plain `<a href>` to a wiki
 * page, then browser back). Without the pathname dep, a stale-state BFCache
 * restore or a freshly-mounted-too-early read could leave `show=false` even
 * though the sessionStorage flag is still set, so the pill silently
 * disappears.
 *
 * Wiki-capture exemption: when `?wikiCapture=1` is set we deliberately
 * suppress this — the capture script bounces through `/demo` paths to seed
 * fixture data and the path-based read of `getDemoMode()` would otherwise
 * drop the pill into every screenshot.
 *
 * Recording exemption: `?record=1` suppresses it too, so a marketing-video
 * surface (`/demo?record=1`) is pristine with zero demo chrome.
 */
export default function FloatingLeaveDemoButton() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local React state with the external sessionStorage demo flag on every route change
    setShow(getDemoMode() && !isWikiCaptureMode() && !isRecordingMode());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same pathname-tied resync for the tutorial flag (URL-derived)
    setTutorial(isTutorialMode());
  }, [pathname]);

  if (!show) return null;

  // Tutorial copy reframes the pill as "exit the practice tour" rather than
  // "leave the public demo" — same handler underneath, copy is the only
  // difference here. (The actual close-vs-IndexedDB-reset branching lives in
  // `<LeaveDemoModal>`.)
  const label = tutorial ? "Exit tour" : "Leave demo";
  const aria = tutorial ? "Exit tutorial tour" : "Leave demo";

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={DEMO_PILL_CLASS}
        aria-label={aria}
      >
        <Icon name="x" className="h-3.5 w-3.5" />
        <span>{label}</span>
      </button>
      <LeaveDemoModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
