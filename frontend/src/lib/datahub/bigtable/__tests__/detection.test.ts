/**
 * detection.test.ts (DataHub-largetables lane, Increment 1)
 *
 * The pure threshold helper that routes a table into the large-dataset lane.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, expect, it } from "vitest";
import {
  isLargeTable,
  LARGE_TABLE_COL_THRESHOLD,
  LARGE_TABLE_ROW_THRESHOLD,
} from "../detection";

describe("isLargeTable", () => {
  it("uses a ~1000-row threshold", () => {
    expect(LARGE_TABLE_ROW_THRESHOLD).toBe(1000);
  });

  it("is false for a small table", () => {
    expect(isLargeTable(10, 5)).toBe(false);
    expect(isLargeTable(999, 5)).toBe(false);
  });

  it("trips at exactly the row threshold", () => {
    expect(isLargeTable(1000, 5)).toBe(true);
    expect(isLargeTable(1001, 5)).toBe(true);
    expect(isLargeTable(250000, 3)).toBe(true);
  });

  it("trips on a very wide short table at the column threshold", () => {
    expect(isLargeTable(10, LARGE_TABLE_COL_THRESHOLD)).toBe(true);
    expect(isLargeTable(10, LARGE_TABLE_COL_THRESHOLD - 1)).toBe(false);
  });

  it("trips when EITHER dimension crosses", () => {
    expect(isLargeTable(2000, 2)).toBe(true);
    expect(isLargeTable(2, 5000)).toBe(true);
    expect(isLargeTable(2, 2)).toBe(false);
  });
});
