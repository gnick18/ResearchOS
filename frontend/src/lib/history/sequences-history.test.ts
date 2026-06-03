// seq history bot (2026-06-03): coverage for the sequence editor version-control
// wiring. Locks:
//   - the additive on-disk namespace ("sequences"),
//   - the structured-projection payload round-trip through the engine (genesis +
//     deltas + reverse-walk for restore),
//   - the viewer adapter's projection + sequence-appropriate delta summaries,
//   - the no-op short-circuit (re-saving an unchanged molecule mints no version).

import { describe, expect, it } from "vitest";
import { HistoryEngine } from "./engine";
import { canonicalize } from "./canonicalize";
import { historyFilePath } from "./storage";
import { isGenesisRow } from "./types";
import { MemoryStorage, makeClock } from "./test-utils";
import {
  SEQUENCES_ENTITY_TYPE,
  sequencePayload,
  projectSequenceState,
  summarizeSequenceChange,
  sequenceDigest,
  sequenceAdapter,
  type SequenceDocLike,
  type SequenceProjection,
} from "./sequences-history";

const OWNER = "alex";
const SEQ_ID = 7;

function makeEngine() {
  const storage = new MemoryStorage();
  const engine = new HistoryEngine({ storage, clock: makeClock() });
  return { engine, storage };
}

/** A minimal editor-doc-like object for the tests. */
function doc(over: Partial<SequenceDocLike & { seq: string }> = {}): SequenceDocLike {
  return {
    name: "pTEST",
    seqType: "dna",
    circular: true,
    seq: "ATGC",
    features: [],
    ...over,
  };
}

/** The canonical HEAD string for a doc, as the live editor threads it. */
function canonicalForDoc(d: SequenceDocLike): string {
  return canonicalize(sequencePayload(d));
}

describe("sequences entity type + path", () => {
  it("uses the additive namespace", () => {
    expect(SEQUENCES_ENTITY_TYPE).toBe("sequences");
  });
  it("resolves the documented on-disk path", () => {
    expect(historyFilePath(OWNER, SEQUENCES_ENTITY_TYPE, SEQ_ID)).toBe(
      "users/alex/_history/sequences/7.jsonl",
    );
  });
});

describe("sequencePayload projection", () => {
  it("normalizes features to the recognized fields + uppercases bases", () => {
    const state = sequencePayload(
      doc({
        seq: "atgc",
        features: [
          { name: "ori", type: "rep_origin", strand: -1, start: 10, end: 50, color: "#fff" },
          { name: "", type: "", start: 1, end: 2 },
        ],
      }),
    );
    expect(state.seq).toBe("ATGC");
    expect(state.features).toEqual([
      { name: "ori", type: "rep_origin", strand: -1, start: 10, end: 50 },
      { name: "Untitled", type: "misc_feature", strand: 1, start: 1, end: 2 },
    ]);
  });
});

describe("structured payload round-trip through the engine", () => {
  it("versions a sequence as its own document (genesis + deltas)", async () => {
    const { engine } = makeEngine();

    // First Save: brand-new sequence (prev null -> empty pre-image) + first delta.
    await engine.appendEdit({
      type: "create",
      entityType: SEQUENCES_ENTITY_TYPE,
      id: SEQ_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: sequencePayload(doc({ seq: "ATGCATGC" })),
    });
    // Second Save: a base edit (insert 4 bp) + a new feature.
    await engine.appendEdit({
      type: "update",
      entityType: SEQUENCES_ENTITY_TYPE,
      id: SEQ_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: sequencePayload(doc({ seq: "ATGCATGC" })),
      nextState: sequencePayload(
        doc({
          seq: "ATGCATGCGGGG",
          features: [{ name: "cds", type: "CDS", strand: 1, start: 0, end: 6 }],
        }),
      ),
    });

    const rows = await engine.readHistory(SEQUENCES_ENTITY_TYPE, OWNER, SEQ_ID);
    expect(rows).toHaveLength(3); // genesis + 2 deltas
    expect(isGenesisRow(rows[0])).toBe(true);

    const head = canonicalForDoc(
      doc({
        seq: "ATGCATGCGGGG",
        features: [{ name: "cds", type: "CDS", strand: 1, start: 0, end: 6 }],
      }),
    );
    const v1 = await engine.reconstructState(SEQUENCES_ENTITY_TYPE, OWNER, SEQ_ID, 1, head);
    const v2 = await engine.reconstructState(SEQUENCES_ENTITY_TYPE, OWNER, SEQ_ID, 2, head);
    expect(projectSequenceState(v1).seqLength).toBe(8);
    expect(projectSequenceState(v1).featureCount).toBe(0);
    expect(projectSequenceState(v2).seqLength).toBe(12);
    expect(projectSequenceState(v2).featureCount).toBe(1);
  });

  it("short-circuits a no-op Save once history exists (no phantom version)", async () => {
    const { engine } = makeEngine();
    await engine.appendEdit({
      type: "create",
      entityType: SEQUENCES_ENTITY_TYPE,
      id: SEQ_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: null,
      nextState: sequencePayload(doc({ seq: "ATGC" })),
    });
    const before = await engine.readHistory(SEQUENCES_ENTITY_TYPE, OWNER, SEQ_ID);

    // Re-Save identical molecule: the empty-delta short-circuit drops it.
    await engine.appendEdit({
      type: "update",
      entityType: SEQUENCES_ENTITY_TYPE,
      id: SEQ_ID,
      owner: OWNER,
      actor: OWNER,
      prevState: sequencePayload(doc({ seq: "ATGC" })),
      nextState: sequencePayload(doc({ seq: "ATGC" })),
    });
    const after = await engine.readHistory(SEQUENCES_ENTITY_TYPE, OWNER, SEQ_ID);
    expect(after).toHaveLength(before.length);
  });

  it("reverse-walks to an earlier version for restore", async () => {
    const { engine } = makeEngine();
    const seqs = ["AAAA", "AAAATTTT", "AAAATTTTGGGG"];
    let prev: SequenceDocLike | null = null;
    for (const s of seqs) {
      const next = doc({ seq: s });
      await engine.appendEdit({
        type: prev ? "update" : "create",
        entityType: SEQUENCES_ENTITY_TYPE,
        id: SEQ_ID,
        owner: OWNER,
        actor: OWNER,
        prevState: prev ? sequencePayload(prev) : null,
        nextState: sequencePayload(next),
      });
      prev = next;
    }
    const rows = await engine.readHistory(SEQUENCES_ENTITY_TYPE, OWNER, SEQ_ID);
    const targetCanonical = engine.reverseWalkTo(
      rows,
      1, // first delta = "AAAA"
      canonicalForDoc(doc({ seq: "AAAATTTTGGGG" })),
    );
    expect(projectSequenceState(targetCanonical).seqLength).toBe(4);
  });
});

