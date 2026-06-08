// Non-destructive photo-annotation layer, ported VERBATIM from the web app's
// frontend/src/lib/attachments/annotations.ts so a photo annotated on the phone
// stays editable on the laptop and vice versa. The raw image is never modified;
// annotations are stored as re-editable vector shapes in the image's NATURAL
// pixel space (0..imageW, 0..imageH). The mobile editor renders them as a scaled
// react-native-svg overlay using viewBox="0 0 imageW imageH", exactly like the
// web <AnnotatedImage>, so one stored annotation renders correctly from a full
// preview down to a thumbnail with zero per-surface math.
//
// Keep this file pure (no React, no DOM, no native module) so the schema + the
// arrowhead math stay shared and testable. House style: no em-dashes, no emojis,
// no mid-sentence colons.

export const ANNOTATION_SCHEMA_VERSION = 1 as const;

/** A two-point shape: arrow (drawn with a head) or a plain line segment. */
export interface AnnotationSegment {
  id: string;
  type: 'arrow' | 'line';
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
  type: 'rect' | 'ellipse';
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
  type: 'freehand';
  /** Flat [x0, y0, x1, y1, ...] in natural image pixels. */
  points: number[];
  color: string;
  strokeWidth: number;
}

/** A closed polygon region of interest. `points` is a flat array of x,y pairs. */
export interface AnnotationPolygon {
  id: string;
  type: 'polygon';
  /** Flat [x0, y0, x1, y1, ...] in natural image pixels; rendered closed. */
  points: number[];
  color: string;
  strokeWidth: number;
}

/** A text label. Uses `fontSize` (natural pixels) instead of `strokeWidth`. */
export interface AnnotationText {
  id: string;
  type: 'text';
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
  | AnnotationPolygon
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

/** A single SVG element description, native-free so the mapping stays testable. */
export interface SvgElementSpec {
  /** SVG tag: line, rect, ellipse, polyline, text, polygon. */
  tag: 'line' | 'rect' | 'ellipse' | 'polyline' | 'text' | 'polygon';
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
 * coordinates. Pure so the scaling math is unit-testable: the overlay
 * <Svg viewBox="0 0 imageW imageH"> lets the renderer scale these specs
 * proportionally to whatever box the image renders in, so a 4px stroke in a
 * 1024-wide viewBox stays proportional at a small container. Mirrors the web
 * shapeToSvgElements arrowhead math EXACTLY.
 */
export function shapeToSvgElements(shape: AnnotationShape): SvgElementSpec[] {
  switch (shape.type) {
    case 'line':
      return [
        {
          tag: 'line',
          key: shape.id,
          attrs: {
            x1: shape.x1,
            y1: shape.y1,
            x2: shape.x2,
            y2: shape.y2,
            stroke: shape.color,
            'stroke-width': shape.strokeWidth,
            'stroke-linecap': 'round',
            fill: 'none',
          },
        },
      ];
    case 'arrow': {
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
          tag: 'line',
          key: `${shape.id}-shaft`,
          attrs: {
            x1,
            y1,
            x2,
            y2,
            stroke: color,
            'stroke-width': strokeWidth,
            'stroke-linecap': 'round',
            fill: 'none',
          },
        },
        {
          tag: 'polygon',
          key: `${shape.id}-head`,
          attrs: {
            points: `${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`,
            fill: color,
            stroke: 'none',
          },
        },
      ];
    }
    case 'rect':
      return [
        {
          tag: 'rect',
          key: shape.id,
          attrs: {
            x: shape.x,
            y: shape.y,
            width: shape.w,
            height: shape.h,
            stroke: shape.color,
            'stroke-width': shape.strokeWidth,
            fill: 'none',
          },
        },
      ];
    case 'ellipse':
      return [
        {
          tag: 'ellipse',
          key: shape.id,
          attrs: {
            cx: shape.x + shape.w / 2,
            cy: shape.y + shape.h / 2,
            rx: Math.abs(shape.w / 2),
            ry: Math.abs(shape.h / 2),
            stroke: shape.color,
            'stroke-width': shape.strokeWidth,
            fill: 'none',
          },
        },
      ];
    case 'freehand':
      return [
        {
          tag: 'polyline',
          key: shape.id,
          attrs: {
            points: pointsToAttr(shape.points),
            stroke: shape.color,
            'stroke-width': shape.strokeWidth,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            fill: 'none',
          },
        },
      ];
    case 'polygon':
      return [
        {
          tag: 'polygon',
          key: shape.id,
          attrs: {
            points: pointsToAttr(shape.points),
            stroke: shape.color,
            'stroke-width': shape.strokeWidth,
            'stroke-linejoin': 'round',
            fill: 'none',
          },
        },
      ];
    case 'text':
      return [
        {
          tag: 'text',
          key: shape.id,
          text: shape.text,
          attrs: {
            x: shape.x,
            // SVG text y is the baseline; nudge down by the font size so the
            // stored (x, y) reads as the top-left corner like the web renderer.
            y: shape.y + shape.fontSize,
            fill: shape.color,
            'font-size': shape.fontSize,
            'font-family': 'sans-serif',
            'dominant-baseline': 'alphabetic',
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
  return out.join(' ');
}

/** Map every shape in a doc to its flattened SVG element specs. */
export function docToSvgElements(doc: AnnotationDoc): SvgElementSpec[] {
  return doc.shapes.flatMap(shapeToSvgElements);
}

// Per-process counter so two shapes made in the same millisecond still get
// distinct ids. Module scope on purpose; uniqueness only needs to hold within a
// single edit session, the timestamp prefix handles uniqueness across runs.
let shapeIdCounter = 0;

/** Generate a stable shape id for a freshly drawn shape. */
export function makeShapeId(): string {
  shapeIdCounter += 1;
  return `shp_${Date.now().toString(36)}_${shapeIdCounter}`;
}
