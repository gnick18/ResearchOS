// Unit tests for transform-table.ts (ai transform-tool bot, 2026-06-11).
//
// Covers.
//   1. parseTransformTableArgs - argument coercion and fallbacks.
//   2. describeTransformTable - payload shape + real engine preview.
//   3. execute - correct DerivedFrom, runTransform snapshot passed to createTable,
//      navigation after create, error cases.
//   4. Agent-loop integration - transform approval raised and allow/skip resolve.
//
// Runs in the "node" environment (no jsdom). The injectable deps seam means no
// real folder or Loro store is needed.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTransform } from "@/lib/datahub/transforms";
import {
  parseTransformTableArgs,
  describeTransformTable,
  transformTableTool,
  transformTableDeps,
} from "./transform-table";
import {
  cacheTableContent,
  _clearDataHubAnalysisCache,
} from "./datahub-analysis";
import type { DataHubDocContent, DataHubDocument } from "@/lib/datahub/model/types";
import type { ApprovalRequest, ApprovalDecision } from "./types";
import { runAgentLoop } from "@/lib/ai/agent-loop";
import type { LoopMessage, ModelResponse, ToolCall } from "@/lib/ai/agent-loop";

// ---------------------------------------------------------------------------
// Fixture content: a minimal 2-column 3-row Column table.
// ---------------------------------------------------------------------------

const FIXTURE_CONTENT: DataHubDocContent = {
  meta: {
    id: "t1",
    name: "Growth data",
    project_ids: [],
    folder_path: null,
    table_type: "column",
    created_at: "2026-06-11T00:00:00.000Z",
  },
  columns: [
    { id: "c_control", name: "Control", role: "y", dataType: "number" },
    { id: "c_drug", name: "Drug", role: "y", dataType: "number" },
  ],
  rows: [
    { id: "r1", cells: { c_control: 100, c_drug: 200 } },
    { id: "r2", cells: { c_control: 400, c_drug: 800 } },
    { id: "r3", cells: { c_control: 1000, c_drug: 2000 } },
  ],
  analyses: [],
  plots: [],
};

const FIXTURE_DOC: DataHubDocument = { ...FIXTURE_CONTENT.meta };

// ---------------------------------------------------------------------------
// 1. parseTransformTableArgs
// ---------------------------------------------------------------------------

