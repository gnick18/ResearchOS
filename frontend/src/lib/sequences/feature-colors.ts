// sequence Phase 2c bot — feature COLOR model + the type->color palette, and the
// GenBank ApEinfo color round-trip.
//
// Why this module exists: the vendored bio-parsers reader only promotes the
// de-facto `/color=` qualifier to `feature.color`; it does NOT read SnapGene /
// ApE's `/ApEinfo_fwdcolor=` / `/ApEinfo_revcolor=` qualifiers (it leaves them as
// raw `notes`). Our on-disk format (and real-world SnapGene/ApE files, and our
// own demo fixtures) carry color via ApEinfo. So we add the minimal handling
// here, in OUR code, rather than patching the vendored JS:
//   - READ:  promote an ApEinfo color (strand-appropriate) into `color`.
//   - WRITE: emit BOTH the ApEinfo note (strand-appropriate) AND keep the value
//            so it survives a future round-trip through SnapGene / ApE / us.
//
// The palette is chosen to read well in BOTH light and dark mode (mid-saturation
// tones, never pure pastels that wash out on dark, never near-black that hides on
// dark). It mirrors the demo-fixture colors so existing files keep their look.

/** Default per-type colors. Keys are lowercased GenBank feature types. */
export const FEATURE_TYPE_COLORS: Record<string, string> = {
  cds: "#34d399", // emerald
  gene: "#34d399",
  promoter: "#fbbf24", // amber
  terminator: "#cbd5e1", // slate
  rep_origin: "#93c5fd", // blue
  ori: "#93c5fd",
  primer: "#f472b6", // pink
  primer_bind: "#f472b6",
  misc_feature: "#a78bfa", // violet
  protein_bind: "#22d3ee", // cyan
  rbs: "#fb923c", // orange
  sig_peptide: "#fcd34d",
  source: "#9ca3af", // gray
  mat_peptide: "#4ade80",
  ncrna: "#c084fc",
  trna: "#c084fc",
  rrna: "#c084fc",
  regulatory: "#fbbf24",
  enhancer: "#fde047",
  intron: "#94a3b8",
  exon: "#34d399",
  "5'utr": "#67e8f9",
  "3'utr": "#67e8f9",
};

/** The fallback color for an unknown/blank type. Reads in light and dark. */
export const DEFAULT_FEATURE_COLOR = "#a78bfa";

/** A small ordered palette for the color picker (light + dark friendly). */
export const FEATURE_COLOR_SWATCHES: string[] = [
  "#34d399", // emerald
  "#22d3ee", // cyan
  "#93c5fd", // blue
  "#a78bfa", // violet
  "#f472b6", // pink
  "#f87171", // red
  "#fb923c", // orange
  "#fbbf24", // amber
  "#fde047", // yellow
  "#4ade80", // green
  "#94a3b8", // slate
  "#cbd5e1", // light slate
];

/** Normalize a feature type for palette lookup (lowercase, trimmed). */
export function normalizeType(type?: string): string {
  return (type || "").trim().toLowerCase();
}

/** Default color for a feature type. Falls back to DEFAULT_FEATURE_COLOR. */
export function colorForType(type?: string): string {
  const key = normalizeType(type);
  return FEATURE_TYPE_COLORS[key] ?? DEFAULT_FEATURE_COLOR;
}

/** The resolved display color for a feature: its explicit color if set, else
 *  the per-type default. Never returns undefined, so the viewer + list always
 *  show a consistent swatch. */
export function resolveFeatureColor(feature: {
  color?: string;
  type?: string;
}): string {
  if (feature.color && feature.color.trim()) return feature.color.trim();
  return colorForType(feature.type);
}

/** Pull the first string value out of a parsed note (bio-parsers stores notes as
 *  arrays of strings, but be defensive about plain strings too). */
function firstNote(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const v = value.find((x) => typeof x === "string" && x.trim());
    return typeof v === "string" ? v.trim() : undefined;
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

/**
 * Read a feature color from ApEinfo qualifiers in the parsed `notes`, choosing
 * the strand-appropriate one. Reverse features prefer `ApEinfo_revcolor`;
 * forward features prefer `ApEinfo_fwdcolor`; either falls back to the other.
 * Returns undefined if neither is present.
 */
export function readApEinfoColor(
  notes: Record<string, unknown> | undefined,
  strand: 1 | -1,
): string | undefined {
  if (!notes) return undefined;
  const fwd = firstNote(notes.ApEinfo_fwdcolor);
  const rev = firstNote(notes.ApEinfo_revcolor);
  if (strand === -1) return rev ?? fwd;
  return fwd ?? rev;
}

/**
 * Build the ApEinfo color notes for a feature, so a color SURVIVES save+reload
 * (and round-trips with SnapGene / ApE). We write BOTH fwd and rev to the chosen
 * color: most tools read whichever matches the displayed strand, and writing
 * both is what ApE itself does, so it is the safe, lossless choice. Returns an
 * object suitable to spread into a feature's `notes` (bio-parsers expects each
 * note value to be an array of strings).
 */
export function apEinfoColorNotes(color: string): {
  ApEinfo_fwdcolor: string[];
  ApEinfo_revcolor: string[];
} {
  const c = color.trim();
  return { ApEinfo_fwdcolor: [c], ApEinfo_revcolor: [c] };
}
