"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { isTooltipFocusSuppressed } from "./tooltip-focus";

type Placement = "top" | "bottom" | "left" | "right";

interface Props {
  /** Short, action-oriented label, e.g. "Open settings". */
  label: string;
  /** Where the tooltip pops relative to the child. Default "bottom". */
  placement?: Placement;
  /** Single trigger element (Link / button / div with a hover surface). */
  children: ReactElement<Record<string, unknown>>;
  /** Delay before showing on hover, in ms. Default 80. */
  showDelayMs?: number;
  /**
   * Controlled-open mode (lab overview PI tooltips manager, 2026-05-25,
   * Chip B). When set, the tooltip's visibility is driven by this prop
   * instead of hover/focus state. `true` keeps the bubble open until
   * the parent flips it to `false` (e.g. on outside-click). `false`
   * forces it closed and disables the hover handlers. `undefined` (the
   * default) keeps the original hover/focus behavior — every existing
   * caller is unaffected.
   *
   * Used by `WidgetHelpBadge` to drive the one-shot auto-open on the
   * /lab-overview first-paint tooltip; the parent component owns the
   * dismiss flow so click-anywhere-to-close works regardless of where
   * the user clicks.
   */
  open?: boolean;
  /**
   * Optional rich body (lab overview PI tooltips manager, 2026-05-25,
   * Chip B). When supplied, the tooltip bubble renders this multi-line
   * description below the headline `label`, wraps long lines (instead
   * of the default whitespace-nowrap), and uses a slightly wider
   * card style suited to 1-2 sentence explanatory copy. Falls back to
   * the original single-line label-only rendering when unset, so every
   * existing caller is unaffected.
   */
  body?: string;
  /**
   * Optional visual variant (Mira PI R1 fix manager, Fix 6,
   * 2026-05-25). When set to `"firstPaintHint"`, the bubble switches to
   * a light card with a sky-blue BeakerBot header + a "Got it" CTA at
   * the bottom, so the auto-opened first-paint tooltip reads as a
   * deliberate guided hint rather than an accidental hover. The CTA
   * fires `onPrimaryAction` when clicked. Defaults to undefined =
   * default dark-card hover styling. Hover-opened + click-opened
   * tooltips on the same trigger continue to use the default variant.
   */
  variant?: "firstPaintHint";
  /**
   * Optional CTA handler for the `firstPaintHint` variant. The bubble
   * renders a "Got it" button that calls this; the caller is
   * responsible for closing the bubble via the `open` prop. Unused for
   * other variants.
   */
  onPrimaryAction?: () => void;
}

const GAP = 6;

/**
 * Merge an arbitrary number of refs (callback or RefObject, possibly null)
 * into a single callback ref. Each consumer's ref is updated on mount /
 * unmount, so wrapping a child with an existing `ref={…}` no longer loses
 * that ref. Inline helper — no extra dependency.
 */
function composeRefs<T>(...refs: Array<Ref<T> | undefined | null>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") {
        ref(node);
      } else {
        // React's MutableRefObject is intentionally writable; the readonly
        // RefObject type used to bar this assignment but the runtime shape
        // is identical, so cast to the mutable form.
        (ref as { current: T | null }).current = node;
      }
    }
  };
}

/**
 * Portal-rendered hover/focus tooltip.
 *
 * The label is appended to `document.body` with `position: fixed` and
 * coordinates derived from the trigger's bounding rect — so it can never
 * be clipped by an `overflow: hidden` / `overflow: auto` ancestor (e.g.
 * the scrollable sidebar) or hidden behind sibling icons with their own
 * stacking contexts.
 *
 * We clone the single child rather than wrapping it, which preserves the
 * trigger's exact layout. The injected `group` class keeps any existing
 * `group-hover:*` utilities on descendants (e.g. the gear icon's
 * rotate-90 hover animation) working as a side benefit.
 */
