// RDKit.js loader + identity service (chemistry-workbench Phase 1).
//
// RDKit MinimalLib compiled to wasm, run fully client-side, no backend. The
// engine for the chemistry workbench: canonical SMILES, InChIKey, formula,
// molecular weight, descriptors, and 2D depiction for library thumbnails and the
// editor companion rail. Proven live in the stack spike (docs/spikes) and the
// mockup before this landed.
//
// Assets are served same-origin from public/rdkit/ (RDKit_minimal.js +
// RDKit_minimal.wasm), the same pattern as public/hmmer/hmmsearch.wasm, so the
// engine works offline with no CDN dependency. We load the UMD script from there
// and instantiate with locateFile pointing back at the same folder, rather than
// importing the package, to keep the wasm out of the Turbopack module graph (the
// same bundler that choked on ketcher-react). 'wasm-unsafe-eval' is already in the
// CSP; the .js + .wasm are same-origin, covered by connect-src/script-src 'self'.

const RDKIT_BASE = "/rdkit/";

/** The slice of the RDKit MinimalLib molecule API this service uses. */
interface RDKitMol {
  is_valid(): boolean;
  get_smiles(): string;
  get_inchi(): string;
  get_descriptors(): string;
  get_svg(width: number, height: number): string;
  get_molblock(): string;
  delete(): void;
}
interface RDKitModule {
  get_mol(input: string): RDKitMol | null;
  get_inchikey_for_inchi(inchi: string): string;
}
type InitRDKit = (opts?: {
  locateFile?: (file: string) => string;
}) => Promise<RDKitModule>;

declare global {
  interface Window {
    initRDKitModule?: InitRDKit;
  }
}

let rdkitPromise: Promise<RDKitModule> | null = null;
let scriptPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[data-rdkit="1"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.dataset.rdkit = "1";
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/**
 * Load (once) and return the RDKit module. Browser-only; rejects during SSR. The
 * wasm is ~2 MB gzipped and loads on first use, then is cached by the singleton
 * promise and the browser, so subsequent calls are instant.
 */
export function getRdkit(): Promise<RDKitModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("RDKit is browser-only"));
  }
  if (!rdkitPromise) {
    rdkitPromise = loadScript(`${RDKIT_BASE}RDKit_minimal.js`).then(() => {
      if (!window.initRDKitModule) {
        throw new Error("initRDKitModule not found after loading RDKit");
      }
      return window.initRDKitModule({ locateFile: (f) => `${RDKIT_BASE}${f}` });
    });
  }
  return rdkitPromise;
}

/** The cheminformatics identity stored in a molecule's meta sidecar + shown in the rail. */
export interface MoleculeIdentity {
  smiles: string;
  inchikey: string;
  formula: string;
  mol_weight: number | null;
  exact_mass: number | null;
  heavy_atoms: number | null;
  rings: number | null;
  rotatable_bonds: number | null;
  // Druglikeness descriptors (chemistry v2 Phase 1c). RDKit's get_descriptors()
  // already computes these; we just read them. Display-only for now (not folded
  // into the on-disk meta), computed on demand from the structure.
  clogp: number | null;
  tpsa: number | null;
  h_donors: number | null;
  h_acceptors: number | null;
  aromatic_rings: number | null;
}

/** A Lipinski Rule-of-Five assessment derived from a computed identity. */
export interface LipinskiResult {
  /** Each rule and whether the molecule violates it. */
  violations: Array<{ rule: string; ok: boolean }>;
  /** How many of the four rules are violated. */
  count: number;
  /** Classic Ro5 verdict: drug-like when no more than one rule is violated. */
  pass: boolean;
  /** True only when every input descriptor was available to judge. */
  complete: boolean;
}

/**
 * Lipinski's Rule of Five from a computed identity. Pure, so it is unit tested.
 * A missing descriptor (null) is treated as "not a violation" but flips
 * `complete` to false so the UI can show that the verdict is partial.
 */
