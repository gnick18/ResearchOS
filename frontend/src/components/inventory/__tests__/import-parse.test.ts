// Tests for the spreadsheet-import parser + mapper (the cold-start path). The
// three steps are pure, so this covers them directly without the dialog:
//   parseTable     TSV vs CSV detection, quoted fields, padding
//   autoMapColumns common headers, name fallback
//   buildImportRows count / date parsing, 0-count, no-name skip
//   matchKey / summarizeMerge  the merge-don't-duplicate grouping

import { describe, expect, it } from "vitest";

import {
  autoMapColumns,
  autoMapHeader,
  buildImportRows,
  matchKey,
  parseTable,
  summarizeMerge,
} from "../import-parse";

describe("parseTable", () => {
  it("detects TSV (the Excel / Sheets clipboard format)", () => {
    const text = "Name\tVendor\tQty\nQ5\tNEB\t3\nTaq\tNEB\t2";
    const { headers, rows } = parseTable(text);
    expect(headers).toEqual(["Name", "Vendor", "Qty"]);
    expect(rows).toEqual([
      ["Q5", "NEB", "3"],
      ["Taq", "NEB", "2"],
    ]);
  });

  it("detects comma CSV when there are no tabs", () => {
    const text = "Name,Vendor,Qty\nQ5,NEB,3\nTaq,NEB,2";
    const { headers, rows } = parseTable(text);
    expect(headers).toEqual(["Name", "Vendor", "Qty"]);
    expect(rows).toEqual([
      ["Q5", "NEB", "3"],
      ["Taq", "NEB", "2"],
    ]);
  });

  it("handles quoted CSV fields with embedded commas and newlines", () => {
    const text =
      'Name,Location,Notes\n"Q5, hi-fi","-80, door","line one\nline two"';
    const { headers, rows } = parseTable(text);
    expect(headers).toEqual(["Name", "Location", "Notes"]);
    expect(rows).toEqual([["Q5, hi-fi", "-80, door", "line one\nline two"]]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    const text = 'Name,Notes\n"Buffer","he said ""use it"""';
    const { rows } = parseTable(text);
    expect(rows[0]).toEqual(["Buffer", 'he said "use it"']);
  });

  it("pads short rows to the header width", () => {
    const text = "Name\tVendor\tQty\nQ5\tNEB"; // missing Qty
    const { rows } = parseTable(text);
    expect(rows).toEqual([["Q5", "NEB", ""]]);
  });

  it("returns empty for blank / header-only input", () => {
    expect(parseTable("")).toEqual({ headers: [], rows: [] });
    expect(parseTable("   ")).toEqual({ headers: [], rows: [] });
    expect(parseTable("Name\tVendor")).toEqual({
      headers: ["Name", "Vendor"],
      rows: [],
    });
  });

  it("strips a leading BOM and drops trailing blank lines", () => {
    const text = "﻿Name,Qty\nQ5,3\n\n";
    const { headers, rows } = parseTable(text);
    expect(headers).toEqual(["Name", "Qty"]);
    expect(rows).toEqual([["Q5", "3"]]);
  });

  it("uses semicolons when present without commas (European CSV)", () => {
    const text = "Name;Vendor;Qty\nQ5;NEB;3";
    const { headers, rows } = parseTable(text);
    expect(headers).toEqual(["Name", "Vendor", "Qty"]);
    expect(rows).toEqual([["Q5", "NEB", "3"]]);
  });
});

describe("autoMapHeader", () => {
  it("maps common headers to their fields", () => {
    expect(autoMapHeader("Name")).toBe("name");
    expect(autoMapHeader("Item")).toBe("name");
    expect(autoMapHeader("Vendor")).toBe("vendor");
    expect(autoMapHeader("Supplier")).toBe("vendor");
    expect(autoMapHeader("Catalog #")).toBe("catalog_number");
    expect(autoMapHeader("Cat#")).toBe("catalog_number");
    expect(autoMapHeader("Part Number")).toBe("catalog_number");
    expect(autoMapHeader("CAS")).toBe("cas");
    expect(autoMapHeader("Qty")).toBe("container_count");
    expect(autoMapHeader("Quantity")).toBe("container_count");
    expect(autoMapHeader("Vials")).toBe("container_count");
    expect(autoMapHeader("Amount on hand")).toBe("container_count");
    expect(autoMapHeader("Unit type")).toBe("container_label");
    expect(autoMapHeader("Expires")).toBe("expiration_date");
    expect(autoMapHeader("Expiration Date")).toBe("expiration_date");
    expect(autoMapHeader("Received")).toBe("received_date");
    expect(autoMapHeader("Lot")).toBe("lot_number");
    expect(autoMapHeader("Batch")).toBe("lot_number");
    expect(autoMapHeader("Location")).toBe("location_text");
    expect(autoMapHeader("Freezer")).toBe("location_text");
    expect(autoMapHeader("Box")).toBe("location_text");
    expect(autoMapHeader("Notes")).toBe("notes");
    expect(autoMapHeader("Comment")).toBe("notes");
    expect(autoMapHeader("Barcode")).toBe("product_barcode");
    expect(autoMapHeader("UPC")).toBe("product_barcode");
  });

  it("skips an unknown header", () => {
    expect(autoMapHeader("Random Stuff")).toBe("skip");
    expect(autoMapHeader("")).toBe("skip");
  });

  it("prefers the more specific rule (CAS over name-ish words)", () => {
    // "cas" must win even though it is short; catalog must win over name.
    expect(autoMapHeader("CAS number")).toBe("cas");
    expect(autoMapHeader("Catalog name")).toBe("catalog_number");
  });
});

describe("autoMapColumns", () => {
  it("maps a typical header row", () => {
    const headers = ["Name", "Vendor", "Catalog #", "Vials", "Expires", "Location"];
    expect(autoMapColumns(headers)).toEqual([
      "name",
      "vendor",
      "catalog_number",
      "container_count",
      "expiration_date",
      "location_text",
    ]);
  });

  it("promotes the first unmapped column to name when nothing matched name", () => {
    const headers = ["Thing", "Vendor", "Qty"]; // "Thing" does not match name
    const mapping = autoMapColumns(headers);
    expect(mapping[0]).toBe("name");
    expect(mapping[1]).toBe("vendor");
    expect(mapping[2]).toBe("container_count");
  });
});

describe("buildImportRows", () => {
  const headers = ["Name", "Vendor", "Catalog #", "Vials", "Expires", "Location"];
  const mapping = autoMapColumns(headers);

  it("builds one item + one stock per row with defaults", () => {
    const rows = [["Q5 Polymerase", "NEB", "M0491S", "3", "2026-08-01", "-80 door"]];
    const [r] = buildImportRows(rows, mapping);
    expect(r.valid).toBe(true);
    expect(r.item.name).toBe("Q5 Polymerase");
    expect(r.item.vendor).toBe("NEB");
    expect(r.item.catalog_number).toBe("M0491S");
    expect(r.item.category).toBe("reagent");
    expect(r.stock.container_count).toBe(3);
    expect(r.stock.location_text).toBe("-80 door");
    // dateInputToIso stores UTC midnight ISO.
    expect(r.stock.expiration_date).toBe("2026-08-01T00:00:00.000Z");
    expect(r.issues).toEqual([]);
  });

  it("defaults a blank count to 1", () => {
    const rows = [["Taq", "NEB", "", "", "", ""]];
    const [r] = buildImportRows(rows, mapping);
    expect(r.stock.container_count).toBe(1);
  });

  it("allows a 0 count and flags it as an issue", () => {
    const rows = [["Ampicillin", "Sigma", "A9518", "0", "2027-01-01", "4C"]];
    const [r] = buildImportRows(rows, mapping);
    expect(r.valid).toBe(true);
    expect(r.stock.container_count).toBe(0);
    expect(r.issues).toContain("count is 0, stock will read empty");
  });

  it("flags a row with no name and marks it invalid", () => {
    const rows = [["", "NEB", "M0491S", "3", "", ""]];
    const [r] = buildImportRows(rows, mapping);
    expect(r.valid).toBe(false);
    expect(r.issues).toContain("no name, will skip");
  });

  it("parses US m/d/yyyy and day-first when month > 12", () => {
    const usHeaders = ["Name", "Expires"];
    const usMap = autoMapColumns(usHeaders);
    const [us] = buildImportRows([["Q5", "8/1/2026"]], usMap);
    expect(us.stock.expiration_date).toBe("2026-08-01T00:00:00.000Z");
    const [dayFirst] = buildImportRows([["Q5", "13/2/2026"]], usMap);
    // 13 cannot be a month, so it is read as the day.
    expect(dayFirst.stock.expiration_date).toBe("2026-02-13T00:00:00.000Z");
  });

  it("flags an unparseable date as an issue and keeps the row valid", () => {
    const dHeaders = ["Name", "Expires"];
    const dMap = autoMapColumns(dHeaders);
    const [r] = buildImportRows([["Q5", "sometime soon"]], dMap);
    expect(r.valid).toBe(true);
    expect(r.stock.expiration_date).toBeNull();
    expect(r.issues.some((s) => s.startsWith("could not read expiration date"))).toBe(
      true,
    );
  });

  it("tolerates a count with a unit word", () => {
    const cHeaders = ["Name", "Qty"];
    const cMap = autoMapColumns(cHeaders);
    const [r] = buildImportRows([["Q5", "3 vials"]], cMap);
    expect(r.stock.container_count).toBe(3);
  });
});

describe("matchKey + summarizeMerge", () => {
  it("matches on name + catalog, case and whitespace insensitive", () => {
    expect(matchKey("Q5 Polymerase", "M0491S")).toBe(
      matchKey("  q5   polymerase ", "m0491s"),
    );
  });

  it("matches by name alone when catalog is missing on either side", () => {
    expect(matchKey("Taq", null)).toBe(matchKey("taq", ""));
    expect(matchKey("Taq", "M0273S")).not.toBe(matchKey("Taq", null));
  });

  it("counts merges into existing items vs new items", () => {
    const headers = ["Name", "Catalog #", "Vials"];
    const mapping = autoMapColumns(headers);
    const rows = buildImportRows(
      [
        ["Q5 Polymerase", "M0491S", "3"], // matches existing -> merge
        ["Taq Polymerase", "M0273S", "2"], // new
        ["", "X", "1"], // no name -> skipped, not counted
      ],
      mapping,
    );
    const existing = new Set<string>([matchKey("Q5 Polymerase", "M0491S")]);
    const { newItems, mergedStocks } = summarizeMerge(rows, existing);
    expect(mergedStocks).toBe(1);
    expect(newItems).toBe(1);
  });

  it("collapses two rows of the same new item to one item + two stocks", () => {
    const headers = ["Name", "Catalog #", "Vials"];
    const mapping = autoMapColumns(headers);
    const rows = buildImportRows(
      [
        ["Buffer X", "B1", "5"],
        ["Buffer X", "B1", "2"], // same key -> second is a merged stock
      ],
      mapping,
    );
    const { newItems, mergedStocks } = summarizeMerge(rows, new Set());
    expect(newItems).toBe(1);
    expect(mergedStocks).toBe(1);
  });
});
