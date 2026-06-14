"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  getDemoMode,
  isRecordingMode,
  isWikiCaptureMode,
} from "@/lib/file-system/wiki-capture-mock";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

/**
 * Soft demo-entry cue. One quiet, dismissible line at the top of the public
 * `/demo` so a visitor knows the lab they are looking at is a sample, without
 * an alarming full-screen interstitial gating their way in. It replaces the
 * old loud always-on banner: the demo should read like a real lab (it is the
 * surface we record marketing video against), so the cue is small, muted, and
 * one click to dismiss.
 *
 * Why a cue and not a gate: the science here is deliberately fake (FakeYeast,
 * fakeGFP) and the data lives only in this browser tab, so nothing is at risk.
 * A blocking "this is a demo" warning would just add friction; a single line
 * states the why and gets out of the way.
 *
 * Mounted at providers level alongside the other demo chrome so it shows on
 * every demo surface. Dismissal is remembered in sessionStorage for the tab,
 * so it appears once and never nags.
 *
 * Suppressed under `?wikiCapture=1` (wiki screenshots) and `?record=1`
 * (marketing-video capture) so those surfaces stay pristine.
 */
const DISMISS_KEY = "researchos:demo-cue-dismissed";

export default function DemoEntryCue() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // sessionStorage can throw in private mode; treat as not dismissed.
    }
    const eligible =
      getDemoMode() && !isWikiCaptureMode() && !isRecordingMode() && !dismissed;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local state with the external sessionStorage demo flag on every route change
    setShow(eligible);
  }, [pathname]);

  if (!show) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // best-effort
    }
    setShow(false);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-surface-raised/90 px-3.5 py-1.5 text-meta text-foreground-muted shadow-sm backdrop-blur">
        <span>
          You are exploring a sample lab. The data is fictional and lives only
          in this tab.
        </span>
        <Tooltip label="Dismiss">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss demo notice"
            className="ml-0.5 rounded-full p-0.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
