// Tests for the standalone-sequence transfer adapter (cross-boundary sharing,
// sequences tier, the simplest tier). Pins the three pieces of new logic,
//   - buildSequenceSendPayload, which produces the small JSON envelope carrying
//     the GenBank text + meta + the `kind: "sequence"` marker + the verified
//     sender block, and the round-trip back through parseSequencePayload.
//   - the sequence sniff classification, that sniffSharePayload returns
//     "sequence" for the envelope while a zip-based payload is never misread.
//   - importSequencePayload, which creates the sequence via sequencesApi.create
//     and DROPS project_ids (the recipient does not get the sender's projects),
//     then stamps the provenance fields on the new sidecar.
//
// The disk seams (sequencesApi.create, sequenceStore.updateMeta) and the sender
// sidecar read are mocked so the adapter's contract is tested in isolation.

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { SequenceDetail } from "@/lib/types";

// Mock the sender-stamp seam, so buildSequenceSendPayload reads a deterministic
// verified-sender block without touching the identity sidecar / filesystem.
const readManifestSender = vi.fn();
vi.mock("@/lib/sharing/sender-stamp", () => ({
  readManifestSender: (...args: unknown[]) => readManifestSender(...args),
}));

// Mock the create seam. The import path calls sequencesApi.create; we capture
// its argument to assert project_ids is never passed.
const createSequence = vi.fn();
vi.mock("@/lib/local-api", () => ({
  sequencesApi: {
    create: (...args: unknown[]) => createSequence(...args),
  },
}));

// Mock the store's updateMeta so we can assert the provenance stamp.
const updateMeta = vi.fn();
vi.mock("@/lib/sequences/sequence-store", () => ({
  sequenceStore: {
    updateMeta: (...args: unknown[]) => updateMeta(...args),
  },
}));

import {
  buildSequenceSendPayload,
  parseSequencePayload,
  readSequencePayloadSender,
  importSequencePayload,
  InvalidSequencePayloadError,
  type SequenceSharePayload,
} from "@/lib/sharing/sequence-transfer";
import { sniffSharePayload } from "@/lib/sharing/experiment-transfer";

const GENBANK =
  "LOCUS       pTEST                  60 bp ds-DNA     circular     01-JAN-2026\n" +
  "FEATURES             Location/Qualifiers\n" +
  "     misc_feature    1..10\n" +
  "                     /label=tag\n" +
  "ORIGIN\n" +
  "        1 atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc atgcatgcat gcatgcatgc\n" +
  "//\n";

function makeDetail(overrides: Partial<SequenceDetail> = {}): SequenceDetail {
  return {
    id: 7,
    display_name: "pTEST plasmid",
    project_ids: ["3", "9"],
    added_at: "2026-01-01T00:00:00.000Z",
    seq_type: "dna",
    length: 60,
    circular: true,
    feature_count: 1,
    genbank: GENBANK,
    seq: "ATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGCATGC",
    annotations: [],
    locus_name: "pTEST",
    ...overrides,
  };
}

beforeEach(() => {
  readManifestSender.mockReset();
  createSequence.mockReset();
  updateMeta.mockReset();
});

describe("buildSequenceSendPayload", () => {
  it("round-trips the GenBank + meta + sender through parseSequencePayload", async () => {
    readManifestSender.mockResolvedValue({
      email: "sender@lab.edu",
      fingerprint: "FP-ABC",
    });

    const bytes = await buildSequenceSendPayload(makeDetail(), "sender-user");
    const parsed = parseSequencePayload(bytes);

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("sequence");
    expect(parsed?.version).toBe(1);
    expect(parsed?.display_name).toBe("pTEST plasmid");
    expect(parsed?.seq_type).toBe("dna");
    expect(parsed?.circular).toBe(true);
    expect(parsed?.genbank).toBe(GENBANK);
    expect(parsed?.sender).toEqual({ email: "sender@lab.edu", fingerprint: "FP-ABC" });
    // The envelope NEVER carries project_ids (cross-user project ids are meaningless).
    expect((parsed as unknown as { project_ids?: unknown }).project_ids).toBeUndefined();
  });

  it("omits the sender block when the sender has no claimed identity", async () => {
    readManifestSender.mockResolvedValue(undefined);
    const bytes = await buildSequenceSendPayload(makeDetail(), null);
    const parsed = parseSequencePayload(bytes);
    expect(parsed?.sender).toBeUndefined();
    expect(readSequencePayloadSender(bytes)).toBeUndefined();
  });

  it("exposes the verified sender via readSequencePayloadSender", async () => {
    readManifestSender.mockResolvedValue({
      email: "sender@lab.edu",
      fingerprint: "FP-ABC",
    });
    const bytes = await buildSequenceSendPayload(makeDetail(), "sender-user");
    expect(readSequencePayloadSender(bytes)).toEqual({
      email: "sender@lab.edu",
      fingerprint: "FP-ABC",
    });
  });
});

