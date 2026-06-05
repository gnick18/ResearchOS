// sequence editor master. Tests for the NCBI taxonomy resolver's PURE parts: the
// single-taxon response parse, the batch id -> name map parse, the lineage
// assembly, and the major-rank picker. The fixtures are REAL JSON the Datasets
// v2 taxonomy endpoint returned (fetched during the build): the human (9606)
// single-taxon response, a batch resolve of the full human lineage ids, and the
// Escherichia coli single-taxon response. Network is not touched here (only the
// pure parsers run).

import { describe, it, expect } from "vitest";
import {
  parseTaxonNode,
  parseTaxonNodeMap,
  assembleTaxonomy,
  majorRanks,
  extractAccession,
  setSourceOrganismInGenbank,
  NcbiDatasetsError,
  type TaxonomyNode,
} from "./ncbi-datasets";
import human9606 from "./__fixtures__/taxonomy/taxon-9606.json";
import humanLineageBatch from "./__fixtures__/taxonomy/batch-9606-lineage.json";
import ecoli from "./__fixtures__/taxonomy/taxon-ecoli.json";

describe("parseTaxonNode (real human 9606 fixture)", () => {
  const leaf = parseTaxonNode(human9606);

  it("parses the tax id, scientific name, and rank", () => {
    expect(leaf.taxId).toBe("9606");
    expect(leaf.name).toBe("Homo sapiens");
    expect(leaf.rank).toBe("species");
  });

  it("reads the ancestor lineage as a list of tax id strings (root first)", () => {
    expect(leaf.lineageIds.length).toBe(31);
    expect(leaf.lineageIds[0]).toBe("1"); // root
    expect(leaf.lineageIds[leaf.lineageIds.length - 1]).toBe("9605"); // Homo
  });

  it("throws a clear error on an empty / unmatched response", () => {
    expect(() => parseTaxonNode({ taxonomy_nodes: [] })).toThrow(
      NcbiDatasetsError,
    );
    expect(() => parseTaxonNode({})).toThrow(NcbiDatasetsError);
  });
});

describe("parseTaxonNodeMap (real batch human-lineage fixture)", () => {
  const map = parseTaxonNodeMap(humanLineageBatch);

  it("indexes every returned node by its tax id string", () => {
    // The batch returns one node per requested id (31 for the human lineage).
    expect(map.size).toBe(31);
    expect(map.get("2759")).toEqual({
      taxId: "2759",
      name: "Eukaryota",
      rank: "domain",
    });
    expect(map.get("40674")).toEqual({
      taxId: "40674",
      name: "Mammalia",
      rank: "class",
    });
  });

  it("does not rely on response order (looks up by id)", () => {
    // Chordata (phylum) and Primates (order) come back in arbitrary positions.
    expect(map.get("7711")?.name).toBe("Chordata");
    expect(map.get("7711")?.rank).toBe("phylum");
    expect(map.get("9443")?.name).toBe("Primates");
    expect(map.get("9443")?.rank).toBe("order");
  });
});

describe("assembleTaxonomy (human leaf + batch names, pure end-to-end)", () => {
  const leaf = parseTaxonNode(human9606);
  const nameMap = parseTaxonNodeMap(humanLineageBatch);
  const result = assembleTaxonomy(leaf, nameMap);

  it("carries the organism's own id, name, and rank", () => {
    expect(result.taxId).toBe("9606");
    expect(result.name).toBe("Homo sapiens");
    expect(result.rank).toBe("species");
  });

  it("builds the named lineage root -> organism, organism as the final node", () => {
    const last = result.lineage[result.lineage.length - 1];
    expect(last).toEqual({
      taxId: "9606",
      name: "Homo sapiens",
      rank: "species",
    });
    // Eukaryota (domain) appears before Mammalia (class) before Homo (genus).
    const names = result.lineage.map((n) => n.name);
    expect(names.indexOf("Eukaryota")).toBeLessThan(names.indexOf("Mammalia"));
    expect(names.indexOf("Mammalia")).toBeLessThan(names.indexOf("Homo"));
  });
});

