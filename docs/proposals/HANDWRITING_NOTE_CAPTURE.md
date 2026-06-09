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

## Data model sketch (to be designed with the orchestrator)

The extracted text is a new field that travels with the image. This touches the notebook sync path, so the exact shape is a FLAG for the orchestrator and the notebook-integrations owner, not something to decide here. Rough shape:

- The enhanced image stored as the attachment (the raw original may optionally be kept too).
- The extracted text stored in a sidecar next to the image (mirrors the existing `{filename}.annot.json` pattern from photo annotation), so it is additive and does not change any existing note format.
- A flag noting whether the user has edited the extracted text (so re-running OCR does not clobber their corrections).

## Open decisions for the orchestrator

- Web model default, `trocr-base` vs `trocr-small` (accuracy vs download size), and whether to gate the model download per-user or per-lab.
- Exact sidecar schema for the extracted text and how it indexes into existing notebook search.
- Where the capture entry point lives in the mobile note/attachment flow (the original chat ended before reading the mobile codebase).
- Whether the laptop enhancement pipeline is worth the WASM/OpenCV lift for v1 or whether web starts as extract-only and leans on mobile for the scan-and-clean.
- Raw-original retention, keep the unprocessed photo, or only the enhanced scan.

## Scope note

This is a feature build (native mobile bridges, an in-browser inference pipeline, and a new synced text field). It is outside the cosmetic lane and belongs with the orchestrator / mobile manager. This doc is a planning artifact only.
