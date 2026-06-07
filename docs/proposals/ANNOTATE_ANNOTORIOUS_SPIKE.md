# Annotate editor: Annotorious spike

Status: spike / assessment, no code committed to the app. Decision pending Grant.

## Why

The current annotate editor (`ImageAnnotatorModal.tsx`) is a hand-built Konva
editor with our own `AnnotationDoc` schema. Grant's review wants a full-viewport
editor with floating tools, semantic ROIs (polygons, not just boxes), and to
stop hand-building the canvas math. Annotorious is the one recommended library
that fits a local-first, no-backend, browser app. Label Studio and CVAT are
server platforms (Python backends, data management) and do NOT fit, they would
require standing up a server and break the local-first model.

## Proof

`docs/mockups/annotate-annotorious-spike.html` is a standalone proof using
Annotorious v3 from CDN (no repo install). It shows the target direction: a
full-viewport image with floating tool palette (select / rectangle / polygon),
floating Save/Cancel, light and dark themes, and a live JSON panel proving the
state is library-owned JSON, not read from the DOM. Open it and draw.

## What Annotorious gives us

- Client-only, works on a plain `<img>` (no OpenSeadragon needed for standard
  images; OSD is a separate package only for deep-zoom / IIIF).
- Box AND polygon ROIs out of the box, plus the resize/drag/coordinate math we
  currently hand-maintain in Konva.
- A clean separation of geometry and data: an annotation is
  `{ id, target: { selector: { type, geometry } }, bodies: [{ purpose, value }] }`.
  `bodies` is where structured tags / comments live, which is the hook for the
  ontology idea (tag type / strain / phenotype) instead of free text.
- Optional W3C Web Annotation output via `W3CImageAdapter`, so we can store the
  standardized model if we want portability.
- React bindings (`@annotorious/react`), so it drops into our stack.

## Bundle weight

Not yet measured precisely (bundlephobia returned no data for the scoped
package). v3 core is a deliberate lightweight rewrite and does NOT pull
OpenSeadragon for standard images. Per the mathjs lesson, the real number is a
`next build` first-load delta measured AT INSTALL behind a thin wrapper, and the
import should be dynamic (the editor is already `next/dynamic`, ssr:false), so
it never rides the shared shell chunk. If the delta is large we reconsider.

## Migration of existing `.annot.json`

This is the real cost. Today we persist our own schema:

```
AnnotationDoc { version, shapes: AnnotationShape[] }   // shapes in NATURAL image coords
AnnotationShape = arrow | line | rect | ellipse | freehand | text  (color, strokeWidth, ...)
```

Annotorious stores its own model (RECTANGLE/POLYGON geometry + bodies). Moving
means a lazy-normalize adapter at the read boundary (the established
`normalize<Entity>Record` pattern), converting old shapes to Annotorious
annotations on load and writing the new shape on save. Gaps to decide:

- Annotorious core has rectangle + polygon (+ point/freehand via plugins). Our
  current set includes arrow, line, ellipse, freehand, text. Arrow/line/text are
  not first-class Annotorious shapes. Either keep a small Konva overlay for
  those, accept losing them, or model them as bodies/styled shapes. THIS IS THE
  KEY DECISION.
- Coordinate space: ours is natural-image coords; Annotorious uses image pixel
  geometry too, so the mapping is direct for boxes; freehand/arrow need custom
  handling.

## Options

1. Full swap to Annotorious (boxes + polygons + ontology bodies), drop
   arrow/line/ellipse/text, lazy-migrate old docs. Cleanest long-term, most
   migration work, some current shapes lost.
2. Hybrid: Annotorious for ROIs (box/polygon/point) + a thin Konva overlay for
   arrow/line/text labels. Keeps every current capability, more complexity.
3. Keep Konva, just adopt the full-viewport + floating-tools + light/dark UI
   (what `2bc22becb` started) and add polygon support by hand. No new dep, no
   migration, least powerful.

## Recommendation

If the goal is the semantic-ROI + ontology direction, option 1 is the right
target, with a real `next build` bundle measurement and a lazy-migration adapter
as the two gates before committing. Confirm whether losing arrow/line/text
free-draw is acceptable (option 1) or must be preserved (option 2) before any
install.

Note: the earlier bounded-card revamp commit (`2bc22becb`) is superseded by the
full-viewport direction and will be replaced or reverted depending on the choice.
