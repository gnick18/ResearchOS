// Structure-search compute layer (chemistry-workbench v2 Phase 2).
//
// Provides two search modes over a caller-supplied array of {id, structure}
// targets, both backed by RDKit MinimalLib (browser-only):
//
//   substructureMatches  — exact substructure containment via SMARTS/SMILES
//                          query; returns the Set of matching ids.
//   similarityRank       — Morgan fingerprint Tanimoto similarity; returns ids
//                          sorted by descending score.
//
// The pure `tanimoto` helper is exported separately so it can be unit tested
// without loading the wasm.
//
// Memory safety: every RDKit mol object is freed in a finally block, mirroring
// the pattern in computeIdentity (rdkit.ts). A target that fails to parse is
// skipped silently. A query that fails to parse throws a user-surfaced error.

import { getRdkit } from "./rdkit";

// ── Extended RDKit types ────────────────────────────────────────────────────
// The base RDKitMol / RDKitModule interfaces in rdkit.ts cover only what the
// identity service needs. We declare the additional surface we use here as a
// local augmentation rather than modifying rdkit.ts (additive, no breakage).

interface RDKitMolExt {
  is_valid(): boolean;
  /** Substructure match. Returns a JSON string: "{}" on no match, or
   *  '{"atoms":[...]}' on a hit. */
  get_substruct_match(qmol: RDKitMolExt): string;
  /** Morgan fingerprint as a string of '0' and '1' characters.
   *  Both query + target MUST use the same detailsJson so lengths match. */
  get_morgan_fp(detailsJson: string): string;
  delete(): void;
}

interface RDKitModuleExt {
  get_mol(input: string): RDKitMolExt | null;
  /** Build a query mol from SMARTS. Returns null on parse failure. */
  get_qmol(smarts: string): RDKitMolExt | null;
}

/** Morgan fingerprint parameters used for every call in this file.
 *  Both query and target MUST use the same object (same string serialisation)
 *  so the resulting bit strings are the same length and Tanimoto is valid. */
const FP_DETAILS = JSON.stringify({ radius: 2, nBits: 2048 });

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Tanimoto coefficient over two equal-length '0'/'1' bit strings.
 *
 * Returns 0 for empty strings, length-mismatched strings, or strings with
 * no set bits in common. Returns 1 for identical non-empty strings.
 */
export function tanimoto(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 0;
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a.charCodeAt(i) === 49; // '1'
    const bi = b.charCodeAt(i) === 49;
    if (ai && bi) intersection++;
    if (ai || bi) union++;
  }
  if (union === 0) return 0;
  return intersection / union;
}

// ── Substructure search ───────────────────────────────────────────────────────

/**
 * Find which molecules in `targets` contain the `query` substructure.
 *
 * The query is first attempted as SMARTS via get_qmol (which handles both
 * SMARTS and plain SMILES). If that returns null / invalid, it falls back to
 * get_mol (plain SMILES). If both fail, an error is thrown — the UI should
 * surface this as "Could not read that structure query".
 *
 * Each target that fails to parse is skipped (not fatal).
 *
 * @returns A Set of ids from `targets` whose structures contain the query.
 */
export async function substructureMatches(
  query: string,
  targets: Array<{ id: string; structure: string }>,
): Promise<Set<string>> {
  const RDKit = (await getRdkit()) as unknown as RDKitModuleExt;

  // Build the query mol. Prefer get_qmol (handles SMARTS); fall back to get_mol
  // (plain SMILES). Throw if neither succeeds — caller surfaces the error.
  let qmol: RDKitMolExt | null = null;
  try {
    qmol = RDKit.get_qmol(query.trim());
    if (!qmol || !qmol.is_valid()) {
      qmol?.delete();
      qmol = null;
    }
  } catch {
    qmol = null;
  }
  if (!qmol) {
    try {
      qmol = RDKit.get_mol(query.trim());
      if (!qmol || !qmol.is_valid()) {
        qmol?.delete();
        qmol = null;
      }
    } catch {
      qmol = null;
    }
  }
  if (!qmol) {
    throw new Error("Could not read that structure query");
  }

  const hits = new Set<string>();
  try {
    for (const { id, structure } of targets) {
      if (!structure) continue;
      let mol: RDKitMolExt | null = null;
      try {
        mol = RDKit.get_mol(structure);
        if (!mol || !mol.is_valid()) continue;
        let matchJson = "{}";
        try {
          matchJson = mol.get_substruct_match(qmol);
        } catch {
          continue;
        }
        // A hit has a non-empty "atoms" array. An empty match is "{}" or
        // '{"atoms":[]}'. We parse and check atoms.length > 0.
        let parsed: { atoms?: unknown[] } = {};
        try {
          parsed = JSON.parse(matchJson) as { atoms?: unknown[] };
        } catch {
          continue;
        }
        if (Array.isArray(parsed.atoms) && parsed.atoms.length > 0) {
          hits.add(id);
        }
      } finally {
        mol?.delete();
      }
    }
  } finally {
    qmol.delete();
  }

  return hits;
}

// ── Similarity search ─────────────────────────────────────────────────────────

export interface SimilarityResult {
  id: string;
  /** Tanimoto score in [0, 1]. */
  score: number;
}

/**
 * Rank `targets` by Morgan fingerprint Tanimoto similarity to `query`.
 *
 * Results are sorted descending by score. Targets that fail to parse are
 * skipped. If the query fails to parse, an error is thrown.
 *
 * Both query and target fingerprints use the same FP_DETAILS (radius=2,
 * nBits=2048) so the bit strings are the same length and Tanimoto is valid.
 */
export async function similarityRank(
  query: string,
  targets: Array<{ id: string; structure: string }>,
): Promise<SimilarityResult[]> {
  const RDKit = (await getRdkit()) as unknown as RDKitModuleExt;

  // Parse the query mol.
  let qmol: RDKitMolExt | null = null;
  try {
    qmol = RDKit.get_mol(query.trim());
    if (!qmol || !qmol.is_valid()) {
      qmol?.delete();
      qmol = null;
    }
  } catch {
    qmol = null;
  }
  if (!qmol) {
    throw new Error("Could not read that structure query");
  }

  let queryFp = "";
  try {
    queryFp = qmol.get_morgan_fp(FP_DETAILS);
  } finally {
    qmol.delete();
  }

  if (!queryFp) {
    throw new Error("Could not generate a fingerprint for that structure query");
  }

  const results: SimilarityResult[] = [];
  for (const { id, structure } of targets) {
    if (!structure) continue;
    let mol: RDKitMolExt | null = null;
    try {
      mol = RDKit.get_mol(structure);
      if (!mol || !mol.is_valid()) continue;
      let fp = "";
      try {
        fp = mol.get_morgan_fp(FP_DETAILS);
      } catch {
        continue;
      }
      const score = tanimoto(queryFp, fp);
      results.push({ id, score });
    } finally {
      mol?.delete();
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
