// seq export bot — pure, unit-testable EXPORT logic for the sequence editor.
//
// The editor had no export. This module is the single home for every
// serialize / slice / translate / rasterize primitive; the toolbar's Export
// menu (ExportMenuDropdown) only calls these and hands the result to a download
// helper. Nothing here mutates the on-disk sequence — export is read-only.
//
// Calm-by-convention: no UI here, no React. Pure functions + a tiny browser
// download helper (guarded so the slice/serialize/translate cores stay
// jsdom/node testable).

import type { SeqDocument, EditFeature } from "./edit-model";
import { documentToGenbank } from "./edit-model";
import { shiftFeaturesOnDelete } from "./coordinate-shift";
import { resolveCodon, GAP_GLYPH } from "./degenerate-codon";
import { sanitizeForExport } from "@/lib/validation/input-hardening";

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/** Make a display name safe for a download filename (no path/sep chars). */
export function sanitizeFilename(name: string, fallback = "sequence"): string {
  const cleaned = (name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_") // illegal on common filesystems
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

/**
 * The on-disk filename for a sequence's map image when it is attached to a lab
 * note: `<sanitized sequence name>_map.png`. Mirrors the download path
 * (`${baseFileName}_map.png`) so a sent-to-note image and a downloaded one are
 * named identically. Falls back to `sequence` when the name is empty.
 */
export function mapImageFilename(seqName: string): string {
  return `${sanitizeFilename(seqName)}_map.png`;
}

/**
 * The human-readable alt-text / caption for a sequence's map image inside a
 * note: `<sequence name> map`. Keeps the original (un-sanitized) display name
 * so the in-note markdown reads naturally (e.g. "pDEMO-fluo map"), with a
 * `sequence map` fallback when the name is blank.
 */
export function mapImageAltText(seqName: string): string {
  const trimmed = (seqName || "").trim();
  return trimmed ? `${trimmed} map` : "sequence map";
}

// ---------------------------------------------------------------------------
// FASTA serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a single record to FASTA: a `>name description` header followed by
 * the residues hard-wrapped at `lineWidth` columns (default 70 — within the
 * common 60/70/80 conventions). Written here (not vendored) per the
 * project note: the upstream jsonToFasta pulls a heavy dependency tree.
 *
 * Works for both DNA and protein (it only wraps characters); the caller picks
 * the residues.
 */
export function toFasta(
  record: { name?: string; description?: string; sequence: string },
  lineWidth = 70,
): string {
  const width = lineWidth > 0 ? lineWidth : 70;
  const name = (record.name || "Untitled_Sequence").trim() || "Untitled_Sequence";
  const desc = record.description ? ` ${record.description.trim()}` : "";
  const residues = (record.sequence || "").replace(/\s+/g, "");
  const lines: string[] = [`>${name}${desc}`];
  if (residues.length === 0) {
    // Still emit a (blank) body line so the record is well-formed.
    lines.push("");
  } else {
    for (let i = 0; i < residues.length; i += width) {
      lines.push(residues.slice(i, i + width));
    }
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Whole-document serialization
// ---------------------------------------------------------------------------

/**
 * Return a shallow copy of `doc` with all user-supplied string fields
 * (document name, feature names) run through sanitizeForExport. The sequence
 * residues are NOT sanitized: they are validated at input and consist of
 * known-safe alphabet characters only.
 *
 * This is applied at the export boundary so that hostile content stored raw
 * (e.g. a 566-char feature name with `<script>alert(1)</script>`) cannot ride
 * into a GenBank file or FASTA header unescaped.
 */
function sanitizeDocForExport(doc: SeqDocument): SeqDocument {
  return {
    ...doc,
    name: sanitizeForExport(doc.name || ""),
    features: doc.features.map((f) => ({
      ...f,
      name: sanitizeForExport(f.name || ""),
    })),
  };
}

/** Serialize the whole document to GenBank text (delegates to edit-model so the
 *  on-disk Save path and the export path can never diverge). Returns null on a
 *  failed round-trip. User-supplied strings are sanitized before serialization. */
export function documentToGenbankText(doc: SeqDocument): string | null {
  return documentToGenbank(sanitizeDocForExport(doc));
}

/** Serialize the whole document to FASTA text (DNA/RNA/protein residues).
 *  The sequence name is sanitized for the FASTA header. */
export function documentToFasta(doc: SeqDocument, lineWidth = 70): string {
  return toFasta(
    { name: sanitizeForExport(doc.name || ""), sequence: doc.seq },
    lineWidth,
  );
}

// ---------------------------------------------------------------------------
// Selection slicing
// ---------------------------------------------------------------------------

/** Normalize a [from, to) selection into a clamped, ordered half-open range. */
export function normalizeRange(
  from: number,
  to: number,
  len: number,
): { lo: number; hi: number } {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(len, Math.max(from, to));
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/**
 * Slice the document to the half-open selection [from, to), rebasing every
 * overlapping feature into the new coordinate frame and dropping features that
 * fall entirely outside the selection.
 *
 * Implemented as "delete the suffix, then delete the prefix" via the same
 * coordinate-shift primitive the editor uses, so feature rebasing matches the
 * editor's own delete semantics exactly (overlapping features are clipped to
 * the surviving span; features fully outside collapse and are dropped).
 */
export function sliceDocument(doc: SeqDocument, from: number, to: number): SeqDocument {
  const { lo, hi } = normalizeRange(from, to, doc.seq.length);
  const seq = doc.seq.slice(lo, hi);

  // Rebase features: drop the tail [hi, len) first, then the head [0, lo).
  // shiftFeaturesOnDelete clips features overlapping the deleted span and drops
  // ones that collapse to zero width (dropCollapsed), matching deleteBases.
  let features: EditFeature[] = doc.features;
  const tailLen = doc.seq.length - hi;
  if (tailLen > 0) {
    features = shiftFeaturesOnDelete(features, hi, tailLen, { dropCollapsed: true });
  }
  if (lo > 0) {
    features = shiftFeaturesOnDelete(features, 0, lo, { dropCollapsed: true });
  }

  return {
    name: `${doc.name || "sequence"}_${lo + 1}-${hi}`,
    seq,
    seqType: doc.seqType,
    // A sub-range of a plasmid is no longer a closed circle.
    circular: false,
    features,
  };
}

/** GenBank text for the current selection (features rebased into the slice).
 *  User-supplied strings are sanitized before serialization. */
export function selectionToGenbankText(
  doc: SeqDocument,
  from: number,
  to: number,
): string | null {
  return documentToGenbank(sanitizeDocForExport(sliceDocument(doc, from, to)));
}

/** FASTA text for the current selection's bases.
 *  The sequence name is sanitized for the FASTA header. */
export function selectionToFasta(
  doc: SeqDocument,
  from: number,
  to: number,
  lineWidth = 70,
): string {
  const sliced = sliceDocument(doc, from, to);
  return toFasta({ name: sanitizeForExport(sliced.name || ""), sequence: sliced.seq }, lineWidth);
}

// ---------------------------------------------------------------------------
// Translation (frame 1) -> protein FASTA
// ---------------------------------------------------------------------------

// Standard genetic code (NCBI transl_table 1). Self-contained: the vendored
// seq-utils barrel does not export a translate(), and the existing orf.ts only
// finds ORFs (no codon->AA map). `*` = stop.
const CODON_TABLE: Record<string, string> = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L",
  CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M",
  GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S",
  CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T",
  GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
  CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K",
  GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  TGT: "C", TGC: "C", TGA: "*", TGG: "W",
  CGT: "R", CGC: "R", CGA: "R", CGG: "R",
  AGT: "S", AGC: "S", AGA: "R", AGG: "R",
  GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

/**
 * Translate a DNA/RNA string in reading frame 1 (start at index 0) to a single
 * amino-acid string. U is read as T. A codon with an IUPAC ambiguity base (N,
 * R, Y, ...) is RESOLVED when every concrete codon it represents yields the
 * same residue (GGN -> "G", CTN -> "L"), matching Biopython; a codon whose
 * expansions disagree (GAN -> Asp+Glu) or that has an off-alphabet base, plus a
 * trailing partial codon, is left untranslated as `X`. Stops render as `*`
 * (kept, not trimmed, so the reader sees the frame as-is).
 */
export function translateFrame1(seq: string): string {
  const s = (seq || "").toUpperCase().replace(/U/g, "T");
  let aa = "";
  for (let i = 0; i + 3 <= s.length; i += 3) {
    const codon = s.slice(i, i + 3);
    aa += resolveCodon(codon, CODON_TABLE) || GAP_GLYPH;
  }
  return aa;
}

/** Protein FASTA for the frame-1 translation of the current selection. */
export function selectionToProteinFasta(
  doc: SeqDocument,
  from: number,
  to: number,
  lineWidth = 70,
): string {
  const { lo, hi } = normalizeRange(from, to, doc.seq.length);
  const protein = translateFrame1(doc.seq.slice(lo, hi));
  const name = `${sanitizeFilename(doc.name || "sequence")}_${lo + 1}-${hi}_protein`;
  return toFasta(
    { name, description: "translation frame 1", sequence: protein },
    lineWidth,
  );
}

// ---------------------------------------------------------------------------
// Map image (SVG -> standalone SVG string / PNG dataURL)
//
// These are the REUSABLE pieces for Phase 4 ("send map to a lab note as an
// image"): given the live SeqViz <svg>, produce a self-contained string the
// caller can download OR embed. Pure where possible; the PNG path needs the
// browser canvas, so it is async and feature-detects.
// ---------------------------------------------------------------------------

/**
 * Find the SeqViz map <svg> inside a container. SeqViz can render several
 * <svg>s (the map plus tiny icon/decoration svgs); we pick the largest by
 * rendered area so we grab the actual map. Returns null if none.
 */
export function findMapSvg(container: HTMLElement | null): SVGSVGElement | null {
  if (!container) return null;
  const svgs = Array.from(container.querySelectorAll("svg"));
  if (svgs.length === 0) return null;
  let best: SVGSVGElement | null = null;
  let bestArea = -1;
  for (const svg of svgs) {
    const r = svg.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      bestArea = area;
      best = svg as SVGSVGElement;
    }
  }
  return best;
}

/**
 * Serialize an <svg> element into a standalone, downloadable SVG string:
 * clones the node, stamps explicit width/height + xmlns + a white background
 * rect so it opens correctly outside the DOM (and rasterizes on a clean
 * background). Pure aside from reading the live element's geometry.
 */
export function svgElementToString(svg: SVGSVGElement): string {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || svg.clientWidth || 600));
  const height = Math.max(1, Math.round(rect.height || svg.clientHeight || 400));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  // Prepend an opaque white background so a transparent SVG rasterizes cleanly.
  const bg = clone.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${xml}`;
}

/**
 * Rasterize an SVG string to a PNG data URL via an offscreen canvas. Async;
 * resolves null if the environment lacks canvas/Image support (so callers can
 * fall back to the SVG download). `scale` multiplies the pixel dimensions for a
 * crisper raster (default 2x).
 *
 * NOTE (PNG caveat): this draws the SVG through an <img>, which requires the
 * SVG be self-contained (svgElementToString inlines geometry + bg, but does NOT
 * inline external fonts — SeqViz is configured with disableExternalFonts, so
 * the map text uses system fonts and rasterizes fine). External-resource SVGs
 * would taint the canvas; the map does not use any.
 */
export function svgStringToPngDataUrl(
  svgString: string,
  width: number,
  height: number,
  scale = 2,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      try {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        resolve(dataUrl);
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * High-level reusable map exporter (the Phase-4 seam): given the viewer
 * container, return both a standalone SVG string and a best-effort PNG data
 * URL. A lab-note "insert map image" path can call this directly and embed the
 * PNG (or the SVG) without touching any download UI.
 */
export async function exportMapImage(
  container: HTMLElement | null,
  scale = 2,
): Promise<{ svg: string; png: string | null; width: number; height: number } | null> {
  const svgEl = findMapSvg(container);
  if (!svgEl) return null;
  const rect = svgEl.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || svgEl.clientWidth || 600));
  const height = Math.max(1, Math.round(rect.height || svgEl.clientHeight || 400));
  const svg = svgElementToString(svgEl);
  const png = await svgStringToPngDataUrl(svg, width, height, scale);
  return { svg, png, width, height };
}

// ---------------------------------------------------------------------------
// Browser download helpers (thin; not exercised by unit tests)
// ---------------------------------------------------------------------------

/** Trigger a browser download of `text` as `filename` with the given MIME. */
export function downloadText(text: string, filename: string, mime = "text/plain"): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  downloadBlob(blob, filename);
}

/** Trigger a browser download of a Blob as `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Trigger a download of a PNG (or any) data URL. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
