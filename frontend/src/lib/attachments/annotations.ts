import { fileService } from "@/lib/file-system/file-service";

/**
 * Non-destructive photo-annotation layer.
 *
 * Each annotated image carries a SECOND sidecar next to the raw file and its
 * existing `{filename}.json` metadata sidecar:
 *
 *   results/task-12/Images/
 *     gel-day3.png              raw image, NEVER modified
 *     gel-day3.png.json         existing metadata sidecar (caption / tags)
 *     gel-day3.png.annot.json   NEW annotation layer (this file's schema)
 *
 * The raw image stays byte-identical; annotations are stored as re-editable
 * vector shapes in the image's NATURAL pixel space (0..imageW, 0..imageH).
 * `<AnnotatedImage>` renders them as a scaled SVG overlay using
 * `viewBox="0 0 imageW imageH"`, so one stored annotation renders correctly
 * from a full-width note down to a 64px thumbnail with zero per-surface math.
 *
 * See `plans/PHOTO_ANNOTATION_DESIGN.md` (locked design) for the full rationale.
 */

export const ANNOTATION_SCHEMA_VERSION = 1 as const;

/** A two-point shape: arrow (drawn with a head) or a plain line segment. */
export interface AnnotationSegment {
  id: string;
  type: "arrow" | "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
}

/** An axis-aligned box: rectangle outline or ellipse inscribed in the box. */
export interface AnnotationBox {
  id: string;
  type: "rect" | "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  strokeWidth: number;
}

/** A freehand pen stroke. `points` is a flat array of x,y pairs. */
export interface AnnotationFreehand {
  id: string;
  type: "freehand";
  /** Flat [x0, y0, x1, y1, ...] in natural image pixels. */
  points: number[];
  color: string;
  strokeWidth: number;
}

