"use client";

// An Illustrator-style pan / zoom viewport for a figure (the phylo Studio tree
// and the Data Hub graph). View-only: it transforms what is shown on screen, it
// never changes the figure or its export.
//
// Gesture model (Grant-tuned 2026-06-14, the Figma/Illustrator standard):
//   - Trackpad two-finger swipe  -> PAN (a wheel event with no ctrl key).
//   - Trackpad pinch / Cmd|Ctrl+wheel -> ZOOM at the cursor (wheel + ctrl/meta;
//     a macOS pinch arrives as a wheel event with ctrlKey=true).
//   - Mouse wheel -> PAN vertically, Shift+wheel -> PAN horizontally.
//   - Left-drag (or Space+drag, the hand tool) -> PAN.
//   - Keyboard (when the canvas is focused): Cmd|Ctrl +/- zoom, Cmd|Ctrl 0 = 100%,
//     Cmd|Ctrl 1 = fit, arrows nudge the view (arrow direction = view direction).
//   - Draggable scrollbars on the right + bottom for mouse users; a corner
//     minimap when zoomed past the viewport.
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
const ARROW_STEP = 30; // px the arrow keys nudge the view

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
  const [space, setSpace] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Live cursor position in viewport coords, so EVERY zoom (wheel, buttons,
  // keyboard) anchors where the mouse is — not the center. Null until the mouse
  // has been over the canvas, in which case zoom falls back to the center.
  const mouse = useRef<{ x: number; y: number } | null>(null);
  // Live mirrors of zoom + pan so zoomToward can compute the new pan from the
  // current values WITHOUT nesting setPan inside setZoom (that nesting double-
  // applied the pan under React StrictMode and threw the figure off-screen).
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const viewport = useCallback(() => {
    const el = containerRef.current;
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  }, []);

  // Where a non-wheel zoom should anchor: the live mouse position, or the
  // viewport center if the mouse has not been over the canvas yet.
  const anchor = useCallback(() => {
    if (mouse.current) return mouse.current;
    const { w, h } = viewport();
    return { x: w / 2, y: h / 2 };
  }, [viewport]);

  // Fit the figure to the viewport, centered. Used on mount + by Center / Cmd-1.
  const center = useCallback(() => {
    const { w, h } = viewport();
    if (w === 0 || h === 0) return;
    const z = Math.min(w / contentWidth, h / contentHeight, 1) * 0.95 || 1;
    setZoom(z);
    setPan({ x: (w - contentWidth * z) / 2, y: (h - contentHeight * z) / 2 });
  }, [viewport, contentWidth, contentHeight]);

  const reset100 = useCallback(() => {
    const { w, h } = viewport();
    setZoom(1);
    setPan({ x: (w - contentWidth) / 2, y: (h - contentHeight) / 2 });
  }, [viewport, contentWidth, contentHeight]);

  // Track the viewport size (for the minimap rect + scrollbars + zoom-to-center).
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

  // Zoom toward an anchor point (in viewport coords), keeping the content point
  // under it fixed. Reads the live zoom + pan from refs and sets both states once
  // (no nested updaters), and updates the refs immediately so a rapid burst of
  // wheel events (a pinch) chains off the latest value instead of a stale one.
  const zoomToward = useCallback((factor: number, ax: number, ay: number) => {
    const z = zoomRef.current;
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
    if (nz === z) return;
    const p = panRef.current;
    const np = {
      x: ax - ((ax - p.x) / z) * nz,
      y: ay - ((ay - p.y) / z) * nz,
    };
    zoomRef.current = nz;
    panRef.current = np;
    setZoom(nz);
    setPan(np);
  }, []);

  // Wheel: the Figma model. No ctrl/meta -> pan; ctrl/meta (incl. trackpad pinch)
  // -> zoom at the cursor. A native non-passive listener so we can preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      const rect = el.getBoundingClientRect();
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey) {
        zoomToward(Math.pow(0.992, dy), mouse.current.x, mouse.current.y);
      } else {
        // Shift+wheel on a mouse pans sideways (some mice only emit deltaY).
        if (e.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        setPan((p) => ({ x: p.x - dx, y: p.y - dy }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomToward]);

  // Drag to pan, with a small threshold so a plain click still passes through to
  // the figure (the Data Hub legend recolor, etc.). Holding Space (the hand tool)
  // pans immediately, bypassing the click-through threshold.
  const drag = useRef<{
    x: number;
    y: number;
    px: number;
    py: number;
    active: boolean;
  } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      px: pan.x,
      py: pan.y,
      active: space,
    };
    if (space) {
      setGrabbing(true);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top };
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

  // Keyboard (only when the canvas is focused, so global Cmd-0 etc. are not
  // hijacked elsewhere). Arrow direction = view direction (Grant 2026-06-14).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.code === "Space") {
      setSpace(true);
      e.preventDefault();
      return;
    }
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      const a = anchor();
      zoomToward(1.2, a.x, a.y);
    } else if (meta && e.key === "-") {
      e.preventDefault();
      const a = anchor();
      zoomToward(1 / 1.2, a.x, a.y);
    } else if (meta && e.key === "0") {
      e.preventDefault();
      reset100();
    } else if (meta && e.key === "1") {
      e.preventDefault();
      center();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPan((p) => ({ ...p, x: p.x - ARROW_STEP }));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPan((p) => ({ ...p, x: p.x + ARROW_STEP }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPan((p) => ({ ...p, y: p.y - ARROW_STEP }));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setPan((p) => ({ ...p, y: p.y + ARROW_STEP }));
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.code === "Space") setSpace(false);
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
    const dx = (e.clientX - d.x) / miniScale;
    const dy = (e.clientY - d.y) / miniScale;
    setPan({ x: d.px - dx * zoom, y: d.py - dy * zoom });
  };
  const onMiniUp = () => {
    miniDrag.current = null;
  };

  // Scrollbars (mouse users). The scrollable extent is the figure plus a viewport
  // of slack on each side, so the thumb reflects where the figure sits.
  const cw = contentWidth * zoom;
  const ch = contentHeight * zoom;
  const totalW = cw + size.w;
  const totalH = ch + size.h;
  const hTrack = Math.max(0, size.w - 16);
  const vTrack = Math.max(0, size.h - 16);
  const hThumb = Math.max(24, Math.min(hTrack, hTrack * (size.w / totalW)));
  const vThumb = Math.max(24, Math.min(vTrack, vTrack * (size.h / totalH)));
  const hPos = Math.max(
    0,
    Math.min(hTrack - hThumb, ((size.w - pan.x) / totalW) * hTrack),
  );
  const vPos = Math.max(
    0,
    Math.min(vTrack - vThumb, ((size.h - pan.y) / totalH) * vTrack),
  );
  const showH = size.w > 0 && cw > size.w + 1;
  const showV = size.h > 0 && ch > size.h + 1;

  const sbDrag = useRef<{ start: number; p0: number; axis: "x" | "y" } | null>(
    null,
  );
  const onSbDown = (axis: "x" | "y") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    sbDrag.current = {
      start: axis === "x" ? e.clientX : e.clientY,
      p0: axis === "x" ? pan.x : pan.y,
      axis,
    };
  };
  const onSbMove = (e: React.PointerEvent) => {
    const d = sbDrag.current;
    if (!d) return;
    e.stopPropagation();
    const moved = (d.axis === "x" ? e.clientX : e.clientY) - d.start;
    const track = d.axis === "x" ? hTrack : vTrack;
    const total = d.axis === "x" ? totalW : totalH;
    const next = d.p0 - moved * (total / track);
    setPan((p) => (d.axis === "x" ? { ...p, x: next } : { ...p, y: next }));
  };
  const onSbUp = () => {
    sbDrag.current = null;
  };

  const btn =
    "flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface/90 text-foreground shadow-sm transition-colors hover:bg-surface-sunken";

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`relative h-full w-full overflow-hidden bg-surface outline-none ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      style={{
        cursor: grabbing ? "grabbing" : "grab",
        touchAction: "none",
      }}
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
        onPointerMove={(e) => e.stopPropagation()}
      >
        <Tooltip label="Zoom in (Cmd +)">
          <button
            type="button"
            aria-label="Zoom in"
            className={btn}
            onClick={() => {
              const a = anchor();
              zoomToward(1.25, a.x, a.y);
            }}
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Zoom out (Cmd -)">
          <button
            type="button"
            aria-label="Zoom out"
            className={btn}
            onClick={() => {
              const a = anchor();
              zoomToward(1 / 1.25, a.x, a.y);
            }}
          >
            <Icon name="minus" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Fit to view (Cmd 1)">
          <button
            type="button"
            aria-label="Fit to view"
            className={btn}
            onClick={center}
          >
            <Icon name="fitView" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Fullscreen">
          <button
            type="button"
            aria-label="Fullscreen"
            className={btn}
            onClick={toggleFullscreen}
          >
            <Icon name="focus" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label="Reset zoom to 100% (Cmd 0)">
          <button
            type="button"
            aria-label="Reset zoom to 100%"
            onClick={reset100}
            className="rounded-md border border-border bg-surface/90 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground-muted shadow-sm transition-colors hover:bg-surface-sunken"
          >
            {Math.round(zoom * 100)}%
          </button>
        </Tooltip>
      </div>

      {/* Scrollbars (mouse users). Hidden unless the figure overflows that axis. */}
      {showV && (
        <div
          className="absolute right-0.5 top-1 z-10 w-2.5"
          style={{ height: vTrack }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="absolute left-0.5 right-0.5 cursor-pointer rounded-full bg-foreground/20 hover:bg-foreground/35"
            style={{ top: vPos, height: vThumb }}
            onPointerDown={onSbDown("y")}
            onPointerMove={onSbMove}
            onPointerUp={onSbUp}
          />
        </div>
      )}
      {showH && (
        <div
          className="absolute bottom-0.5 left-1 z-10 h-2.5"
          style={{ width: hTrack }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="absolute top-0.5 bottom-0.5 cursor-pointer rounded-full bg-foreground/20 hover:bg-foreground/35"
            style={{ left: hPos, width: hThumb }}
            onPointerDown={onSbDown("x")}
            onPointerMove={onSbMove}
            onPointerUp={onSbUp}
          />
        </div>
      )}

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
