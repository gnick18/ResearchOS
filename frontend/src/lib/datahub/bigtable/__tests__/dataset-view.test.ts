/**
 * dataset-view.test.ts (DataHub-largetables lane)
 *
 * Covers formatPreviewCell, the COSMETIC preview formatter that renders a parsed
 * date / timestamp column as a readable date instead of raw epoch millis. It is
 * display only: it never changes a stored value and never touches a computed
 * statistic (analyses read raw arrays through dataset-columns, not this). The
 * tests assert a date/timestamp column formats, and that number / text columns
 * fall through to String() unchanged.
 *
 * dataset-view.ts pulls in the DuckDB client + file-service at import time, so we
 * stub those exactly as the analyses test does; only the pure formatter is used.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, expect, it, vi } from "vitest";

// A mutable Arrow-like result the query() mock returns. Tests set MOCK_RESULT to a
// table whose schema marks columns with Arrow type objects (typeId) or strings.
let MOCK_RESULT: {
  toArray: () => Record<string, unknown>[];
  schema: { fields: { name: string; type?: unknown }[] };
} = { toArray: () => [], schema: { fields: [] } };

vi.mock("../duckdb-client", () => ({
  query: vi.fn(async () => MOCK_RESULT),
  init: vi.fn(async () => {}),
  registerParquetBuffer: vi.fn(async () => {}),
  dropFileBuffer: vi.fn(async () => {}),
  copyQueryToParquet: vi.fn(async () => new Uint8Array()),
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    async readJson() {
      return null;
    },
    async writeJson() {},
    async readFileAsBlob() {
      return null;
    },
    async writeFileFromBlob() {},
  },
}));

import {
  formatPreviewCell,
  arrowTypeToColumnDataType,
  readRowWindow,
  type OpenDatasetHandle,
} from "../dataset-view";

// Arrow Type enum ids (the positive base ids a concrete DataType reports).
const ARROW = {
  Int: 2,
  Float: 3,
  Decimal: 7,
  Date: 8,
  Time: 9,
  Timestamp: 10,
  Utf8: 5,
  Bool: 6,
} as const;

describe("formatPreviewCell (date preview formatting)", () => {
  it("formats epoch millis on a date column as YYYY-MM-DD", () => {
    // 1794268800000 ms = 2026-11-10T00:00:00Z, midnight UTC -> pure date. This is
    // the exact epoch-millis value the live test saw rendered raw in the preview.
    expect(formatPreviewCell(1794268800000, "date")).toBe("2026-11-10");
  });

  it("keeps the time on a timestamp value with a non-zero time-of-day", () => {
    // 2026-11-09T13:45:30Z.
    const ms = Date.UTC(2026, 10, 9, 13, 45, 30);
    expect(formatPreviewCell(ms, "date")).toBe("2026-11-09 13:45:30");
  });

  it("formats an epoch-millis BigInt on a date column", () => {
    expect(formatPreviewCell(BigInt(1794268800000), "date")).toBe("2026-11-10");
  });

  it("formats a JS Date on a date column", () => {
    expect(formatPreviewCell(new Date(Date.UTC(2026, 0, 2)), "date")).toBe(
      "2026-01-02",
    );
  });

  it("passes an already-formatted ISO date string through", () => {
    expect(formatPreviewCell("2026-11-09", "date")).toBe("2026-11-09");
  });

  it("leaves a NUMBER column unchanged (no date treatment)", () => {
    expect(formatPreviewCell(1794268800000, "number")).toBe("1794268800000");
    expect(formatPreviewCell(3.14, "number")).toBe("3.14");
  });

  it("leaves a TEXT column unchanged", () => {
    expect(formatPreviewCell("DrugA", "text")).toBe("DrugA");
    expect(formatPreviewCell("2026-11-09", "text")).toBe("2026-11-09");
  });

  it("renders null / undefined as an empty string for any type", () => {
    expect(formatPreviewCell(null, "date")).toBe("");
    expect(formatPreviewCell(undefined, "number")).toBe("");
  });

  it("falls back to String() for an unparseable date cell (never blanks or throws)", () => {
    expect(formatPreviewCell("not-a-date", "date")).toBe("not-a-date");
  });
});

describe("arrowTypeToColumnDataType (live Arrow type -> Data Hub type)", () => {
  it("maps Date / Time / Timestamp typeIds to 'date'", () => {
    expect(arrowTypeToColumnDataType({ typeId: ARROW.Date })).toBe("date");
    expect(arrowTypeToColumnDataType({ typeId: ARROW.Time })).toBe("date");
    expect(arrowTypeToColumnDataType({ typeId: ARROW.Timestamp })).toBe("date");
  });

  it("maps Int / Float / Decimal typeIds to 'number'", () => {
    expect(arrowTypeToColumnDataType({ typeId: ARROW.Int })).toBe("number");
    expect(arrowTypeToColumnDataType({ typeId: ARROW.Float })).toBe("number");
    expect(arrowTypeToColumnDataType({ typeId: ARROW.Decimal })).toBe("number");
  });

  it("maps other typeIds (Utf8 / Bool) to 'text'", () => {
    expect(arrowTypeToColumnDataType({ typeId: ARROW.Utf8 })).toBe("text");
    expect(arrowTypeToColumnDataType({ typeId: ARROW.Bool })).toBe("text");
  });

  it("falls back to the type STRING form when no typeId is present", () => {
    expect(arrowTypeToColumnDataType("Timestamp<MILLISECOND>")).toBe("date");
    expect(arrowTypeToColumnDataType("Date32<DAY>")).toBe("date");
    expect(arrowTypeToColumnDataType("Time64<MICROSECOND>")).toBe("date");
    expect(arrowTypeToColumnDataType("Int64")).toBe("number");
    expect(arrowTypeToColumnDataType("Float64")).toBe("number");
    expect(arrowTypeToColumnDataType("Decimal128")).toBe("number");
    expect(arrowTypeToColumnDataType("Utf8")).toBe("text");
  });
});

describe("readRowWindow (surfaces LIVE Arrow column types)", () => {
  const handle: OpenDatasetHandle = {
    id: "ds1",
    fileName: "dataset_ds1.parquet",
    owner: "me",
    columnNames: ["run_date", "n"],
  };

  it("types a column 'date' from the live Arrow schema even when the static schema says text", async () => {
    // The recipe parsed run_date to a TIMESTAMP. DuckDB returns it as epoch millis
    // with an Arrow Timestamp type, even though the source column was text.
    MOCK_RESULT = {
      toArray: () => [{ run_date: 1793491200000, n: 3 }],
      schema: {
        fields: [
          { name: "run_date", type: { typeId: ARROW.Timestamp } },
          { name: "n", type: { typeId: ARROW.Int } },
        ],
      },
    };
    const { rows, columnTypes } = await readRowWindow(handle, 0, 25);
    expect(rows).toEqual([{ run_date: 1793491200000, n: 3 }]);
    expect(columnTypes.run_date).toBe("date");
    expect(columnTypes.n).toBe("number");
    // And the live date type feeds formatPreviewCell to a readable date.
    expect(formatPreviewCell(rows[0].run_date, columnTypes.run_date)).toBe(
      "2026-11-01",
    );
  });

  it("returns an empty columnTypes map when the result schema has no fields", async () => {
    MOCK_RESULT = { toArray: () => [], schema: { fields: [] } };
    const { rows, columnTypes } = await readRowWindow(handle, 0, 25);
    expect(rows).toEqual([]);
    expect(columnTypes).toEqual({});
  });
});
