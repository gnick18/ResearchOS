// Unit tests for the pick-step readout helpers (Phase C cloning visuals).
//
// Two pure helpers under test:
//   - fragmentSiteSummary: per-enzyme cut counts on a fragment (reuses the
//     vendored digest via digestEnzymes). Fixture-backed against the BsaI Golden
//     Gate cassettes (ids 6/7).
//   - classifyGatewaySubstrate / checkGatewayMatch: att-site auto-detection and
//     the BP/LR reaction match check (reuses locateAttSites). Fixture-backed
//     against the attL entry clone (id 8) and attR destination (id 9), plus
//     hand-built attB / attP substrates from the canonical site constants.

import { describe, it, expect } from "vitest";
import { buildWikiFixtures } from "../file-system/wiki-capture-fixture";
import { genbankToDetail } from "./parse";
import {
  ATTB1,
  ATTB2,
  ATTP1,
  ATTP2,
  type GatewaySubstrate,
} from "./cloning-gateway";
import {
  fragmentSiteSummary,
  classifyGatewaySubstrate,
  checkGatewayMatch,
} from "./pick-readouts";
import type { SequenceMeta } from "../types";

/** Pull a fixture sequence entry (.gb text) by id and parse it into a detail. */
function loadFixtureSeq(id: number) {
  const entries = buildWikiFixtures();
  const gbEntry = entries.find(([path]) => path === `users/alex/sequences/${id}.gb`);
  const metaEntry = entries.find(([path]) => path === `users/alex/sequences/${id}.meta.json`);
  const gb = gbEntry![1] as string;
  const meta = metaEntry![1] as SequenceMeta;
  const detail = genbankToDetail(gb, meta);
  expect(detail, `sequences/${id}.gb failed to parse`).toBeTruthy();
  return detail!;
}

/** Wrap a parsed fixture detail as a Gateway substrate. */
function asSubstrate(detail: { seq: string; circular: boolean }, name: string): GatewaySubstrate {
  return { name, seq: detail.seq, circular: detail.circular };
}

// ── 1. fragmentSiteSummary ─────────────────────────────────────────────────

describe("fragmentSiteSummary (sites per fragment)", () => {
  it("counts BsaI sites on the demo Golden Gate cassettes (ids 6/7)", () => {
    const d6 = loadFixtureSeq(6);
    const d7 = loadFixtureSeq(7);

    const s6 = fragmentSiteSummary(d6.seq, ["BsaI"]);
    const s7 = fragmentSiteSummary(d7.seq, ["BsaI"]);

    // A healthy Type IIS cassette is flanked by two BsaI sites (one per end).
    expect(s6.enzymes).toHaveLength(1);
    expect(s6.enzymes[0].name).toBe("BsaI");
    expect(s6.enzymes[0].count).toBe(2);
    expect(s6.allCut).toBe(true);
    expect(s6.hasNoncutter).toBe(false);

    expect(s7.enzymes[0].count).toBe(2);
    expect(s7.allCut).toBe(true);
  });

  it("reports 0 sites (a noncutter) when the enzyme does not cut the fragment", () => {
    // The Golden Gate cassettes carry BsaI sites, not EcoRI (GAATTC). Use a
    // short fragment with no EcoRI site at all.
    const summary = fragmentSiteSummary("AAAACCCCGGGGTTTT", ["EcoRI"]);
    expect(summary.enzymes[0].count).toBe(0);
    expect(summary.hasNoncutter).toBe(true);
    expect(summary.allCut).toBe(false);
  });

  it("counts multiple enzymes independently and preserves request order", () => {
    // One EcoRI site (GAATTC), zero BamHI sites (GGATCC).
    const seq = "TTTTGAATTCTTTT";
    const summary = fragmentSiteSummary(seq, ["BamHI", "EcoRI"]);
    expect(summary.enzymes.map((e) => e.name)).toEqual(["BamHI", "EcoRI"]);
    const ecoRI = summary.enzymes.find((e) => e.name === "EcoRI");
    const bamHI = summary.enzymes.find((e) => e.name === "BamHI");
    expect(ecoRI!.count).toBe(1);
    expect(bamHI!.count).toBe(0);
    expect(summary.hasNoncutter).toBe(true); // BamHI does not cut
    expect(summary.allCut).toBe(false);
  });

  it("handles an empty selection and an empty sequence calmly", () => {
    expect(fragmentSiteSummary("", ["BsaI"]).enzymes[0].count).toBe(0);
    const none = fragmentSiteSummary("GAATTC", []);
    expect(none.enzymes).toHaveLength(0);
    expect(none.allCut).toBe(false);
    expect(none.hasNoncutter).toBe(false);
  });
});

