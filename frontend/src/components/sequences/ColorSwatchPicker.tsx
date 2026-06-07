"use client";

// primer colors bot — a small, reusable COLOR SWATCH picker, factored out of the
// FeatureEditorDialog color UI so the primer Add / Edit dialogs share the exact
// same swatch row + custom-color input + "use default" reset. The palette is the
// shared FEATURE_COLOR_SWATCHES so a primer color reads the same as a feature
// color everywhere. No emojis (the custom-color affordance is a plain "+"), no
// em-dashes, no mid-sentence colons.

import { FEATURE_COLOR_SWATCHES } from "@/lib/sequences/feature-colors";

export default function ColorSwatchPicker({
  value,
  effectiveColor,
  onChange,
  onReset,
  resetLabel,
  disabled,
}: {
  /** The explicit color the user picked, or "" when none is set. */
  value: string;
  /** The color actually shown (explicit color, else the type default). Drives the
   *  custom-color input's swatch so it always reflects what the map will draw. */
  effectiveColor: string;
  onChange: (color: string) => void;
  /** Clear the explicit color back to the type default. Omitted -> no reset row. */
  onReset?: () => void;
  resetLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <span className="mb-1 block text-meta font-medium text-gray-500">Color</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {FEATURE_COLOR_SWATCHES.map((sw) => {
          const active = value.trim().toLowerCase() === sw.toLowerCase();
          return (
            <button
              key={sw}
              type="button"
              disabled={disabled}
              onClick={() => onChange(sw)}
              className={`h-6 w-6 rounded-md seq-swatch-border transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? "ring-2 ring-sky-500 ring-offset-1" : ""
              }`}
              style={{ backgroundColor: sw }}
              aria-label={`Set color ${sw}`}
            />
          );
        })}
        {/* Custom color */}
        <label
          className={`relative ml-1 flex h-6 w-6 items-center justify-center rounded-md seq-swatch-border ${
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          }`}
        >
          <input
            type="color"
            value={effectiveColor}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="h-6 w-6 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            aria-label="Custom color"
          />
          <span className="pointer-events-none absolute text-meta font-bold text-gray-500">+</span>
        </label>
      </div>
      {onReset ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onReset}
          className="mt-1.5 text-meta text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline disabled:cursor-not-allowed disabled:no-underline"
        >
          {resetLabel ?? "Use default"}
        </button>
      ) : null}
    </div>
  );
}
