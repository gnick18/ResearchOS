// cloning bot — IO ADAPTER between the pure assembly engine and the rest of the
// app (library sequences in, a GenBank construct out). Kept SEPARATE from the
// pure engine (cloning.ts) so the engine stays DOM/parser-free and trivially
// testable; this thin layer owns the coordinate-convention translation and the
// bio-parsers serialize call.
//
// COORDINATE CONVENTION
// ---------------------
// The engine uses 0-based, end-EXCLUSIVE [start, end) intervals. The app's
// SequenceAnnotation / ParsedFeature use 0-based, end-INCLUSIVE intervals (the
// bio-parsers default). We translate at this boundary:
//   inclusive end  ->  exclusive end : end + 1   (library annotation -> engine)
//   exclusive end  ->  inclusive end : end - 1   (engine product -> GenBank)

import { jsonToGenbank, type ParsedSequence, type ParsedFeature } from "@/vendor/bio-parsers";
import { genbankToDetail } from "./parse";
import type { SequenceAnnotation, SequenceDetail, SequenceMeta } from "../types";
import type {
  AssembledProduct,
  CloneFeature,
  FragmentPrimers,
} from "./cloning";

/** Turn a loaded library sequence's annotations (inclusive end) into the
 *  engine's CloneFeature[] (exclusive end). Skips zero/negative spans. */
export function annotationsToCloneFeatures(annotations: SequenceAnnotation[]): CloneFeature[] {
  const out: CloneFeature[] = [];
  for (const a of annotations) {
    const start = a.start;
    const end = a.end + 1; // inclusive -> exclusive
    if (end <= start) continue;
    out.push({
      name: a.name,
      start,
      end,
      strand: a.direction === -1 ? -1 : 1,
      type: a.type,
      color: a.color,
    });
  }
  return out;
}

/**
 * Serialize an assembled product (engine shape) to GenBank text via the
 * vendored writer, converting the engine's exclusive ends back to the
 * inclusive-end ParsedFeature shape jsonToGenbank expects. Optionally appends
 * the designed junction primers as `primer_bind` features at their binding
 * spans on the product.
 */
export function productToGenbank(
  name: string,
  product: AssembledProduct,
  opts: { primersAsFeatures?: FragmentPrimers[] } = {},
): string {
  const features: ParsedFeature[] = product.features.map((f) => cloneFeatureToParsed(f));

  if (opts.primersAsFeatures && opts.primersAsFeatures.length > 0) {
    features.push(...primerBindFeatures(product, opts.primersAsFeatures));
  }

  const parsed: ParsedSequence = {
    name: (name || "construct").replace(/\s+/g, "_").slice(0, 60) || "construct",
    sequence: product.seq,
    circular: product.circular,
    type: "DNA",
    features,
  };
  // jsonToGenbank returns false only for an unserializable record (e.g. no
  // sequence); the product always carries bases, so coerce to "" defensively.
  return jsonToGenbank(parsed, {}) || "";
}

/**
 * Turn an assembled product into a renderable SequenceDetail for the review-step
 * map, with ZERO new parse code. Reuses productToGenbank (serialize) +
 * genbankToDetail (parse back), so the preview map renders byte-identical to a
 * saved-sequence map. The synthetic meta uses id -1 as the sentinel for an
 * unsaved preview. Returns null only if the product could not be parsed back
 * (genbankToDetail returns null), which a real product never hits.
 */
export function productToDetail(
  name: string,
  product: AssembledProduct,
  opts: { primersAsFeatures?: FragmentPrimers[] } = {},
): SequenceDetail | null {
  const genbank = productToGenbank(name || "Assembled construct", product, opts);
  const meta: SequenceMeta = {
    id: -1, // sentinel: this is an unsaved preview
    display_name: name || "Assembled construct",
    project_ids: [],
    added_at: new Date().toISOString(),
    seq_type: "dna",
  };
  return genbankToDetail(genbank, meta);
}

function cloneFeatureToParsed(f: CloneFeature): ParsedFeature {
  return {
    name: f.name,
    start: f.start,
    end: Math.max(f.start, f.end - 1), // exclusive -> inclusive
    strand: f.strand,
    type: f.type ?? "misc_feature",
    color: f.color,
  };
}

/**
 * Build `primer_bind` features for the designed junction primers, placed at the
 * annealing region's location on the PRODUCT. Each fragment occupies a known
 * span of the product (cumulative offsets), and the forward / reverse annealing
 * regions sit at that fragment's 5' / 3' ends respectively. The homology TAIL is
 * not part of the binding site (it overhangs), so the feature covers the
 * annealing region only.
 */
function primerBindFeatures(
  product: AssembledProduct,
  fragmentPrimers: FragmentPrimers[],
): ParsedFeature[] {
  // Reconstruct per-fragment offsets from the carried feature math is fragile;
  // instead we recompute offsets from the primers' own fragment order using the
  // product split is not available here, so we derive offsets by walking the
  // fragments' annealing lengths is also not enough. We therefore locate each
  // annealing region by direct search on the product (it is an exact substring
  // for the forward primer, and the revcomp template for the reverse), which is
  // unambiguous for real fragments and robust to the offset bookkeeping.
  const feats: ParsedFeature[] = [];
  const seq = product.seq;
  for (const fp of fragmentPrimers) {
    // Forward annealing region is a forward substring of the product.
    if (fp.forward.anneal) {
      const idx = seq.indexOf(fp.forward.anneal);
      if (idx >= 0) {
        feats.push({
          name: `${fp.fragmentName} F`,
          start: idx,
          end: idx + fp.forward.anneal.length - 1, // inclusive
          strand: 1,
          type: "primer_bind",
        });
      }
    }
    // Reverse annealing region binds the bottom strand; its template span is the
    // revcomp of the primer's annealing region, which is a forward substring.
    if (fp.reverse.anneal) {
      const template = revcompLocal(fp.reverse.anneal);
      const idx = seq.indexOf(template);
      if (idx >= 0) {
        feats.push({
          name: `${fp.fragmentName} R`,
          start: idx,
          end: idx + template.length - 1, // inclusive
          strand: -1,
          type: "primer_bind",
        });
      }
    }
  }
  return feats;
}

function revcompLocal(s: string): string {
  const C: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", N: "N" };
  let out = "";
  for (let i = s.length - 1; i >= 0; i -= 1) out += C[s[i]] ?? "N";
  return out;
}

/** A plain-text oligo order list (name + 5'->3' sequence + length + anneal Tm).
 *  Copyable / savable. One line per primer, forward then reverse per fragment. */
export function oligoOrderText(fragmentPrimers: FragmentPrimers[]): string {
  const lines: string[] = ["Name\tSequence (5'->3')\tLength\tAnneal Tm (C)"];
  for (const fp of fragmentPrimers) {
    lines.push(
      `${fp.fragmentName} F\t${fp.forward.sequence}\t${fp.forward.length}\t${fmtTm(fp.forward.annealTm)}`,
    );
    lines.push(
      `${fp.fragmentName} R\t${fp.reverse.sequence}\t${fp.reverse.length}\t${fmtTm(fp.reverse.annealTm)}`,
    );
  }
  return lines.join("\n");
}

function fmtTm(tm: number): string {
  return Number.isFinite(tm) ? tm.toFixed(1) : "—";
}
