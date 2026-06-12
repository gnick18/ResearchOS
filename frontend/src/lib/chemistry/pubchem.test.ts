// Unit tests for the PubChem PUG-REST property parser (chemistry-workbench).
//
// The network is not exercised here; mapPropertyRecord is the pure parser that
// turns a raw PUG-REST property record into our PubChemCompound shape, and these
// tests pin that the physicochemical descriptors (XLogP, H-bond donor / acceptor
// counts, TPSA) parse and surface, and that a missing descriptor yields null
// rather than NaN or a throw. fetchCompoundsByCids is checked with a mocked fetch
// only to confirm the request asks for the exact property list.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mapPropertyRecord,
  fetchCompoundsByCids,
  PUG_PROPERTY_LIST,
  type PugPropertyRecord,
} from "./pubchem";

function rec(overrides: Partial<PugPropertyRecord> = {}): PugPropertyRecord {
  return {
    CID: 2519,
    Title: "Caffeine",
    MolecularFormula: "C8H10N4O2",
    MolecularWeight: "194.19",
    InChIKey: "RYYVLZVUVIJVGH-UHFFFAOYSA-N",
    XLogP: -0.1,
    HBondDonorCount: 0,
    HBondAcceptorCount: 6,
    TPSA: 58.4,
    ...overrides,
  };
}

describe("mapPropertyRecord descriptors", () => {
  it("parses XLogP, the H-bond counts, and TPSA from a numeric record", () => {
    const c = mapPropertyRecord(rec());
    expect(c.xlogp).toBe(-0.1);
    expect(c.h_bond_donor_count).toBe(0);
    expect(c.h_bond_acceptor_count).toBe(6);
    expect(c.tpsa).toBe(58.4);
  });

  it("coerces descriptors that arrive as strings", () => {
    const c = mapPropertyRecord(
      rec({
        XLogP: "1.2",
        HBondDonorCount: "3",
        HBondAcceptorCount: "5",
        TPSA: "90.7",
      }),
    );
    expect(c.xlogp).toBe(1.2);
    expect(c.h_bond_donor_count).toBe(3);
    expect(c.h_bond_acceptor_count).toBe(5);
    expect(c.tpsa).toBe(90.7);
  });

  it("yields null (never a throw or NaN) when TPSA is missing", () => {
    const r = rec();
    delete r.TPSA;
    const c = mapPropertyRecord(r);
    expect(c.tpsa).toBeNull();
    // The other descriptors still parse.
    expect(c.xlogp).toBe(-0.1);
    expect(c.h_bond_acceptor_count).toBe(6);
  });

  it("treats a blank or unparseable descriptor as null", () => {
    const c = mapPropertyRecord(rec({ XLogP: "", TPSA: "n/a" }));
    expect(c.xlogp).toBeNull();
    expect(c.tpsa).toBeNull();
  });

  it("keeps a zero H-bond donor count as 0, not null", () => {
    const c = mapPropertyRecord(rec({ HBondDonorCount: 0 }));
    expect(c.h_bond_donor_count).toBe(0);
  });
});

describe("fetchCompoundsByCids request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the exact PUG-REST property list (including the four descriptors)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ PropertyTable: { Properties: [rec()] } }),
          { status: 200 },
        ),
      );
    const out = await fetchCompoundsByCids([2519]);
    expect(out).toHaveLength(1);
    expect(out[0].tpsa).toBe(58.4);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain(PUG_PROPERTY_LIST);
    expect(PUG_PROPERTY_LIST).toContain("XLogP");
    expect(PUG_PROPERTY_LIST).toContain("HBondDonorCount");
    expect(PUG_PROPERTY_LIST).toContain("HBondAcceptorCount");
    expect(PUG_PROPERTY_LIST).toContain("TPSA");
  });
});
