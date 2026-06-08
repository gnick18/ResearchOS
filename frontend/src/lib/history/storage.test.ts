// Version Control: jsonl (de)serialization robustness.
//
// appendEdit reads the whole history file before every write, so jsonlToRows
// must never throw on a corrupt line. One torn/partial line (e.g. a crash
// mid-append) used to throw and silently stop ALL future history writes for
// that record. These tests pin the skip-bad-lines behavior.

import { describe, expect, it } from "vitest";
import { jsonlToRows, rowsToJsonl } from "./storage";

describe("jsonlToRows", () => {
  it("returns [] for null/empty input", () => {
    expect(jsonlToRows(null)).toEqual([]);
    expect(jsonlToRows("")).toEqual([]);
  });

  it("parses well-formed lines and skips blanks", () => {
    const raw = '{"a":1}\n\n{"a":2}\n';
    expect(jsonlToRows(raw)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("skips a single corrupt line and keeps the rest readable", () => {
    const raw = '{"a":1}\nnot json {{{\n{"a":3}\n';
    expect(jsonlToRows(raw)).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it("survives a torn final line (interrupted append)", () => {
    const raw = '{"a":1}\n{"a":2}\n{"a":3'; // last line cut off mid-write
    expect(jsonlToRows(raw)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("round-trips rowsToJsonl -> jsonlToRows", () => {
    const rows = [{ id: "x", v: 1 }, { id: "y", v: 2 }];
    expect(jsonlToRows(rowsToJsonl(rows))).toEqual(rows);
  });
});
