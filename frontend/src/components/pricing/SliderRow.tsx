"use client";

/**
 * A labelled range slider used across the /pricing calculators. The value badge
 * reads in brand-action, matching the approved mockup's .gbval / .gbslider.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

export default function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  ariaLabel,
  onChange,
}: {
  label: string;
  value: number;
  /** What the value badge shows (e.g. "60%"). Defaults to the raw value. */
  display?: string;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mb-3.5">
      <label className="mb-2 flex items-center justify-between text-[12.5px] font-semibold text-foreground">
        {label}
        <span className="font-extrabold tabular-nums text-brand-action">
          {display ?? value}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-[color:var(--color-brand-action)]"
      />
    </div>
  );
}