describe("sniffSharePayload (sequence classification)", () => {
  it("classifies a sequence envelope as 'sequence'", async () => {
    readManifestSender.mockResolvedValue(undefined);
    const bytes = await buildSequenceSendPayload(makeDetail(), null);
    expect(await sniffSharePayload(bytes)).toBe("sequence");
  });

  it("does not misclassify plain JSON without the kind marker", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
    expect(await sniffSharePayload(bytes)).toBe("unknown");
  });

  it("does not misclassify a note-shaped or non-zip blob as a sequence", async () => {
    // Random bytes that start with "PK" (zip magic) must fall through to the zip
    // path, not the sequence probe.
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(await sniffSharePayload(zipMagic)).toBe("unknown");
  });
});

describe("parseSequencePayload (tolerance)", () => {
  it("returns null for non-sequence JSON", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ kind: "note" }));
    expect(parseSequencePayload(bytes)).toBeNull();
  });

  it("returns null for a sequence envelope missing genbank", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ kind: "sequence", display_name: "x" }),
    );
    expect(parseSequencePayload(bytes)).toBeNull();
  });

  it("returns null for non-JSON bytes", () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x12]);
    expect(parseSequencePayload(bytes)).toBeNull();
  });
});

describe("importSequencePayload", () => {
  function envelope(overrides: Partial<SequenceSharePayload> = {}): Uint8Array {
    const payload: SequenceSharePayload = {
      kind: "sequence",
      version: 1,
      display_name: "pTEST plasmid",
      seq_type: "dna",
      circular: true,
      genbank: GENBANK,
      ...overrides,
    };
    return new TextEncoder().encode(JSON.stringify(payload));
  }

  it("creates the sequence WITHOUT project_ids (imports as Unfiled)", async () => {
    createSequence.mockResolvedValue({ id: 42 });
    updateMeta.mockResolvedValue({});

    const { sequenceId } = await importSequencePayload(envelope(), {
      currentUser: "recipient",
      senderEmail: "sender@lab.edu",
      senderFingerprint: "FP-ABC",
    });

    expect(sequenceId).toBe(42);
    expect(createSequence).toHaveBeenCalledTimes(1);
    const createArg = createSequence.mock.calls[0][0];
    expect(createArg.genbank).toBe(GENBANK);
    expect(createArg.display_name).toBe("pTEST plasmid");
    expect(createArg.seq_type).toBe("dna");
    // The contract under test, project_ids is NEVER forwarded to create.
    expect(createArg.project_ids).toBeUndefined();
  });

  it("stamps the provenance fields on the new sidecar", async () => {
    createSequence.mockResolvedValue({ id: 42 });
    updateMeta.mockResolvedValue({});

    await importSequencePayload(envelope(), {
      currentUser: "recipient",
      senderEmail: "sender@lab.edu",
      senderFingerprint: "FP-ABC",
    });

    expect(updateMeta).toHaveBeenCalledTimes(1);
    const [id, patch, username] = updateMeta.mock.calls[0];
    expect(id).toBe(42);
    expect(username).toBe("recipient");
    expect(patch.received_from).toBe("sender@lab.edu");
    expect(patch.received_from_fingerprint).toBe("FP-ABC");
    expect(typeof patch.received_at).toBe("string");
  });

  it("throws InvalidSequencePayloadError on a non-sequence payload", async () => {
    const bad = new TextEncoder().encode(JSON.stringify({ kind: "note" }));
    await expect(
      importSequencePayload(bad, {
        currentUser: "recipient",
        senderEmail: "x",
        senderFingerprint: "y",
      }),
    ).rejects.toBeInstanceOf(InvalidSequencePayloadError);
    expect(createSequence).not.toHaveBeenCalled();
  });
});
