"use client";

// ScrollableNumberInput (Data Hub graphs slice). A number box where hovering it
// and scrolling the wheel nudges the value, the way Adobe / Figma size fields
// work, instead of scrolling the page. The why: tuning a figure's width or DPI
// by a few units is faster with a flick of the wheel than selecting and
// retyping, and the page scroll is suppressed only while the pointer is over the
// box so scrolling anywhere else is unaffected.
//
// The wheel listener is attached natively with { passive: false } because
// React's synthetic onWheel cannot reliably call preventDefault on a passive
// listener. Typing still works as a normal number input.

import { useEffect, useRef } from "react";

/** Count the decimal places a step implies, so wheel steps round cleanly and do
 * not drift into float noise (0.1 + 0.2 style). */
function decimalsOf(step: number): number {
  if (!Number.isFinite(step)) return 0;
  const s = String(step);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Round a value to the given number of decimal places. */
function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export default function ScrollableNumberInput({
  value,
  onChange,
  step = 1,
  bigStep,
  min,
  max,
  ariaLabel,
  className,
  ...rest
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  /** The step used while Shift is held (defaults to step * 10). */
  bigStep?: number;
  min?: number;
  max?: number;
  ariaLabel?: string;
  className?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "step" | "min" | "max" | "type"
>) {
  const ref = useRef<HTMLInputElement>(null);

  // Keep the live props in a ref so the native wheel listener (attached once)
  // always reads the current value / bounds without re-binding on every render.
  const stateRef = useRef({ value, onChange, step, bigStep, min, max });
  stateRef.current = { value, onChange, step, bigStep, min, max };

  const clamp = (n: number): number => {
    const { min: lo, max: hi } = stateRef.current;
    let out = n;
    if (lo != null && out < lo) out = lo;
    if (hi != null && out > hi) out = hi;
    return out;
  };

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const onWheel = (e: WheelEvent) => {
      // Only steal the wheel while the box is actually under the pointer or
      // focused, so the page scrolls normally everywhere else.
      const active =
        node === document.activeElement || node.matches(":hover");
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();

      const s = stateRef.current;
      const effStep = e.shiftKey ? s.bigStep ?? s.step * 10 : s.step;
      const decimals = decimalsOf(effStep);
      // deltaY < 0 is a scroll up, which increments.
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = clamp(roundTo(s.value + dir * effStep, decimals));
      if (next !== s.value) s.onChange(next);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
    // The listener reads everything through stateRef, so it only needs to bind
    // once for the lifetime of the node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") return; // let the field be empty mid-edit without snapping
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange(clamp(parsed));
  };

  return (
    <input
      ref={ref}
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={onInput}
      aria-label={ariaLabel}
      className={className}
      {...rest}
    />
  );
}
