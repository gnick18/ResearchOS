# Photo Annotation Tool: Design (locked)

Status: design locked 2026-06-02, Phase 1 not yet dispatched.
Author: orchestrator.
Decisions signed off by Grant: storage model, editor library, export timing (see Decision Log).

---

## 1. What this is

An in-app, non-destructive image annotation tool. A user opens any image already
attached to a note or experiment (gel image, micrograph, plate photo, screenshot)
and draws on it: arrows, boxes, ellipses, lines, freehand pen strokes, and text
labels. The point is to mark up the things scientists mark up by hand today
(circle a band, arrow a colony, label a lane) without leaving the app and without
touching the original file.

## 2. The core principle: non-destructive and re-editable

The raw image on disk is the system of record and is never modified. Annotations
are stored beside it as re-editable vector shape data, and rendered as a scaled
SVG overlay on top of the raw image at every surface that displays it.

This is deliberately stronger than the two options we discussed and rejected:

- Rejected "overwrite the file": destroys raw data; bad for reproducibility,
  audit, and the NIH data-management story ResearchOS sells.
- Rejected "always duplicate the file": forces a prompt on every edit, doubles
  storage, and the duplicate is still a flattened raster you can never edit again.
- Rejected "bake a flat transparent PNG overlay" (the first phrasing of the
  overlay idea): preserves the raw, but the annotations themselves are baked
  pixels, so a typo'd label or a misplaced arrow can never be fixed, and the PNG
  pixelates when the note renders the image wider than it was annotated.

The chosen model keeps the raw byte-identical AND keeps the annotations as live
objects. Three concrete payoffs:

- Editable forever. Reopening the editor rehydrates every shape as a selectable
  object. Drag an arrow head, retype a label, recolor, delete, undo, months later.
- Tiny and diff-friendly. A few KB of JSON, not a second multi-MB raster. Matters
  for OneDrive / Dropbox / iCloud / git shared folders.
- Crisp at any size. Vector overlay stays sharp from full-width note down to a
  64px image-strip thumbnail.

## 3. Data model

A second sidecar lives next to the image, alongside the existing
`{filename}.json` metadata sidecar:

```
results/task-12/Images/
  gel-day3.png              raw, never modified
  gel-day3.png.json         existing metadata sidecar (caption / tags / source)
  gel-day3.png.annot.json   NEW annotation layer
```

```jsonc
{
  "version": 1,
  "imageW": 1024,            // image natural width at annotation time
  "imageH": 768,             // image natural height
  "shapes": [
    { "id": "a1", "type": "arrow",
      "x1": 430, "y1": 230, "x2": 560, "y2": 360,
      "color": "#e11d48", "strokeWidth": 4 },
    { "id": "a2", "type": "rect",
      "x": 120, "y": 80, "w": 200, "h": 140,
      "color": "#e11d48", "strokeWidth": 4 },
    { "id": "a3", "type": "text",
      "x": 600, "y": 150, "text": "band of interest",
      "color": "#e11d48", "fontSize": 28 }
  ],
  "updatedAt": "2026-06-02T18:00:00.000Z",
  "updatedBy": "grant"
}
```

Key modeling choices:

- Coordinates are in the image's NATURAL pixel space (0..imageW, 0..imageH), not
  normalized 0..1. The overlay SVG uses `viewBox="0 0 imageW imageH"` so the
  browser scales the whole coordinate space to whatever box the image renders in.
  Stroke widths and font sizes are also natural-pixel values, so they scale
  proportionally with everything else. This is what makes a single stored
  annotation render correctly in a full-width note and a 64px thumbnail with zero
  per-surface math.
- `imageW` / `imageH` are captured at annotation time. If the raw image is later
  replaced with different dimensions (rare), the overlay still maps proportionally
  via the viewBox; we do not silently corrupt coordinates.
- Separate file from `ImageSidecar` (not a new field on it) so the metadata
  sidecar stays small and human-readable, and so GC / events / move logic treat
  the annotation layer as an independent concern.
- Shape types for v1: `arrow`, `line`, `rect`, `ellipse`, `freehand`
  (points array), `text`. Extensible via the `type` discriminator + `version`.

## 4. Rendering: one shared `<AnnotatedImage>`

A single component is the linchpin. It renders the raw `<img>` (blob URL via the
existing `blobUrlResolver`) with an absolutely-positioned SVG overlay generated
from the `.annot.json`, both inside a relatively-positioned wrapper sized to the
image. The SVG uses `viewBox="0 0 imageW imageH"` and `width/height: 100%` so it
tracks the image box at any scale.

- When no `.annot.json` exists, it renders exactly today's `<img>` with no
  wrapper and no overlay: zero overhead and zero behavior change for the 99% of
  images with no annotations.
- A small "annotated" badge (custom inline SVG, corner-positioned) marks images
  that carry a layer, so it is discoverable that an overlay exists even at
  thumbnail size.
- Small-preview legibility: below a width threshold (thumbnails), text shapes are
  dropped from the overlay for legibility while strokes (arrows / boxes / pen)
  still render proportionally. At normal viewing sizes everything renders.

