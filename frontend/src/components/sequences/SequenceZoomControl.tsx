"use client";

// seq nav bot — the SEAMLESS ZOOM CONTROL for the linear/circular viewer.
//
// A horizontal slider (0-100) wired straight to SeqViz's `zoom.linear` (or
// `zoom.circular`), flanked by zoom-out / zoom-in step buttons and a "Fit / Map"
// button that snaps to the full overview map (MAP MODE) at the low end. Dragging
// the slider zooms smoothly from whole-sequence overview (low) to base level
// (high). All icons are inline SVG (no emoji / no icon library, per convention).

import Tooltip from "@/components/Tooltip";
import {
  MAP_ZOOM,
  MIN_LINEAR_ZOOM,
  MAX_LINEAR_ZOOM,
  clampLinearZoom,
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
// Fit / Map — a frame-to-fit / "show the whole map" glyph.
function IconFitMap({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 8V5a2 2 0 0 1 2-2h3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  );
}

const STEP = 8;

export interface SequenceZoomControlProps {
  /** Current zoom (0-100). */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Which knob this drives — only affects the label / Fit-target. */
  axis: "linear" | "circular";
  /** nav polish bot — the lowest zoom this control may reach. The Sequence view
   *  passes SEQUENCE_MIN_LINEAR_ZOOM so the slider floor matches the floored
   *  view (the whole-molecule map lives on the Map tab, not the slider bottom).
   *  Defaults to MIN_LINEAR_ZOOM. */
  minZoom?: number;
}

export default function SequenceZoomControl({
  zoom,
  onZoomChange,
  axis,
  minZoom = MIN_LINEAR_ZOOM,
}: SequenceZoomControlProps) {
  const floor = Math.max(MIN_LINEAR_ZOOM, minZoom);
  const set = (z: number) => onZoomChange(Math.min(MAX_LINEAR_ZOOM, Math.max(floor, clampLinearZoom(z))));
  // The "Fit" button snaps to this control's floor (full zoom-out for THIS view).
  const atFloor = axis === "linear" && zoom <= floor;

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Zoom">
      <Tooltip label="Zoom out">
        <button
          type="button"
          onClick={() => set(zoom - STEP)}
          disabled={zoom <= floor}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Zoom out"
        >
          <IconMinus className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <input
        type="range"
        min={axis === "linear" ? floor : MIN_LINEAR_ZOOM}
        max={MAX_LINEAR_ZOOM}
        value={Math.max(zoom, axis === "linear" ? floor : MIN_LINEAR_ZOOM)}
        onChange={(e) => set(Number(e.target.value))}
        aria-label={`${axis === "linear" ? "Linear" : "Circular"} zoom`}
        className="h-1 w-28 cursor-pointer accent-sky-600"
      />
      <Tooltip label="Zoom in">
        <button
          type="button"
          onClick={() => set(zoom + STEP)}
          disabled={zoom >= MAX_LINEAR_ZOOM}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Zoom in"
        >
          <IconPlus className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      {axis === "linear" ? (
        <Tooltip label="Fit (zoom out fully; the whole-molecule map is the Map tab)">
          <button
            type="button"
            onClick={() => set(floor)}
            aria-pressed={atFloor}
            className={`flex h-6 items-center gap-1 rounded px-1.5 text-meta font-medium transition-colors ${
              atFloor ? "bg-sky-50 text-sky-700" : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            }`}
          >
            <IconFitMap className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Fit</span>
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

export { MAP_ZOOM };
