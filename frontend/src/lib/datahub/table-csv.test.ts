import { describe, expect, it } from "vitest";
import type { DataHubDocContent } from "@/lib/datahub/model/types";
import { tableContentToCsv } from "./table-csv";

/** A minimal two-column content with the given rows of cells. */
function content(
  columns: { id: string; name: string }[],
  rows: Record<string, number | string | null>[],
): DataHubDocContent {
  return {
    meta: {
      id: "1",
      name: "t",
      project_ids: [],
      folder_path: null,
      table_type: "column",
      created_at: "",
    },
    columns: columns.map((c) => ({
      id: c.id,
      name: c.name,
      role: "y",
      dataType: "number",
    })),
    rows: rows.map((cells, i) => ({ id: `r${i}`, cells })),
    analyses: [],
    plots: [],
  };
}

describe("tableContentToCsv", () => {
  it("writes a header with a leading row-number column and one line per row", () => {
    const csv = tableContentToCsv(
      content(
        [
          { id: "c1", name: "Control" },
          { id: "c2", name: "Treated" },
        ],
        [
          { c1: 10, c2: 20 },
          { c1: 30, c2: 40 },
        ],
      ),
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("#,Control,Treated");
    expect(lines[1]).toBe("1,10,20");
    expect(lines[2]).toBe("2,30,40");
  });

  it("renders a blank cell as an empty field, not the literal null", () => {
    const csv = tableContentToCsv(
      content([{ id: "c1", name: "A" }], [{ c1: null }, {}]),
    );
    const lines = csv.trimEnd().split("\r\n");
    // Both a null cell and a missing cell are empty fields after the row number.
    expect(lines[1]).toBe("1,");
    expect(lines[2]).toBe("2,");
  });

  it("quotes fields that contain a comma, a quote, or a newline (RFC 4180)", () => {
    const csv = tableContentToCsv(
      content(
        [{ id: "c1", name: "Label, with comma" }],
        [{ c1: 'has "quote"' }, { c1: "line\nbreak" }],
      ),
    );
    const lines = csv.trimEnd().split("\r\n");
    // The header field with a comma is quoted.
    expect(lines[0]).toBe('#,"Label, with comma"');
    // Embedded quotes are doubled.
    expect(csv).toContain('"has ""quote"""');
    // A field with a newline is quoted (so it round-trips as one field).
    expect(csv).toContain('"line\nbreak"');
  });
});