export function lipinski(identity: MoleculeIdentity): LipinskiResult {
  const checks: Array<{ rule: string; value: number | null; limit: number }> = [
    { rule: "MW ≤ 500", value: identity.mol_weight, limit: 500 },
    { rule: "logP ≤ 5", value: identity.clogp, limit: 5 },
    { rule: "H-bond donors ≤ 5", value: identity.h_donors, limit: 5 },
    { rule: "H-bond acceptors ≤ 10", value: identity.h_acceptors, limit: 10 },
  ];
  let count = 0;
  let complete = true;
  const violations = checks.map(({ rule, value, limit }) => {
    if (value == null) {
      complete = false;
      return { rule, ok: true };
    }
    const ok = value <= limit;
    if (!ok) count += 1;
    return { rule, ok };
  });
  return { violations, count, pass: count <= 1, complete };
}

/**
 * Extract the Hill molecular formula from an InChI string. RDKit MinimalLib's
 * get_descriptors() does not include the formula, but the InChI carries it as the
 * first layer (InChI=1S/C9H8O4/c... -> "C9H8O4"). Pure, so it is unit tested.
 */
export function formulaFromInchi(inchi: string): string {
  const parts = inchi.split("/");
  // parts[0] is "InChI=1S" (or "InChI=1"); parts[1] is the formula layer.
  const layer = parts[1] ?? "";
  return /^[A-Za-z0-9.]+$/.test(layer) ? layer : "";
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute the full identity of a structure (SMILES or Molfile) with RDKit. Frees
 * the wasm-side molecule before returning. Throws if the input does not parse.
 */
export async function computeIdentity(input: string): Promise<MoleculeIdentity> {
  const RDKit = await getRdkit();
  const mol = RDKit.get_mol(input);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    throw new Error("RDKit could not parse the structure");
  }
  try {
    let smiles = "";
    try {
      smiles = mol.get_smiles();
    } catch {
      // leave blank; an invalid SMILES output is non-fatal for the rest
    }
    let inchikey = "";
    let formula = "";
    try {
      const inchi = mol.get_inchi();
      inchikey = RDKit.get_inchikey_for_inchi(inchi);
      formula = formulaFromInchi(inchi);
    } catch {
      // InChI generation can fail on exotic inputs; identity still returns SMILES
    }
    let d: Record<string, unknown> = {};
    try {
      d = JSON.parse(mol.get_descriptors()) as Record<string, unknown>;
    } catch {
      // descriptors are best-effort
    }
    return {
      smiles,
      inchikey,
      formula,
      mol_weight: toNum(d.amw),
      exact_mass: toNum(d.exactmw),
      heavy_atoms: toNum(d.NumHeavyAtoms),
      rings: toNum(d.NumRings),
      rotatable_bonds: toNum(d.NumRotatableBonds),
      clogp: toNum(d.CrippenClogP),
      tpsa: toNum(d.tpsa),
      // Prefer the Lipinski H-bond counts; fall back to the plain counts.
      h_donors: toNum(d.NumHBD ?? d.lipinskiHBD),
      h_acceptors: toNum(d.NumHBA ?? d.lipinskiHBA),
      aromatic_rings: toNum(d.NumAromaticRings),
    };
  } finally {
    mol.delete();
  }
}

/**
 * Convert any parseable structure (SMILES or Molfile) to an MDL Molfile, the
 * store's source-of-truth form. Used by file import to normalize SMILES into a
 * `.mol`. A SMILES-derived molblock has flat coordinates; the editor (Ketcher)
 * lays it out on open and the library thumbnail renders from the SMILES, so the
 * flat coords never surface. Throws if the input does not parse.
 */
export async function toMolblock(input: string): Promise<string> {
  const RDKit = await getRdkit();
  const mol = RDKit.get_mol(input);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    throw new Error("RDKit could not parse the structure");
  }
  try {
    return mol.get_molblock();
  } finally {
    mol.delete();
  }
}

/**
 * Render a structure (SMILES or Molfile) to a 2D SVG string for thumbnails and
 * previews. Returns an empty string if the input does not parse.
 */
export async function renderSvg(
  input: string,
  width = 260,
  height = 200,
): Promise<string> {
  const RDKit = await getRdkit();
  const mol = RDKit.get_mol(input);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    return "";
  }
  try {
    return mol.get_svg(width, height);
  } finally {
    mol.delete();
  }
}