describe("parseTransformTableArgs", () => {
  it("parses a full valid args object", () => {
    const parsed = parseTransformTableArgs({
      tableId: "t1",
      transform: "normalize",
      params: { mode: "max" },
      resultName: "Growth data (normalized)",
    });
    expect(parsed.tableId).toBe("t1");
    expect(parsed.transform).toBe("normalize");
    expect(parsed.params).toEqual({ mode: "max" });
    expect(parsed.resultName).toBe("Growth data (normalized)");
  });

  it("falls back to empty tableId and 'transform' kind when args are missing", () => {
    const parsed = parseTransformTableArgs({});
    expect(parsed.tableId).toBe("");
    expect(parsed.transform).toBe("transform");
    expect(parsed.params).toEqual({});
    expect(parsed.resultName).toBeUndefined();
  });

  it("ignores non-object params", () => {
    const parsed = parseTransformTableArgs({
      tableId: "t1",
      transform: "transpose",
      params: "bad",
    });
    expect(parsed.params).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 2. describeTransformTable
// ---------------------------------------------------------------------------

describe("describeTransformTable", () => {
  beforeEach(() => {
    _clearDataHubAnalysisCache();
  });

  it("returns a plain summary when the table is not cached", () => {
    const result = describeTransformTable({
      tableId: "t1",
      transform: "normalize",
      params: { mode: "max" },
    });
    expect(result.summary).toContain("Normalize");
    expect(result.transformPayload).toBeUndefined();
  });

  it("returns a transform payload with a real preview when the table is cached", () => {
    cacheTableContent("t1", FIXTURE_CONTENT);
    const result = describeTransformTable({
      tableId: "t1",
      transform: "normalize",
      params: { mode: "max" },
    });
    expect(result.transformPayload).toBeDefined();
    const payload = result.transformPayload!;
    expect(payload.kind).toBe("transform");
    expect(payload.sourceName).toBe("Growth data");
    expect(payload.resultName).toBe("Growth data (normalized)");
    expect(payload.steps).toHaveLength(1);

    const step = payload.steps[0];
    expect(step.kind).toBe("normalize");
    expect(step.name).toBe("Normalize");
    expect(step.blurb).toContain("column");
    expect(step.params.some((p) => p.label === "baseline")).toBe(true);

    // Preview must be the real engine result, not fabricated.
    expect(step.preview).toBeDefined();
    expect(step.preview!.columns).toEqual(["Control", "Drug"]);
    // Control row 1: 100, max = 1000 -> 10%. Engine computes this.
    expect(step.preview!.rows[0][0]).toBe("10");
  });

  it("uses the custom resultName when provided", () => {
    cacheTableContent("t1", FIXTURE_CONTENT);
    const result = describeTransformTable({
      tableId: "t1",
      transform: "normalize",
      params: { mode: "max" },
      resultName: "My custom name",
    });
    expect(result.transformPayload!.resultName).toBe("My custom name");
  });

  it("produces correct param pills for transform/linear", () => {
    cacheTableContent("t1", FIXTURE_CONTENT);
    const result = describeTransformTable({
      tableId: "t1",
      transform: "transform",
      params: { func: "linear", k: 2, b: 5 },
    });
    const pills = result.transformPayload!.steps[0].params;
    expect(pills.find((p) => p.label === "function")?.value).toBe("Linear");
    expect(pills.find((p) => p.label === "k")?.value).toBe("2");
    expect(pills.find((p) => p.label === "b")?.value).toBe("5");
  });

  it("still returns a payload when the engine preview has valid params (fractionOfTotal defaults)", () => {
    cacheTableContent("t1", FIXTURE_CONTENT);
    const result = describeTransformTable({
      tableId: "t1",
      transform: "fractionOfTotal",
      params: {},
    });
    expect(result.transformPayload).toBeDefined();
    expect(result.transformPayload!.steps[0].kind).toBe("fractionOfTotal");
  });
});

// ---------------------------------------------------------------------------
// 3. execute: creates the derived table with the correct DerivedFrom and snapshot
// ---------------------------------------------------------------------------

describe("transformTableTool.execute", () => {
  const navigate = vi.fn();
  const createTable = vi.fn().mockResolvedValue(FIXTURE_DOC);
  const getContent = vi.fn().mockResolvedValue(FIXTURE_CONTENT);

  beforeEach(() => {
    vi.clearAllMocks();
    _clearDataHubAnalysisCache();
    // Inject stubs into the exported mutable deps object (same pattern as
    // chemistry-tools.test.ts which stubs chemToolsDeps fields).
    transformTableDeps.getContent = getContent;
    transformTableDeps.createTable = createTable;
    transformTableDeps.navigate = navigate;
  });

  it("calls createTable with the correct DerivedFrom and runTransform snapshot", async () => {
    const args = {
      tableId: "t1",
      transform: "normalize",
      params: { mode: "max" },
    };
    const result = await transformTableTool.execute(args);
    expect(result).toMatchObject({ ok: true, tableId: "t1" });

    // createTable must have been called with derivedFrom linking back to source.
    const createCall = createTable.mock.calls[0][0];
    expect(createCall.derivedFrom).toEqual({
      sourceTableId: "t1",
      transform: "normalize",
      params: { mode: "max" },
    });

    // The columns and rows must be the engine's output, not the source raw values.
    const engineResult = runTransform("normalize", FIXTURE_CONTENT, { mode: "max" });
    expect(createCall.columns).toEqual(engineResult.columns);
    expect(createCall.rows).toEqual(engineResult.rows);

    // Navigates to the new table after create.
    expect(navigate).toHaveBeenCalledWith(`/datahub?doc=${FIXTURE_DOC.id}`);
  });

  it("returns ok:false when no tableId given", async () => {
    const result = await transformTableTool.execute({
      transform: "normalize",
      params: {},
    });
    expect(result).toMatchObject({ ok: false });
    expect(createTable).not.toHaveBeenCalled();
  });

  it("returns ok:false when getContent returns null", async () => {
    transformTableDeps.getContent = vi.fn().mockResolvedValue(null);
    const result = await transformTableTool.execute({
      tableId: "t99",
      transform: "normalize",
      params: {},
    });
    expect(result).toMatchObject({ ok: false });
    expect(createTable).not.toHaveBeenCalled();
  });

  it("uses resultName when provided", async () => {
    await transformTableTool.execute({
      tableId: "t1",
      transform: "normalize",
      params: { mode: "max" },
      resultName: "Custom name",
    });
    const createCall = createTable.mock.calls[0][0];
    expect(createCall.name).toBe("Custom name");
  });

  it("defaults name to '<source> (<suffix>)' when resultName absent", async () => {
    await transformTableTool.execute({
      tableId: "t1",
      transform: "normalize",
      params: { mode: "max" },
    });
    const createCall = createTable.mock.calls[0][0];
    expect(createCall.name).toBe("Growth data (normalized)");
  });
});

// ---------------------------------------------------------------------------
// 4. Agent loop integration: transform approval resolves correctly
// ---------------------------------------------------------------------------

describe("agent loop: transform approval gate", () => {
  const navigate = vi.fn();
  const createTable = vi.fn().mockResolvedValue(FIXTURE_DOC);
  const getContent = vi.fn().mockResolvedValue(FIXTURE_CONTENT);

  beforeEach(() => {
    vi.clearAllMocks();
    _clearDataHubAnalysisCache();
    cacheTableContent("t1", FIXTURE_CONTENT);
    transformTableDeps.getContent = getContent;
    transformTableDeps.createTable = createTable;
    transformTableDeps.navigate = navigate;
  });

  // Build a model caller that emits one transform_table tool_call on turn 1,
  // then a final answer on turn 2.
  function makeModelCaller(transform: string, params: Record<string, unknown>) {
    let turn = 0;
    return async (_messages: LoopMessage[]): Promise<ModelResponse> => {
      turn += 1;
      if (turn === 1) {
        const call: ToolCall = {
          id: "call1",
          type: "function",
          function: {
            name: "transform_table",
            arguments: JSON.stringify({ tableId: "t1", transform, params }),
          },
        };
        return {
          choices: [{ message: { role: "assistant", content: null, tool_calls: [call] } }],
        };
      }
      return { choices: [{ message: { role: "assistant", content: "Done." } }] };
    };
  }

  it("raises a kind:transform approval and proceeds on allow", async () => {
    const capturedRequests: ApprovalRequest[] = [];
    const requestApproval = async (req: ApprovalRequest): Promise<ApprovalDecision> => {
      capturedRequests.push(req);
      return "allow";
    };

    const result = await runAgentLoop({
      messages: [{ role: "user", content: "normalize my growth table" }],
      tools: [transformTableTool],
      callModel: makeModelCaller("normalize", { mode: "max" }),
      requestApproval,
      getAutonomy: () => "ask",
    });

    // The loop raised a transform approval (kind:"transform").
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].kind).toBe("transform");
    const req = capturedRequests[0] as Extract<ApprovalRequest, { kind: "transform" }>;
    expect(req.sourceName).toBe("Growth data");
    expect(req.steps).toHaveLength(1);
    expect(req.steps[0].name).toBe("Normalize");
    // The preview is the real engine output, not fabricated.
    expect(req.steps[0].preview).toBeDefined();

    // On allow the execute ran and the table was created.
    expect(createTable).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(`/datahub?doc=${FIXTURE_DOC.id}`);
    expect(result.answer).toBe("Done.");
  });

  it("does NOT create the table when the user rejects", async () => {
    const requestApproval = async (_req: ApprovalRequest): Promise<ApprovalDecision> => "skip";

    const result = await runAgentLoop({
      messages: [{ role: "user", content: "normalize my growth table" }],
      tools: [transformTableTool],
      callModel: makeModelCaller("normalize", { mode: "max" }),
      requestApproval,
      getAutonomy: () => "ask",
    });

    expect(createTable).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // The model still produces a final answer.
    expect(result.answer).toBe("Done.");
  });

  it("proceeds without asking in auto mode (non-destructive)", async () => {
    // No requestApproval wired; autonomy is "auto". The gate should not block.
    const result = await runAgentLoop({
      messages: [{ role: "user", content: "normalize my growth table" }],
      tools: [transformTableTool],
      callModel: makeModelCaller("normalize", { mode: "max" }),
      getAutonomy: () => "auto",
    });

    expect(createTable).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalled();
    expect(result.answer).toBe("Done.");
  });
});
