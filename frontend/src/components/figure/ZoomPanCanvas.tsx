"use client";

// An Illustrator-style pan / zoom viewport for a figure (the phylo Studio tree
// and the Data Hub graph). View-only: it transforms what is shown on screen, it
// never changes the figure or its export. Drag to pan, scroll to zoom centered on
// the cursor, +/- buttons, Center (fit + recenter), and Fullscreen. When zoomed in
// past the viewport, a corner minimap shows the whole figure with a draggable
// viewport box for a second way to navigate.
//
// House style: <Icon> only, no inline svg, no emojis / em-dashes / mid-sentence
// colons.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 12;
const MINIMAP_W = 150;
const DRAG_THRESHOLD = 3; // px of movement before a press becomes a pan, not a click

export default function ZoomPanCanvas({
  contentWidth,
  contentHeight,
  children,
  minimap,
  className = "",
}: {
  /** Natural (unscaled) figure width in px, for fit + minimap geometry. */
  contentWidth: number;
  /** Natural (unscaled) figure height in px. */
  contentHeight: number;
  /** The figure content (rendered at its natural size). */
  children: React.ReactNode;
  /** Optional thumbnail content for the minimap (usually the same figure svg). */
  minimap?: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const viewport = useCallback(() => {
    const el = containerRef.current;
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  }, []);

  // Fit the figure to the viewport, centered. Used on mount + by Center.
  const center = useCallback(() => {
    const { w, h } = viewport();
    if (w === 0 || h === 0) return;
    const z = Math.min(w / contentWidth, h / contentHeight, 1) * 0.95 || 1;
    setZoom(z);
    setPan({ x: (w - contentWidth * z) / 2, y: (h - contentHeight * z) / 2 });
  }, [viewport, contentWidth, contentHeight]);

  // Track the viewport size (for the minimap rect + zoom-to-center) and fit once
  // a real size is known.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit on first real size, then whenever the figure's natural size changes.
  const didFit = useRef(false);
  useEffect(() => {
    if (!didFit.current && size.w > 0) {
      didFit.current = true;
      center();
    }
  }, [size.w, center]);
  useEffect(() => {
    center();
    // re-fit when the figure dimensions change
  }, [contentWidth, contentHeight, center]);

  // Zoom toward an anchor point (in viewport coords), keeping it fixed.
  const zoomToward = useCallback((factor: number, ax: number, ay: number) => {
    setZoom((z) => {
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      setPan((p) => ({
        x: ax - ((ax - p.x) / z) * nz,
        y: ay - ((ay - p.y) / z) * nz,
      }));
      return nz;
    });
  }, []);

  // Scroll to zoom centered on the cursor. A native non-passive listener so we
  // can preventDefault (stop the page scrolling).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomToward(
        Math.exp(-e.deltaY * 0.0015),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomToward]);

  // Drag to pan, with a small threshold so a click still passes through to the
  // figure (the Data Hub legend recolor, etc.).
  const drag = useRef<{
    x: number;
    y: number;
    px: number;
    py: number;
    active: boolean;
  } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, active: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.active) {
      d.active = true;
      setGrabbing(true);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    setPan({ x: d.px + dx, y: d.py + dy });
  };
  const onPointerUp = () => {
    drag.current = null;
    setGrabbing(false);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) void el.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };

  // Minimap: a scaled thumbnail of the whole figure plus a draggable rectangle
  // marking the visible region. Shown only when zoomed in past the viewport.
  const miniScale = MINIMAP_W / contentWidth;
  const miniH = contentHeight * miniScale;
  const view = {
    x: (-pan.x / zoom) * miniScale,
    y: (-pan.y / zoom) * miniScale,
    w: (size.w / zoom) * miniScale,
    h: (size.h / zoom) * miniScale,
  };
  const showMinimap =
    size.w > 0 && (view.w < MINIMAP_W - 1 || view.h < miniH - 1);

  const miniDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null,
  );
  const onMiniDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    miniDrag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMiniMove = (e: React.PointerEvent) => {
    const d = miniDrag.current;
    if (!d) return;
    e.stopPropagation();
    // A drag of the viewport box by (dx, dy) screen px moves the box over the
    // figure, which pans the main view the opposite way (in figure px * zoom).
    const dx = (e.clientX - d.x) / miniScale;
    const dy = (e.clientY - d.y) / miniScale;
    setPan({ x: d.px - dx * zoom, y: d.py - dy * zoom });
  };
  const onMiniUp = () => {
    miniDrag.current = null;
  };

  const btn =
    "flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface/90 text-foreground shadow-sm transition-colors hover:bg-surface-sunken";

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-surface ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ cursor: grabbing ? "grabbing" : "grab", touchAction: "none" }}
    >
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          width: contentWidth,
          height: contentHeight,
        }}
      >
        {children}
      </div>

      {/* Controls (top-right). Icon-only buttons carry a Tooltip + aria-label
          (house rule); the controls never start a pan (stop pointer here). */}
      <div
        className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Tooltip label="Zoom in">
          <button
            type="button"
            aria-label="Zoom in"
            className={btn}
            onClick={() => zoomToward(1.25, size.w / 2, size.h / 2)}
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Zoom out">
          <button
            type="button"
            aria-label="Zoom out"
            className={btn}
            onClick={() => zoomToward(1 / 1.25, size.w / 2, size.h / 2)}
          >
            <Icon name="minus" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Fit to view">
          <button
            type="button"
            aria-label="Fit to view"
            className={btn}
            onClick={center}
          >
            <Icon name="focus" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Fullscreen">
          <button
            type="button"
            aria-label="Fullscreen"
            className={btn}
            onClick={toggleFullscreen}
          >
            <Icon name="scan" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Reset zoom to 100%">
          <button
            type="button"
            aria-label="Reset zoom to 100%"
            onClick={() => {
              const { w, h } = viewport();
              setZoom(1);
              setPan({
                x: (w - contentWidth) / 2,
                y: (h - contentHeight) / 2,
              });
            }}
            className="rounded-md border border-border bg-surface/90 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground-muted shadow-sm transition-colors hover:bg-surface-sunken"
          >
            {Math.round(zoom * 100)}%
          </button>
        </Tooltip>
      </div>

      {/* Minimap (bottom-left), shown when zoomed past the viewport. */}
      {showMinimap && (
        <div
          className="absolute bottom-2 left-2 z-10 overflow-hidden rounded-md border border-border bg-white/95 shadow-md"
          style={{ width: MINIMAP_W, height: miniH }}
        >
          {minimap && (
            <div
              style={{
                transform: `scale(${miniScale})`,
                transformOrigin: "0 0",
                width: contentWidth,
                height: contentHeight,
                pointerEvents: "none",
              }}
            >
              {minimap}
            </div>
          )}
          <div
            className="absolute cursor-move border-2 border-accent bg-accent/10"
            style={{
              left: Math.max(0, Math.min(view.x, MINIMAP_W - 4)),
              top: Math.max(0, Math.min(view.y, miniH - 4)),
              width: Math.max(4, Math.min(view.w, MINIMAP_W)),
              height: Math.max(4, Math.min(view.h, miniH)),
            }}
            onPointerDown={onMiniDown}
            onPointerMove={onMiniMove}
            onPointerUp={onMiniUp}
          />
        </div>
      )}
    </div>
  );
}
