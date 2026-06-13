/**
 * seed-phylo-demo.test.ts
 *
 * Re-runnable generator + well-formedness gate for the Phylogenetics demo trees.
 *
 * Two modes, both driven through vitest so the `@` alias and the REAL phylo
 * parser resolve without a separate build step (the repo has no tsx / ts-node):
 *
 *   GENERATE  (SEED_DEMO=1 vitest run src/lib/phylo/__seed__):
 *     reads the committed verbatim source trees + metadata CSVs under
 *     __seed__/sources, parses each tree with the REAL parseNewick to get a true
 *     tip count, transforms each CSV into a PhyloMetadataBinding (the id column is
 *     the tip column, every CSV row carried through verbatim), builds a PhyloMeta
 *     plus a sensible PhyloFigureSpec per tree, and writes the on-disk mirror to
 *     frontend/public/demo-data/users/alex/phylo/<id>.tree + <id>.meta.json. Run
 *     this when the source trees or the figure specs below change, then commit the
 *     regenerated files.
 *
 *   GATE  (plain vitest run, the default in CI):
 *     reads the committed `.tree` + `.meta.json` mirrors back, re-parses each tree
 *     with the real parser, and asserts the on-disk fixture is well-formed (tips
 *     greater than zero, the parsed tip count matches the stamped tip_count, and
 *     the bound metadata ids overlap the real tips). This catches drift if the
 *     parser or the on-disk format ever changes under the committed fixture.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNewick, leaves } from "@/lib/phylo/parse";
import { parseCsv } from "@/lib/phylo/layout";
import type {
  PhyloMeta,
  PhyloFigureSpec,
  PhyloMetadataBinding,
} from "@/lib/phylo/types";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
// .../frontend/src/lib/phylo/__seed__ -> .../frontend
const FRONTEND_ROOT = join(HERE, "..", "..", "..", "..");
const SOURCES_DIR = join(HERE, "sources");
const PHYLO_DIR = join(
  FRONTEND_ROOT,
  "public",
  "demo-data",
  "users",
  "alex",
  "phylo",
);

// The demo persona owner the fixtures attach to.
const OWNER = "alex";
// alex's demo projects (stringified ids, matching the catalog's project_ids).
const PROJ_BIOFUEL = "1"; // "DEMO: Engineer FakeYeast for biofuel"
const PROJ_STRESS = "3"; // "DEMO: Stress tolerance screening"

// Fixed timestamp. The demo rebase does not touch the phylo dir, so this stays
// put and reads as recent bench work without being schedule-relative anywhere.
const ADDED_AT = "2026-05-15T11:00:00.000Z";

// ---------------------------------------------------------------------------
// Per-tree seed specs. Each points at a committed source folder + the figure
// the Studio should open into. Track keys + column-binding keys are exactly the
// ones render.ts honors (labels / labelsItalic / points / strip / bars / heat /
// clade / support, and category / bar / heat columns).
// ---------------------------------------------------------------------------

interface SourceCsv {
  /** Relative path under the tree's source folder. */
  file: string;
}

interface SeedSpec {
  id: string;
  name: string;
  project_ids: string[];
  /** Source folder under __seed__/sources. */
  sourceDir: string;
  /** Source tree file (always Newick here). */
  treeFile: string;
  /** Metadata CSV to bind (optional, hpv58 ships labels-only). */
  csv?: SourceCsv;
  figure: PhyloFigureSpec;
  /** Column-binding overrides for the metadata, on top of tipColumn. */
  binding?: {
    categoryColumn?: string;
    barColumn?: string;
    heatColumns?: string[];
  };
}

