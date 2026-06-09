# Handwriting note capture (scan, enhance, extract)

Status: proposal / not built. Mobile-and-web feature, owned by the orchestrator (mobile manager) when it moves to build. This doc captures the original chat exploration (session 4207ef59, never written to disk) plus Grant's fleshed-out two-layer idea (2026-06-09).

## The user story

A lot of researchers only take handwritten notes at the bench. The goal is to let them photograph a page and get two useful things out of one capture, with everything happening on-device so the handwriting never touches a server (local-first holds).

Grant's framing, the two layers from one photo:

1. A clean, easy-to-read image of the page (the human layer).
2. The text pulled out of that page as real machine-readable text (the machine layer), so it is searchable and usable by agents even though a human still prefers to read the handwriting.

## The two layers

### Layer 1, the enhanced scan (human-facing, always shown)

Take the raw photo and run a document-scan / rectification pass so it reads cleanly on a computer screen:

- Perspective correction (dewarp), a photo shot at an angle is flattened to face-on, as if scanned straight down.
- Deskew, denoise, shadow removal.
- Binarization / contrast enhancement so the ink stands out on a clean white background.

This is the same effect as Apple Notes "Scan Document" or CamScanner. The cleaned image is the artifact the user drops into their Lab Notes or Results, wherever they want it. A human reads handwriting faster than reconstructed text, so this enhanced image is the primary thing shown.

### Layer 2, the extracted text (machine-facing, hidden by default)

Run handwriting text recognition (HTR / OCR) on the same capture and store the plain text alongside the image. Conceptually this is the "searchable PDF" model, the image is what you see, the text rides underneath powering search and AI.

Why keep it even though the image is the nice part:

- Full-text search across notebooks finds the page by its content.
- Agentic agents can read the note as text instead of needing vision on every image.
- Copy / quote / reuse of specific lines.

UX decision (Grant, 2026-06-09): the extracted text is HIDDEN by default, always. The enhanced image is the only thing shown at rest. Beneath it sits a small collapsible reveal (for example a "show extracted text" expander). When the user opens the reveal, the text is EDITABLE, so they can fix recognition mistakes, which keeps the searchable layer accurate. Default-collapsed keeps the note visually clean while preserving the searchable / agent-readable layer underneath.

## Platform paths (both surfaces, equal weight)

Both layers exist on both surfaces. The enhancement and the OCR are two outputs of one capture flow, and on mobile the native document-scanner APIs bundle both steps for free.

### Mobile app (React Native / Expo)

The earlier chat concluded mobile is the most natural home (notes happen at the bench, phone in hand). The native document-scanner frameworks do the rectify-and-clean AND the OCR on-device using the phone's Neural Engine, with no model download.

- iOS, VisionKit document scanner (`VNDocumentCameraViewController`) gives the rectified, cleaned scan; Apple Vision (`VNRecognizeTextRequest`, handwriting support since iOS 16) gives the extracted text. Both free, on-device, fast.
- Android, Google ML Kit Document Scanner gives the rectified scan; ML Kit Text Recognition v2 gives the text. Android is not quite as strong on messy cursive but handles lab-style handwriting (block letters, chemical names, measurements) well.
- A wrapper like `react-native-text-recognition` unifies the OCR call across the two platforms (Apple Vision on iOS, ML Kit on Android) behind one API. The document-scan UI is platform-specific but both are first-party and free.
- Grant's call: if a clean cross-platform path is not available, ship iOS first and put Android on the roadmap. The native scanner + OCR pair above does cover both, so iOS and Android can land together.

Capture flow, phone scans the page, the device produces the enhanced image AND the extracted text on-device, both sync to the shared folder, and the laptop notebook displays the image with the hidden-by-default editable text reveal.

### Laptop web app (Next.js, in-browser)

For notes added or reviewed on the laptop, run the same two layers fully in the browser tab, no server.

- Enhancement, an OpenCV-style document pipeline (contour detection for the page edges, perspective transform to rectify, adaptive threshold to clean), runnable in the browser via a WASM build, produces the same flattened white-background scan.
- Extraction, Transformers.js running a quantized ONNX HTR model via WebGPU (WASM fallback). Default candidate `microsoft/trocr-base-handwritten` (MIT, ~270MB cached in IndexedDB after first download), with `trocr-small-handwritten` (~80MB) as a lighter, lower-accuracy option. Needs an opt-in download gate ("download the handwriting model, stays on your device") and a first-load progress indicator.
- Newer model options noted for evaluation, GOT-OCR2.0 (Apache 2.0, heavier, mixed print + handwriting + diagrams), Florence-2-base (MIT, general vision-language, quantized browser builds exist), Surya (excellent layout detection but GPL-3.0, a license concern for ResearchOS).

