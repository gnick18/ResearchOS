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

describe("snapgeneToJson — modern format, no DOMParser", () => {
  let parsed: any;

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
    parsed = res[0].parsedSequence;
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
    const geneB = parsed.features.find((f: any) => f.name === "geneB")!;
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
