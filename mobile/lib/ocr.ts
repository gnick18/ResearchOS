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
 * Whether the native document scanner + OCR are available in this runtime.
 * False in Expo Go (the native modules ship with the dev client). At the
 * dev-client cutover this becomes a real probe of the installed native modules.
 */
export function isScannerAvailable(): boolean {
  return false;
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
  // Native scan + OCR wiring lands at the dev-client cutover (see doc comment).
  return null;
}