Surfaces where the bare `<img>` is replaced by `<AnnotatedImage>` (found in the
codebase audit):

- `LiveMarkdownEditor.tsx` (markdown `img` renderer, ~line 2158)
- `HybridMarkdownEditor.tsx` (markdown `img` renderer, ~line 2753)
- `MarkdownPreview.tsx` (~line 123)
- `RenderedMarkdown.tsx` (~line 96)
- `ImageStrip.tsx` thumbnails (~line 238)
- `project-surface/ResultsGallery.tsx`

The existing click-to-resize affordance in the editors is preserved; annotation
is a separate action (see Section 5), not a replacement for resize.

## 5. The editor

A full-screen modal annotator, built on react-konva (Konva canvas stage in a
React wrapper). Layout:

- Stage shows the raw image at natural resolution, fit-to-viewport with zoom/pan.
- Toolbar: select, arrow, line, rectangle, ellipse, freehand pen, text. Plus a
  color row, stroke-width control, and font-size control. All icons are custom
  inline SVGs (no emojis, no lucide). Icon-only buttons wrapped in `<Tooltip>`.
- Direct manipulation: shapes are draggable, resizable, and deletable. Konva
  handles the transform handles. Text shapes are double-click-to-edit.
- Undo / redo over the shape list.
- Save serializes the Konva shape list back into the `.annot.json` schema (NOT
  Konva's native JSON; we own a stable schema) and writes it atomically via
  `fileService.writeJson`, then emits an `imageEvents` change so every mounted
  `<AnnotatedImage>` for that file re-renders live. Raw image is never written.
- Cancel discards in-memory changes; nothing is written.

Re-edit: opening the editor on an image that already has `.annot.json` rehydrates
every shape as a live Konva object, so editing-after-the-fact is the same
experience as the first edit.

Entry points (all already have a click path on the image):

- The `ImageResizePopover` gains an "Annotate" action.
- The `ImageMetadataPopup` footer gains an "Annotate" button.
- The `ImageStrip` thumbnail context (alongside the metadata popup).

## 6. Export and flatten (deferred to Phase 3)

Some consumers cannot render a live SVG overlay: the react-pdf combined-PDF
export, copy-to-clipboard, pasting into a manuscript, Zenodo deposits. For those
we add, in Phase 3, an explicit "Export flattened copy" that composites raw +
overlay onto a canvas and writes a NEW `{name}.annotated.png` with the raw
preserved. This is the only place a duplicate raster is ever created, it is
opt-in, and it never interrupts the annotate flow with a prompt. The PDF export
path flattens annotated images automatically at build time.

This is explicitly out of scope for Phase 1 and Phase 2.

## 7. Lifecycle and GC (the traps to get right)

- `gcUnreferencedAttachments` must treat `{file}.annot.json` as part of its
  parent image: when the raw image is deleted the layer is deleted with it, and
  the raw is never collected merely because it carries a layer. The annot sidecar
  is not itself a markdown reference, so it must not be counted as a referenced
  attachment.
- `lib/attachments/move-image.ts` and the rename path must carry the
  `.annot.json` alongside the image and its `.json` metadata sidecar.
- `strip-references` and `duplicate-check` are unaffected (the annot sidecar is
  not a markdown image reference and has no caption to strip).
- Atomic writes: route the annot write through `fileService.writeJson` (already
  uses the `.tmp` + `move()` atomic pattern), never a raw `createWritable` on the
  final path.

## 8. Phasing

Phase 1 (core, dispatch first):
- `.annot.json` schema + a typed read/write helper in `lib/attachments/`.
- `<AnnotatedImage>` shared renderer, wired into all six render surfaces.
- react-konva editor with arrow / line / rect / ellipse / freehand / text,
  color / stroke / font controls, select-move-resize-delete, undo/redo, save.
- Entry points: resize popover + metadata popup.
- Notes and results surfaces working end to end (annotate, see it everywhere,
  re-edit).
- Tests: schema round-trip, overlay scaling math, no-annot-layer no-op path.

Phase 2 (lifecycle + polish):
- GC awareness, rename/move carry of `.annot.json`.
- "Annotated" badge, small-preview text-drop threshold.
- Undo/redo and selection polish, keyboard shortcuts.

Phase 3 (portability):
- Flatten-to-PNG export, react-pdf export integration, copy-to-clipboard.

Wiki: a dedicated wiki sub-bot drafts `/wiki/...` with annotated screenshots
after Phase 1 lands, per the standing wiki-ownership convention. Feature sub-bots
surface wiki implications in their reports and do not touch `wiki/**`.

## 9. Dependency note

react-konva + konva are MIT-licensed, compatible with the project's AGPLv3, and
add no React peer conflicts. Exact install command and version pin to be captured
in the Phase 1 chip brief (mirror the CM6 dependency-manifest discipline). Konva
is canvas-based for the editor only; the always-on render path (`<AnnotatedImage>`)
is plain SVG with no Konva dependency, so notes pages do not pull Konva into the
common bundle.

## Decision Log

- 2026-06-02. Storage model: vector JSON sidecar + live SVG overlay. Chosen over
  baked transparent PNG and over hybrid (vector + cached PNG). Rationale:
  re-editable forever, tiny storage, crisp at any size including small previews.
  Grant confirmed the live-overlay approach conditional on clean rendering at all
  sizes including small previews; the viewBox-scaling design satisfies that.
- 2026-06-02. Editor library: react-konva. Chosen over a hand-built SVG editor
  (more build time, reimplement selection/resize/undo) and fabric.js (heavier,
  imperative non-React API).
- 2026-06-02. Export/flatten timing: deferred to Phase 3. Ship the editor + live
  overlay first; add portability as a fast-follow.

## Cross-arc coordination (reply to the minimalism / de-bloat arc, 2026-06-02)

Reply from the photo-annotation manager to the de-bloat manager re
`docs/proposals/MINIMALISM_ARC_COORDINATION.md`.

1. No canvas / widget overlap. Photo annotation never touched
   `components/lab-overview/**`, the widget registry, the `/` home canvas, or
   `/lab-overview`. We surface only on the editor image surfaces and the image
   popup. Delete the canvas freely; nothing of ours rides on it.

2. We are on the new editor shapes, with one dead-code cleanup. The live
   annotation path is the inline editor (`LiveMarkdownEditor` img renderer) plus
   `ImageStrip` and `ImageMetadataPopup`. Our `<AnnotatedImage>` swap in
   `HybridMarkdownEditor` is now dead code since that editor is dormant. It is
   harmless; cull it whenever you remove HybridMarkdownEditor, or ping me and I
   will. The `MarkdownPreview` / `RenderedMarkdown` swaps are still live (read
   surfaces).

3. ImageStrip is the active collision and 14fdd046 is NOT on main yet. Current
   main has only our ImageStrip (AnnotatedImage thumbnails + the top-left
   annotate pencil + the button->div change + the `ImageAnnotatorModal` mount).
   When you land the unified strip, the merge MUST keep all of that, especially:
   thumbnails render via `<AnnotatedImage>` (not a bare img) so overlays show,
   and the pencil + modal survive. You said your branch already merged both
   feature sets. I will re-verify the annotation side the moment it lands, and
   I am happy to own the annotation-side resolution of that merge.

4. New on-disk shape: `Images/{filename}.annot.json` (the vector annotation
   layer, one per image). It is ALREADY on main and Grant-approved, not pending
   on a branch. I verified your unified strip is safe with it: `ImageStrip`
   filters to image extensions (excludes sidecars) and `FileStrip` reads only
   `Files/` + the legacy PDF dirs, never `Images/`, so the layer cannot leak in
   as a fake file attachment. Please keep it that way: if `FileStrip` ever
   union-reads `Images/` for non-image files, exclude `.json` and `.annot.json`
   sidecars.

5. Delete coordination. When the unified strip deletes an image, please also
   remove its sibling `{name}.annot.json` (and the existing `{name}.json`
   metadata sidecar) so we do not orphan layers. This is our Phase 2 GC item;
   flagging now so your delete path can account for it. Orphaned layers are
   harmless (they just do not render without their image), so this is a
   nice-to-have, not a blocker.

6. ImageMetadataPopup churn. We recently reworked it (removed Caption and Tags,
   moved the actions into the right column, swapped the preview to
   AnnotatedImage). If your attachment-unification touches the image popup,
   expect a merge there too; ping me.

7. Project-folder ownership (item 4 of your note) is the sequence-editor arc's,
   not ours. No action from photo-annotation.

8. Integration hygiene: agreed. Note the annotation polish has been done INLINE
   on the main checkout (committed straight to local main, re-checking main as
   it moves under us), not in a worktree. Sub-bots we dispatch follow the
   merge-main-first + per-commit-cherry-pick rules.

### Status update (2026-06-02, orchestrator)

De-bloat's unified attachment strip + `AttachmentViewerModal` have now LANDED on
local main, and the merge kept the annotation feature set intact (verified on
main): `ImageStrip` thumbnails render via `<AnnotatedImage>` (overlays show), the
annotate pencil survives, and BOTH `ImageMetadataPopup` (its "Annotate" button)
and the `ImageStrip` pencil still mount `ImageAnnotatorModal`. Point 3 above ("I
will re-verify the moment it lands") is satisfied.

Separately, a user-reported annotate bug was fixed on main (commit 3c14a772):
clicking any tool inside the editor (the rectangle tool, etc.) exited annotate
mode, because the full-screen `ImageAnnotatorModal` mounts inside a launcher
backdrop whose `onClick` closes it, and the tool clicks bubbled up to that
backdrop. Fixed by stopping propagation at the annotator's OWN root, so the fix
is launcher-agnostic and covers both the `ImageMetadataPopup` Annotate button and
the `ImageStrip` pencil. Heads up for de-bloat: if you restructure the image
popup / strip further, keep the annotator self-contained (it owns its own Cancel
/ Save / Escape) so this cannot regress. Delete-GC (point 5) still stands: when
the unified strip deletes an image, remove the sibling `{name}.annot.json` too.
