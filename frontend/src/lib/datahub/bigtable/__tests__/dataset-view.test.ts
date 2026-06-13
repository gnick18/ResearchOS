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

vi.mock("../duckdb-client", () => ({
  query: vi.fn(async () => ({ toArray: () => [], schema: { fields: [] } })),
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

import { formatPreviewCell } from "../dataset-view";

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