export default function Tooltip({
  label,
  placement = "bottom",
  children,
  showDelayMs = 80,
  open,
  body,
  variant,
  onPrimaryAction,
}: Props) {
  const triggerElRef = useRef<HTMLElement | null>(null);
  // Mira PI R1 Fix 6 (2026-05-25): the tooltipRef points at EITHER the
  // default <span> bubble OR the firstPaintHint <div> card; both shapes
  // expose getBoundingClientRect() via the base HTMLElement type, so
  // typing the ref as HTMLElement covers both variants without forcing
  // the call sites to branch.
  const tooltipRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | null>(null);

  const [hoverVisible, setHoverVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  // Visibility resolves to the controlled `open` prop when set,
  // otherwise the hover/focus state. The hover state is still
  // maintained while controlled so a parent that flips `open` back to
  // undefined later picks up the user's current hover.
  const isControlled = open !== undefined;
  const visible = isControlled ? open === true : hoverVisible;

  useEffect(() => setMounted(true), []);

  // When controlled visibility flips closed, clear the cached
  // position so a subsequent open recomputes against the current
  // trigger rect (the trigger may have scrolled / resized in between).
  useEffect(() => {
    if (!visible) setPos(null);
  }, [visible]);

  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!visible || !triggerElRef.current) return;
    const trigger = triggerElRef.current.getBoundingClientRect();
    const tt = tooltipRef.current?.getBoundingClientRect();
    const ttW = tt?.width ?? 0;
    const ttH = tt?.height ?? 0;

    let top = 0;
    let left = 0;
    switch (placement) {
      case "top":
        top = trigger.top - ttH - GAP;
        left = trigger.left + trigger.width / 2 - ttW / 2;
        break;
      case "bottom":
        top = trigger.bottom + GAP;
        left = trigger.left + trigger.width / 2 - ttW / 2;
        break;
      case "left":
        top = trigger.top + trigger.height / 2 - ttH / 2;
        left = trigger.left - ttW - GAP;
        break;
      case "right":
        top = trigger.top + trigger.height / 2 - ttH / 2;
        left = trigger.right + GAP;
        break;
    }

    // Clamp to viewport so long labels near the edge stay fully visible
    // rather than getting cut off.
    const MARGIN = 4;
    const maxLeft = Math.max(MARGIN, window.innerWidth - ttW - MARGIN);
    const maxTop = Math.max(MARGIN, window.innerHeight - ttH - MARGIN);
    left = Math.max(MARGIN, Math.min(left, maxLeft));
    top = Math.max(MARGIN, Math.min(top, maxTop));

    setPos({ top, left });
  }, [visible, placement, label]);

  const handleEnter = useCallback(() => {
    if (isControlled) return;
    if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = window.setTimeout(() => {
      setHoverVisible(true);
    }, showDelayMs);
  }, [showDelayMs, isControlled]);

  const handleLeave = useCallback(() => {
    if (isControlled) return;
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    setHoverVisible(false);
    setPos(null);
  }, [isControlled]);

  // Focus reveal, but skip it when focus arrived via focusWithoutTooltip() (a
  // programmatic restore/return to this trigger). Keyboard-tab focus still
  // reveals; only the stray "focus came back after a close" bubble is muted.
  const handleFocus = useCallback(() => {
    if (isTooltipFocusSuppressed()) return;
    handleEnter();
  }, [handleEnter]);

  const captureRef = useCallback((el: HTMLElement | null) => {
    triggerElRef.current = el;
  }, []);

  // Preserve the child's existing ref by composing it with our own
  // captureRef. Without this, `cloneElement` would overwrite the
  // original ref, breaking patterns like
  // `<button ref={(el) => map.current.set(id, el)} />` inside <Tooltip>.
  // The composed ref fans out the DOM node to every consumer.
  //
  // React 19 note: `ref` is now a regular prop (`element.ref` access is
  // removed), so we read it from `child.props.ref`.
  const child = Children.only(children);
  type ChildProps = { className?: string; ref?: Ref<HTMLElement> };
  const original = (isValidElement(child) ? child.props : {}) as ChildProps;
  const childRef = original.ref ?? null;
  // captureRef and childRef are callback refs; composeRefs returns a new
  // callback ref that React invokes with the DOM node at mount/unmount.
  // Nothing reads `.current` during render.
  const composedRef = useMemo(
    // eslint-disable-next-line react-hooks/refs
    () => composeRefs<HTMLElement>(captureRef, childRef),
    [captureRef, childRef],
  );

  if (!isValidElement(child)) return <>{children}</>;

  const merged: Record<string, unknown> = {
    className: [original.className, "group"].filter(Boolean).join(" "),
    onMouseEnter: handleEnter,
    onMouseLeave: handleLeave,
    onFocus: handleFocus,
    onBlur: handleLeave,
    ref: composedRef,
  };

  return (
    <>
      {/* eslint-disable-next-line react-hooks/refs -- merged passes a
          callback ref + memoised handlers; nothing reads .current here. */}
      {cloneElement(child, merged)}
      {mounted &&
        visible &&
        createPortal(
          variant === "firstPaintHint" && body ? (
            // Mira PI R1 fix manager (Fix 6, 2026-05-25): the
            // first-paint-hint variant. A light card with a sky-blue
            // BeakerBot header strip + "Got it" CTA at the bottom, so
            // the auto-opened tooltip reads as a deliberate guided
            // moment instead of an accidental hover hint. Larger
            // typography (text-meta instead of text-meta), a stronger
            // shadow + sky ring, and `pointer-events: auto` so the
            // CTA is clickable. Uses the same positioning math as the
            // default variant.
            <div
              ref={tooltipRef as RefObject<HTMLDivElement>}
              role="tooltip"
              data-firstpaint-hint
              style={{
                position: "fixed",
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                opacity: pos ? 1 : 0,
                transition: "opacity 100ms",
                pointerEvents: "auto",
                zIndex: 1000,
                maxWidth: 300,
              }}
              className="rounded-lg bg-surface-raised text-foreground text-meta shadow-xl ring-1 ring-sky-300 overflow-hidden"
            >
              {/* Header strip — sky tint + inline BeakerBot mark.
                  Matches the project's BeakerBot color (sky-500) so the
                  hint reads as the same mascot voice the v4 tour uses.
                  firstPaintHint mascot-icon fix manager (2026-05-25): the
                  inline SVG below is the canonical BeakerBot silhouette
                  copied directly from `components/BeakerBot.tsx` (idle
                  pose, no liquid, no animation), trimmed to the static
                  geometry a 14px decorative badge needs. We inline the
                  paths instead of mounting the full `<BeakerBot>`
                  component because that component is ~1600 lines of
                  animation + easter-egg state (hearts, click pop,
                  cursor:pointer), none of which is appropriate
                  for a passive header badge inside a tooltip card. The
                  inline copy keeps the badge purely decorative and
                  matches the BeakerBot brand mark (sky-500, beaker
                  silhouette + face) per the project's mascot-is-BeakerBot
                  rule. */}
              <div className="flex items-center gap-1.5 bg-surface-sunken dark:bg-sky-500/15 px-3 py-1.5 border-b border-border">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 40 40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="text-sky-500 flex-shrink-0"
                >
                  {/* Hair flick: small curl at the top, anime-ish */}
                  <path d="M22 8 C 22 6, 24 4, 26 6" />
                  {/* Body: rounded-bottom beaker silhouette */}
                  <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
                  {/* Beaker lip */}
                  <path d="M11 12 L29 12" />
                  {/* Eyes */}
                  <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="23" cy="18" r="1.2" fill="currentColor" stroke="none" />
                  {/* Smile */}
                  <path d="M18 22 Q 20 24, 22 22" />
                  {/* Measurement-mark cheek dashes */}
                  <path d="M14 26 L15.5 26" />
                  <path d="M24.5 26 L26 26" />
                </svg>
                <span className="text-meta uppercase tracking-wide font-semibold text-sky-700 dark:text-sky-300">
                  Quick tip
                </span>
              </div>
              <div className="px-3 pt-2.5 pb-2">
                <span className="block font-semibold text-foreground mb-1 text-meta">
                  {label}
                </span>
                <span className="block font-normal text-foreground-muted leading-snug">
                  {body}
                </span>
              </div>
              {onPrimaryAction ? (
                <div className="px-3 pb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPrimaryAction();
                    }}
                    className="text-meta font-medium text-sky-700 dark:text-sky-300 hover:text-sky-900 bg-sky-50 dark:bg-brand-action/15 hover:bg-sky-100 dark:hover:bg-brand-action/20 px-2 py-0.5 rounded transition-colors"
                  >
                    Got it
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <span
              ref={tooltipRef as RefObject<HTMLSpanElement>}
              role="tooltip"
              style={{
                position: "fixed",
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                opacity: pos ? 1 : 0,
                transition: "opacity 100ms",
                pointerEvents: "none",
                zIndex: 1000,
                // When a multi-line body is supplied, switch from the
                // single-line nowrap shape to a wider card. The
                // multi-line variant needs a max-width so long sentences
                // wrap instead of stretching across the viewport.
                maxWidth: body ? 280 : undefined,
                whiteSpace: body ? "normal" : "nowrap",
              }}
              className={
                body
                  ? "rounded-md bg-surface-overlay text-foreground border border-border text-meta font-medium px-2.5 py-1.5 shadow-lg leading-snug"
                  : "whitespace-nowrap rounded-md bg-surface-overlay text-foreground border border-border text-meta font-medium px-2 py-1 shadow-lg"
              }
            >
              {body ? (
                <>
                  <span className="block font-semibold mb-1">{label}</span>
                  <span className="block font-normal text-foreground-muted">{body}</span>
                </>
              ) : (
                label
              )}
            </span>
          ),
          document.body,
        )}
    </>
  );
}
