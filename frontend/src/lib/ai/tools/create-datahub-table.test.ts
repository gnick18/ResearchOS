import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDatahubTableTool,
  createDatahubTableDeps,
} from "./create-datahub-table";
import type { DataHubCreate, DataHubDocument } from "@/lib/datahub/model/types";

// The parser (importTextToTable) runs for real; only the write + nav are injected.
const original = { ...createDatahubTableDeps };
const createMock = vi.fn(
  async (d: DataHubCreate): Promise<DataHubDocument> =>
    ({ id: "doc-9", name: d.name, project_ids: d.project_ids ?? [] }) as DataHubDocument,
);
const navMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(createDatahubTableDeps, {
    createTable: createMock,
    navigate: navMock,
  });
});
afterEach(() => {
  Object.assign(createDatahubTableDeps, original);
});

const CSV = "strain_id,MIC,phenotype\nA,1.2,resistant\nB,0.5,susceptible";
const TSV = "strain_id\tMIC\nA\t1.2\nB\t0.5";

describe("create_datahub_table", () => {
  it("describeAction previews the detected columns + row count (gated)", () => {
    expect(createDatahubTableTool.action).toBe(true);
    expect(createDatahubTableTool.isDestructive?.({})).toBe(false);
    const req = createDatahubTableTool.describeAction?.({ data: CSV, name: "Assay" });
    expect(req?.summary).toMatch(/Assay/);
    expect(req?.summary).toMatch(/3 columns/);
    expect(req?.summary).toMatch(/2 rows/);
    expect(req?.summary).toMatch(/strain_id/);
  });

  it("parses CSV verbatim and creates a column table, then navigates + embeds", async () => {
    const res = (await createDatahubTableTool.execute({ data: CSV, name: "Assay" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
    const payload = createMock.mock.calls[0][0];
    expect(payload.table_type).toBe("column");
    expect(payload.columns?.length).toBe(3);
    expect(payload.rows?.length).toBe(2);
    expect(res.id).toBe("doc-9");
    expect(res.rowCount).toBe(2);
    expect(res.embed).toBe("[Assay](/datahub?doc=doc-9#ros=table)");
    expect(navMock).toHaveBeenCalledWith("/datahub?doc=doc-9");
  });

  it("auto-detects a TSV delimiter too", async () => {
    const res = (await createDatahubTableTool.execute({ data: TSV })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    const payload = createMock.mock.calls[0][0];
    expect(payload.columns?.length).toBe(2);
    expect(payload.rows?.length).toBe(2);
  });

  it("files under a project when projectId is given", async () => {
    await createDatahubTableTool.execute({ data: CSV, name: "Assay", projectId: "proj1" });
    expect(createMock.mock.calls[0][0].project_ids).toEqual(["proj1"]);
  });

  it("fails on empty / whitespace-only data without creating anything", async () => {
    const res = (await createDatahubTableTool.execute({ data: "   \n  \n" })) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });
});
