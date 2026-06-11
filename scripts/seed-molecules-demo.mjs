/**
 * seed-molecules-demo.mjs
 *
 * Re-runnable seed for the Chemistry demo molecules. Writes the on-disk
 * molecule pair (the locked format from frontend/src/lib/chemistry/molecule-store.ts):
 *
 *   users/alex/molecules/<id>.mol        MDL Molfile (the source of truth)
 *   users/alex/molecules/<id>.meta.json  MoleculeMeta sidecar (name, identity, links)
 *
 * The app computes the RDKit identity (SMILES / InChIKey / formula / MW) on save,
 * but RDKit is browser-only (wasm), so this Node seed CANNOT call it. The
 * identities below are the standard, verifiable values for these well-known
 * molecules, transcribed here so the library grid + thumbnails render without a
 * re-parse. The molfiles are valid V2000 blocks with 2D coordinates so the editor
 * (Ketcher) reopens them faithfully; RDKit re-canonicalizes on open either way.
 *
 * The molecules are themed to the FakeYeast biofuel lab (fermentation products +
 * a yeast metabolite + a stilbene the lab might assay), all clearly real, common
 * structures so a viewer recognizes them.
 *
 * Run: node scripts/seed-molecules-demo.mjs
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const MOL_DIR = join(
  REPO_ROOT,
  "frontend",
  "public",
  "demo-data",
  "users",
  "alex",
  "molecules",
);

const OWNER_PROJ_BIOFUEL = "1"; // "DEMO: Engineer FakeYeast for biofuel"
const ADDED_AT = "2026-05-14T16:00:00.000Z";

/**
 * Build a minimal valid V2000 Molfile from an atom + bond list. Coordinates are
 * laid out on a simple 1.0-unit grid; the editor re-lays-out on open, so the grid
 * only needs to be parseable, not pretty.
 */
function molfile(name, atoms, bonds) {
  const pad = (n, w) => String(n).padStart(w, " ");
  const fmtCoord = (v) => v.toFixed(4).padStart(10, " ");
  const header = `\n  ResearchOS demo\n\n`;
  const counts = `${pad(atoms.length, 3)}${pad(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000\n`;
  const atomBlock = atoms
    .map(
      (a) =>
        `${fmtCoord(a.x)}${fmtCoord(a.y)}${fmtCoord(0)} ${a.el.padEnd(3, " ")} 0  0  0  0  0  0  0  0  0  0  0  0\n`,
    )
    .join("");
  const bondBlock = bonds
    .map((b) => `${pad(b.a, 3)}${pad(b.b, 3)}${pad(b.order, 3)}  0\n`)
    .join("");
  return header + counts + atomBlock + bondBlock + "M  END\n";
}

// Heavy-atom layouts (H's are implicit; RDKit adds them). Simple chains/rings.
const ETHANOL = molfile(
  "ethanol",
  [
    { el: "C", x: 0, y: 0 },
    { el: "C", x: 1, y: 0 },
    { el: "O", x: 2, y: 0 },
  ],
  [
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
  ],
);

const ACETIC_ACID = molfile(
  "acetic acid",
  [
    { el: "C", x: 0, y: 0 },
    { el: "C", x: 1, y: 0 },
    { el: "O", x: 2, y: 0.5 },
    { el: "O", x: 1, y: -1 },
  ],
  [
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
    { a: 2, b: 4, order: 2 },
  ],
);

const GLYCEROL = molfile(
  "glycerol",
  [
    { el: "O", x: 0, y: 1 },
    { el: "C", x: 0, y: 0 },
    { el: "C", x: 1, y: 0 },
    { el: "O", x: 1, y: 1 },
    { el: "C", x: 2, y: 0 },
    { el: "O", x: 2, y: 1 },
  ],
  [
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
    { a: 3, b: 4, order: 1 },
    { a: 3, b: 5, order: 1 },
    { a: 5, b: 6, order: 1 },
  ],
);

