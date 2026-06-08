// Verification that the demo/wiki-capture cloning substrates ACTUALLY assemble.
//
// The /demo and ?wikiCapture=1 fixture (wiki-capture-fixture.ts) ships purpose
// built substrates so the Cloning Workspace's Golden Gate and Gateway review
// heroes can be exercised live, not just empty-stated. A substrate that looks
// right but does not cut/ligate/recombine is worthless, so this suite reads the
// EXACT GenBank text from the fixture, parses it with the real app parser, and
// drives the real engines, asserting a non-empty product each time.
//
// ids 6/7 = BsaI Golden Gate cassette pair (two linear parts -> one circle).
// ids 8/9 = Gateway LR pair (attL entry clone x attR destination vector).

import { describe, it, expect } from "vitest";
import { buildWikiFixtures } from "../file-system/wiki-capture-fixture";
import { genbankToDetail } from "./parse";
import { annotationsToCloneFeatures } from "./cloning-io";
import { cutAndLigate } from "./cut-ligate";
import { runGateway, type GatewaySubstrate } from "./cloning-gateway";
import type { SequenceMeta } from "../types";

/** Pull a fixture sequence entry (.gb text) by id and parse it into a detail. */
function loadFixtureSeq(id: number) {
  const entries = buildWikiFixtures();
  const gbEntry = entries.find(([path]) => path === `users/alex/sequences/${id}.gb`);
  const metaEntry = entries.find(([path]) => path === `users/alex/sequences/${id}.meta.json`);
  expect(gbEntry, `fixture is missing sequences/${id}.gb`).toBeTruthy();
  expect(metaEntry, `fixture is missing sequences/${id}.meta.json`).toBeTruthy();
  const gb = gbEntry![1] as string;
  const meta = metaEntry![1] as SequenceMeta;
  const detail = genbankToDetail(gb, meta);
  expect(detail, `sequences/${id}.gb failed to parse`).toBeTruthy();
  return detail!;
}

describe("demo Golden Gate cassettes (ids 6 + 7) assemble via BsaI", () => {
  it("produces a non-empty circular product with all-distinct fusion overhangs", () => {
    const d6 = loadFixtureSeq(6);
    const d7 = loadFixtureSeq(7);

    // Both cassettes are LINEAR parts (the fixture LOCUS says linear).
    expect(d6.circular).toBe(false);
    expect(d7.circular).toBe(false);

    const result = cutAndLigate(
      [
        { name: "GG6", seq: d6.seq, features: annotationsToCloneFeatures(d6.annotations) },
        { name: "GG7", seq: d7.seq, features: annotationsToCloneFeatures(d7.annotations) },
      ],
      { enzymeNames: ["BsaI"], mode: "golden-gate", circularOnly: true, allowBlunt: false },
    );

    // THE PROOF: the engine returns at least one product.
    expect(result.products.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings).toHaveLength(0);

    // The product is a circle (head-to-tail two-part assembly).
    const circular = result.products.find((p) => p.circular);
    expect(circular).toBeTruthy();
    expect(circular!.seq.length).toBeGreaterThan(0);

    // Golden Gate uniqueness verdict: every fusion overhang is distinct, so the
    // hero shows the unambiguous one-pot order (no overhang clash).
    const overhangs = circular!.junctionOverhangs;
    expect(overhangs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(overhangs).size).toBe(overhangs.length);

    // The carried-annotation path: both part bodies' features survive into the
    // assembled construct.
    const featNames = circular!.features.map((f) => f.name);
    expect(featNames).toContain("GG part 1 body");
    expect(featNames).toContain("GG part 2 body");
  });
});

describe("demo Gateway LR pair (ids 8 + 9) recombines", () => {
  it("produces a non-empty clone (+ byproduct) that carries the insert feature", () => {
    const d8 = loadFixtureSeq(8); // attL entry clone
    const d9 = loadFixtureSeq(9); // attR destination vector

    // Both Gateway substrates are circular plasmids.
    expect(d8.circular).toBe(true);
    expect(d9.circular).toBe(true);

    const entry: GatewaySubstrate = {
      name: "attL entry clone",
      seq: d8.seq,
      circular: d8.circular,
      features: annotationsToCloneFeatures(d8.annotations),
    };
    const dest: GatewaySubstrate = {
      name: "attR destination",
      seq: d9.seq,
      circular: d9.circular,
    };

    const result = runGateway(entry, dest, "LR");

    // THE PROOF: the LR reaction returns a clone and a byproduct (non-empty).
    expect(result.products.length).toBeGreaterThanOrEqual(1);

    // No fatal "no att sites" error should appear.
    const fatal = result.warnings.filter((w) => /no att.*sites? found/i.test(w));
    expect(fatal).toHaveLength(0);

    const clone = result.products.find((p) => p.role === "clone");
    expect(clone).toBeTruthy();
    expect(clone!.seq.length).toBeGreaterThan(0);
    expect(clone!.circular).toBe(true);

    // The gene of interest transfers onto the destination backbone.
    const cloneFeatNames = clone!.features.map((f) => f.name);
    expect(cloneFeatNames).toContain("gene of interest");

    // A byproduct (cassette transferred onto the entry backbone) is also derived.
    const byproduct = result.products.find((p) => p.role === "byproduct");
    expect(byproduct).toBeTruthy();
    expect(byproduct!.seq.length).toBeGreaterThan(0);
  });
});
