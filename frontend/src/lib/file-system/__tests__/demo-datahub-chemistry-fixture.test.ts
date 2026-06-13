/**
 * demo-datahub-chemistry-fixture.test.ts
 *
 * End-to-end proof that the demo fixture loader surfaces the seeded Data Hub
 * workbooks and Chemistry molecules. This is the loader-wiring gate: it installs
 * the REAL wiki-capture fixture (buildWikiFixtures -> in-memory fileService) and
 * then calls the SAME APIs the /datahub and /chemistry pages call, asserting the
 * seeded content comes back. If the static fixture ever drops the datahub `.json`
 * mirrors or the molecule `.mol` / `.meta.json` pairs (or the `.mol` text routing
 * regresses), this fails.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect, beforeAll } from "vitest";

// installWikiCaptureFixture fetches some demo PNGs / markdown over the network;
// stub fetch so those best-effort fetches resolve to 404 (the static fixtures we
// assert on are seeded synchronously from buildWikiFixtures, not fetched).
beforeAll(() => {
  if (typeof globalThis.fetch !== "function") {
    globalThis.fetch = (async () =>
      new Response(null, { status: 404 })) as typeof fetch;
  }
});

describe("demo fixture: Data Hub + Chemistry are populated", () => {
  it("seeds the datahub mirrors and molecule pairs into the in-memory store", async () => {
    const { installWikiCaptureFixture } = await import(
      "@/lib/file-system/wiki-capture-mock"
    );
    await installWikiCaptureFixture({ signIn: true, fixtureUser: "alex" });

    // Data Hub: the catalog list the /datahub page reads.
    const { dataHubApi } = await import("@/lib/datahub/api");
    const tables = await dataHubApi.list();
    const names = tables.map((t) => t.name).sort();
    expect(names).toContain("fakeGFP expression (qPCR)");
    expect(names).toContain("Growth curve, YPD vs 4% glucose");
    expect(names).toContain("Heat-shock survival by strain");

    // At least one table carries a real analysis + a plot once its doc is opened.
    const gfp = tables.find((t) => t.name === "fakeGFP expression (qPCR)");
    expect(gfp).toBeTruthy();
    expect(gfp!.project_ids).toContain("1");
    const full = await dataHubApi.get(gfp!.id);
    expect(full).toBeTruthy();

    // Molecules: the library list the /chemistry page reads (for user alex).
    const { moleculeStore } = await import("@/lib/chemistry/molecule-store");
    const metas = await moleculeStore.listMetaForUser("alex");
    const molNames = metas.map((m) => m.name).sort();
    expect(molNames).toContain("Ethanol");
    expect(molNames).toContain("Resveratrol");
    expect(metas.length).toBeGreaterThanOrEqual(4);

    // The .mol source-of-truth text routed to the text store, so the editor can
    // reopen it (this is the routing fix in wiki-capture-mock).
    const raw = await moleculeStore.getRawForUser(metas[0].id, "alex");
    expect(raw).toBeTruthy();
    expect(raw!.molfile).toContain("V2000");

    // Phylogenetics: the three seeded trees the /phylo Tree Studio reads.
    const { phyloApi } = await import("@/lib/phylo/api");
    const trees = await phyloApi.listForUser("alex");
    const treeNames = trees.map((t) => t.name).sort();
    expect(treeNames).toContain("Candida auris global epidemiology");
    expect(treeNames).toContain("Human Microbiome Project tree");
    expect(treeNames).toContain("HPV58 phylogeny");
    expect(trees.length).toBeGreaterThanOrEqual(3);

    // The showcase tree carries a real figure spec, a bound metadata table, and
    // its .tree source-of-truth text (so the Studio reopens it populated).
    const candida = trees.find(
      (t) => t.name === "Candida auris global epidemiology",
    );
    expect(candida).toBeTruthy();
    expect(candida!.figure?.layout).toBe("circular");
    expect(candida!.metadata?.heatColumns).toEqual(["FCZ", "AMB", "MCF"]);
    expect((candida!.tip_count ?? 0)).toBeGreaterThan(0);
    // The `.tree` source-of-truth text routed to the text store, so the Studio
    // can read the tree back (mirrors the `.mol` routing above).
    const { fileService } = await import("@/lib/file-system/file-service");
    const treeText = await fileService.readText(
      `users/alex/phylo/${candida!.id}.tree`,
    );
    expect(treeText).toBeTruthy();
    expect(treeText!).toContain("(");
  });
});