describe("sequence adapter projection + summaries", () => {
  it("projects a malformed/empty canonical to the empty shape", () => {
    expect(projectSequenceState(null).seqLength).toBe(0);
    expect(projectSequenceState("").featureCount).toBe(0);
    expect(projectSequenceState("not json").body).toBe("");
  });

  it("builds the compact digest", () => {
    expect(
      sequenceDigest({
        body: "",
        name: "x",
        seqType: "dna",
        circular: true,
        seqLength: 3400,
        featureCount: 8,
        seq: "",
      }),
    ).toBe("3,400 bp, 8 features, circular");
    expect(
      sequenceDigest({
        body: "",
        name: "x",
        seqType: "dna",
        circular: false,
        seqLength: 1000,
        featureCount: 1,
        seq: "",
      }),
    ).toBe("1,000 bp, 1 feature, linear");
  });

  const base: SequenceProjection = {
    body: "",
    name: "pA",
    seqType: "dna",
    circular: false,
    seqLength: 100,
    featureCount: 2,
    seq: "A".repeat(100),
  };

  it("summarizes created / length / feature / topology / name deltas", () => {
    expect(summarizeSequenceChange(null, base)).toBe("created sequence");
    expect(
      summarizeSequenceChange(base, { ...base, seqLength: 112, featureCount: 3 }),
    ).toBe("+12 bp, +1 feature");
    expect(summarizeSequenceChange(base, { ...base, seqLength: 60 })).toBe("-40 bp");
    expect(
      summarizeSequenceChange(base, { ...base, circular: true }),
    ).toBe("linear to circular");
    expect(
      summarizeSequenceChange({ ...base, circular: true }, base),
    ).toBe("circular to linear");
    expect(
      summarizeSequenceChange(base, { ...base, name: "pUC19" }),
    ).toBe("renamed to pUC19");
  });

  it("labels in-place edits + restore / undo rows", () => {
    // Same length / count / topology / name but the FEATURE details changed
    // (same bases) -> "edited features".
    expect(summarizeSequenceChange(base, { ...base })).toBe("edited features");
    expect(summarizeSequenceChange(base, { ...base }, "revert")).toBe(
      "Restored an earlier version",
    );
    expect(summarizeSequenceChange(base, { ...base }, "undo-revert")).toBe(
      "Undid a restore",
    );
  });

  it("detects an in-place base edit (point mutation, same length) via raw seq", () => {
    const a: SequenceProjection = { ...base, seq: "ATGC".padEnd(100, "A") };
    const b: SequenceProjection = { ...base, seq: "ATGG".padEnd(100, "A") };
    expect(summarizeSequenceChange(a, b)).toBe("edited bases");
  });

  it("exposes the adapter shape the panel consumes", () => {
    expect(sequenceAdapter.projectBody("not json").body).toBe("");
    expect(sequenceAdapter.summarize(null, base)).toBe("created sequence");
  });
});
