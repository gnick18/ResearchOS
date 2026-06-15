// Built-in figure templates: starter diagram scaffolds made of shapes, typed
// text, and smart connectors. "Use template" seeds the current page with these
// (fresh ids, so they reference each other correctly). Pure, no React.
//
// Data-bound templates (panels that fill from the user's sequences / trees /
// plots) are a later step; these scaffolds give the layout, the user drops their
// own panels and icons in. No em-dashes, no emojis, no mid-sentence colons.

import type {
  Annotation,
  Connector,
  FigurePage,
  FigureShape,
} from "@/lib/figure/figure-page";

export interface TemplateElements {
  shapes: FigureShape[];
  annotations: Annotation[];
  connectors: Connector[];
}

export interface FigureTemplate {
  id: string;
  name: string;
  description: string;
  /** Build the elements to add, seeded for unique + cross-referencing ids. */
  build: (seed: string, pageWIn: number, pageHIn: number) => TemplateElements;
}

const box = (
  shapeId: string,
  xIn: number,
  yIn: number,
  wIn: number,
  hIn: number,
  kind: FigureShape["kind"] = "rect",
): FigureShape => ({
  shapeId,
  kind,
  xIn,
  yIn,
  wIn,
  hIn,
  fill: "#e3f4ec",
  stroke: "#1d9e75",
  strokeWPt: 1.5,
});

const heading = (annId: string, xIn: number, yIn: number, text: string): Annotation => ({
  annId,
  kind: "text",
  xIn,
  yIn,
  text,
  fontPt: 18,
  variant: "heading",
});

const label = (annId: string, xIn: number, yIn: number, text: string): Annotation => ({
  annId,
  kind: "text",
  xIn,
  yIn,
  text,
  fontPt: 12,
  variant: "label",
});

const connect = (
  connId: string,
  fromId: string,
  toId: string,
  fromSide: Connector["from"]["side"],
  toSide: Connector["to"]["side"],
): Connector => ({
  connId,
  from: { ref: { kind: "shape", id: fromId }, side: fromSide },
  to: { ref: { kind: "shape", id: toId }, side: toSide },
  shape: "elbow",
  heads: 1,
  color: "#1f2937",
  weightPt: 1.5,
});

export const FIGURE_TEMPLATES: FigureTemplate[] = [
  {
    id: "process-3",
    name: "Process flow",
    description: "Three labeled steps connected left to right.",
    build: (s, w) => {
      const bw = 1.8;
      const bh = 1;
      const y = 1.5;
      const gap = (w - 2 * 0.5 - 3 * bw) / 2;
      const xs = [0.5, 0.5 + bw + gap, 0.5 + 2 * (bw + gap)];
      const shapes = xs.map((x, i) => box(`${s}-b${i}`, x, y, bw, bh));
      const annotations = xs.map((x, i) =>
        label(`${s}-l${i}`, x + 0.2, y + 0.6, `Step ${i + 1}`),
      );
      const connectors = [
        connect(`${s}-c0`, `${s}-b0`, `${s}-b1`, "right", "left"),
        connect(`${s}-c1`, `${s}-b1`, `${s}-b2`, "right", "left"),
      ];
      return { shapes, annotations, connectors };
    },
  },
  {
    id: "compare-2",
    name: "Two-column comparison",
    description: "Two side-by-side panels with headings.",
    build: (s, w, h) => {
      const cw = (w - 0.5 * 3) / 2;
      const ch = h - 2.5;
      const xs = [0.5, 0.5 + cw + 0.5];
      const shapes = xs.map((x, i) => box(`${s}-col${i}`, x, 1.6, cw, ch));
      const annotations = xs.map((x, i) =>
        heading(`${s}-h${i}`, x + 0.2, 1.2, i === 0 ? "Condition A" : "Condition B"),
      );
      return { shapes, annotations, connectors: [] };
    },
  },
  {
    id: "abstract",
    name: "Graphical abstract",
    description: "A title band and a framed canvas for a one-page summary.",
    build: (s, w, h) => {
      const shapes = [
        { ...box(`${s}-band`, 0.5, 0.5, w - 1, 0.8), fill: "#1d9e75", stroke: "none", strokeWPt: 0 },
        { ...box(`${s}-frame`, 0.5, 1.6, w - 1, h - 2.6), fill: "none", stroke: "#c3cabf", strokeWPt: 1 },
      ];
      const annotations = [heading(`${s}-title`, 0.8, 1.05, "Graphical abstract")];
      return { shapes, annotations, connectors: [] };
    },
  },
];

/** Merge a template's elements into a page at the page's real size (appending). */
export function applyTemplateSized(
  page: FigurePage,
  t: FigureTemplate,
  wIn: number,
  hIn: number,
): FigurePage {
  const seed = `t${page.id}-${page.shapes?.length ?? 0}-${page.annotations.length}-${Math.round(
    wIn * 10,
  )}`;
  const el = t.build(seed, wIn, hIn);
  return {
    ...page,
    shapes: [...(page.shapes ?? []), ...el.shapes],
    annotations: [...page.annotations, ...el.annotations],
    connectors: [...(page.connectors ?? []), ...el.connectors],
  };
}
