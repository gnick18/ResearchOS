"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Stage, Layer, Image as KonvaImage, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  Arrow as KArrow,
  Line as KLine,
  Rect as KRect,
  Ellipse as KEllipse,
  Text as KText,
} from "react-konva";
import {
  ANNOTATION_SCHEMA_VERSION,
  readAnnotations,
  writeAnnotations,
  type AnnotationDoc,
  type AnnotationShape,
} from "@/lib/attachments/annotations";
import { imageEvents } from "@/lib/attachments/image-events";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { usePopupLayer } from "@/lib/ui/popup-stack";
import Tooltip from "@/components/Tooltip";

/**
 * Full-screen, non-destructive photo-annotation editor (react-konva).
 *
 * Konva touches `window` / `canvas` and breaks SSR, so callers MUST load this
 * via `next/dynamic(() => import("@/components/ImageAnnotatorModal"), { ssr:
 * false })`. The component additionally guards against a server render.
 *
 * On open: rehydrates from any existing `.annot.json` so re-editing works (every
 * shape returns as a live, editable object). On save: serializes the shape list
 * back into OUR `AnnotationDoc` schema (NOT Konva's native toJSON),
 * `writeAnnotations`, emits `imageEvents.emitAnnotated`, closes. The raw image
 * is NEVER written; Cancel discards.
 *
 * House style: no emojis; every icon is a custom inline SVG; icon-only buttons
 * use `<Tooltip>`; no em-dashes in copy. See `plans/PHOTO_ANNOTATION_DESIGN.md`.
 */

type Tool = "select" | "arrow" | "line" | "rect" | "ellipse" | "freehand" | "polygon" | "text";

const COLORS = [
  "#e11d48", // rose
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#111827", // near-black
  "#ffffff", // white
] as const;

const STROKE_WIDTHS = [2, 4, 6, 10] as const;
const FONT_SIZES = [18, 28, 40, 64] as const;

// Zoom limits, relative to the fit-to-viewport baseline (zoom 1 == image fits
// the viewport). Below 1 zooms out, above 1 zooms in.
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 16;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

let shapeCounter = 0;
function nextId(): string {
  shapeCounter += 1;
  return `s${Date.now().toString(36)}${shapeCounter}`;
}

interface ImageAnnotatorModalProps {
  basePath: string;
  filename: string;
  /** Optional pre-resolved blob URL for the raw image, to skip a re-read. */
  resolvedSrc?: string;
  /** Username stamped into `updatedBy` on save. */
  username?: string;
  onClose: () => void;
}

