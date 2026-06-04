"use client";

// overview slider bot — the OVERVIEW BAR'S ZOOM SLIDER.
//
// Repurposed from the old base/text-view zoom slider. This slider now drives the
// TOP overview bar's zoom (its bp EXTENT span), NOT the base/text view. It sits
// directly beside the SequenceOverviewBar so it reads as the overview's own zoom
// control. The base/text view keeps trackpad pinch-to-zoom plus the Fit button
// (no slider); this control never touches the detail-view zoom.
//
// TWO-WAY SYNC with the bar: the slider POSITION is derived from the live extent
// span (so a scroll / pinch over the bar moves the slider), and dragging the
// slider rescales the extent around its CENTER and emits the new extent (so the
// bar follows the slider). The span <-> slider mapping is the LOG-scale
// extentSpanToSlider / sliderToExtentSpan pair; the rescale reuses the bar's own
// center-anchored math. All icons are inline SVG (no emoji / no icon library).

import Tooltip from "@/components/Tooltip";
import {
  extentSpanToSlider,
  sliderToExtentSpan,
  rescaleExtentToSpan,
  overviewMinSpan,
  OVERVIEW_SLIDER_MIN,
  OVERVIEW_SLIDER_MAX,
} from "@/lib/sequences/sequence-zoom";

function IconMinus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={className} aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={className} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** One step nudges the slider by this many units (matches the old control feel). */
const STEP = 8;

export interface SequenceOverviewZoomSliderProps {
  seqLength: number;
  /** The overview bar's current bp EXTENT (its own zoom). */
  extent: { start: number; end: number };
  /** Emit a new extent when the slider rescales it (around its center). */
  onExtentChange: (extent: { start: number; end: number }) => void;
  /** The detail window span (bp visible in the base view). The minimum extent
   *  span is floored at this so the viewport box stays meaningful, mirroring the
   *  bar's own wheel-zoom floor. */
  winSpan: number;
}

export default function SequenceOverviewZoomSlider({
  seqLength,
  extent,
  onExtentChange,
  winSpan,
}: SequenceOverviewZoomSliderProps) {
  const len = Number.isFinite(seqLength) && seqLength > 0 ? seqLength : 0;
  const minSpan = overviewMinSpan(winSpan, len);

  const lo = Math.max(0, Math.min(len, extent.start));
  const hi = Math.max(lo, Math.min(len, extent.end));
  const span = Math.max(1, hi - lo);

  // Slider position derived from the live extent span (two-way sync: the bar's
  // own scroll / pinch zoom moves this).
  const sliderValue = extentSpanToSlider({ span, seqLength: len, minSpan });

  // A molecule shorter than the floor (or no sequence) can't be zoomed: the whole
  // thing is always shown, so disable the control rather than offer a dead slider.
  const disabled = len <= 0 || minSpan >= len;

  const setSlider = (next: number) => {
    if (disabled) return;
    const clamped = Math.max(OVERVIEW_SLIDER_MIN, Math.min(OVERVIEW_SLIDER_MAX, next));
    const targetSpan = sliderToExtentSpan({ slider: clamped, seqLength: len, minSpan });
    const nextExtent = rescaleExtentToSpan({
      extent: { start: lo, end: hi },
      seqLength: len,
      targetSpan,
      minSpan,
    });
    if (nextExtent.start === lo && nextExtent.end === hi) return;
    onExtentChange(nextExtent);
  };

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Overview zoom">
      <Tooltip label="Zoom out the overview">
        <button
          type="button"
          onClick={() => setSlider(sliderValue - STEP)}
          disabled={disabled || sliderValue <= OVERVIEW_SLIDER_MIN}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Zoom out the overview"
        >
          <IconMinus className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <input
        type="range"
        min={OVERVIEW_SLIDER_MIN}
        max={OVERVIEW_SLIDER_MAX}
        value={sliderValue}
        onChange={(e) => setSlider(Number(e.target.value))}
        disabled={disabled}
        aria-label="Overview zoom"
        className="h-1 w-28 cursor-pointer accent-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
      />
      <Tooltip label="Zoom in the overview">
        <button
          type="button"
          onClick={() => setSlider(sliderValue + STEP)}
          disabled={disabled || sliderValue >= OVERVIEW_SLIDER_MAX}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Zoom in the overview"
        >
          <IconPlus className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}
