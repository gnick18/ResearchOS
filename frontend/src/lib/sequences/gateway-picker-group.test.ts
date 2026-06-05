// sequence editor master — the Gateway picker floats att-flanked substrates to
// the top. We drive groupGatewayPicker on the REAL wiki-capture fixtures: id 8
// (attL entry clone) and id 9 (attR destination vector) must classify and sort
// ahead of a plain non-att sequence, which lands in "other". REUSES the same
// classifier the Phase C pick-step detection uses; no att detection is mocked.

import { describe, it, expect } from "vitest";
import { buildWikiFixtures } from "../file-system/wiki-capture-fixture";
import { genbankToDetail } from "./parse";
import { groupGatewayPicker } from "./pick-readouts";
import type { SequenceMeta } from "../types";

/** Resolve one fixture sequence id to its bases via the real app parser. */
function loadFixtureSeq(id: number): string {
  const entries = buildWikiFixtures();
  const gb = entries.find(([p]) => p === `users/alex/sequences/${id}.gb`)?.[1] as string;
  const meta = entries.find(([p]) => p === `users/alex/sequences/${id}.meta.json`)?.[1] as SequenceMeta;
  const detail = genbankToDetail(gb, meta);
  expect(detail, `sequences/${id}.gb failed to parse`).toBeTruthy();
  return detail!.seq;
}

describe("groupGatewayPicker floats att-flanked substrates to the top", () => {
  it("puts the attL entry clone + attR destination in att, the rest in other", () => {
    const attL = loadFixtureSeq(8); // attL entry clone
    const attR = loadFixtureSeq(9); // attR destination vector
    const plain = "ACGT".repeat(50); // no att pair

    // Interleave so a correct grouping (not just input order) is what passes.
    const groups = groupGatewayPicker([
      { rec: "plain", seq: plain, circular: false },
      { rec: "entry-8", seq: attL, circular: true },
      { rec: "dest-9", seq: attR, circular: true },
    ]);

    // Both fixtures classify and float up; the plain sequence does not.
    expect(groups.att.map((a) => a.rec)).toEqual(["entry-8", "dest-9"]);
    expect(groups.other).toEqual(["plain"]);

    // Each att candidate carries its detected kind + label.
    const entry = groups.att.find((a) => a.rec === "entry-8")!;
    const dest = groups.att.find((a) => a.rec === "dest-9")!;
    expect(entry.kind).toBe("attL");
    expect(entry.label).toMatch(/attL entry clone/);
    expect(dest.kind).toBe("attR");
    expect(dest.label).toMatch(/attR destination/);
  });

  it("treats a not-yet-resolved row (empty seq) as 'other', still selectable", () => {
    const groups = groupGatewayPicker([
      { rec: "pending", seq: "", circular: true },
    ]);
    expect(groups.att).toHaveLength(0);
    expect(groups.other).toEqual(["pending"]);
  });
});