export default function ImageAnnotatorModal({
  basePath,
  filename,
  resolvedSrc,
  username,
  onClose,
}: ImageAnnotatorModalProps) {
  // SSR guard: never render the konva stage on the server (callers should also
  // dynamic-import with ssr:false, but this is belt-and-braces).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The editor opens over ImageMetadataPopup's LivingPopup (which blurs), so it
  // registers with the popup stack and only blurs when it is the bottom-most
  // blur layer, never compounding into a double-blur.
  const { shouldBlur } = usePopupLayer(true, true);

  // While the full-screen annotation editor is open, hide the global
  // floating action dock (bottom-right cluster) via a document flag + CSS.
  // It is clutter over the edit surface and one of the rare cases where the
  // dock should not show. Removed on close.
  useEffect(() => {
    document.documentElement.setAttribute("data-annotator-open", "");
    return () => document.documentElement.removeAttribute("data-annotator-open");
  }, []);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgError, setImgError] = useState(false);

  // The canonical state is OUR schema's shape list (not konva nodes). Undo/redo
  // operates over snapshots of this list.
  const [shapes, setShapes] = useState<AnnotationShape[]>([]);
  const [past, setPast] = useState<AnnotationShape[][]>([]);
  const [future, setFuture] = useState<AnnotationShape[][]>([]);

  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState<number>(STROKE_WIDTHS[1]);
  const [fontSize, setFontSize] = useState<number>(FONT_SIZES[1]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingText, setEditingText] = useState<{
    id: string;
    value: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  // Stage sizing. `containerSize` is the full-viewport Konva stage (it fills the
  // editor); `stageSize` is the FITTED image size in content space (natural *
  // fit-scale). The image is drawn at content (0,0) sized `stageSize`, and the
  // stage `view` transform (zoom + pan) places + scales that content inside the
  // viewport, so zooming/panning never resizes the shapes' own geometry.
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  // The pan + zoom of the image within the viewport. zoom 1 == fit; x/y is the
  // stage position in screen pixels.
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });

  // Drawing-in-progress shape (committed to `shapes` on pointer up).
  const drawingRef = useRef<AnnotationShape | null>(null);
  // In-progress polygon: click adds a vertex, Enter / click-near-start closes,
  // Escape cancels. `cx`/`cy` is the live cursor (natural coords) for the rubber
  // band from the last placed vertex. State (not a ref) so render stays pure.
  const [poly, setPoly] = useState<{ points: number[]; cx: number; cy: number } | null>(null);
  const [, forceTick] = useState(0);

  // --- Load the raw image element -----------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url =
        resolvedSrc ??
        (await blobUrlResolver.getBlobUrl(`${basePath}/Images/${filename}`));
      if (cancelled || !url) {
        if (!url) setImgError(true);
        return;
      }
      const image = new window.Image();
      image.onload = () => {
        if (!cancelled) setImg(image);
      };
      image.onerror = () => {
        if (!cancelled) setImgError(true);
      };
      image.src = url;
    })();
    return () => {
      cancelled = true;
    };
  }, [basePath, filename, resolvedSrc]);

  // --- Rehydrate existing annotations -------------------------------------
  useEffect(() => {
    let cancelled = false;
    void readAnnotations(basePath, filename).then((doc) => {
      if (cancelled || !doc) return;
      setShapes(doc.shapes);
    });
    return () => {
      cancelled = true;
    };
  }, [basePath, filename]);

  // --- Fit-to-viewport sizing ---------------------------------------------
  useEffect(() => {
    if (!img) return;
    const recompute = () => {
      const box = containerRef.current?.getBoundingClientRect();
      const availW = box?.width ?? window.innerWidth;
      const availH = box?.height ?? window.innerHeight;
      setContainerSize({ width: Math.round(availW), height: Math.round(availH) });
      // Leave a margin so the fitted image does not sit flush under the floating
      // tool panels at zoom 1.
      const scale = Math.min(
        (availW - 48) / img.naturalWidth,
        (availH - 48) / img.naturalHeight,
        1,
      );
      setStageSize({
        width: Math.max(1, Math.round(img.naturalWidth * scale)),
        height: Math.max(1, Math.round(img.naturalHeight * scale)),
      });
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [img]);

  // Natural<->stage scale. All shapes are stored in NATURAL coords; the stage
  // renders scaled, so we convert pointer positions back to natural on input.
  const scale = useMemo(() => {
    if (!img) return 1;
    return stageSize.width / img.naturalWidth;
  }, [img, stageSize.width]);

  const toNatural = useCallback(
    (sx: number, sy: number) => ({ x: sx / scale, y: sy / scale }),
    [scale],
  );

  // --- Zoom + pan ----------------------------------------------------------
  // Center the fitted image in the viewport at zoom 1.
  const fitView = useCallback(() => {
    setView({
      zoom: 1,
      x: Math.round((containerSize.width - stageSize.width) / 2),
      y: Math.round((containerSize.height - stageSize.height) / 2),
    });
  }, [containerSize.width, containerSize.height, stageSize.width, stageSize.height]);

  // Recenter whenever the image or the viewport box changes (load, resize).
  useEffect(() => {
    if (!img || containerSize.width === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- center the view once the image + viewport box are known
    fitView();
  }, [img, containerSize.width, containerSize.height, stageSize.width, stageSize.height, fitView]);

  // Zoom toward a point in SCREEN space (relative to the stage container),
  // keeping whatever content sits under that point fixed under it. `zoomFn` maps
  // the current zoom to the next, so callers never need the live zoom value.
  const zoomToPoint = useCallback(
    (zoomFn: (z: number) => number, px: number, py: number) => {
      setView((v) => {
        const z2 = clampZoom(zoomFn(v.zoom));
        const cx = (px - v.x) / v.zoom;
        const cy = (py - v.y) / v.zoom;
        return { zoom: z2, x: px - cx * z2, y: py - cy * z2 };
      });
    },
    [],
  );

  // Zoom about the viewport center, for the +/- buttons.
  const zoomByButton = useCallback(
    (factor: number) => {
      zoomToPoint((z) => z * factor, containerSize.width / 2, containerSize.height / 2);
    },
    [zoomToPoint, containerSize.width, containerSize.height],
  );

  // Center the viewport on a content-space point (used by the navigator minimap),
  // keeping the current zoom.
  const panToContent = useCallback(
    (contentX: number, contentY: number) => {
      setView((v) => ({
        ...v,
        x: containerSize.width / 2 - contentX * v.zoom,
        y: containerSize.height / 2 - contentY * v.zoom,
      }));
    },
    [containerSize.width, containerSize.height],
  );

  // Native, NON-PASSIVE wheel handler so we can preventDefault and take over the
  // gesture from the browser: a pinch (or ctrl+wheel) zooms toward the cursor and
  // BLOCKS the browser's native page zoom; a plain two-finger scroll pans. Konva's
  // onWheel can be passive, so we bind the raw listener on the container instead.
  useEffect(() => {
    // Bind to the ROOT overlay (not just the stage container) so a pinch over
    // the floating tool panels is captured too; otherwise the browser does a
    // native page zoom there and the panels shift off-screen.
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (e.ctrlKey) {
        // Trackpad pinch and ctrl+wheel both arrive here. exp keeps zoom smooth
        // and symmetric in and out.
        zoomToPoint((z) => z * Math.exp(-e.deltaY * 0.01), px, py);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // `mounted` is in the deps so this re-runs once the root div is actually in
    // the DOM (the component returns null until mounted), otherwise rootRef is
    // null on the first run and the listener never attaches.
  }, [zoomToPoint, mounted]);

  // --- History helpers -----------------------------------------------------
  const commit = useCallback((next: AnnotationShape[]) => {
    setPast((p) => [...p, shapesRef.current]);
    setFuture([]);
    setShapes(next);
  }, []);

  // Keep a ref of the latest shapes so `commit` can snapshot without a
  // stale closure.
  const shapesRef = useRef<AnnotationShape[]>(shapes);
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [shapesRef.current, ...f]);
      setShapes(prev);
      return p.slice(0, -1);
    });
    setSelectedId(null);
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const nextState = f[0];
      setPast((p) => [...p, shapesRef.current]);
      setShapes(nextState);
      return f.slice(1);
    });
    setSelectedId(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commit(shapesRef.current.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, commit]);

  // Finish the in-progress polygon (needs at least 3 vertices = 6 numbers).
  const commitPolygon = useCallback(
    (draft: { points: number[]; cx: number; cy: number } | null) => {
      setPoly(null);
      if (!draft || draft.points.length < 6) return;
      const id = nextId();
      const shape: AnnotationShape = {
        id,
        type: "polygon",
        points: draft.points,
        color,
        strokeWidth,
      };
      commit([...shapesRef.current, shape]);
      setTool("select");
      setSelectedId(id);
    },
    [color, strokeWidth, commit],
  );

  // Switching away from the polygon tool abandons any in-progress polygon.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- abandon the draft when the tool changes away from polygon
    if (tool !== "polygon") setPoly(null);
  }, [tool]);

  // --- Keyboard: Escape closes, Delete removes, Cmd+Z / Cmd+Shift+Z --------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingText) return; // let the textarea own keys while editing
      // An in-progress polygon owns Enter (close) and Escape (cancel) first.
      if (poly) {
        if (e.key === "Enter") {
          e.preventDefault();
          commitPolygon(poly);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setPoly(null);
          return;
        }
      }
      if (e.key === "Escape") {
        if (selectedId) {
          setSelectedId(null);
        } else {
          onClose();
        }
        return;
      }
      // Enter locks in the current selection (deselect), the same as
      // clicking an empty part of the canvas. Does not close the modal.
      if (e.key === "Enter" && selectedId) {
        e.preventDefault();
        setSelectedId(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingText, selectedId, onClose, deleteSelected, undo, redo, poly, commitPolygon]);

  // --- Transformer binding -------------------------------------------------
  useEffect(() => {
    const tr = transformerRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    if (tool !== "select" || !selectedId) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = layer.findOne(`#${selectedId}`);
    if (node) {
      tr.nodes([node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, tool, shapes]);

  // --- Pointer drawing -----------------------------------------------------
  const handlePointerDown = useCallback(
    (e: KonvaEventObject<PointerEvent | MouseEvent | TouchEvent>) => {
      if (tool === "select") {
        // Click on empty stage clears selection.
        if (e.target === e.target.getStage()) setSelectedId(null);
        return;
      }
      const stage = stageRef.current;
      // getRelativePointerPosition accounts for the stage's zoom + pan transform,
    // so the pointer maps to content space at any zoom level.
    const pos = stage?.getRelativePointerPosition();
      if (!pos) return;
      const { x, y } = toNatural(pos.x, pos.y);

      if (tool === "text") {
        const id = nextId();
        const shape: AnnotationShape = {
          id,
          type: "text",
          x,
          y,
          text: "Text",
          color,
          fontSize,
        };
        commit([...shapesRef.current, shape]);
        // Leave text-placement mode and select the new label so it is
        // immediately draggable (move) and re-editable (double-click). Without
        // this the tool stays "text", so the label can't be moved and clicking
        // it just drops another "Text" instead of editing it.
        setTool("select");
        setSelectedId(id);
        // Immediately open the inline editor for the new label.
        openTextEditor(id, "Text", pos.x, pos.y);
        return;
      }

      if (tool === "polygon") {
        if (poly && poly.points.length >= 6) {
          // Close when clicking near the first vertex (threshold in screen px,
          // so it feels the same at any zoom). stage.scaleX() is the live zoom.
          const z = stage?.scaleX() ?? 1;
          const dScreen = Math.hypot(
            (x - poly.points[0]) * scale * z,
            (y - poly.points[1]) * scale * z,
          );
          if (dScreen < 12) {
            commitPolygon(poly);
            return;
          }
        }
        setPoly((cur) =>
          cur
            ? { points: [...cur.points, x, y], cx: x, cy: y }
            : { points: [x, y], cx: x, cy: y },
        );
        return;
      }

      let shape: AnnotationShape;
      const id = nextId();
      if (tool === "arrow" || tool === "line") {
        shape = { id, type: tool, x1: x, y1: y, x2: x, y2: y, color, strokeWidth };
      } else if (tool === "rect" || tool === "ellipse") {
        shape = { id, type: tool, x, y, w: 0, h: 0, color, strokeWidth };
      } else {
        // freehand
        shape = { id, type: "freehand", points: [x, y], color, strokeWidth };
      }
      drawingRef.current = shape;
      forceTick((t) => t + 1);
    },
    // openTextEditor is intentionally omitted (declared below; stable enough for
    // this handler, matching the pre-existing pattern).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, toNatural, scale, color, strokeWidth, fontSize, commit, commitPolygon, poly],
  );

  const handlePointerMove = useCallback(() => {
    const stage = stageRef.current;
    // Polygon-in-progress: track the cursor for the rubber-band segment from the
    // last placed vertex.
    if (poly) {
      const rel = stage?.getRelativePointerPosition();
      if (rel) {
        const n = toNatural(rel.x, rel.y);
        setPoly((p) => (p ? { ...p, cx: n.x, cy: n.y } : p));
      }
      return;
    }
    const drawing = drawingRef.current;
    if (!drawing) return;
    // getRelativePointerPosition accounts for the stage's zoom + pan transform,
    // so the pointer maps to content space at any zoom level.
    const pos = stage?.getRelativePointerPosition();
    if (!pos) return;
    const { x, y } = toNatural(pos.x, pos.y);
    if (drawing.type === "arrow" || drawing.type === "line") {
      drawing.x2 = x;
      drawing.y2 = y;
    } else if (drawing.type === "rect" || drawing.type === "ellipse") {
      drawing.w = x - drawing.x;
      drawing.h = y - drawing.y;
    } else if (drawing.type === "freehand") {
      drawing.points = [...drawing.points, x, y];
    }
    forceTick((t) => t + 1);
  }, [toNatural, poly]);

  const handlePointerUp = useCallback(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawingRef.current = null;
    // Discard zero-size shapes from an accidental click.
    const degenerate =
      ((drawing.type === "arrow" || drawing.type === "line") &&
        drawing.x1 === drawing.x2 &&
        drawing.y1 === drawing.y2) ||
      ((drawing.type === "rect" || drawing.type === "ellipse") &&
        drawing.w === 0 &&
        drawing.h === 0) ||
      (drawing.type === "freehand" && drawing.points.length < 4);
    if (degenerate) {
      forceTick((t) => t + 1);
      return;
    }
    commit([...shapesRef.current, normalizeBox(drawing)]);
    setTool("select");
    setSelectedId(drawing.id);
  }, [commit]);

  // --- Text editing --------------------------------------------------------
  const openTextEditor = useCallback(
    (id: string, value: string, contentX: number, contentY: number) => {
      const stage = stageRef.current;
      const stageBox = stage?.container().getBoundingClientRect();
      // Map the content-space point through the stage's zoom + pan transform to a
      // screen pixel, so the inline editor lands on the label at any zoom level.
      const abs = stage?.getAbsoluteTransform().point({ x: contentX, y: contentY }) ?? {
        x: contentX,
        y: contentY,
      };
      setEditingText({
        id,
        value,
        screenX: (stageBox?.left ?? 0) + abs.x,
        screenY: (stageBox?.top ?? 0) + abs.y,
      });
    },
    [],
  );

  const commitTextEdit = useCallback(() => {
    setEditingText((cur) => {
      if (!cur) return null;
      const trimmed = cur.value.trim();
      const next =
        trimmed.length === 0
          ? shapesRef.current.filter((s) => s.id !== cur.id)
          : shapesRef.current.map((s) =>
              s.id === cur.id && s.type === "text" ? { ...s, text: cur.value } : s,
            );
      setPast((p) => [...p, shapesRef.current]);
      setFuture([]);
      setShapes(next);
      return null;
    });
  }, []);

  // --- Shape mutation on drag / transform ----------------------------------
  const applyShape = useCallback(
    (id: string, patch: Partial<AnnotationShape>) => {
      commit(
        shapesRef.current.map((s) =>
          s.id === id ? ({ ...s, ...patch } as AnnotationShape) : s,
        ),
      );
    },
    [commit],
  );

  // --- Save ----------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!img) return;
    setSaving(true);
    try {
      const doc: AnnotationDoc = {
        version: ANNOTATION_SCHEMA_VERSION,
        imageW: img.naturalWidth,
        imageH: img.naturalHeight,
        shapes: shapesRef.current,
        updatedAt: new Date().toISOString(),
        updatedBy: username,
      };
      await writeAnnotations(basePath, filename, doc);
      imageEvents.emitAnnotated({ basePath, filename });
      onClose();
    } catch (err) {
      console.error("[annotator] save failed", err);
      alert("Failed to save annotations.");
    } finally {
      setSaving(false);
    }
  }, [img, username, basePath, filename, onClose]);

  if (!mounted) return null;

  const liveShapes = drawingRef.current
    ? [...shapes, drawingRef.current]
    : shapes;

  // The size controls reflect and edit the SELECTED shape when one is
  // selected, otherwise they set the default for the next shape drawn. Text
  // size is driven only by this control (the transformer does not resize
  // text), so a label has a single source of truth for its size.
  const selectedShape = selectedId
    ? shapes.find((s) => s.id === selectedId) ?? null
    : null;
  const textSelected = selectedShape?.type === "text";
  const effFontSize =
    selectedShape && selectedShape.type === "text" ? selectedShape.fontSize : fontSize;
  const effStroke =
    selectedShape && selectedShape.type !== "text"
      ? selectedShape.strokeWidth
      : strokeWidth;
  const applyFontSize = (v: number) => {
    const c = Math.min(200, Math.max(8, Math.round(v) || effFontSize));
    setFontSize(c);
    if (selectedShape && selectedShape.type === "text")
      applyShape(selectedShape.id, { fontSize: c });
  };
  const applyStrokeWidth = (v: number) => {
    const c = Math.min(40, Math.max(1, Math.round(v) || effStroke));
    setStrokeWidth(c);
    if (selectedShape && selectedShape.type !== "text")
      applyShape(selectedShape.id, { strokeWidth: c });
  };
  // The inline text editor matches the size and color of the label being
  // edited so editing does not visually jump.
  const editingShape = editingText
    ? shapes.find((s) => s.id === editingText.id) ?? null
    : null;
  const editFontSize =
    editingShape && editingShape.type === "text" ? editingShape.fontSize : fontSize;
  const editColor =
    editingShape && editingShape.type === "text" ? editingShape.color : color;

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[450] bg-slate-900/40 ${
        shouldBlur ? "backdrop-blur-md" : ""
      }`}
      data-tour-popup-occluding="image-annotator"
      // Full-viewport editor: the image fills the screen and the tools float
      // OVER it (Grant 2026-06-07). Mounts as a sibling of ImageMetadataPopup's
      // LivingPopup (z-[400]); z-[450] keeps it above the metadata card.
      // stopPropagation keeps clicks self-contained; the scrim does NOT close on
      // click, so unsaved annotations are never lost to a stray outside click.
      onClick={(e) => e.stopPropagation()}
    >
      {/* Floating actions, top-right */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-3 rounded-2xl border border-border bg-surface-raised/95 px-3 py-2 shadow-2xl ring-1 ring-black/5 backdrop-blur">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-action/10 text-brand-action">
            <IconPencil />
          </span>
          <div className="min-w-0">
            <h3 className="text-title font-semibold text-foreground leading-tight">Annotate image</h3>
            <p className="text-meta text-foreground-muted truncate leading-tight" title={filename}>
              {filename}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-body font-medium text-foreground-muted hover:bg-surface-sunken hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !img}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body font-medium rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Floating toolbar, top-left */}
      <div className="absolute left-4 top-4 z-10 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-raised/95 px-3 py-2 shadow-2xl ring-1 ring-black/5 backdrop-blur">
        <div className="flex items-center gap-1">
          <ToolButton label="Select / move" active={tool === "select"} onClick={() => setTool("select")}>
            <IconCursor />
          </ToolButton>
          <ToolButton label="Arrow" active={tool === "arrow"} onClick={() => setTool("arrow")}>
            <IconArrow />
          </ToolButton>
          <ToolButton label="Line" active={tool === "line"} onClick={() => setTool("line")}>
            <IconLine />
          </ToolButton>
          <ToolButton label="Rectangle" active={tool === "rect"} onClick={() => setTool("rect")}>
            <IconRect />
          </ToolButton>
          <ToolButton label="Ellipse" active={tool === "ellipse"} onClick={() => setTool("ellipse")}>
            <IconEllipse />
          </ToolButton>
          <ToolButton label="Freehand pen" active={tool === "freehand"} onClick={() => setTool("freehand")}>
            <IconPen />
          </ToolButton>
          <ToolButton
            label="Polygon (click vertices, Enter or click start to close)"
            active={tool === "polygon"}
            onClick={() => setTool("polygon")}
          >
            <IconPolygon />
          </ToolButton>
          <ToolButton label="Text label" active={tool === "text"} onClick={() => setTool("text")}>
            <IconText />
          </ToolButton>
        </div>

        <div className="w-px h-6 bg-border" />

        {/* Colors */}
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <Tooltip key={c} label={`Color ${c}`} placement="bottom">
              <button
                type="button"
                onClick={() => {
                  setColor(c);
                  if (selectedId) applyShape(selectedId, { color: c });
                }}
                aria-label={`Color ${c}`}
                className={`w-6 h-6 rounded-full border transition-transform ${
                  color === c
                    ? "ring-2 ring-brand-action ring-offset-1 ring-offset-surface-sunken scale-110 border-transparent"
                    : "border-border"
                }`}
                style={{ backgroundColor: c }}
              />
            </Tooltip>
          ))}
        </div>

        <div className="w-px h-6 bg-border" />

        {/* Stroke width */}
        <div className="flex items-center gap-1">
          <span className="text-meta uppercase tracking-wide text-foreground-muted">Stroke</span>
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => applyStrokeWidth(w)}
              className={`px-2 py-1 text-meta rounded transition-colors ${
                effStroke === w
                  ? "bg-brand-action text-white"
                  : "text-foreground-muted hover:bg-surface-raised"
              }`}
            >
              {w}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={40}
            value={effStroke}
            onChange={(e) => applyStrokeWidth(Number(e.target.value))}
            className="w-12 px-1 py-1 text-meta rounded bg-surface-raised text-foreground border border-border text-center outline-none focus:ring-1 focus:ring-brand-action"
            aria-label="Custom stroke width"
          />
        </div>

        <div className="w-px h-6 bg-border" />

        {/* Font size */}
        <div className="flex items-center gap-1">
          <span className="text-meta uppercase tracking-wide text-foreground-muted">Text</span>
          {FONT_SIZES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => applyFontSize(f)}
              className={`px-2 py-1 text-meta rounded transition-colors ${
                effFontSize === f
                  ? "bg-brand-action text-white"
                  : "text-foreground-muted hover:bg-surface-raised"
              }`}
            >
              {f}
            </button>
          ))}
          <input
            type="number"
            min={8}
            max={200}
            value={effFontSize}
            onChange={(e) => applyFontSize(Number(e.target.value))}
            className="w-12 px-1 py-1 text-meta rounded bg-surface-raised text-foreground border border-border text-center outline-none focus:ring-1 focus:ring-brand-action"
            aria-label="Custom text size"
          />
        </div>

        <div className="w-px h-6 bg-border" />

        {/* Undo / redo / delete */}
        <div className="flex items-center gap-1">
          <ToolButton label="Undo" active={false} disabled={past.length === 0} onClick={undo}>
            <IconUndo />
          </ToolButton>
          <ToolButton label="Redo" active={false} disabled={future.length === 0} onClick={redo}>
            <IconRedo />
          </ToolButton>
          <ToolButton
            label="Delete selected"
            active={false}
            disabled={!selectedId}
            onClick={deleteSelected}
          >
            <IconTrash />
          </ToolButton>
        </div>

        <div className="w-px h-6 bg-border" />

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <ToolButton label="Zoom out" active={false} onClick={() => zoomByButton(1 / 1.2)}>
            <IconMinus />
          </ToolButton>
          <Tooltip label="Fit to screen" placement="bottom">
            <button
              type="button"
              onClick={fitView}
              className="min-w-[3.25rem] rounded px-2 py-1 text-meta tabular-nums text-foreground-muted transition-colors hover:bg-surface-raised"
              aria-label="Fit to screen"
            >
              {Math.round(view.zoom * 100)}%
            </button>
          </Tooltip>
          <ToolButton label="Zoom in" active={false} onClick={() => zoomByButton(1.2)}>
            <IconPlus />
          </ToolButton>
        </div>
      </div>

      {/* Full-viewport stage: the image fills the screen, tools float over it. */}
      <div ref={containerRef} className="absolute inset-0 overflow-hidden">
        {imgError ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-body text-foreground-muted">Could not load the image.</p>
          </div>
        ) : !img || containerSize.width === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-body text-foreground-muted">Loading image...</p>
          </div>
        ) : (
            <Stage
              ref={stageRef}
              width={containerSize.width}
              height={containerSize.height}
              scaleX={view.zoom}
              scaleY={view.zoom}
              x={view.x}
              y={view.y}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onTouchStart={handlePointerDown}
              onTouchMove={handlePointerMove}
              onTouchEnd={handlePointerUp}
              style={{ cursor: tool === "select" ? "default" : "crosshair" }}
            >
              <Layer ref={layerRef}>
                <KonvaImage image={img} width={stageSize.width} height={stageSize.height} listening={false} />
                {liveShapes.map((shape) => (
                  <ShapeNode
                    key={shape.id}
                    shape={shape}
                    scale={scale}
                    draggable={tool === "select"}
                    onSelect={() => {
                      if (tool === "select") setSelectedId(shape.id);
                    }}
                    onChange={(patch) => applyShape(shape.id, patch)}
                    onTextEdit={(value, screenX, screenY) =>
                      openTextEditor(shape.id, value, screenX, screenY)
                    }
                  />
                ))}
                {poly && poly.points.length >= 2 && (
                  <KLine
                    points={[...poly.points, poly.cx, poly.cy].map((n) => n * scale)}
                    stroke={color}
                    strokeWidth={strokeWidth * scale}
                    lineCap="round"
                    lineJoin="round"
                    dash={[10, 6]}
                    listening={false}
                  />
                )}
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  // Text size is controlled only by the toolbar control, so the
                  // transformer just shows the selection box for text (drag to
                  // move) without resize handles. Other shapes resize normally.
                  resizeEnabled={!textSelected}
                  ignoreStroke
                  boundBoxFunc={(oldBox, newBox) =>
                    newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
                  }
                />
              </Layer>
            </Stage>
        )}
      </div>

      {/* Navigator minimap: the full image with a green box for the visible
          region. Click or drag it to jump the view to another section. Only
          shown when zoomed in (the whole image is visible at fit). */}
      {img && containerSize.width > 0 && view.zoom > 1.01 && (() => {
        const miniScale = Math.min(200 / stageSize.width, 160 / stageSize.height);
        const miniW = Math.round(stageSize.width * miniScale);
        const miniH = Math.round(stageSize.height * miniScale);
        const z = view.zoom;
        const vx = Math.max(0, -view.x / z) * miniScale;
        const vy = Math.max(0, -view.y / z) * miniScale;
        const vw = Math.min(miniW - vx, (containerSize.width / z) * miniScale);
        const vh = Math.min(miniH - vy, (containerSize.height / z) * miniScale);
        const onMini = (e: ReactPointerEvent<HTMLDivElement>) => {
          // Click jumps; drag (button held) scrubs.
          if (e.type === "pointermove" && e.buttons !== 1) return;
          const r = e.currentTarget.getBoundingClientRect();
          panToContent((e.clientX - r.left) / miniScale, (e.clientY - r.top) / miniScale);
        };
        return (
          <div className="absolute bottom-4 right-4 z-10 rounded-xl border border-border bg-surface-raised/95 p-1 shadow-2xl ring-1 ring-black/5 backdrop-blur">
            <div
              className="relative cursor-pointer overflow-hidden rounded-md"
              style={{ width: miniW, height: miniH }}
              onPointerDown={onMini}
              onPointerMove={onMini}
            >
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="block h-full w-full select-none object-contain"
              />
              <div
                className="pointer-events-none absolute rounded-sm border-2 border-green-400 bg-green-400/15"
                style={{
                  left: vx,
                  top: vy,
                  width: Math.max(4, vw),
                  height: Math.max(4, vh),
                }}
              />
            </div>
          </div>
        );
      })()}

      {/* Inline text editor overlay */}
      {editingText && (
        <textarea
          autoFocus
          // Select the existing text on focus so typing replaces the "Text"
          // placeholder instead of appending to it.
          onFocus={(e) => e.currentTarget.select()}
          value={editingText.value}
          onChange={(e) => setEditingText((c) => (c ? { ...c, value: e.target.value } : c))}
          onBlur={commitTextEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitTextEdit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              commitTextEdit();
            }
          }}
          className="bg-surface-raised text-foreground ring-2 ring-brand-action shadow-lg"
          style={{
            position: "fixed",
            top: editingText.screenY,
            left: editingText.screenX,
            zIndex: 460,
            minWidth: 120,
            fontSize: Math.max(12, editFontSize * scale * view.zoom),
            color: editColor,
            borderRadius: 6,
            padding: "2px 4px",
            outline: "none",
            resize: "none",
          }}
        />
      )}
    </div>
  );
}

/**
 * Box shapes (rect / ellipse) can be drawn with negative width/height when the
 * user drags up or left. Normalize to a positive-extent box so x/y is always
 * the top-left corner, which keeps the SVG overlay and the Transformer happy.
 */
function normalizeBox(shape: AnnotationShape): AnnotationShape {
  if (shape.type !== "rect" && shape.type !== "ellipse") return shape;
  const x = shape.w < 0 ? shape.x + shape.w : shape.x;
  const y = shape.h < 0 ? shape.y + shape.h : shape.y;
  return { ...shape, x, y, w: Math.abs(shape.w), h: Math.abs(shape.h) };
}

// --- Per-shape konva node ---------------------------------------------------

function ShapeNode({
  shape,
  scale,
  draggable,
  onSelect,
  onChange,
  onTextEdit,
}: {
  shape: AnnotationShape;
  scale: number;
  draggable: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<AnnotationShape>) => void;
  onTextEdit: (value: string, screenX: number, screenY: number) => void;
}) {
  // Shapes are stored in natural coords; the layer is NOT scaled, so we convert
  // each coordinate to stage space (* scale) for rendering and back on change.
  const common = {
    id: shape.id,
    stroke: shape.type === "text" ? undefined : shape.color,
    onMouseDown: onSelect,
    onTap: onSelect,
    draggable,
  };

  if (shape.type === "arrow" || shape.type === "line") {
    const points = [shape.x1, shape.y1, shape.x2, shape.y2].map((n) => n * scale);
    const Comp = shape.type === "arrow" ? KArrow : KLine;
    return (
      <Comp
        {...common}
        points={points}
        strokeWidth={shape.strokeWidth * scale}
        lineCap="round"
        pointerLength={shape.type === "arrow" ? Math.max(10, shape.strokeWidth * 4) * scale : undefined}
        pointerWidth={shape.type === "arrow" ? Math.max(10, shape.strokeWidth * 4) * scale : undefined}
        fill={shape.color}
        hitStrokeWidth={Math.max(12, shape.strokeWidth * scale)}
        onDragEnd={(e) => {
          const dx = e.target.x() / scale;
          const dy = e.target.y() / scale;
          e.target.position({ x: 0, y: 0 });
          onChange({
            x1: shape.x1 + dx,
            y1: shape.y1 + dy,
            x2: shape.x2 + dx,
            y2: shape.y2 + dy,
          });
        }}
      />
    );
  }

  if (shape.type === "rect") {
    return (
      <KRect
        {...common}
        x={shape.x * scale}
        y={shape.y * scale}
        width={shape.w * scale}
        height={shape.h * scale}
        strokeWidth={shape.strokeWidth * scale}
        onDragEnd={(e) => {
          onChange({ x: e.target.x() / scale, y: e.target.y() / scale });
        }}
        onTransformEnd={(e) => {
          const node = e.target;
          const sx = node.scaleX();
          const sy = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            x: node.x() / scale,
            y: node.y() / scale,
            w: (node.width() * sx) / scale,
            h: (node.height() * sy) / scale,
          });
        }}
      />
    );
  }

  if (shape.type === "ellipse") {
    return (
      <KEllipse
        {...common}
        x={(shape.x + shape.w / 2) * scale}
        y={(shape.y + shape.h / 2) * scale}
        radiusX={Math.abs(shape.w / 2) * scale}
        radiusY={Math.abs(shape.h / 2) * scale}
        strokeWidth={shape.strokeWidth * scale}
        onDragEnd={(e) => {
          // Konva ellipse x/y is its CENTER; convert back to top-left corner.
          onChange({
            x: e.target.x() / scale - shape.w / 2,
            y: e.target.y() / scale - shape.h / 2,
          });
        }}
        onTransformEnd={(e) => {
          const node = e.target;
          const sx = node.scaleX();
          const sy = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          const rx = (node as Konva.Ellipse).radiusX() * sx;
          const ry = (node as Konva.Ellipse).radiusY() * sy;
          const w = (rx * 2) / scale;
          const h = (ry * 2) / scale;
          onChange({
            x: node.x() / scale - w / 2,
            y: node.y() / scale - h / 2,
            w,
            h,
          });
        }}
      />
    );
  }

  if (shape.type === "freehand") {
    const points = shape.points.map((n) => n * scale);
    return (
      <KLine
        {...common}
        points={points}
        strokeWidth={shape.strokeWidth * scale}
        lineCap="round"
        lineJoin="round"
        tension={0.2}
        hitStrokeWidth={Math.max(12, shape.strokeWidth * scale)}
        onDragEnd={(e) => {
          const dx = e.target.x() / scale;
          const dy = e.target.y() / scale;
          e.target.position({ x: 0, y: 0 });
          onChange({
            points: shape.points.map((n, i) => (i % 2 === 0 ? n + dx : n + dy)),
          });
        }}
      />
    );
  }

  if (shape.type === "polygon") {
    const points = shape.points.map((n) => n * scale);
    return (
      <KLine
        {...common}
        points={points}
        closed
        strokeWidth={shape.strokeWidth * scale}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={Math.max(12, shape.strokeWidth * scale)}
        onDragEnd={(e) => {
          const dx = e.target.x() / scale;
          const dy = e.target.y() / scale;
          e.target.position({ x: 0, y: 0 });
          onChange({
            points: shape.points.map((n, i) => (i % 2 === 0 ? n + dx : n + dy)),
          });
        }}
      />
    );
  }

  if (shape.type !== "text") return null;

  // text
  return (
    <KText
      id={shape.id}
      x={shape.x * scale}
      y={shape.y * scale}
      text={shape.text}
      fontSize={shape.fontSize * scale}
      fill={shape.color}
      draggable={draggable}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDblClick={(e) => {
        // Content-space position of the label; openTextEditor maps it through
        // the stage transform to a screen pixel.
        onTextEdit(shape.text, e.target.x(), e.target.y());
      }}
      onDblTap={(e) => {
        // Content-space position of the label; openTextEditor maps it through
        // the stage transform to a screen pixel.
        onTextEdit(shape.text, e.target.x(), e.target.y());
      }}
      onDragEnd={(e) => {
        onChange({ x: e.target.x() / scale, y: e.target.y() / scale });
      }}
    />
  );
}

// --- Toolbar primitives -----------------------------------------------------

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} placement="bottom">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors disabled:opacity-40 ${
          active ? "bg-brand-action text-white" : "text-foreground-muted hover:bg-surface-raised"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

// --- Inline SVG icons (no emojis, no icon library) --------------------------

const ic = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function IconCursor() {
  return (
    <svg {...ic}>
      <path d="M5 3l6 18 2.5-7.5L21 11z" />
    </svg>
  );
}
function IconArrow() {
  return (
    <svg {...ic}>
      <path d="M5 19L19 5" />
      <path d="M12 5h7v7" />
    </svg>
  );
}
function IconLine() {
  return (
    <svg {...ic}>
      <path d="M5 19L19 5" />
    </svg>
  );
}
function IconRect() {
  return (
    <svg {...ic}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </svg>
  );
}
function IconEllipse() {
  return (
    <svg {...ic}>
      <ellipse cx="12" cy="12" rx="9" ry="6" />
    </svg>
  );
}
function IconPen() {
  // Freehand tool: "scribble loop" (Grant picked 2026-06-07 from
  // docs/mockups/freehand-icon-options.html).
  return (
    <svg {...ic}>
      <path d="M4 16c2-6 5 4 7-1s4-7 6-3-2 7 1 7" />
    </svg>
  );
}
function IconText() {
  return (
    <svg {...ic}>
      <path d="M5 6h14" />
      <path d="M12 6v13" />
    </svg>
  );
}
function IconUndo() {
  return (
    <svg {...ic}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  );
}
function IconRedo() {
  return (
    <svg {...ic}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg {...ic}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}
function IconPencil({ className }: { className?: string }) {
  return (
    <svg {...ic} className={className}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}
function IconMinus() {
  return (
    <svg {...ic}>
      <path d="M5 12h14" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg {...ic}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
function IconPolygon() {
  return (
    <svg {...ic}>
      <path d="M12 3l8 6-3 9H7L4 9z" />
    </svg>
  );
}
