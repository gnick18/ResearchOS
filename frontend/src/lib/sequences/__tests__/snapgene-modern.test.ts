// snapgene parser fix bot — regression guard for the SnapGene `.dna` reader.
//
// Two things this protects:
//   1. The reader must NOT depend on `DOMParser`. An earlier revision parsed
//      the Features / Notes XML blocks with the browser `DOMParser`, which made
//      the whole import throw `DOMParser is not defined` (-> "Import Error:
//      Invalid File", zero sequences) in any non-DOM realm. That bit modern
//      SnapGene exports because they all carry Features/Notes blocks. This file
//      is a `.test.ts` so it runs in the NODE vitest project (no DOM globals),
//      which is exactly the environment that used to break.
//   2. Unknown / newer block tags must be skipped by length, not throw, so
//      future format additions degrade gracefully.
//
// We build a synthetic modern-format `.dna` in-memory (no real user file) so
// the assertions are deterministic and carry no private data.

import { describe, it, expect, beforeAll } from "vitest";
import { snapgeneToJson } from "@/vendor/bio-parsers";
import type { ParsedSequence, ParsedFeature } from "@/vendor/bio-parsers";

/** Extended feature shape with primer-specific fields the snapgene parser adds. */
interface SnapFeature extends ParsedFeature {
  notes?: Record<string, string[]>;
  locations?: Array<{ start: number; end: number }>;
}

// Guard the premise: this suite must run WITHOUT a DOM, mirroring SSR / worker
// / node contexts. If a future setup leaks a DOMParser global in, the
// regression it protects against would be masked.
describe("environment precondition", () => {
  it("runs with no DOMParser (the realm that used to break)", () => {
    expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe(
      "undefined",
    );
  });
});

/** Build a minimal-but-realistic modern SnapGene `.dna` byte buffer. */
function buildSyntheticDna(opts: {
  sequence: string;
  circular: boolean;
  featuresXml: string;
  notesXml: string;
  /** Append an unrecognized block tag with arbitrary body bytes. */
  includeUnknownBlock?: boolean;
  /** Append a SnapGene Primers block (type 5) with this XML body. */
  primersXml?: string;
}): ArrayBuffer {
  const enc = new TextEncoder();
  const chunks: number[] = [];
  const push = (...bytes: number[]) => chunks.push(...bytes);
  const pushU32 = (n: number) =>
    push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const pushU16 = (n: number) => push((n >>> 8) & 0xff, n & 0xff);
  const pushBytes = (b: Uint8Array) => {
    for (let i = 0; i < b.length; i++) push(b[i]);
  };

  // ── Header block: tag 0, length 14, "SnapGene" + isDNA/export/import ──
  push(0); // header block tag
  pushU32(14); // header payload length
  pushBytes(enc.encode("SnapGene")); // 8 bytes
  pushU16(1); // isDNA
  pushU16(15); // export version (modern)
  pushU16(19); // import version (modern)

  // ── Sequence block: tag 0, body = 1 props byte + sequence bytes ──
  const seqBytes = enc.encode(opts.sequence);
  push(0); // sequence block tag
  pushU32(seqBytes.length + 1);
  push(opts.circular ? 0x01 : 0x00); // props: bit0 = circular
  pushBytes(seqBytes);

  // ── Unknown / future block (must be skipped by length, not throw) ──
  if (opts.includeUnknownBlock) {
    const junk = enc.encode("FUTURE-BLOCK-PAYLOAD");
    push(99); // a tag the reader does not understand
    pushU32(junk.length);
    pushBytes(junk);
  }

  // ── Features block: tag 10, body = XML ──
  const featBytes = enc.encode(opts.featuresXml);
  push(10);
  pushU32(featBytes.length);
  pushBytes(featBytes);

  // ── Primers block: tag 5, body = XML (optional) ──
  if (opts.primersXml != null) {
    const primerBytes = enc.encode(opts.primersXml);
    push(5);
    pushU32(primerBytes.length);
    pushBytes(primerBytes);
  }

  // ── Notes block: tag 6, body = XML ──
  const noteBytes = enc.encode(opts.notesXml);
  push(6);
  pushU32(noteBytes.length);
  pushBytes(noteBytes);

  return new Uint8Array(chunks).buffer;
}

