"use client";

// Anchored header dropdown. The lightweight counterpart to LivingPopup, for the
// header cluster buttons (Timers, Companion) that should feel like a menu
// dropping out of the button rather than a full-screen modal. No dimmed scrim,
// no blur. The page behind stays interactive; the popover closes on Escape, on
// an outside click, or on the trigger's own onClose.
//
// Controlled: the parent owns `open` + `onClose` (same shape as the popup
// stores LivingPopup uses, so swapping is a drop-in). `origin` is the screen
// point the open was triggered from (the click on the header button); the card
// drops down just below it and right-aligns near it, clamped to the viewport.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface HeaderPopoverProps {
  open: boolean;
  /** Screen point the open was triggered from (header button click). */
  origin?: { x: number; y: number } | null;
  onClose: () => void;
  /** Card max-width Tailwind class. Default max-w-sm. */
  widthClassName?: string;
  /** Accessible label for the dialog. */
  label?: string;
  children: React.ReactNode;
}

export default function HeaderPopover({
  open,
  origin,
  onClose,
  widthClassName = "max-w-sm",
  label,
  children,
}: HeaderPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  // Entrance: scale + fade from the top-right corner once mounted.
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Close on outside click + Escape. The mousedown listener is armed on the next
  // tick so the click that opened the popover does not immediately close it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = window.setTimeout(
      () => document.addEventListener("mousedown", onDown),
      0,
    );
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // Drop below the trigger, right-aligned near it, clamped into the viewport.
  const pad = 8;
  const ox = origin?.x ?? window.innerWidth - 40;
  const oy = origin?.y ?? 52;
  const right = Math.max(pad, window.innerWidth - ox - 24);
  const top = Math.min(oy + 16, window.innerHeight - 80);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={{ top, right }}
      className={
        `fixed z-[120] ${widthClassName} w-[calc(100vw-1rem)] ` +
        "flex flex-col max-h-[min(75vh,640px)] rounded-2xl border border-border " +
        "bg-surface-raised ros-popup-card-shadow overflow-hidden origin-top-right " +
        "transition-[transform,opacity] duration-150 ease-out " +
        (shown ? "opacity-100 scale-100" : "opacity-0 scale-95")
      }
    >
      {children}
    </div>,
    document.body,
  );
}
