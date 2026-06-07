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
  /** Blur the page behind this popup. Reserve for BIG, attention-demanding
   *  popups (Settings, your profile, an editor); little popups never blur.
   *  Even when set, blur never compounds (only the bottom-most blurs). Default
   *  false. */
  blur?: boolean;
  /** Let the child fully control its own size (width AND height), e.g. a big
   *  editor with an expand-to-fullscreen mode. LivingPopup centers it and plays
   *  the zoom, but imposes no width/max-height; the child keeps its own sizing
   *  classes. Implies card=false. Default false. */
  selfSize?: boolean;
  /** Close on the built-in Escape handler. Set false when the child owns Escape
   *  with its own precedence (e.g. an editor that closes a sub-panel first).
   *  Default true. */
  closeOnEscape?: boolean;
  /** Close when the scrim (outside the card) is clicked. Set false for forms
   *  that must not be dismissed by a stray outside click. Default true. */
  closeOnScrimClick?: boolean;
  /** Show the top-right close X. Set false when the child has its own close
   *  control (most big editors do). Default true. */
  showClose?: boolean;
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
  blur = false,
  selfSize = false,
  closeOnEscape = true,
  closeOnScrimClick = true,
  showClose = true,
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

  // Escape closes, unless the child owns Escape (closeOnEscape=false).
  useEffect(() => {
    if (!mounted || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mounted, onClose, closeOnEscape]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // Register in the shared popup stack while mounted. Blur is reserved for big
  // attention-demanding popups (the `blur` prop); little popups never blur. And
  // even among blurring popups only the bottom-most blurs, so blur never
  // compounds (Grant 2026-06-06).
  const { shouldBlur } = usePopupLayer(mounted, blur);

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

  // selfSize: a transparent transform wrapper that imposes no width/height, so
  // the child (a big editor with its own sizing + expand mode) renders exactly
  // as it would under a plain scrim. It spans the full width to give the child a
  // width to resolve against, but stays pointer-events-none so clicks in the
  // empty space beside the centered card fall through to the scrim (which
  // closes); the child MUST set pointer-events-auto on its own card to stay
  // interactive. Otherwise the standard sized card.
  const cardClass = selfSize
    ? "pointer-events-none w-full flex justify-center"
    : [
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
      {/* Scrim over the live page behind. Click closes. It always dims; it only
          blurs for a big attention-demanding popup (blur prop) that is the
          bottom-most blurring popup, so little popups never blur and blur never
          compounds (see popup-stack). preventDefault on mousedown so the scrim
          never STEALS FOCUS from the content: otherwise clicking out would blur
          a focused field, fire its onBlur (e.g. an editor's save) mid-close, and
          that async save could land after unmount and reopen the popup. The
          click still fires, so it still closes. */}
      <button
        type="button"
        aria-label={closeLabel}
        onMouseDown={(e) => e.preventDefault()}
        onClick={closeOnScrimClick ? onClose : undefined}
        className={`absolute inset-0 h-full w-full cursor-default bg-slate-900/25 ${
          shouldBlur ? "backdrop-blur-md" : ""
        }`}
        style={{ opacity: shown ? 1 : 0, transition: `opacity ${ANIM_MS}ms ease` }}
      />

      {/* Close affordance, top-right. Hidden when the child has its own close
          control (showClose=false). */}
      <div
        className="absolute right-4 top-4 z-10"
        style={{
          opacity: shown ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ease`,
          display: showClose ? undefined : "none",
        }}
      >
        <Tooltip label="Close" placement="bottom">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
            aria-label={closeLabel}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised/80 text-foreground-muted shadow ring-1 ring-black/5 backdrop-blur transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>

      {/* Centered content. fillHeight (or selfSize) = bounded/self-sized card
          centered with the children scrolling inside; otherwise the card grows
          to content and the whole popup scrolls. The scrim shows through except
          on the card, so clicking outside closes (unless closeOnScrimClick). */}
      {fillHeight || selfSize ? (
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
