# Handwriting note display, component behavior spec

Status: spec for the orchestrator to build (laptop / web frontend). The mobile
side produces `{imageName}.ocr.json` (schema in `lib/ocr.ts` / the OcrResult
contract); this doc specifies how the laptop renders an image that has an OCR
sidecar. It mirrors the existing `<AnnotatedImage>` mechanics so the orchestrator
owns placement and build.

## Relationship to AnnotatedImage

`<AnnotatedImage>` already wraps every note image and, when `{filename}.annot.json`
exists, draws an SVG overlay with `viewBox="0 0 imageW imageH"` so one stored doc
renders crisply from a full-width note down to a 64px thumbnail with no
per-surface math. It renders across ImageStrip, RenderedMarkdown,
LiveMarkdownEditor, ImageMetadataPopup, and ResultsGallery.

The OCR display reuses that same image component and the same natural-pixel +
`viewBox` scaling. The difference: annotations are an always-on visual overlay,
while OCR is a hidden text layer with an optional, suppressed-at-thumbnail
highlight overlay. An image can carry BOTH sidecars at once (`.annot.json` and
`.ocr.json`); they are independent and must coexist (annotation shapes draw as
today; the OCR reveal is separate, see Coexistence).

## States

1. No OCR. No `.ocr.json` for the image. Renders exactly as today, a plain
   `<AnnotatedImage>`. Zero change.
2. OCR present, collapsed (the default at rest). The enhanced image renders
   normally; a small affordance signals extracted text exists; the text is NOT
   shown.
3. OCR present, expanded. The "Show extracted text" reveal is open, showing the
   editable text.
4. OCR present, empty text. The engine returned nothing usable. Treat as state 1
   visually (no badge, no reveal), so a blank result never adds clutter.

## At-rest behavior

- The enhanced (rectified, cleaned) image is the artifact shown, full size and at
  thumbnails, through the same shared image component. A human reads the
  handwriting faster than reconstructed text, so the image is always primary.
- The extracted text is HIDDEN by default, always. Nothing about the text is
  drawn on the image at rest.
- Where space allows (note body, metadata popup, results gallery, NOT
  thumbnails), show one compact affordance that OCR exists, a small "Extracted
  text" disclosure control beneath the image. This is the only at-rest hint.

## The "Show extracted text" reveal

- Collapsed by default, always, on every surface. The user opens it explicitly.
- Lives BELOW the image as a disclosure, it is not an image overlay. (The image
  stays clean; the text is a separate panel.)
- When expanded it shows the extracted text in an EDITABLE field bound to the
  sidecar `text`. Multiline, wraps, sized to content with a sensible max height
  then scrolls.
- Plain copy affordance (select-all / copy button) so the text is easy to lift.
- The reveal renders only in full contexts that can host a text panel
  (RenderedMarkdown, LiveMarkdownEditor, ImageMetadataPopup, ResultsGallery
  detail). It is suppressed on ImageStrip thumbnails (see Thumbnail vs full).

## Edit semantics and re-OCR protection

- Editing the text writes back to `{imageName}.ocr.json`, updating `text` and
  setting `edited: true`.
- `edited: true` is the lock. Any later re-OCR of the same image (a re-scan, a
  batch re-run) MUST NOT overwrite a sidecar whose `edited` is true. The writer
  (poll.ts / the re-OCR path, orchestrator-owned) checks `edited` before
  clobbering, exactly as it would guard a hand-corrected field.
- Editing does not touch the image or the `lines[]` boxes; it only updates
  `text` + `edited`. (The per-line boxes describe the original recognition; once
  a human rewrites `text`, the boxes are stale and are not re-derived. See Open
  questions.)
- Persisting follows the same sidecar write + sync path as `.annot.json` (the
  orchestrator owns `ocrPath()` and the carry on move/rename/delete).

## Thumbnail vs full size, and the bbox scaling

The `lines[].bbox` values are natural-pixel `[x, y, w, h]` against
`imageW/imageH`, identical to how annotation coords scale. That enables an
OPTIONAL on-image highlight overlay that reuses AnnotatedImage's exact mechanism,
`<svg viewBox="0 0 imageW imageH">` with one rect per line, so highlights track
the image crisply from full width down to a thumbnail with no per-surface math.

Behavior by size:

- Full size. The text reveal is available (collapsed by default). If the
  highlight overlay ships, it is off by default and toggled on (for example,
  hovering or focusing a line in the reveal highlights that line's box on the
  image, or a single "show text regions" control). Highlights use the same
  `viewBox` scaling as annotations.
- Thumbnail (for example ImageStrip's `w-16 h-16 object-cover`). No reveal, no
  highlight overlay, the text panel does not fit and boxes would be noise at
  64px. Show at most a tiny static badge indicating extracted text exists
  (mirroring the photo-annotation "annotated" badge pattern), or nothing. The
  bare enhanced image is the thumbnail.

v1 may ship text-only (reveal + edit, no on-image highlight overlay). The bbox
scaling is specified here so that when the highlight overlay is added it drops
into AnnotatedImage's existing `viewBox` path with no new scaling math.

## Coexistence with annotations

- An image may have `.annot.json` AND `.ocr.json`. The annotation overlay draws
  as it does today (always-on shapes). The OCR reveal is a separate below-image
  panel and an optional, off-by-default highlight overlay.
- If both the annotation overlay and an OCR highlight overlay are visible at
  once, they are distinct SVG layers over the same `viewBox`; the OCR highlight
  should read as subtle (a light fill or underline) so it never competes with
  the user's own annotations.

## Accessibility and copy

- The disclosure control is a real button with an accessible label ("Show
  extracted text" / "Hide extracted text") and expanded state.
- The editable field is a labeled text input. Edits announce a saved state.
- Extracted text is selectable and copyable even while collapsed-then-expanded.

## Open questions for the orchestrator

- Stale boxes after an edit. Once a human rewrites `text`, the `lines[]` boxes no
  longer map to the new text. Options, keep the boxes as the original-recognition
  record (highlight overlay reflects the original scan, not the edits), or drop
  `lines[]` to `[]` on first edit. Recommend keeping them as the original record
  and just not re-deriving, simplest and the highlight stays informative.
- Whether the on-image highlight overlay ships in v1 or is deferred (text-only
  first). Recommend deferring, the reveal + edit is the core value; highlights
  are a nice-to-have that reuses the existing scaling whenever added.
- Badge vs no badge at thumbnail. A tiny "has extracted text" badge aids
  discovery but adds a glyph; your call on whether it earns its place.