The two-layer data model (image as the human artifact, hidden editable text as the machine layer) is shared across both surfaces.

## Implementation

### Principle, the phone does the work

Modern phones run the whole scan, enhance, and extract pipeline on-device through first-party frameworks (Apple Vision, Google ML Kit). No server, no model download, no API cost, and well under a second per page on the Neural Engine or NPU. The web path is a fallback for images that originate on the laptop. It is also fully client-side but heavier, because it downloads a model once. So the default and best experience is mobile, and web exists only so a laptop user is never blocked.

### Mobile, the primary path (Expo / React Native)

One library covers both platforms. `react-native-document-scanner-plugin` wraps Apple VisionKit on iOS and Google ML Kit Document Scanner on Android behind a single API, and it ships an Expo config plugin. It does automatic document detection, edge and perspective correction, and multi-page capture, and it returns cleaned page images. Verified actively maintained (npm last published Jan 2026).

Expo caveat. This is a native module, so it does NOT run in Expo Go. The app needs a dev client and a prebuild step (config plugin in `app.json` plus `expo prebuild`, or an EAS dev build). If the mobile app is still running under Expo Go, this is the one piece of build infra to plan for. Flag for the mobile manager.

OCR step. `@react-native-ml-kit/text-recognition` (ML Kit Text Recognition v2, both platforms), or Apple Vision `VNRecognizeTextRequest` on iOS for the strongest handwriting accuracy. ML Kit returns blocks and lines with bounding boxes and per-element confidence; Apple Vision returns observations with candidate strings, confidence, and boxes. A thin abstraction picks the iOS-best engine on iOS and ML Kit on Android, so the rest of the app sees one shape.

Flow on the phone:

1. User taps "Scan note" in a Lab Notes or Results attachment slot.
2. The document scanner launches and the user captures one or more pages. It returns enhanced (dewarped, cropped, contrast-cleaned) page images. Enhancement is free here, the native scanner already does it, so there is no OpenCV on mobile for v1.
3. For each enhanced page, run OCR on that same enhanced image. Collect the full text, the per-line boxes, and confidence.
4. Persist, the enhanced image as the attachment, an optional raw original, and the extracted text plus line boxes in a sidecar (see data model). Stamp the engine and timestamp.
5. Sync the image and sidecar to the shared folder over the existing capture and sync path.

Battery and speed are a non-issue. A page of Vision or ML Kit OCR runs in well under a second on a current phone and uses the NPU, so there is nothing to throttle.

### Web, the fallback path (Next.js, in-browser)

For a note authored or reviewed on the laptop where the source is an existing photo or a file the user drags in, run both layers in the browser tab, no server.

Enhancement. `jscanify` (MIT, built on OpenCV.js) does corner detection, perspective warp, and a clean filter, or call OpenCV.js directly (`findContours`, then `warpPerspective`, then `adaptiveThreshold`). OpenCV.js is roughly an 8MB WASM load, lazy-loaded only when the user enhances and never in the common bundle. If the user uploads an already-flat scan, enhancement can be skipped.

Extraction. Transformers.js (`@huggingface/transformers`) running a quantized ONNX model via WebGPU with a WASM fallback, cached in IndexedDB after first download behind an opt-in gate.

Model choice carries a real architectural wrinkle. `trocr-base-handwritten` is a LINE-level model (trained on IAM single text lines), so a full page needs a line-segmentation step first (detect text lines, crop each, run TrOCR per line, then reassemble). That is several more moving parts in the browser. The simpler full-page route is a model that reads a whole image in one pass, Florence-2-base (MIT) with its `<OCR>` task, or GOT-OCR2.0 (Apache 2.0). Recommendation for web v1, prefer a full-page model (Florence-2) to avoid shipping a line-segmenter, and keep TrOCR-per-line as a later accuracy option. Surya has the best layout and line detection but is GPL-3.0, a license non-starter for ResearchOS.

