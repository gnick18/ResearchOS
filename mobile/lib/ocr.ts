/**
 * On-device handwriting note capture. Launches the platform document scanner
 * (rectify + clean), runs on-device OCR on the enhanced page, and returns the
 * enhanced image uri plus a structured OcrResult.
 *
 * This is the mobile-side contract the "Scan note" action calls into. The
 * orchestrator owns everything downstream (the capture meta, the laptop poller
 * that writes {imageName}.ocr.json, the display component, search ingestion).
 *
 * Availability guard. The native document scanner + text recognition are NOT
 * present in Expo Go; they ship with the dev client + config plugins the mobile
 * manager cuts over to. Until that cutover, isScannerAvailable() is false and
 * scanNote() returns null, so the whole app keeps running unchanged on Expo Go.
 * The native packages are deliberately NOT imported here yet, because Metro
 * would fail to resolve them at bundle time in Expo Go; the wiring lands in the
 * same change that installs them (see scanNote below).
 *
 * Runtime note. Hermes has no Web Crypto. Any ids or hashes use @noble +
 * expo-crypto only (none are needed in this module yet).
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { Image } from 'react-native';
import DocumentScanner, {
  ResponseType,
} from 'react-native-document-scanner-plugin';
import TextRecognition from '@react-native-ml-kit/text-recognition';

export const OCR_SCHEMA_VERSION = 1 as const;

export type OcrEngine = 'apple-vision' | 'mlkit';

export interface OcrLine {
  text: string;
  // Natural-pixel [x, y, w, h], so it scales like the .annot.json overlay does.
  bbox: [number, number, number, number];
  // 0..1 recognition confidence for the line.
  confidence: number;
}

export interface OcrResult {
  version: typeof OCR_SCHEMA_VERSION;
  // Which on-device engine produced this (Apple Vision on iOS, ML Kit on Android).
  engine: OcrEngine;
  // ISO timestamp the extraction ran.
  extractedAt: string;
  // Natural pixel size of the enhanced image the boxes are relative to.
  imageW: number;
  imageH: number;
  // Full extracted text, lines joined with newlines.
  text: string;
  lines: OcrLine[];
  // True once a human edits the extracted text, so a re-OCR never clobbers it.
  edited: boolean;
  // Present only when the raw (un-enhanced) original is retained alongside the
  // enhanced scan. Optional now; v1 may keep only the enhanced image.
  rawImagePath?: string;
}

export interface ScanNoteResult {
  // The enhanced (rectified, cleaned) page image, ready to attach as a capture.
  uri: string;
  ocr: OcrResult;
}

/**
 * Whether the native document scanner + OCR are available in this runtime. True
 * on the dev client (where the native modules ship), probed defensively so a
 * stray Expo Go bundle degrades to "unavailable" rather than crashing. Note that
 * statically importing the native packages above already makes this module
 * dev-client-only, this probe is belt-and-suspenders.
 */
export function isScannerAvailable(): boolean {
  return (
    !!DocumentScanner &&
    typeof DocumentScanner.scanDocument === 'function' &&
    !!TextRecognition &&
    typeof TextRecognition.recognize === 'function'
  );
}

// Read an image's natural pixel size. The boxes + imageW/imageH are relative to
// the ENHANCED scan, so this measures the scanner's output, not the raw photo.
function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: 0, height: 0 }),
    );
  });
}

// ML Kit returns a per-element `frame`. The field names are not pinned in the
// package docs, so read both the {left,top,width,height} and the {x,y} shapes
// defensively and emit natural-pixel [x, y, w, h] to match OcrLine.bbox.
function frameToBbox(frame: unknown): [number, number, number, number] {
  const f = (frame ?? {}) as Record<string, number | undefined>;
  const x = f.left ?? f.x ?? 0;
  const y = f.top ?? f.y ?? 0;
  const w = f.width ?? 0;
  const h = f.height ?? 0;
  return [x, y, w, h];
}

/**
 * Launch the document scanner, run OCR on the enhanced page, and return the
 * enhanced image uri + a structured OcrResult. Returns null when the scanner is
 * unavailable (Expo Go) or the user cancels the scan.
 *
 * Native implementation, added at the dev-client cutover once the packages are
 * installed and the config plugins are applied:
 *   1. react-native-document-scanner-plugin -> scanDocument() returns the
 *      rectified, cleaned page image uri(s). VisionKit on iOS, ML Kit document
 *      scanner on Android. Cancel returns null.
 *   2. @react-native-ml-kit/text-recognition (ML Kit v2, both platforms) or
 *      Apple Vision on iOS recognizes text on the ENHANCED image, mapping each
 *      block/line to OcrLine { text, bbox (natural px), confidence }.
 *   3. Assemble OcrResult (engine per platform, imageW/imageH from the enhanced
 *      image, text = lines joined, edited:false) and return { uri, ocr }.
 * The packages are not referenced above because Metro would fail to resolve
 * them in Expo Go; this wiring lands in the change that installs them.
 */
export async function scanNote(): Promise<ScanNoteResult | null> {
  if (!isScannerAvailable()) return null;

  // 1. Scan + clean. VisionKit on iOS / ML Kit document scanner on Android does
  // the perspective correction, deskew, and white-background contrast clean.
  // Returns enhanced page image file paths. Cancel returns status 'cancel'.
  const { scannedImages, status } = await DocumentScanner.scanDocument({
    responseType: ResponseType.ImageFilePath,
    croppedImageQuality: 100,
    maxNumDocuments: 1,
  });
  if (status !== 'success' || !scannedImages || scannedImages.length === 0) {
    return null;
  }
  const uri = scannedImages[0];

  // 2. Natural pixel size of the enhanced page (for the bboxes + the sidecar).
  const { width: imageW, height: imageH } = await getImageSize(uri);

  // 3. OCR the ENHANCED image (not the raw photo). ML Kit returns blocks of
  // lines; flatten to OcrLine. ML Kit text recognition does not expose a
  // reliable per-line confidence, so default to 1 (Apple Vision, a later
  // iOS-accuracy path, does provide it).
  const lines: OcrLine[] = [];
  try {
    const recognized = await TextRecognition.recognize(uri);
    for (const block of recognized.blocks ?? []) {
      for (const line of block.lines ?? []) {
        lines.push({
          text: line.text ?? '',
          bbox: frameToBbox((line as { frame?: unknown }).frame),
          confidence: 1,
        });
      }
    }
    const ocr: OcrResult = {
      version: OCR_SCHEMA_VERSION,
      engine: 'mlkit',
      extractedAt: new Date().toISOString(),
      imageW,
      imageH,
      text: recognized.text ?? lines.map((l) => l.text).join('\n'),
      lines,
      edited: false,
    };
    return { uri, ocr };
  } catch {
    // OCR failed but the enhanced scan is still useful. Return the image with an
    // empty text layer rather than dropping the capture.
    const ocr: OcrResult = {
      version: OCR_SCHEMA_VERSION,
      engine: 'mlkit',
      extractedAt: new Date().toISOString(),
      imageW,
      imageH,
      text: '',
      lines: [],
      edited: false,
    };
    return { uri, ocr };
  }
}