/** A text label. Uses `fontSize` (natural pixels) instead of `strokeWidth`. */
export interface AnnotationText {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

export type AnnotationShape =
  | AnnotationSegment
  | AnnotationBox
  | AnnotationFreehand
  | AnnotationText;

export interface AnnotationDoc {
  version: number;
  /** Image natural width at annotation time. */
  imageW: number;
  /** Image natural height at annotation time. */
  imageH: number;
  shapes: AnnotationShape[];
  /** ISO timestamp of the last save. */
  updatedAt: string;
  /** Username of the last editor, when known. */
  updatedBy?: string;
}

/**
 * Path of the annotation sidecar for an image. Mirrors `sidecarPath` in
 * `image-folder.ts` but with the `.annot.json` suffix so the two sidecars
 * never collide.
 */
export function annotPath(basePath: string, imageName: string): string {
  return `${basePath}/Images/${imageName}.annot.json`;
}

/**
 * Read the annotation layer for an image, or `null` when none exists (the
 * common case: 99% of images carry no annotations). A malformed / empty file
 * is treated as missing by `fileService.readJson`.
 */
export async function readAnnotations(
  basePath: string,
  imageName: string,
): Promise<AnnotationDoc | null> {
  const doc = await fileService.readJson<AnnotationDoc>(annotPath(basePath, imageName));
  if (!doc || !Array.isArray(doc.shapes)) return null;
  return doc;
}

/**
 * Atomically write the annotation layer for an image. `fileService.writeJson`
 * already routes through the `.tmp` + `move()` atomic pattern, so we never
 * touch `createWritable` on the final path directly. The raw image is never
 * written here.
 */
export async function writeAnnotations(
  basePath: string,
  imageName: string,
  doc: AnnotationDoc,
): Promise<void> {
  await fileService.writeJson(annotPath(basePath, imageName), doc);
}

/**
 * Derive an Images/ filename from a markdown image `src`. Markdown refs
 * percent-encode the filename (`Images/foo%20bar.png`) while the on-disk name
 * is literal (`foo bar.png`); we mirror `blobUrlResolver.resolvePath`'s
 * `decodeURI` step then take the basename. Returns `null` for non-local refs
 * (http/data/blob) and for refs that don't look like an `Images/` path.
 */
export function filenameFromMarkdownSrc(src: string): string | null {
  if (!src) return null;
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("blob:")
  ) {
    return null;
  }
  let decoded = src;
  try {
    decoded = decodeURI(src);
  } catch {
    // malformed percent-encoding: fall back to the raw src
  }
  // Strip any CommonMark title / angle-bracket noise the caller may not have
  // canonicalized, then take the last path segment.
  const cleaned = decoded.replace(/^<|>$/g, "").split(/[?#]/)[0].trim();
  const base = cleaned.split("/").pop() ?? "";
  return base.length > 0 ? base : null;
}

/** A single SVG element description, DOM-free so the mapping stays testable. */
export interface SvgElementSpec {
  /** SVG tag: line, rect, ellipse, polyline, text, polygon. */
  tag: "line" | "rect" | "ellipse" | "polyline" | "text" | "polygon";
  /** Element attributes in natural-pixel coordinates. */
  attrs: Record<string, string | number>;
  /** Text content, for `text` elements. */
  text?: string;
  /** Stable key for React reconciliation. */
  key: string;
}

/** Default arrowhead length as a multiple of stroke width. */
const ARROWHEAD_STROKE_MULTIPLE = 4;
/** Minimum arrowhead length in natural pixels, so thin strokes still show a head. */
const ARROWHEAD_MIN = 10;

/**
 * Map one annotation shape to one or more SVG element specs in NATURAL image
 * coordinates. Pure + DOM-free so the scaling math is unit-testable: the
 * overlay `<svg viewBox="0 0 imageW imageH">` lets the browser scale these
 * specs proportionally to whatever box the image renders in, so a 4px stroke
 * in a 1024-wide viewBox stays proportional at a 64px container.
 */
export function shapeToSvgElements(shape: AnnotationShape): SvgElementSpec[] {
  switch (shape.type) {
    case "line":
      return [
        {
          tag: "line",
          key: shape.id,
          attrs: {
            x1: shape.x1,
            y1: shape.y1,
            x2: shape.x2,
            y2: shape.y2,
            stroke: shape.color,
            "stroke-width": shape.strokeWidth,
            "stroke-linecap": "round",
            fill: "none",
          },
        },
      ];
    case "arrow": {
      const { x1, y1, x2, y2, color, strokeWidth } = shape;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(ARROWHEAD_MIN, strokeWidth * ARROWHEAD_STROKE_MULTIPLE);
      const spread = Math.PI / 7;
      const hx1 = x2 - headLen * Math.cos(angle - spread);
      const hy1 = y2 - headLen * Math.sin(angle - spread);
      const hx2 = x2 - headLen * Math.cos(angle + spread);
      const hy2 = y2 - headLen * Math.sin(angle + spread);
      return [
        {
          tag: "line",
          key: `${shape.id}-shaft`,
          attrs: {
            x1,
            y1,
            x2,
            y2,
            stroke: color,
            "stroke-width": strokeWidth,
            "stroke-linecap": "round",
            fill: "none",
          },
        },
        {
          tag: "polygon",
          key: `${shape.id}-head`,
          attrs: {
            points: `${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`,
            fill: color,
            stroke: "none",
          },
        },
      ];
    }
    case "rect":
      return [
        {
          tag: "rect",
          key: shape.id,
          attrs: {
            x: shape.x,
            y: shape.y,
            width: shape.w,
            height: shape.h,
            stroke: shape.color,
            "stroke-width": shape.strokeWidth,
            fill: "none",
          },
        },
      ];
    case "ellipse":
      return [
        {
          tag: "ellipse",
          key: shape.id,
          attrs: {
            cx: shape.x + shape.w / 2,
            cy: shape.y + shape.h / 2,
            rx: Math.abs(shape.w / 2),
            ry: Math.abs(shape.h / 2),
            stroke: shape.color,
            "stroke-width": shape.strokeWidth,
            fill: "none",
          },
        },
      ];
    case "freehand":
      return [
        {
          tag: "polyline",
          key: shape.id,
          attrs: {
            points: pointsToAttr(shape.points),
            stroke: shape.color,
            "stroke-width": shape.strokeWidth,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            fill: "none",
          },
        },
      ];
    case "text":
      return [
        {
          tag: "text",
          key: shape.id,
          text: shape.text,
          attrs: {
            x: shape.x,
            // SVG text y is the baseline; nudge down by the font size so the
            // stored (x, y) reads as the top-left corner like Konva's Text.
            y: shape.y + shape.fontSize,
            fill: shape.color,
            "font-size": shape.fontSize,
            "font-family": "sans-serif",
            "dominant-baseline": "alphabetic",
          },
        },
      ];
    default: {
      // Exhaustiveness guard: a new shape type added to the union without a
      // render branch is a compile error here.
      const _never: never = shape;
      return _never;
    }
  }
}

/** Flatten a [x0,y0,x1,y1,...] array into an SVG `points` attribute string. */
function pointsToAttr(points: number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push(`${points[i]},${points[i + 1]}`);
  }
  return out.join(" ");
}

/** Map every shape in a doc to its flattened SVG element specs. */
export function docToSvgElements(doc: AnnotationDoc): SvgElementSpec[] {
  return doc.shapes.flatMap(shapeToSvgElements);
}
