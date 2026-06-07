# Annotate editor revamp: approved plan

The near-term plan for the photo-annotation editor (`ImageAnnotatorModal`).
Direction chosen by Grant 2026-06-07: keep the existing Konva engine + our
`AnnotationDoc` schema (Option 3), revamp the editor, defer the structured-ROI /
ontology data-model project (see STRUCTURED_ROI_ONTOLOGY.md).

## Done

- **Full-viewport + floating tools** (`a87d11643`). Image fills the viewport;
  toolbar floats top-left, title + Cancel/Save float top-right. Light/dark via
  semantic tokens. Backdrop blur gated through the popup stack so it does not
  double-blur over the ImageMetadata popup it opens from.
- **Dev test harness** at `/dev/annotate-demo` (`e84105b49`). Mounts the real
  editor over a fake data-URI plate image; `?wikiCapture=1` makes Save use the
  in-memory mock so testing never writes to the real folder.

## Built (3bd67b1de, 2026-06-07; needs a live pass on /dev/annotate-demo)

- **Zoom + pan.** Viewport-sized stage + controlled view {zoom,x,y}; pinch /
  ctrl+wheel zooms toward the cursor and blocks native page zoom (non-passive
  wheel listener), two-finger scroll pans; floating -, % (Fit), + control;
  recenters on load/resize. Drawing uses getRelativePointerPosition so it stays
  accurate at any zoom/pan.
- **Polygon tool.** Additive AnnotationShape "polygon" + shapeToSvgElements
  branch (renders on every surface via AnnotatedImage); click to place vertices,
  Enter / click-near-start closes, Escape cancels, dashed rubber band.

## Approved, the original detail (kept for reference)

1. **Zoom + pan (APPROVED 2026-06-07).** Smooth zoom and pan on the image inside
   the editor.
   - Konva `Stage` scale + position. Zoom TOWARD THE CURSOR (Figma/Maps feel),
     not the center. Two-finger trackpad drag = pan.
   - **Trackpad pinch = yes.** Chrome/Edge report a pinch as a `wheel` event with
     `ctrlKey=true`, so pinch maps onto the same handler.
   - **Block the browser's native zoom.** Attach a NON-PASSIVE `wheel` listener
     over the editor overlay and `preventDefault()` so the page never zooms; the
     gesture drives the canvas instead. (Keyboard Cmd/Ctrl +/- left to the
     browser unless we decide to capture it too.)
   - Floating zoom control: % readout + "Fit" / "100%" reset.
   - REAL WORK: rework the pointer->natural coordinate mapping so drawing,
     selecting, dragging, and the inline text editor stay accurate at any
     scale+pan (shapes are stored in natural image pixels; the current single
     `scale` factor becomes scale x zoom + pan offset).
   - Must be verified live on `/dev/annotate-demo` (interaction-heavy; trackpad
     pinch + native-zoom-block cannot be unit-tested).

2. **Polygon tool.** New `AnnotationShape` variant (`type: "polygon"`, flat
   `points[]` in natural pixels), additive to the schema with a render branch in
   `shapeToSvgElements` (so `<AnnotatedImage>` overlays render it everywhere).
   Click-to-place vertices, close on click-near-start / double-click / Enter,
   Esc cancels the in-progress polygon. ShapeNode render branch (closed Konva
   line) + transformer handling. Interaction-heavy: verify live on the demo page.

## Later (separate project)

- Structured ROIs + ontology tagging (STRUCTURED_ROI_ONTOLOGY.md). Re-opens the
  Annotorious-vs-Konva question (ANNOTATE_ANNOTORIOUS_SPIKE.md).

## Verification note

Zoom/pan and polygon are both interaction-heavy and cannot be meaningfully
unit-tested. Iterate them against `/dev/annotate-demo?wikiCapture=1` with a live
preview before declaring done.
