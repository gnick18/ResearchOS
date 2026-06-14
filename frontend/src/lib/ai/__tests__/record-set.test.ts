// record-set seam tests (ai record-widget bot, 2026-06-14).
//
// Pins the two-way contract that keeps the UI full set out of the model's context:
// withRecordSetUi ATTACHES it under _ui; stripRecordSetUi REMOVES it and passes
// through anything that is not an object (or has no _ui). recordSetFromResult and
// briefToRow get spot coverage too.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  withRecordSetUi,
  stripRecordSetUi,
  recordSetFromResult,
  briefToRow,
  maybeRecordSet,
  attachRecordSetIfBig,
  RECORD_SET_UI_KEY,
  RECORD_SET_MIN_ITEMS,
  type RecordSet,
  type RecordSetRow,
} from "@/lib/ai/record-set";
import type { ArtifactBrief } from "@/lib/ai/artifact-index";

const rows = (n: number): RecordSetRow[] =>
  Array.from({ length: n }, (_, i) => ({
    type: "note" as const,
    id: String(i + 1),
    title: `Row ${i + 1}`,
  }));

const SAMPLE_SET: RecordSet = {
  kind: "list_records",
  title: "Records",
  total: 2,
  items: [
    { type: "note", id: "1", title: "First" },
    { type: "experiment", id: "2", title: "Second" },
  ],
};

describe("withRecordSetUi", () => {
  it("attaches the set under _ui without disturbing the model-facing fields", () => {
    const result = { ok: true, total: 2, items: [{ id: "1" }] };
    const wrapped = withRecordSetUi(result, SAMPLE_SET);
    expect(wrapped._ui).toEqual(SAMPLE_SET);
    expect(wrapped.ok).toBe(true);
    expect(wrapped.total).toBe(2);
    expect(wrapped.items).toEqual([{ id: "1" }]);
    expect(RECORD_SET_UI_KEY in wrapped).toBe(true);
  });
});

describe("stripRecordSetUi", () => {
  it("removes the _ui key, leaving the model-facing result intact", () => {
    const wrapped = withRecordSetUi({ ok: true, count: 2 }, SAMPLE_SET);
    const stripped = stripRecordSetUi(wrapped) as Record<string, unknown>;
    expect(RECORD_SET_UI_KEY in stripped).toBe(false);
    expect(stripped).toEqual({ ok: true, count: 2 });
  });

  it("passes a result with no _ui through unchanged", () => {
    const plain = { ok: true, items: [1, 2, 3] };
    expect(stripRecordSetUi(plain)).toBe(plain);
  });

  it("passes non-objects through unchanged", () => {
    expect(stripRecordSetUi(null)).toBe(null);
    expect(stripRecordSetUi(undefined)).toBe(undefined);
    expect(stripRecordSetUi("hello")).toBe("hello");
    expect(stripRecordSetUi(42)).toBe(42);
  });

  it("does not mutate the original result object", () => {
    const wrapped = withRecordSetUi({ ok: true }, SAMPLE_SET);
    stripRecordSetUi(wrapped);
    expect(RECORD_SET_UI_KEY in wrapped).toBe(true);
  });
});

describe("recordSetFromResult", () => {
  it("reads the set off a wrapped result", () => {
    const wrapped = withRecordSetUi({ ok: true }, SAMPLE_SET);
    expect(recordSetFromResult(wrapped)).toEqual(SAMPLE_SET);
  });

  it("returns null for a result with no _ui, a non-object, or a malformed _ui", () => {
    expect(recordSetFromResult({ ok: true })).toBeNull();
    expect(recordSetFromResult(null)).toBeNull();
    expect(recordSetFromResult("x")).toBeNull();
    expect(recordSetFromResult({ _ui: { kind: "x" } })).toBeNull(); // no items array
    expect(recordSetFromResult({ _ui: { items: [] } })).toBeNull(); // no kind
  });
});

describe("the >4 threshold rule (RECORD_SET_MIN_ITEMS)", () => {
  it("RECORD_SET_MIN_ITEMS is 5 (more than 4 items shows the widget)", () => {
    expect(RECORD_SET_MIN_ITEMS).toBe(5);
  });

  describe("maybeRecordSet", () => {
    it("returns null at exactly 4 rows (4 or fewer stays inline chips)", () => {
      expect(maybeRecordSet(rows(4), { kind: "k", title: "T" })).toBeNull();
    });

    it("returns a set at exactly 5 rows", () => {
      const set = maybeRecordSet(rows(5), { kind: "k", title: "T" });
      expect(set).not.toBeNull();
      expect(set?.total).toBe(5);
      expect(set?.items).toHaveLength(5);
    });

    it("returns null for an empty list", () => {
      expect(maybeRecordSet([], { kind: "k", title: "T" })).toBeNull();
    });

    it("honors an explicit total and carries the query", () => {
      const set = maybeRecordSet(rows(6), { kind: "k", title: "T", total: 42, query: "cyp51A" });
      expect(set?.total).toBe(42);
      expect(set?.query).toBe("cyp51A");
    });
  });

  describe("attachRecordSetIfBig", () => {
    it("attaches _ui only when the list clears the threshold", () => {
      const small = attachRecordSetIfBig({ ok: true }, rows(4), { kind: "k", title: "T" }) as {
        _ui?: unknown;
      };
      expect(small._ui).toBeUndefined();

      const big = attachRecordSetIfBig({ ok: true }, rows(5), { kind: "k", title: "T" }) as {
        _ui?: RecordSet;
      };
      expect(big._ui?.kind).toBe("k");
      expect(big._ui?.items).toHaveLength(5);
    });

    it("returns the model-facing fields untouched either way", () => {
      const result = { ok: true, count: 3, items: [1, 2, 3] };
      const out = attachRecordSetIfBig(result, rows(2), { kind: "k", title: "T" });
      expect(out).toEqual(result);
    });
  });
});

describe("briefToRow", () => {
  it("maps a brief to a row, carrying optional subtitle and date", () => {
    const brief: ArtifactBrief = {
      type: "note",
      id: "7",
      title: "Colony count",
      subtitle: "active",
      date: "2026-05-03",
      deepLink: "/notes/7",
    };
    expect(briefToRow(brief)).toEqual({
      type: "note",
      id: "7",
      title: "Colony count",
      subtitle: "active",
      date: "2026-05-03",
    });
  });

  it("coerces a numeric-ish id to a string and omits absent optionals", () => {
    const brief: ArtifactBrief = {
      type: "sequence",
      id: "12",
      title: "pUC19",
      deepLink: "/sequences?seq=12",
    };
    const row = briefToRow(brief);
    expect(row.id).toBe("12");
    expect(row.subtitle).toBeUndefined();
    expect(row.date).toBeUndefined();
  });
});