// Resveratrol (trans-3,5,4'-trihydroxystilbene), C14H12O3. A real stilbene a
// yeast lab might assay; drawn as two phenol rings joined by a vinyl bridge.
function benzeneRing(cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 3) * i;
    pts.push({ x: cx + Math.cos(ang), y: cy + Math.sin(ang) });
  }
  return pts;
}
const ringA = benzeneRing(0, 0); // atoms 1-6
const ringB = benzeneRing(6, 0); // atoms 9-14 (after bridge atoms 7,8)
const RESVERATROL = molfile(
  "resveratrol",
  [
    ...ringA.map((p) => ({ el: "C", ...p })), // 1-6
    { el: "C", x: 2.0, y: 0.5 }, // 7 vinyl C
    { el: "C", x: 3.0, y: -0.5 }, // 8 vinyl C
    ...ringB.map((p) => ({ el: "C", ...p })), // 9-14
    { el: "O", x: -1.0, y: 1.5 }, // 15 OH on ring A (meta)
    { el: "O", x: -1.0, y: -1.5 }, // 16 OH on ring A (meta)
    { el: "O", x: 7.0, y: 1.5 }, // 17 OH on ring B (para)
  ],
  [
    // ring A aromatic (alternating for V2000 Kekule)
    { a: 1, b: 2, order: 2 },
    { a: 2, b: 3, order: 1 },
    { a: 3, b: 4, order: 2 },
    { a: 4, b: 5, order: 1 },
    { a: 5, b: 6, order: 2 },
    { a: 6, b: 1, order: 1 },
    // bridge
    { a: 4, b: 7, order: 1 },
    { a: 7, b: 8, order: 2 },
    { a: 8, b: 9, order: 1 },
    // ring B aromatic
    { a: 9, b: 10, order: 2 },
    { a: 10, b: 11, order: 1 },
    { a: 11, b: 12, order: 2 },
    { a: 12, b: 13, order: 1 },
    { a: 13, b: 14, order: 2 },
    { a: 14, b: 9, order: 1 },
    // hydroxyls
    { a: 2, b: 15, order: 1 },
    { a: 6, b: 16, order: 1 },
    { a: 12, b: 17, order: 1 },
  ],
);

/**
 * The demo molecules. identity = the standard RDKit-canonical values for each
 * structure (transcribed, since RDKit cannot run in Node). source "imported" so
 * the library shows the file-import provenance chip (these came from a .mol).
 */
const MOLECULES = [
  {
    id: "1",
    name: "Ethanol",
    molfile: ETHANOL,
    smiles: "CCO",
    inchikey: "LFQSCWFLJHTTHZ-UHFFFAOYSA-N",
    formula: "C2H6O",
    mol_weight: 46.07,
  },
  {
    id: "2",
    name: "Acetic acid",
    molfile: ACETIC_ACID,
    smiles: "CC(=O)O",
    inchikey: "QTBSBXVTEAMEQO-UHFFFAOYSA-N",
    formula: "C2H4O2",
    mol_weight: 60.05,
  },
  {
    id: "3",
    name: "Glycerol",
    molfile: GLYCEROL,
    smiles: "OCC(O)CO",
    inchikey: "PEDCQBHIVMGVHV-UHFFFAOYSA-N",
    formula: "C3H8O3",
    mol_weight: 92.09,
  },
  {
    id: "4",
    name: "Resveratrol",
    molfile: RESVERATROL,
    smiles: "Oc1ccc(/C=C/c2cc(O)cc(O)c2)cc1",
    inchikey: "LUKBXSAWLPMMSZ-OWOJBTEDSA-N",
    formula: "C14H12O3",
    mol_weight: 228.24,
  },
];

mkdirSync(MOL_DIR, { recursive: true });
for (const m of MOLECULES) {
  writeFileSync(join(MOL_DIR, `${m.id}.mol`), m.molfile, "utf8");
  const meta = {
    id: m.id,
    name: m.name,
    project_ids: [OWNER_PROJ_BIOFUEL],
    added_at: ADDED_AT,
    smiles: m.smiles,
    inchikey: m.inchikey,
    formula: m.formula,
    mol_weight: m.mol_weight,
    source: "imported",
  };
  writeFileSync(
    join(MOL_DIR, `${m.id}.meta.json`),
    JSON.stringify(meta, null, 2) + "\n",
    "utf8",
  );
}

console.log(`Seeded ${MOLECULES.length} demo molecules into ${MOL_DIR}`);