const SEQUENCE = "ATGCATGCATGCATGCATGCATGCATGCATGCATGCATGC"; // 40 bp
const FEATURES_XML =
  '<?xml version="1.0"?><Features nextValidID="3">' +
  // forward gene with one segment + a color qualifier (the &lt;html&gt; style)
  '<Feature recentID="0" name="geneA" directionality="1" type="gene">' +
  '<Segment range="3-12" color="#ff0000" type="standard"/>' +
  '<Q name="note"><V text="&lt;html&gt;&lt;body&gt;hello&lt;/body&gt;&lt;/html&gt;"/></Q>' +
  "</Feature>" +
  // reverse multi-segment CDS (exercises the joined-locations path)
  '<Feature recentID="1" name="geneB" directionality="2" type="CDS">' +
  '<Segment range="15-20" color="#00ff00" type="standard"/>' +
  '<Segment range="25-30" color="#00ff00" type="standard"/>' +
  "</Feature>" +
  "</Features>";
const NOTES_XML =
  "<Notes><CustomMapLabel>My Modern Plasmid</CustomMapLabel>" +
  "<Description>&lt;html&gt;&lt;body&gt;A test &amp; sample.&lt;/body&gt;&lt;/html&gt;</Description>" +
  "</Notes>";

// A Primers block (type 5) exercising: a forward primer (boundStrand 0), a
// reverse primer (boundStrand 1), a primer with TWO binding sites (-> two
// features), and a primer whose binding-site location is garbage (-> skipped,
// the rest survive). The earlier reader dropped this whole block.
const PRIMERS_XML =
  '<?xml version="1.0"?><Primers>' +
  // forward primer, single site, oligo sequence on the Primer element
  '<Primer name="M13_fwd" sequence="GTAAAACGACGGCCAGT" description="seq primer">' +
  '<BindingSite location="3..12" boundStrand="0" simplified="3..12"/>' +
  "</Primer>" +
  // reverse primer (boundStrand 1)
  '<Primer name="M13_rev" sequence="CAGGAAACAGCTATGAC">' +
  '<BindingSite location="25..36" boundStrand="1"/>' +
  "</Primer>" +
  // primer annealing in TWO places -> two primer_bind features
  '<Primer name="multi" sequence="ATGCATGC">' +
  '<BindingSite location="1..8" boundStrand="0"/>' +
  '<BindingSite location="33..40" boundStrand="1"/>' +
  "</Primer>" +
  // primer with an unparseable location -> skipped, others survive
  '<Primer name="broken" sequence="NNNN">' +
  '<BindingSite location="not-a-range" boundStrand="0"/>' +
  "</Primer>" +
  "</Primers>";

describe("snapgeneToJson — primers (block type 5)", () => {
  let parsed: ParsedSequence;

  beforeAll(async () => {
    const ab = buildSyntheticDna({
      sequence: SEQUENCE,
      circular: true,
      featuresXml: FEATURES_XML,
      notesXml: NOTES_XML,
      primersXml: PRIMERS_XML,
    });
    const res = await snapgeneToJson(ab, { fileName: "with-primers.dna" });
    expect(res[0].success).toBe(true);
    parsed = res[0].parsedSequence!;
  });

  it("emits primer_bind features (and keeps the type-10 features too)", () => {
    const primers = (parsed.features as SnapFeature[]).filter(
      (f) => f.type === "primer_bind",
    );
    // M13_fwd + M13_rev + multi(2 sites) = 4; "broken" is skipped.
    expect(primers).toHaveLength(4);
    // The two real Features (geneA, geneB) must still be present.
    expect(
      (parsed.features as SnapFeature[]).filter((f) => f.type !== "primer_bind"),
    ).toHaveLength(2);
  });

  it("maps a forward primer with correct coords, strand, and oligo note", () => {
    const fwd = (parsed.features as SnapFeature[]).find((f) => f.name === "M13_fwd");
    expect(fwd).toBeTruthy();
    expect(fwd!.type).toBe("primer_bind");
    expect(fwd!.start).toBe(2); // 1-based 3 -> 0-based 2
    expect(fwd!.end).toBe(11); // 1-based 12 -> 0-based 11
    expect(fwd!.strand).toBe(1);
    // Oligo sequence carried as a /note (array value -> survives to GenBank).
    expect(fwd!.notes!.note).toEqual(["GTAAAACGACGGCCAGT"]);
  });

  it("maps a reverse primer to strand -1", () => {
    const rev = (parsed.features as SnapFeature[]).find((f) => f.name === "M13_rev");
    expect(rev).toBeTruthy();
    expect(rev!.strand).toBe(-1);
    expect(rev!.start).toBe(24); // 25 -> 24
    expect(rev!.end).toBe(35); // 36 -> 35
    expect(rev!.notes!.note).toEqual(["CAGGAAACAGCTATGAC"]);
  });

  it("emits one feature per binding site for a multi-site primer", () => {
    const multi = (parsed.features as SnapFeature[]).filter((f) => f.name === "multi");
    expect(multi).toHaveLength(2);
    const strands = multi.map((f) => f.strand).sort();
    expect(strands).toEqual([-1, 1]);
  });

  it("skips a primer whose binding-site location won't parse", () => {
    expect((parsed.features as SnapFeature[]).some((f) => f.name === "broken")).toBe(false);
  });

  it("does not throw when there is no Features block, only Primers", async () => {
    const ab = buildSyntheticDna({
      sequence: SEQUENCE,
      circular: false,
      featuresXml: '<?xml version="1.0"?><Features></Features>',
      notesXml: NOTES_XML,
      primersXml:
        '<Primers><Primer name="solo" sequence="ACGTACGT">' +
        '<BindingSite location="5..12" boundStrand="0"/></Primer></Primers>',
    });
    const res = await snapgeneToJson(ab, { fileName: "x.dna" });
    expect(res[0].success).toBe(true);
    const solo = (res[0].parsedSequence!.features as SnapFeature[]).find(
      (f) => f.name === "solo",
    )!;
    expect(solo).toBeTruthy();
    expect(solo.type).toBe("primer_bind");
    expect(solo.notes?.note).toEqual(["ACGTACGT"]);
  });
});

