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

// Body-scroll lock, REF-COUNTED across all open popups.
//
// The old per-popup save/restore (`const prev = body.style.overflow; set hidden;
// cleanup: restore prev`) LEAKED with stacked or sequential popups: a second
// popup captured prev="hidden" (set by the first) and "restored" the lock on
// close, so the page stayed unscrollable forever (Grant hit this reviewing two
// popups in a row). A single shared counter fixes it: the FIRST popup saves the
// page's real overflow and locks; nested popups just increment; the LAST to close
// restores the saved value. Each returned releaser is idempotent so a double
// cleanup (e.g. React StrictMode in dev) cannot under-count.
let scrollLockCount = 0;
let scrollLockPrevOverflow = "";

function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (scrollLockCount === 0) {
    scrollLockPrevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
      document.body.style.overflow = scrollLockPrevOverflow;
    }
  };
}

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
  /** Vertical placement of the card. "center" floats it in the middle (default,
   *  every normal popup). "top" drops it from near the top of the viewport for a
   *  command-palette feel (the parent-task picker, BeakerSearch-style pickers).
   *  Horizontal placement is always centered. */
  align?: "center" | "top";
  /** Raise the popup above the normal z-[400] popup band to z-[440]. Reserve for
   *  a popup that must clear another high-z overlay (e.g. the v4 tour input lock
   *  at z-[420]). Default false. The shared popup stack (dim/blur) is mount-order
   *  based, so elevating only changes paint order, not the dim logic. */
  elevated?: boolean;
  /** Keep Tab / Shift+Tab focus cycling INSIDE the popup (WCAG 2.4.3), so
   *  keyboard focus cannot wander into the page behind the scrim. Default true.
   *  Set false for an intentionally NON-MODAL surface (e.g. a command-palette
   *  dock that must let focus flow to the page). The trap is also auto-skipped
   *  for `selfSize` popups, which are big editors / pickers that own their own
   *  focus management. */
  trapFocus?: boolean;
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
  align = "center",
  elevated = false,
  trapFocus = true,
  children,
}: LivingPopupProps) {
  // mounted: in the DOM (stays true through the exit animation).
  // shown: animated to the expanded/visible state.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
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

  // Register in the shared popup stack while mounted. This drives blur/dim (see
  // below) AND `isTop`, which the Escape handler uses to coordinate stacked
  // overlays. Called here, above the Escape effect, so isTop is available to it.
  const { shouldBlur, shouldDim, isTop } = usePopupLayer(mounted, blur);

  // Escape closes, unless the child owns Escape (closeOnEscape=false).
  //
  // NESTING: only the TOP-most popup in the shared stack acts on a press, so one
  // Escape closes exactly one layer (the innermost / last-opened), then the next
  // press closes the one below. We gate on `isTop` (mount-order state) rather
  // than event/effect order, because the popup's two-phase mount means listener
  // registration order is not reliably innermost-first. When we DO act we also
  // mirror useEscapeToClose, mark the event handled (preventDefault +
  // stopPropagation) so a parent that listens on window (e.g. NoteDetailPopup,
  // TaskDetailPopup) does not also advance its own state machine on the same
  // press. isTop is in the deps so the listener re-binds with a fresh value when
  // a popup opens or closes above this one.
  useEffect(() => {
    if (!mounted || !closeOnEscape || !isTop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      onClose();
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mounted, onClose, closeOnEscape, isTop]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // Lock background scroll while the popup is mounted, so a trackpad scroll over
  // the popup (e.g. the chemistry editor canvas) does not chain through to the
  // page behind the scrim. Ref-counted (lockBodyScroll) so stacked / sequential
  // popups nest correctly and the LAST to unmount restores the page's original
  // overflow. On macOS overlay scrollbars there is no width to compensate, so no
  // layout shift.
  useEffect(() => {
    if (!mounted) return;
    return lockBodyScroll();
  }, [mounted]);

  // Focus trap (a11y, WCAG 2.4.3): keep Tab / Shift+Tab cycling within the popup
  // so keyboard focus cannot wander into the live page behind the scrim. Scoped
  // to the OVERLAY root, so the scrim/close-X (siblings of the card) are part of
  // the cycle too. Skipped for `selfSize` popups (big editors / command-palette
  // pickers that own their own focus management) and when `trapFocus` is off
  // (intentionally non-modal surfaces). Cooperates with the Escape/scrim logic,
  // it only handles the Tab key and never calls onClose.
  // A popup is "modal" when it confines focus: standard sized, not opted out.
  // selfSize popups (big editors / command-palette pickers) and trapFocus=false
  // surfaces are non-modal and neither trap focus nor claim aria-modal.
  const isModal = trapFocus && !selfSize;
  useEffect(() => {
    if (!mounted || !isModal) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const getFocusables = (): HTMLElement[] =>
      Array.from(
        overlay.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
    // Land focus inside the popup on open, UNLESS a child already grabbed it
    // (e.g. an autofocused input). Prefer the card so the first Tab starts in
    // the content, not on the scrim/close control. Children that autofocus via
    // their own effect run first (child effects precede parent effects), so this
    // never overrides an intentional initial focus; setTimeout-based autofocus
    // lands a tick later and still wins.
    if (!overlay.contains(document.activeElement)) {
      try {
        (cardRef.current ?? overlay).focus();
      } catch {
        // ignore in non-DOM test environments
      }
    }
    const onTrapKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = getFocusables();
      if (focusables.length === 0) {
        // Nothing tabbable inside: pin focus on the card so Tab can't escape.
        e.preventDefault();
        cardRef.current?.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !overlay.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !overlay.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener("keydown", onTrapKeyDown);
    return () => overlay.removeEventListener("keydown", onTrapKeyDown);
  }, [mounted, isModal]);

  // (Stack membership is registered above, where isTop is also read. Blur is
  // reserved for big attention-demanding popups via the `blur` prop; little
  // popups never blur, and even among blurring popups only the bottom-most blurs
  // so blur never compounds (Grant 2026-06-06).)

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
        // A popup must always read as a contained surface. It sits on the top
        // elevation (bg-surface-overlay, lighter than the page and than inner
        // cards in dark mode) AND carries a real border, because the shadow/ring
        // are black and invisible on a dark background. Without this a popup is
        // the same near-black as the page and disappears (Grant 2026-06-08).
        card
          ? "rounded-2xl bg-surface-overlay border border-border shadow-2xl ring-1 ring-black/5"
          : "",
        padded ? "p-6 sm:p-8" : "",
        fillHeight ? "max-h-[88vh] flex flex-col overflow-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ");

  const cardEl = (
    <div
      ref={cardRef}
      tabIndex={-1}
      className={cardClass}
      style={cardStyle}
      role="dialog"
      aria-modal={isModal ? "true" : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 ${elevated ? "z-[440]" : "z-[400]"}`}
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
        className={`absolute inset-0 h-full w-full cursor-default ${
          shouldDim ? "bg-slate-900/25" : ""
        } ${shouldBlur ? "backdrop-blur-md" : ""}`}
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
        <div
          className={`pointer-events-none absolute inset-0 flex justify-center ${
            align === "top" ? "items-start px-4 pt-[10vh]" : "items-center p-4"
          }`}
        >
          {cardEl}
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 overflow-y-auto">
          <div
            className={`flex min-h-full flex-col items-center px-4 ${
              align === "top" ? "justify-start pt-[10vh] pb-10" : "justify-center py-10"
            }`}
          >
            {cardEl}
          </div>
        </div>
      )}
    </div>
  );
}