Web is explicitly secondary. The phone is the capture device and does this better and cheaper, so web can even ship extract-only first (no enhancement) and lean on mobile for the scan-and-clean if the OpenCV lift is not worth v1.

### Shared display component (both surfaces)

One component renders the result the same way everywhere notes show images, mirroring the existing `<AnnotatedImage>` pattern from photo annotation. It shows the enhanced image at rest. Beneath it sits a collapsed "Show extracted text" disclosure that is closed by default, always. Expanding it reveals the extracted text in an editable field bound to the sidecar. On any edit it sets `edited: true` so a future re-OCR never clobbers a human correction. Closed-by-default keeps the note visually clean, while the text underneath still powers search and agents whether or not the disclosure is ever opened.

### Search and agent wiring

The notebook search index reads the sidecar `text` so a page is findable by its content. Agents read the same `text` field instead of running vision over the image each time. This is the payoff for keeping the machine layer even though a human reads the image.

### Suggested build sequencing

- Phase 1 (mobile, iOS + Android together). Wire the document scanner plus OCR, the sidecar write, and the synced enhanced image. This is the highest-value, lowest-risk slice because the native frameworks do the heavy lifting.
- Phase 2 (display + search). The shared display component with the hidden editable text reveal, plus search-index ingestion of the sidecar text. Lands the value on the laptop where notes are read.
- Phase 3 (web capture). In-browser enhancement (jscanify / OpenCV.js) and extraction (Florence-2 via Transformers.js) for laptop-origin images. Optional if mobile covers the real use case.

## Data model sketch

The extracted text travels with the image as an additive sidecar, mirroring the existing `{filename}.annot.json` pattern from photo annotation, so no existing note format changes. The exact shape is still a FLAG for the orchestrator and the notebook-integrations owner because it touches the sync path. Proposed shape:

`Images/{filename}.ocr.json` (next to the enhanced image, resolved through the same helper as `annotPath()`):

```json
{
  "version": 1,
  "engine": "apple-vision | mlkit | florence-2 | trocr-base",
  "extractedAt": "2026-06-09T18:20:00Z",
  "imageW": 2048,
  "imageH": 2731,
  "text": "2026-05-12 bench notes\nminiprep yield 84 ng/uL ...",
  "lines": [
    { "text": "2026-05-12 bench notes", "bbox": [120, 80, 900, 44], "confidence": 0.94 }
  ],
  "edited": false,
  "rawImagePath": "Images/{filename}.raw.jpg"
}
```

- `bbox` is natural image pixels `[x, y, w, h]`, so it scales like the annotation overlay does down to thumbnails.
- `edited` flips to `true` on any user correction and blocks a re-OCR overwrite.
- `rawImagePath` is present only when the raw original is kept (see open decisions).

Touch points (FLAG, orchestrator confirms):

- The sidecar must ride along on delete, rename, and move of the image, exactly like `.annot.json` does today through `annotPath()` in the image-move helpers.
- The notebook search index ingests the sidecar `text`.
- The mobile capture and sync path carries the sidecar next to the image.

### Verify before build

Pin exact versions and confirm Expo config-plugin compatibility at build time. `react-native-document-scanner-plugin`, `@react-native-ml-kit/text-recognition`, `jscanify`, `@huggingface/transformers`, and the chosen ONNX model build all move quickly. Confirm the current mobile app can take a dev client (the Expo Go caveat above).

## Open decisions for the orchestrator

- Web model, the implementation recommends a full-page model (Florence-2) over TrOCR-per-line for v1; confirm that call, and decide whether to gate the model download per-user or per-lab.
- Confirm the proposed `{filename}.ocr.json` sidecar schema and how it indexes into existing notebook search.
- Where the capture entry point lives in the mobile note/attachment flow (the original chat ended before reading the mobile codebase).
- Whether the laptop enhancement pipeline is worth the WASM / OpenCV lift for v1, or whether web starts as extract-only (Phase 3 optional) and leans on mobile for the scan-and-clean.
- Raw-original retention, keep the unprocessed photo, or only the enhanced scan.
- Confirm the mobile app can move off Expo Go to a dev client / prebuild, which the native document scanner requires.

## Scope note

This is a feature build (native mobile bridges, an in-browser inference pipeline, and a new synced text field). It is outside the cosmetic lane and belongs with the orchestrator / mobile manager. This doc is a planning artifact only.
