"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOnboarding } from "@/lib/onboarding/orchestrator";
import { ONBOARDING_TIPS } from "@/lib/onboarding/tips";
import Tooltip from "./Tooltip";

/**
 * Dev-only "force an onboarding tip to fire" button. Renders a small
 * dropdown listing the 10 tips by title; clicking one navigates to the
 * tip's route (if different) and force-fires it once the target element
 * mounts. Bypasses every gate (active-time, cooldown, dwell, roll,
 * shown-history) — it's a preview, not a real serve, and does NOT
 * persist to the sidecar.
 *
 * Conditional on `process.env.NODE_ENV === "development"`. Next.js
 * replaces that with the literal `"development"` string at build time,
 * so in production builds (e.g. on Vercel) the early-return turns the
 * body into dead code that the bundler can drop.
 *
 * Returns null in demo / wiki-capture mode because the orchestrator
 * isn't mounted there — `useOnboarding()` returns null and there's
 * nothing to fire against.
 */
const IS_DEV = process.env.NODE_ENV === "development";

export default function DevForceTipButton() {
  const [open, setOpen] = useState(false);
  const orchestrator = useOnboarding();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!IS_DEV) return null;
  if (!orchestrator) return null;

  const handleFire = (tipId: string, route: string) => {
    setOpen(false);
    if (pathname !== route) {
      router.push(route);
      // Slight delay so the route mount + ref attach has a chance.
      // The orchestrator's force-fire polls for the target for up to
      // 3s, so a missed first frame is fine — this is just a hint.
      window.setTimeout(() => orchestrator.forceFireTip(tipId), 100);
    } else {
      orchestrator.forceFireTip(tipId);
    }
  };

  const handleShowWelcome = () => {
    setOpen(false);
    // Re-trigger the welcome modal by flipping sidecar.mode back to
    // null. Orchestrator's `showWelcome = sidecar.mode === null`
    // conditional will re-render the modal. The user can then re-pick
    // a mode to verify each one. Does NOT clear the rest of the
    // sidecar (tips history, active_seconds, etc.) — those stay so
    // a second pick lands the user in the same state they were in
    // before, just with the new mode.
    void orchestrator.setMode(null);
  };

  return (
    <div className="relative" ref={menuRef}>
      <Tooltip label="Force an onboarding tip to fire (dev only)" placement="top">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Force an onboarding tip to fire (dev only)"
          aria-expanded={open}
          aria-haspopup="menu"
          className="w-12 h-12 rounded-full bg-white border-2 border-sky-300 hover:border-sky-500 hover:bg-sky-50 text-sky-600 hover:text-sky-700 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        >
          {/* Beaker-bot silhouette to match the actual mascot. */}
          <svg
            className="w-5 h-5"
            viewBox="0 0 40 40"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 8 C 22 6, 24 4, 26 6" />
            <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
            <path d="M11 12 L29 12" />
            <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="23" cy="18" r="1.2" fill="currentColor" stroke="none" />
            <path d="M18 22 Q 20 24, 22 22" />
          </svg>
        </button>
      </Tooltip>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 mb-2 w-72 bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-50 max-h-[28rem] overflow-y-auto"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
            Force-fire onboarding tip
          </div>
          {ONBOARDING_TIPS.map((tip) => (
            <button
              key={tip.id}
              role="menuitem"
              onClick={() => handleFire(tip.id, tip.route)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 transition-colors flex items-center justify-between gap-2"
            >
              <span className="truncate">{tip.title}</span>
              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                {tip.route}
              </span>
            </button>
          ))}

          <div className="border-t border-slate-100 mt-1 pt-1">
            <button
              role="menuitem"
              onClick={handleShowWelcome}
              className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 text-amber-700 font-medium transition-colors"
            >
              Show welcome modal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
