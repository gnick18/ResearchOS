"use client";

// LivingPopup: the one reusable shell for every "Apple-style" popup in the app.
//
// It owns the unified feel so no popup re-implements it: a hazy blurred scrim
// over the live page, a card that zooms out of (and collapses back to) the point
// it was opened from, a top-right X, and close on the X, the scrim (click
// outside), or Escape. Tweak the animation / blur / chrome HERE and every popup
// updates.
//
// Controlled: the parent owns `open` + `onClose`. The parent does NOT need any
// animation state, LivingPopup mounts on open, plays the entrance, and on close
// plays the exit before unmounting (it keeps rendering the last children during
// the exit, so content does not flash away).
//
// Usage (a store-driven popup mounted once in AppShell):
//   const s = useSettingsModal();
//   <LivingPopup open={s.isOpen} origin={s.origin} onClose={s.close}
//     label="Settings" widthClassName="max-w-3xl" fillHeight>
//     <SettingsBody />
//   </LivingPopup>
//
// Chrome knobs:
//   card        wrap children in a rounded surface card (default true). Set false
//               when the children already provide their own card chrome.
//   padded      add inner padding to the card (default false).
//   fillHeight  bound the card height (max-h) and let the children scroll
//               INTERNALLY (default false = card grows to content and the whole
//               popup scrolls). Use true for tall bodies with their own scroll.
//   widthClassName  the card max-width Tailwind class (default max-w-lg).
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG.

import { useEffect, useRef, useState } from "react";

import Tooltip from "@/components/Tooltip";
import type { OpenOrigin } from "@/lib/ui/create-popup-store";
import { usePopupLayer } from "@/lib/ui/popup-stack";

// Duration of the open / close animation. Matched by the inline transitions.
const ANIM_MS = 340;
// Apple-ish ease: quick out, soft settle.
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/** Transform that collapses the card toward the open point (or a soft default). */
function collapsedTransform(origin: OpenOrigin | null): string {
  if (typeof window === "undefined" || !origin) {
    return "translate(0px, 24px) scale(0.85)";
  }
  const dx = Math.round(origin.x - window.innerWidth / 2);
  const dy = Math.round(origin.y - window.innerHeight / 2);
  return `translate(${dx}px, ${dy}px) scale(0.15)`;
}

export interface LivingPopupProps {
  /** Controlled open state. The parent toggles this. */
  open: boolean;
  /** Called when the user closes (X, scrim click, or Escape). */
  onClose: () => void;
  /** Accessible label for the dialog (also used in the close button labels). */
  label: string;
  /** Screen point the open was triggered from, for the zoom. Optional. */
  origin?: OpenOrigin | null;
  /** Card max-width Tailwind class. Default max-w-lg. */
  widthClassName?: string;
  /** Wrap children in a rounded surface card. Default true. */
  card?: boolean;
  /** Add inner padding to the card. Default false. */
  padded?: boolean;
  /** Bound the card height + let children scroll internally. Default false. */
  fillHeight?: boolean;
  children: React.ReactNode;
}

export default function LivingPopup({
  open,
  onClose,
  label,
  origin = null,
  widthClassName = "max-w-lg",
  card = true,
  padded = false,
  fillHeight = false,
  children,
}: LivingPopupProps) {
  // mounted: in the DOM (stays true through the exit animation).
  // shown: animated to the expanded/visible state.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [activeOrigin, setActiveOrigin] = useState<OpenOrigin | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The parent always renders `children` (it owns the content element and lets
  // this component control mounting), so they stay rendered through the exit
  // animation without any caching here.

  // Drive the two-phase entrance / exit off the controlled `open` prop. This
  // effect deliberately sets state in response to a prop change to sequence the
  // mount + entrance + exit (the supported way to derive an animation lifecycle
  // from a controlled prop), so the set-state calls below are intentional.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setActiveOrigin(origin);
      setMounted(true);
      setShown(false);
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setShown(true)),
      );
      return () => cancelAnimationFrame(raf);
    }
    // Closing: play the exit, then unmount.
    setShown(false);
    closeTimer.current = setTimeout(() => setMounted(false), ANIM_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- origin is captured into activeOrigin only on open; reacting to it on the close branch would restart the timer.
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Escape closes.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // Register in the shared popup stack while mounted. Only the bottom-most
  // popup blurs the page; a popup stacked on top dims without re-blurring, so
  // blur never compounds (Grant 2026-06-06: no blur-on-blur).
  const { isBottom } = usePopupLayer(mounted);

  if (!mounted) return null;

  const closeLabel = `Close ${label.toLowerCase()}`;

  const cardStyle: React.CSSProperties = {
    transform: shown
      ? "translate(0px, 0px) scale(1)"
      : collapsedTransform(activeOrigin),
    opacity: shown ? 1 : 0,
    transition: `transform ${ANIM_MS}ms ${EASE}, opacity ${Math.round(
      ANIM_MS * 0.7,
    )}ms ease`,
    transformOrigin: "center center",
    willChange: "transform, opacity",
  };

  const cardClass = [
    "pointer-events-auto w-full",
    widthClassName,
    card ? "rounded-2xl bg-surface-raised shadow-2xl ring-1 ring-black/5" : "",
    padded ? "p-6 sm:p-8" : "",
    fillHeight ? "max-h-[88vh] flex flex-col overflow-hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cardEl = (
    <div className={cardClass} style={cardStyle} role="dialog" aria-label={label}>
      {children}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[400]"
      // Tour-occlusion marker (TourSpotlight convention). While any living
      // popup is mounted the v4 walkthrough ring drops, unless the spotlight
      // target sits INSIDE this popup (TourSpotlight checks el.contains, and
      // this root wraps the children). Owning it here means migrated popups
      // do not each re-stamp data-tour-popup-occluding on their own overlay.
      data-tour-popup-occluding="living-popup"
    >
      {/* Scrim over the live page behind. Click closes. Only the bottom-most
          popup blurs; a popup stacked on top just dims, so blur never
          compounds (see popup-stack). */}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className={`absolute inset-0 h-full w-full cursor-default bg-slate-900/25 ${
          isBottom ? "backdrop-blur-md" : ""
        }`}
        style={{ opacity: shown ? 1 : 0, transition: `opacity ${ANIM_MS}ms ease` }}
      />

      {/* Close affordance, top-right. */}
      <div
        className="absolute right-4 top-4 z-10"
        style={{ opacity: shown ? 1 : 0, transition: `opacity ${ANIM_MS}ms ease` }}
      >
        <Tooltip label="Close" placement="bottom">
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised/80 text-foreground-muted shadow ring-1 ring-black/5 backdrop-blur transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>

      {/* Centered content. fillHeight = bounded card, children scroll inside;
          otherwise the card grows to content and the whole popup scrolls. The
          scrim shows through except on the card, so clicking outside closes. */}
      {fillHeight ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          {cardEl}
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 overflow-y-auto">
          <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
            {cardEl}
          </div>
        </div>
      )}
    </div>
  );
}