describe("snapgeneToJson — modern format, no DOMParser", () => {
  let parsed: ParsedSequence;

  beforeAll(async () => {
    const ab = buildSyntheticDna({
      sequence: SEQUENCE,
      circular: true,
      featuresXml: FEATURES_XML,
      notesXml: NOTES_XML,
      includeUnknownBlock: true,
    });
    const res = await snapgeneToJson(ab, { fileName: "synthetic-modern.dna" });
    expect(res[0].success).toBe(true);
    parsed = res[0].parsedSequence!;
  });

  it("extracts the sequence and circular topology", () => {
    expect(parsed.sequence.toUpperCase()).toBe(SEQUENCE);
    expect(parsed.sequence.length).toBe(40);
    expect(parsed.circular).toBe(true);
  });

  it("reads the custom map label and HTML-stripped description from Notes", () => {
    expect(parsed.name).toBe("My Modern Plasmid");
    expect(parsed.description).toBe("A test & sample.");
  });

  it("extracts both features with correct coordinates and strands", () => {
    expect(parsed.features).toHaveLength(2);
    expect(parsed.features).toContainEqual(
      expect.objectContaining({
        name: "geneA",
        type: "gene",
        start: 2, // 1-based 3 -> 0-based 2
        end: 11, // 1-based 12 -> 0-based 11
        strand: 1,
        color: "#ff0000",
      }),
    );
    const geneB = (parsed.features as SnapFeature[]).find((f) => f.name === "geneB")!;
    expect(geneB.strand).toBe(-1);
    expect(geneB.type).toBe("CDS");
    // multi-segment -> a `locations` array is attached
    expect(geneB.locations).toEqual([
      { start: 14, end: 19 },
      { start: 24, end: 29 },
    ]);
  });

  it("skips an unknown/newer block tag instead of throwing", async () => {
    // Same file WITHOUT the unknown block must parse identically (feature-wise),
    // proving the unknown block was tolerated, not mis-read.
    const ab = buildSyntheticDna({
      sequence: SEQUENCE,
      circular: false,
      featuresXml: FEATURES_XML,
      notesXml: NOTES_XML,
      includeUnknownBlock: false,
    });
    const res = await snapgeneToJson(ab, { fileName: "synthetic-modern.dna" });
    expect(res[0].success).toBe(true);
    expect(res[0].parsedSequence!.features).toHaveLength(2);
    expect(res[0].parsedSequence!.circular).toBe(false);
  });

  it("does not throw on a feature with a malformed range", async () => {
    const ab = buildSyntheticDna({
      sequence: SEQUENCE,
      circular: false,
      featuresXml:
        '<?xml version="1.0"?><Features>' +
        '<Feature recentID="0" name="bad" type="misc">' +
        '<Segment range="" color="#123456" type="standard"/>' +
        "</Feature></Features>",
      notesXml: NOTES_XML,
    });
    const res = await snapgeneToJson(ab, { fileName: "x.dna" });
    expect(res[0].success).toBe(true);
    const f = res[0].parsedSequence!.features![0];
    expect(Number.isNaN(f.start)).toBe(false);
    expect(Number.isNaN(f.end)).toBe(false);
  });
});
