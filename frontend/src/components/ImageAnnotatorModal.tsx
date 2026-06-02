"use client";

import {
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

type Tool = "select" | "arrow" | "line" | "rect" | "ellipse" | "freehand" | "text";

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

  // Stage sizing: fit the natural image into the available viewport box.
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

  // Drawing-in-progress shape (committed to `shapes` on pointer up).
  const drawingRef = useRef<AnnotationShape | null>(null);
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
      const availW = box?.width ?? window.innerWidth - 80;
      const availH = box?.height ?? window.innerHeight - 200;
      const scale = Math.min(availW / img.naturalWidth, availH / img.naturalHeight, 1);
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

  // --- Keyboard: Escape closes, Delete removes, Cmd+Z / Cmd+Shift+Z --------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingText) return; // let the textarea own keys while editing
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
  }, [editingText, selectedId, onClose, deleteSelected, undo, redo]);

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
      const pos = stage?.getPointerPosition();
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
    [tool, toNatural, color, strokeWidth, fontSize, commit],
  );

  const handlePointerMove = useCallback(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
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
  }, [toNatural]);

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
    (id: string, value: string, screenX: number, screenY: number) => {
      const stageBox = stageRef.current?.container().getBoundingClientRect();
      setEditingText({
        id,
        value,
        screenX: (stageBox?.left ?? 0) + screenX,
        screenY: (stageBox?.top ?? 0) + screenY,
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
      className="fixed inset-0 z-[200] flex flex-col bg-gray-900/95 backdrop-blur-sm"
      data-tour-popup-occluding="image-annotator"
      // This full-screen editor mounts as a child of ImageMetadataPopup's
      // backdrop div, whose onClick closes the whole popup. Although we are
      // position:fixed, we are still a DOM descendant of that backdrop, so a
      // click on any tool (Rectangle, Arrow, ...) or on the canvas would bubble
      // up and close the popup, exiting annotate mode. Stop propagation at our
      // root so the editor is self-contained and owns its own Cancel / Save /
      // Escape exits. (Mirrors the content-card stopPropagation in the popup.)
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 bg-gray-900">
        <div className="flex items-center gap-2 min-w-0">
          <IconPencil className="text-sky-400 flex-shrink-0" />
          <h3 className="text-sm font-medium text-gray-100 truncate" title={filename}>
            Annotate: {filename}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !img}
            className="px-4 py-1.5 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-gray-700 bg-gray-800">
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
          <ToolButton label="Text label" active={tool === "text"} onClick={() => setTool("text")}>
            <IconText />
          </ToolButton>
        </div>

        <div className="w-px h-6 bg-gray-600" />

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
                  color === c ? "ring-2 ring-sky-400 scale-110 border-white" : "border-gray-500"
                }`}
                style={{ backgroundColor: c }}
              />
            </Tooltip>
          ))}
        </div>

        <div className="w-px h-6 bg-gray-600" />

        {/* Stroke width */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] uppercase tracking-wide text-gray-400">Stroke</span>
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => applyStrokeWidth(w)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                effStroke === w
                  ? "bg-sky-600 text-white"
                  : "text-gray-300 hover:bg-gray-700"
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
            className="w-12 px-1 py-1 text-xs rounded bg-gray-700 text-gray-100 text-center outline-none focus:ring-1 focus:ring-sky-500"
            aria-label="Custom stroke width"
          />
        </div>

        <div className="w-px h-6 bg-gray-600" />

        {/* Font size */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] uppercase tracking-wide text-gray-400">Text</span>
          {FONT_SIZES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => applyFontSize(f)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                effFontSize === f
                  ? "bg-sky-600 text-white"
                  : "text-gray-300 hover:bg-gray-700"
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
            className="w-12 px-1 py-1 text-xs rounded bg-gray-700 text-gray-100 text-center outline-none focus:ring-1 focus:ring-sky-500"
            aria-label="Custom text size"
          />
        </div>

        <div className="w-px h-6 bg-gray-600" />

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
      </div>

      {/* Stage area */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden p-4">
        {imgError ? (
          <p className="text-sm text-gray-300">Could not load the image.</p>
        ) : !img ? (
          <p className="text-sm text-gray-300">Loading image...</p>
        ) : (
          <div className="shadow-2xl" style={{ width: stageSize.width, height: stageSize.height }}>
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
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
          </div>
        )}
      </div>

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
          style={{
            position: "fixed",
            top: editingText.screenY,
            left: editingText.screenX,
            zIndex: 210,
            minWidth: 120,
            fontSize: Math.max(12, editFontSize * scale),
            color: editColor,
            background: "rgba(255,255,255,0.95)",
            border: "1px solid #38bdf8",
            borderRadius: 4,
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
        const box = e.target.getClientRect();
        onTextEdit(shape.text, box.x, box.y);
      }}
      onDblTap={(e) => {
        const box = e.target.getClientRect();
        onTextEdit(shape.text, box.x, box.y);
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
          active ? "bg-sky-600 text-white" : "text-gray-300 hover:bg-gray-700"
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
  return (
    <svg {...ic}>
      <path d="M3 21c3-1 5-2 7-5 1.5-2 3-5 5-7 1.2-1.2 3-1 3 .5 0 2-3 3.8-5 5-3 1.8-5 3-10 6.5z" />
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
