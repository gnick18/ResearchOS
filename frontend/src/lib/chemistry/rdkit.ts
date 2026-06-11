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
    };
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
