// Tests for the Info sheet model: the constants add / update / remove logic, the
// validAnalysisTypes gate (an Info sheet offers no analysis), and the Loro
// round-trip of the body + constants through seed -> getContent, plus the
// byte-stability guarantee (a grid table carries no info key, so it stays
// byte-identical to before this field existed).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
  seedDataHubDoc,
  getDataHubContent,
  setInfoContent,
  INFO_KEY,
  getDataHubMeta,
} from "@/lib/loro/datahub-doc";
import { validAnalysisTypes } from "@/lib/datahub/run-analysis";
import {
  buildEmptyInfoSheet,
  isInfoSheet,
  infoOf,
  addConstant,
  updateConstant,
  removeConstant,
  setBody,
} from "@/lib/datahub/info-sheet";
import type {
  DataHubDocContent,
  InfoContent,
} from "@/lib/datahub/model/types";

function infoContent(info?: InfoContent): DataHubDocContent {
  return {
    meta: {
      id: "info-1",
      name: "Cell line provenance",
      project_ids: [],
      folder_path: null,
      table_type: "info",
      created_at: "2026-06-12T00:00:00Z",
    },
    columns: [],
    rows: [],
    analyses: [],
    plots: [],
    info: info ?? {
      body: "## HeLa stock\nThawed 2026-06-01. Passage 7.",
      constants: [
        { name: "Dilution factor", value: "100", note: "serial 1:10" },
        { name: "Plate reader", value: "Synergy H1" },
      ],
    },
  };
}

function gridContent(): DataHubDocContent {
  return {
    meta: {
      id: "col-1",
      name: "Viability",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "2026-06-12T00:00:00Z",
    },
    columns: [{ id: "c-y1", name: "Control", role: "y", dataType: "number" }],
    rows: [{ id: "r1", cells: { "c-y1": 100 } }],
    analyses: [],
    plots: [],
  };
}

function importSeed(content: DataHubDocContent): LoroDoc {
  const doc = new LoroDoc();
  doc.import(seedDataHubDoc(content));
  return doc;
}

describe("info sheet builder + accessors", () => {
  it("builds an empty sheet (no body, no constants)", () => {
    expect(buildEmptyInfoSheet()).toEqual({ body: "", constants: [] });
  });

  it("isInfoSheet is true only for table_type info", () => {
    expect(isInfoSheet(infoContent())).toBe(true);
    expect(isInfoSheet(gridContent())).toBe(false);
  });

  it("infoOf falls back to an empty payload when info is absent", () => {
    const c = infoContent();
    delete c.info;
    expect(infoOf(c)).toEqual({ body: "", constants: [] });
  });
});

describe("constants logic", () => {
  const base: InfoContent = {
    body: "notes",
    constants: [{ name: "A", value: "1" }],
  };

  it("addConstant appends a blank row and keeps the body", () => {
    const next = addConstant(base);
    expect(next.body).toBe("notes");
    expect(next.constants).toEqual([
      { name: "A", value: "1" },
      { name: "", value: "" },
    ]);
    // Pure: the input is not mutated.
    expect(base.constants).toHaveLength(1);
  });

  it("updateConstant patches one field and drops a blank note", () => {
    const next = updateConstant(base, 0, { value: "42", note: "" });
    expect(next.constants[0]).toEqual({ name: "A", value: "42" });
  });

  it("updateConstant keeps a non-empty note", () => {
    const next = updateConstant(base, 0, { note: "see SOP" });
    expect(next.constants[0]).toEqual({ name: "A", value: "1", note: "see SOP" });
  });

  it("updateConstant is a no-op for an out-of-range index", () => {
    expect(updateConstant(base, 9, { value: "x" }).constants).toEqual(
      base.constants,
    );
  });

  it("removeConstant drops the row at the index", () => {
    const two = addConstant(base);
    const next = removeConstant(two, 0);
    expect(next.constants).toEqual([{ name: "", value: "" }]);
  });

  it("removeConstant is a no-op for an out-of-range index", () => {
    expect(removeConstant(base, 9).constants).toEqual(base.constants);
  });

  it("setBody replaces the body and keeps the constants", () => {
    const next = setBody(base, "new body");
    expect(next.body).toBe("new body");
    expect(next.constants).toEqual(base.constants);
  });
});

describe("validAnalysisTypes for an info sheet", () => {
  it("returns [] (documentation runs no analysis)", () => {
    expect(validAnalysisTypes(infoContent())).toEqual([]);
  });
});

describe("info sheet Loro round-trip", () => {
  it("round-trips the body + constants through seed -> getContent", () => {
    const content = infoContent();
    const doc = importSeed(content);
    const projected = getDataHubContent(doc, content.meta.id);
    expect(projected.meta.table_type).toBe("info");
    expect(projected.info).toEqual(content.info);
    // An Info sheet has no grid.
    expect(projected.columns).toEqual([]);
    expect(projected.rows).toEqual([]);
  });

  it("round-trips a fresh empty sheet as an Info sheet (not a bare table)", () => {
    const content = infoContent(buildEmptyInfoSheet());
    const doc = importSeed(content);
    const projected = getDataHubContent(doc, content.meta.id);
    expect(projected.info).toEqual({ body: "", constants: [] });
  });

  it("setInfoContent writes the live doc and reprojects", () => {
    const content = infoContent(buildEmptyInfoSheet());
    const doc = importSeed(content);
    setInfoContent(doc, {
      body: "edited",
      constants: [{ name: "pH", value: "7.4" }],
    });
    doc.commit();
    const projected = getDataHubContent(doc, content.meta.id);
    expect(projected.info).toEqual({
      body: "edited",
      constants: [{ name: "pH", value: "7.4" }],
    });
  });

  it("is deterministic: two seeds of the same info are byte-equal", () => {
    const content = infoContent();
    const a = seedDataHubDoc(content);
    const b = seedDataHubDoc(content);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("drops a malformed constant rather than crashing the projection", () => {
    const content = infoContent({
      body: "x",
      // A constant with a missing value coerces to "" on the way through.
      constants: [{ name: "ok", value: "1" }, { name: "bad" } as never],
    });
    const doc = importSeed(content);
    const projected = getDataHubContent(doc, content.meta.id);
    expect(projected.info?.constants).toEqual([
      { name: "ok", value: "1" },
      { name: "bad", value: "" },
    ]);
  });
});

describe("byte-stability: a grid table never carries the info key", () => {
  it("a column table seeds with no info meta key and projects without info", () => {
    const content = gridContent();
    const doc = importSeed(content);
    expect(getDataHubMeta(doc).get(INFO_KEY)).toBeUndefined();
    expect(getDataHubContent(doc, content.meta.id).info).toBeUndefined();
  });
});