describe("majorRanks (human)", () => {
  const leaf = parseTaxonNode(human9606);
  const nameMap = parseTaxonNodeMap(humanLineageBatch);
  const major = majorRanks(assembleTaxonomy(leaf, nameMap).lineage);

  it("keeps only the canonical major ranks, in order", () => {
    const pairs = major.map((n) => [n.rank, n.name]);
    // DOMAIN folds into the superkingdom slot; clade ranks (e.g. Vertebrata)
    // are dropped; the chain reads superkingdom -> species.
    expect(pairs).toEqual([
      ["domain", "Eukaryota"], // superkingdom slot
      ["kingdom", "Metazoa"],
      ["phylum", "Chordata"],
      ["class", "Mammalia"],
      ["order", "Primates"],
      ["family", "Hominidae"],
      ["genus", "Homo"],
      ["species", "Homo sapiens"],
    ]);
  });

  it("emits one node per slot and never duplicates a rank", () => {
    const ranks = major.map((n) => n.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("returns an empty list for a lineage with no major ranks", () => {
    const cladeOnly: TaxonomyNode[] = [
      { taxId: "1", name: "root", rank: "" },
      { taxId: "131567", name: "cellular organisms", rank: "cellular_root" },
      { taxId: "7742", name: "Vertebrata", rank: "clade" },
    ];
    expect(majorRanks(cladeOnly)).toEqual([]);
  });
});

describe("Escherichia coli (real single-taxon fixture)", () => {
  const leaf = parseTaxonNode(ecoli);

  it("parses the bacterial species leaf", () => {
    expect(leaf.taxId).toBe("562");
    expect(leaf.name).toBe("Escherichia coli");
    expect(leaf.rank).toBe("species");
    // Its lineage starts at root and ends at the Escherichia genus (561).
    expect(leaf.lineageIds[0]).toBe("1");
    expect(leaf.lineageIds[leaf.lineageIds.length - 1]).toBe("561");
  });

  it("treats a bacterial DOMAIN node as the superkingdom slot in majorRanks", () => {
    // Build a minimal named lineage for the E. coli chain (the ranks/names are
    // the real ones the batch endpoint returns for these ids).
    const nameMap = new Map<string, TaxonomyNode>([
      ["2", { taxId: "2", name: "Bacteria", rank: "domain" }],
      ["1224", { taxId: "1224", name: "Pseudomonadota", rank: "phylum" }],
      ["1236", { taxId: "1236", name: "Gammaproteobacteria", rank: "class" }],
      ["91347", { taxId: "91347", name: "Enterobacterales", rank: "order" }],
      ["543", { taxId: "543", name: "Enterobacteriaceae", rank: "family" }],
      ["561", { taxId: "561", name: "Escherichia", rank: "genus" }],
    ]);
    const major = majorRanks(assembleTaxonomy(leaf, nameMap).lineage);
    expect(major[0]).toEqual({ taxId: "2", name: "Bacteria", rank: "domain" });
    expect(major[major.length - 1].name).toBe("Escherichia coli");
  });
});

const GB_WITH_SOURCE = `LOCUS       TEST                  60 bp    DNA     linear   UNA 05-JUN-2026
DEFINITION  Test sequence.
ACCESSION   NM_000546
FEATURES             Location/Qualifiers
     source          1..60
                     /mol_type="genomic DNA"
     gene            1..60
                     /gene="TP53"
ORIGIN
        1 atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc
//
`;

const GB_NO_SOURCE = `LOCUS       TEST2                 30 bp    DNA     linear   UNA 05-JUN-2026
DEFINITION  No source feature.
FEATURES             Location/Qualifiers
     gene            1..30
                     /gene="X"
ORIGIN
        1 atgcatgcat gcatgcatgc atgcatgcat
//
`;

describe("extractAccession", () => {
  it("reads the first ACCESSION token", () => {
    expect(extractAccession(GB_WITH_SOURCE)).toBe("NM_000546");
  });
  it("returns null when there is no ACCESSION line", () => {
    expect(extractAccession(GB_NO_SOURCE)).toBeNull();
  });
  it("treats a placeholder dot as no accession", () => {
    const gb = "LOCUS x 10 bp\nACCESSION   .\nORIGIN\n//\n";
    expect(extractAccession(gb)).toBeNull();
  });
});

describe("setSourceOrganismInGenbank", () => {
  it("adds /organism and /db_xref into an existing source feature", () => {
    const out = setSourceOrganismInGenbank(GB_WITH_SOURCE, "Homo sapiens", "9606");
    expect(out).toContain('/organism="Homo sapiens"');
    expect(out).toContain('/db_xref="taxon:9606"');
    // The fresh qualifiers sit inside the source block, the gene feature stays.
    expect(out).toContain('/mol_type="genomic DNA"');
    expect(out).toContain('/gene="TP53"');
    // The source location line is preserved exactly once.
    expect(out.match(/^ {5}source\b/gm)?.length).toBe(1);
  });

  it("replaces a stale organism rather than duplicating it", () => {
    const once = setSourceOrganismInGenbank(GB_WITH_SOURCE, "Mus musculus", "10090");
    const twice = setSourceOrganismInGenbank(once, "Homo sapiens", "9606");
    expect(twice).toContain('/organism="Homo sapiens"');
    expect(twice).not.toContain("Mus musculus");
    expect(twice.match(/\/organism=/g)?.length).toBe(1);
    expect(twice.match(/\/db_xref="taxon:/g)?.length).toBe(1);
  });

  it("inserts a source feature when the record has none", () => {
    const out = setSourceOrganismInGenbank(GB_NO_SOURCE, "Escherichia coli", "562");
    expect(out).toContain("     source          1..30");
    expect(out).toContain('/organism="Escherichia coli"');
    expect(out).toContain('/db_xref="taxon:562"');
    // The original gene feature is untouched.
    expect(out).toContain('/gene="X"');
  });

  it("is a no-op for an empty organism", () => {
    expect(setSourceOrganismInGenbank(GB_WITH_SOURCE, "", "9606")).toBe(
      GB_WITH_SOURCE,
    );
  });

  it("indents qualifiers to column 21", () => {
    const out = setSourceOrganismInGenbank(GB_WITH_SOURCE, "Homo sapiens", "9606");
    expect(out).toContain(`${" ".repeat(21)}/organism="Homo sapiens"`);
  });
});
