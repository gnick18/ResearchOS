"use client";

// ScrollArea: the app's custom overlay scrollbar (the approved standard,
// Grant 2026-06-14). A native scrollbar can't animate its thumb size or hold a
// pill shape, so this hides the native bar and draws its own thumb:
//   - pill shape: a min length + full radius, so it never stretches tall or
//     shrinks to a dot; the LENGTH tracks the content ratio, the WIDTH is fixed.
//   - dim at rest, a touch brighter WHILE scrolling (settles back after idle),
//   - hover and grab share one dark tone; GRAB only changes the SIZE (a smooth
//     back-eased grow that lands with a small snap, settling back on release).
//
// Wrap any scroll region: the outer wrapper takes layout classes (h-full,
// flex-1 min-h-0, a fixed height, rounding), the viewport scrolls. Forward
// `viewportProps` (role / tabIndex / aria / onKeyDown / data-testid) and
// `viewportRef` when the caller needs to own the scroll element (focus, keyboard
// nav). The thumb tint rides on --foreground so it reads on light and dark.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

export interface ScrollAreaProps {
  children: ReactNode;
  /** Classes on the outer relative wrapper (layout: h-full / flex-1 min-h-0 /
   *  a fixed height, rounding, borders). */
  className?: string;
  /** Classes on the inner scrolling viewport (padding, etc.). */
  viewportClassName?: string;
  /** Ref to the scrolling viewport (focus / scroll control). */
  viewportRef?: Ref<HTMLDivElement>;
  /** Props spread onto the viewport (role, tabIndex, aria-*, onKeyDown,
   *  data-testid, ...). */
  viewportProps?: HTMLAttributes<HTMLDivElement>;
}

const MIN_THUMB = 44;
const SETTLE_MS = 700;

export default function ScrollArea({
  children,
  className = "",
  viewportClassName = "",
  viewportRef,
  viewportProps,
}: ScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState({ height: 0, top: 0, visible: false });
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false); // brightened while scrolling
  const activityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const drag = useRef<{ startY: number; startScrollTop: number } | null>(null);

  // Merge the internal scroll ref with the caller's viewportRef.
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      if (typeof viewportRef === "function") viewportRef(node);
      else if (viewportRef)
        (viewportRef as { current: HTMLDivElement | null }).current = node;
    },
    [viewportRef],
  );

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setThumb((t) => (t.visible ? { ...t, visible: false } : t));
      return;
    }
    const trackH = clientHeight;
    const h = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * trackH);
    const maxTop = trackH - h;
    const top = (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    setThumb({ height: h, top, visible: true });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recompute();
    const onScroll = () => {
      recompute();
      setActive(true);
      if (activityTimer.current) clearTimeout(activityTimer.current);
      activityTimer.current = setTimeout(() => setActive(false), SETTLE_MS);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (activityTimer.current) clearTimeout(activityTimer.current);
    };
  }, [recompute]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    drag.current = { startY: e.clientY, startScrollTop: el.scrollTop };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const { scrollHeight, clientHeight } = el;
    const thumbH = Math.max(
      MIN_THUMB,
      (clientHeight / scrollHeight) * clientHeight,
    );
    const maxTop = clientHeight - thumbH;
    const range = scrollHeight - clientHeight;
    const deltaY = e.clientY - drag.current.startY;
    el.scrollTop = drag.current.startScrollTop + (deltaY / maxTop) * range;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    setDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be released
    }
  }, []);

  // Tone: rest (dim) / scrolling (a touch brighter) / hover + grab (dark). Grab
  // shares the hover tone; the ONLY thing grab changes is the size.
  const pct = dragging || hover ? 42 : active ? 30 : 14;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={setRefs}
        {...viewportProps}
        className={`ros-hide-native-scroll h-full overflow-y-auto ${viewportClassName} ${viewportProps?.className ?? ""}`}
      >
        {children}
      </div>

      {thumb.visible && (
        <div className="pointer-events-none absolute inset-y-0 right-[2px] w-3">
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerEnter={() => setHover(true)}
            onPointerLeave={() => setHover(false)}
            aria-hidden
            className="pointer-events-auto absolute left-1/2 top-0 cursor-default rounded-full"
            style={{
              height: thumb.height,
              width: dragging ? 10 : 6,
              transform: `translateX(-50%) translateY(${thumb.top}px)`,
              backgroundColor: `color-mix(in srgb, var(--foreground) ${pct}%, transparent)`,
              transition:
                "width 160ms cubic-bezier(0.34, 1.56, 0.64, 1), background-color 160ms ease",
            }}
          />
        </div>
      )}
    </div>
  );
}