// ── 2. classifyGatewaySubstrate ────────────────────────────────────────────

describe("classifyGatewaySubstrate (att auto-detection)", () => {
  it("classifies the demo attL entry clone (id 8) as attL", () => {
    const d8 = loadFixtureSeq(8);
    const c = classifyGatewaySubstrate(asSubstrate(d8, "entry"));
    expect(c.kind).toBe("attL");
    expect(c.label).toBe("attL entry clone detected");
    // The directional pair (site 1 + site 2) was found.
    expect(c.sites.some((s) => s.specificity === 1)).toBe(true);
    expect(c.sites.some((s) => s.specificity === 2)).toBe(true);
  });

  it("classifies the demo attR destination (id 9) as attR", () => {
    const d9 = loadFixtureSeq(9);
    const c = classifyGatewaySubstrate(asSubstrate(d9, "dest"));
    expect(c.kind).toBe("attR");
    expect(c.label).toBe("attR destination detected");
  });

  it("classifies a hand-built attB insert from the canonical attB1/attB2 sites", () => {
    // attB1 ... gene ... attB2 on a linear PCR product.
    const seq = ATTB1 + "ATGAAACCCGGGTTTTAA" + ATTB2;
    const c = classifyGatewaySubstrate({ name: "pcr", seq, circular: false });
    expect(c.kind).toBe("attB");
    expect(c.label).toBe("attB insert (PCR) detected");
  });

  it("classifies a hand-built attP donor from the canonical attP1/attP2 sites", () => {
    const seq = ATTP1 + "GGGGCCCCAAAATTTT" + ATTP2;
    const c = classifyGatewaySubstrate({ name: "pDONR", seq, circular: true });
    expect(c.kind).toBe("attP");
    expect(c.label).toBe("attP donor (pDONR) detected");
  });

  it("returns unknown when no directional att pair is present", () => {
    const c = classifyGatewaySubstrate({ name: "plain", seq: "ACGTACGTACGTACGT", circular: true });
    expect(c.kind).toBe("unknown");
    expect(c.sites).toHaveLength(0);
  });
});

// ── 3. checkGatewayMatch ───────────────────────────────────────────────────

describe("checkGatewayMatch (reaction vs substrate)", () => {
  it("accepts the demo LR pair (attL entry id 8, attR dest id 9)", () => {
    const d8 = loadFixtureSeq(8);
    const d9 = loadFixtureSeq(9);
    const m = checkGatewayMatch(
      [asSubstrate(d8, "entry"), asSubstrate(d9, "dest")],
      "LR",
    );
    expect(m.ok).toBe(true);
    expect(m.hint).toBe("");
    expect(m.substrates.map((s) => s.kind)).toEqual(["attL", "attR"]);
  });

  it("hints when the LR substrates are in the wrong order (attR first)", () => {
    const d8 = loadFixtureSeq(8);
    const d9 = loadFixtureSeq(9);
    const m = checkGatewayMatch(
      [asSubstrate(d9, "dest"), asSubstrate(d8, "entry")],
      "LR",
    );
    expect(m.ok).toBe(false);
    expect(m.hint).toMatch(/attL entry clone first/i);
  });

  it("accepts a hand-built BP pair (attB insert, attP donor)", () => {
    const attB: GatewaySubstrate = {
      name: "insert",
      seq: ATTB1 + "ATGAAACCCGGG" + ATTB2,
      circular: false,
    };
    const attP: GatewaySubstrate = {
      name: "pDONR",
      seq: ATTP1 + "GGGGCCCCAAAA" + ATTP2,
      circular: true,
    };
    const m = checkGatewayMatch([attB, attP], "BP");
    expect(m.ok).toBe(true);
    expect(m.hint).toBe("");
  });

  it("hints when an LR reaction is run on a BP-style attB/attP pair", () => {
    const attB: GatewaySubstrate = { name: "insert", seq: ATTB1 + "ATGAAA" + ATTB2, circular: false };
    const attP: GatewaySubstrate = { name: "pDONR", seq: ATTP1 + "GGGG" + ATTP2, circular: true };
    const m = checkGatewayMatch([attB, attP], "LR");
    expect(m.ok).toBe(false);
    expect(m.hint).toMatch(/attL entry clone first/i);
  });

  it("stays quiet (no hint) until two substrates are picked", () => {
    const d8 = loadFixtureSeq(8);
    const m = checkGatewayMatch([asSubstrate(d8, "entry")], "LR");
    expect(m.ok).toBe(false);
    expect(m.hint).toBe("");
    expect(m.substrates).toHaveLength(1);
  });
});