const SEEDS: SeedSpec[] = [
  // 1) Candida auris global epidemiology. Circular tree, clade color strip +
  //    tip points by clade + a resistance heatmap (FCZ / AMB / MCF).
  {
    id: "1",
    name: "Candida auris global epidemiology",
    project_ids: [PROJ_STRESS],
    sourceDir: "candida_auris",
    treeFile: "tree.nwk",
    csv: { file: "metadata.csv" },
    figure: {
      layout: "circular",
      branchLengths: false,
      tracks: {
        labels: false,
        labelsItalic: false,
        points: true,
        strip: true,
        bars: false,
        heat: true,
        clade: false,
        support: false,
      },
    },
    binding: {
      categoryColumn: "CLADE",
      heatColumns: ["FCZ", "AMB", "MCF"],
    },
  },

  // 2) The Human Microbiome Project tree, the canonical ggtreeExtra figure.
  //    Circular tree, tip points + ring color strip by Phylum, outer bar plot of
  //    abundance. tippoint.csv carries Phylum + Size; ringheatmap.csv carries the
  //    abundance we bar-plot, joined onto the same id column.
  {
    id: "2",
    name: "Human Microbiome Project tree",
    project_ids: [PROJ_BIOFUEL],
    sourceDir: "hmp",
    treeFile: "tree.nwk",
    csv: { file: "tippoint.csv" },
    figure: {
      layout: "circular",
      branchLengths: false,
      tracks: {
        labels: false,
        labelsItalic: false,
        points: true,
        strip: true,
        bars: true,
        heat: false,
        clade: false,
        support: false,
      },
    },
    binding: {
      categoryColumn: "Phylum",
      barColumn: "Size",
    },
  },

  // 3) HPV58 phylogeny. Rectangular phylogram (real branch lengths), bootstrap
  //    support values on internal nodes, the default clade highlight, tip labels.
  {
    id: "3",
    name: "HPV58 phylogeny",
    project_ids: [PROJ_STRESS],
    sourceDir: "hpv58",
    treeFile: "tree.nwk",
    figure: {
      layout: "rectangular",
      branchLengths: true,
      tracks: {
        labels: true,
        labelsItalic: false,
        points: false,
        strip: false,
        bars: false,
        heat: false,
        clade: true,
        support: true,
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function readSource(spec: SeedSpec, file: string): string {
  return readFileSync(join(SOURCES_DIR, spec.sourceDir, file), "utf8");
}

/** Transform a source CSV into the inline metadata binding for a tree. */
function buildBinding(spec: SeedSpec): PhyloMetadataBinding | undefined {
  if (!spec.csv) return undefined;
  const parsed = parseCsv(readSource(spec, spec.csv.file));
  // The id column is the first column in every source CSV (header "ID").
  const tipColumn = parsed.columns[0];
  return {
    tipColumn,
    rows: parsed.rows,
    categoryColumn: spec.binding?.categoryColumn,
    barColumn: spec.binding?.barColumn,
    heatColumns: spec.binding?.heatColumns,
  };
}

/** Materialize a SeedSpec into the tree text + the PhyloMeta sidecar. */
function buildRecord(spec: SeedSpec): { tree: string; meta: PhyloMeta } {
  const tree = readSource(spec, spec.treeFile);
  const root = parseNewick(tree);
  const tip_count = leaves(root).length;
  const metadata = buildBinding(spec);
  const meta: PhyloMeta = {
    id: spec.id,
    name: spec.name,
    project_ids: spec.project_ids,
    added_at: ADDED_AT,
    format: "newick",
    source: "upload",
    tip_count,
    figure: spec.figure,
    ...(metadata ? { metadata } : {}),
  };
  return { tree, meta };
}

/** Count how many bound metadata ids actually land on a real tip in the tree. */
function metadataOverlap(tree: string, binding: PhyloMetadataBinding): number {
  const tipNames = new Set(leaves(parseNewick(tree)).map((t) => t.name));
  const ids = new Set(
    (binding.rows ?? []).map((r) => r[binding.tipColumn] ?? ""),
  );
  let hits = 0;
  for (const id of ids) if (id !== "" && tipNames.has(id)) hits++;
  return hits;
}

// ---------------------------------------------------------------------------
// GENERATE mode (SEED_DEMO=1) vs GATE mode (default)
// ---------------------------------------------------------------------------

const GENERATE = process.env.SEED_DEMO === "1";

describe("Phylogenetics demo fixtures", () => {
  if (GENERATE) {
    it("writes the .tree + .meta.json mirrors", () => {
      mkdirSync(PHYLO_DIR, { recursive: true });
      for (const spec of SEEDS) {
        const { tree, meta } = buildRecord(spec);
        // The tree text is the source of truth, written verbatim (only a trailing
        // newline normalized) exactly as the store would write it.
        writeFileSync(
          join(PHYLO_DIR, `${spec.id}.tree`),
          tree.endsWith("\n") ? tree : tree + "\n",
          "utf8",
        );
        writeFileSync(
          join(PHYLO_DIR, `${spec.id}.meta.json`),
          JSON.stringify(meta, null, 2) + "\n",
          "utf8",
        );
      }
      expect(existsSync(join(PHYLO_DIR, "1.meta.json"))).toBe(true);
    });
    return;
  }

  // GATE mode: assert the committed fixtures are well-formed.
  for (const spec of SEEDS) {
    it(`fixture ${spec.id} (${spec.name}) is well-formed`, () => {
      const treePath = join(PHYLO_DIR, `${spec.id}.tree`);
      const metaPath = join(PHYLO_DIR, `${spec.id}.meta.json`);
      expect(existsSync(treePath), `${treePath} missing`).toBe(true);
      expect(existsSync(metaPath), `${metaPath} missing`).toBe(true);

      const treeText = readFileSync(treePath, "utf8");
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as PhyloMeta;

      // Sidecar identity is intact and linked to a project.
      expect(meta.id).toBe(spec.id);
      expect(meta.name).toBe(spec.name);
      expect(meta.project_ids).toEqual(spec.project_ids);
      expect(meta.format).toBe("newick");
      expect(meta.figure).toBeTruthy();

      // The tree re-parses to a real tree with tips, and the stamped tip_count
      // matches what the real parser counts now.
      const root = parseNewick(treeText);
      const tips = leaves(root);
      expect(tips.length).toBeGreaterThan(0);
      expect(meta.tip_count).toBe(tips.length);

      // The bound metadata (when present) overlaps the real tips, so the figure
      // is not annotating an empty join.
      if (spec.csv) {
        expect(meta.metadata, "metadata binding missing").toBeTruthy();
        const overlap = metadataOverlap(treeText, meta.metadata!);
        expect(overlap).toBeGreaterThan(0);
      }
              });
  }
});
