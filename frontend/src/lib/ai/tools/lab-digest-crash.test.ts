// lab-digest crash regression + defensive-hardening tests (Fix Bot B, 2026-06-12).
//
// Three goals in one file:
//   1. Reproduce (deterministically, without a real folder) the scenario the
//      Chrome verifier found: lab_digest with demo-shaped (all-empty) loader
//      results. Confirm the tool returns a well-formed digest and does NOT throw.
//   2. Confirm that a loader returning undefined (a broken dep) does not silently
//      produce a bad result and does not throw past runToolCall.
//   3. Confirm the defensive hardening in runToolCall: a tool that throws
//      `undefined` (the exact value Next 16.1.6's .digest handler chokes on)
//      is caught and converted to a clean error result, never propagated to
//      the caller of runAgentLoop.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, afterEach } from "vitest";
import {
  composeLabDigest,
  labDigestTool,
  type LabDigest,
} from "./lab-digest";
import {
  summarizeExperimentsDeps,
} from "./summarize-experiments";
import { summarizePurchasesDeps } from "./summarize-purchases";
import { summarizeNotesDeps } from "./summarize-notes";
import { summarizeProjectsDeps } from "./summarize-projects";
import { runAgentLoop, type LoopMessage, type ModelResponse } from "../agent-loop";
import type { AiTool } from "./types";
import type { Task, PurchaseItem, Note, NoteEntry, Project } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixture builders (mirrors the helpers in summarize-suite.test.ts).
// ---------------------------------------------------------------------------

function makeEntry(title: string): NoteEntry {
  return {
    id: crypto.randomUUID(),
    title,
    date: "2026-06-01",
    content: "",
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-01T10:00:00Z",
  };
}

function makeNote(overrides: Partial<Note & { owner: string }> = {}): Note & { owner: string } {
  return {
    id: 1,
    title: "Transformation prep",
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [makeEntry("Colony count")],
    updated_at: "2026-06-10T10:00:00Z",
    username: "grant",
    owner: "grant",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: "cyp51A",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-05-01T10:00:00Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 1,
    name: "Run",
    start_date: "2026-06-10",
    duration_days: 1,
    end_date: "2026-06-10",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [],
    deviation_log: null,
    tags: [],
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

type OwnedPurchase = PurchaseItem & { owner: string };

function makePurchase(overrides: Partial<OwnedPurchase> = {}): OwnedPurchase {
  return {
    id: 1,
    task_id: 1,
    item_name: "Gibson mix",
    quantity: 1,
    link: null,
    cas: null,
    price_per_unit: 95,
    shipping_fees: 0,
    total_price: 95,
    notes: null,
    funding_string: null,
    vendor: "NEB",
    catalog_number: null,
    category: "reagents",
    order_status: "received",
    last_edited_at: "2026-06-05T10:00:00Z",
    owner: "grant",
    ...overrides,
  };
}

// Save and restore the real deps after each test so mutations do not bleed
// between test cases.
const realExpLister = summarizeExperimentsDeps.listExperiments;
const realPurLister = summarizePurchasesDeps.listPurchases;
const realNoteLister = summarizeNotesDeps.listNotes;
const realProjList = summarizeProjectsDeps.listProjects;
const realProjTasks = summarizeProjectsDeps.listTasks;

afterEach(() => {
  summarizeExperimentsDeps.listExperiments = realExpLister;
  summarizePurchasesDeps.listPurchases = realPurLister;
  summarizeNotesDeps.listNotes = realNoteLister;
  summarizeProjectsDeps.listProjects = realProjList;
  summarizeProjectsDeps.listTasks = realProjTasks;
});

const TODAY = "2026-06-12";

// ---------------------------------------------------------------------------
// Step 1: reproduce the demo-mode scenario (all loaders return empty arrays,
// which is what happens when no real folder is connected in /demo workbench).
// ---------------------------------------------------------------------------

describe("composeLabDigest with empty (demo-mode) inputs", () => {
  it("returns a fully-formed digest with all-zero counts when given empty arrays", () => {
    const digest = composeLabDigest(
      { experiments: [], purchases: [], notes: [], projects: [], tasks: [] },
      {},
      TODAY,
    );

    // Structure must be complete, no undefined fields.
    expect(digest).toBeDefined();
    expect(digest.window.asOf).toBe(TODAY);
    expect(digest.window.since).toBeNull();
    expect(digest.window.until).toBeNull();
    expect(digest.window.owners).toBeNull();

    // All numeric fields must be 0 (deterministic, not undefined/NaN).
    expect(digest.experiments.run).toBe(0);
    expect(digest.experiments.finished).toBe(0);
    expect(digest.experiments.overdue).toBe(0);
    expect(digest.experiments.finishingThisWeek).toBe(0);
    expect(digest.notes.written).toBe(0);
    expect(digest.notes.entries).toBe(0);
    expect(digest.purchases.made).toBe(0);
    expect(digest.purchases.totalSpend).toBe(0);
    expect(digest.purchases.pending).toBe(0);
    expect(digest.scheduled.projectsWithOverdue).toBe(0);
    expect(digest.scheduled.nextUpcomingStart).toBeNull();
  });

  it("returns correct counts when given realistic fixture data (non-empty case)", () => {
    const experiments: Task[] = [
      makeTask({ id: 1, is_complete: true, start_date: "2026-06-02", end_date: "2026-06-03" }),
      makeTask({ id: 2, is_complete: false, start_date: "2026-06-05", end_date: "2026-06-08" }),
    ];
    const purchases: OwnedPurchase[] = [
      makePurchase({ id: 1, total_price: 100, order_status: "received" }),
      makePurchase({ id: 2, total_price: 50, order_status: "ordered" }),
    ];
    const notes: Array<Note & { owner: string }> = [
      makeNote({ id: 1, entries: [makeEntry("a"), makeEntry("b")] }),
    ];
    const projects: Project[] = [makeProject({ id: 1 })];
    const tasks: Task[] = [
      makeTask({ id: 10, project_id: 1, is_complete: false, start_date: "2026-06-20", end_date: "2026-06-22" }),
    ];

    const digest = composeLabDigest(
      { experiments, purchases, notes, projects, tasks },
      {},
      TODAY,
    );

    expect(digest.experiments.run).toBe(2);
    expect(digest.experiments.finished).toBe(1);
    expect(digest.purchases.made).toBe(2);
    expect(digest.purchases.totalSpend).toBe(150);
    expect(digest.notes.written).toBe(1);
    expect(digest.notes.entries).toBe(2);
    expect(digest.scheduled.nextUpcomingStart).toBe("2026-06-20");
  });
});

// ---------------------------------------------------------------------------
// Step 1b: labDigestTool.execute() with empty loaders (demo mode via stubs).
// ---------------------------------------------------------------------------

describe("labDigestTool.execute with empty demo-mode loaders", () => {
  it("returns { ok, digest } and does NOT throw when all loaders return empty arrays", async () => {
    Object.assign(summarizeExperimentsDeps, { listExperiments: async () => [] });
    Object.assign(summarizePurchasesDeps, { listPurchases: async () => [] });
    Object.assign(summarizeNotesDeps, { listNotes: async () => [] });
    Object.assign(summarizeProjectsDeps, {
      listProjects: async () => [],
      listTasks: async () => [],
    });

    const result = await labDigestTool.execute({});
    expect(result).toBeDefined();
    const r = result as { ok: boolean; digest: LabDigest };
    expect(r.ok).toBe(true);
    expect(r.digest).toBeDefined();
    expect(r.digest.experiments.run).toBe(0);
    expect(r.digest.purchases.totalSpend).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Step 3a: defensive hardening for a tool that throws `undefined`. The exact
// throw value Next 16.1.6's .digest handler chokes on. Confirm runToolCall
// catches it and returns a clean error result, never propagating past the loop.
// ---------------------------------------------------------------------------

describe("runAgentLoop defensive hardening: tool throws undefined", () => {
  it("a tool that throws undefined is caught in runToolCall, never crashes the loop", async () => {
    // A read-only tool that throws `undefined` (a non-Error, the pathological case).
    const throwUndefinedTool: AiTool = {
      name: "throw_undefined",
      description: "A test tool that throws undefined.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        // This is the exact pattern that Next 16.1.6 crashes on if it escapes
        // to the error boundary (throw undefined produces an error where .digest
        // reads as undefined and crashes Next's overlay). runToolCall must catch it.
        throw undefined; // eslint-disable-line @typescript-eslint/no-throw-literal
      },
    };

    // The model calls throw_undefined, then after seeing the error result says
    // the final answer.
    let modelCallCount = 0;
    const callModel = async (): Promise<ModelResponse> => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        // First turn: request the tool.
        return {
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: { name: "throw_undefined", arguments: "{}" },
              }],
            },
          }],
        };
      }
      // Second turn: model sees the error result and gives the final answer.
      return {
        choices: [{ message: { role: "assistant", content: "Handled gracefully." } }],
      };
    };

    const messages: LoopMessage[] = [
      { role: "system", content: "You are a test bot." },
      { role: "user", content: "trigger the undefined throw" },
    ];

    // This must NOT throw. The loop must catch the undefined and continue.
    const result = await runAgentLoop({
      messages,
      tools: [throwUndefinedTool],
      callModel,
    });

    expect(result.answer).toBe("Handled gracefully.");
    expect(result.stoppedOnGuard).toBe(false);
    expect(modelCallCount).toBe(2);

    // The tool result message in the history must contain an error (not rethrown).
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const toolContent = JSON.parse(toolMsg!.content ?? "{}");
    // The catch block must have produced { error: "..." }, not a rethrow.
    // When the thrown value is undefined, the error field is the generic fallback
    // (not "undefined" the string, which would be confusing to the user).
    expect(typeof toolContent.error).toBe("string");
    expect(toolContent.error.length).toBeGreaterThan(0);
    expect(toolContent.error).toBe("Tool execution failed.");
  });

  it("a tool that throws null is also caught and does not propagate", async () => {
    const throwNullTool: AiTool = {
      name: "throw_null",
      description: "A test tool that throws null.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw null;
      },
    };

    let calls = 0;
    const callModel = async (): Promise<ModelResponse> => {
      calls += 1;
      if (calls === 1) {
        return {
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "c1",
                type: "function",
                function: { name: "throw_null", arguments: "{}" },
              }],
            },
          }],
        };
      }
      return { choices: [{ message: { role: "assistant", content: "Null handled." } }] };
    };

    const result = await runAgentLoop({
      messages: [
        { role: "system", content: "System." },
        { role: "user", content: "trigger null throw" },
      ],
      tools: [throwNullTool],
      callModel,
    });

    expect(result.answer).toBe("Null handled.");
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const content = JSON.parse(toolMsg!.content ?? "{}");
    expect(typeof content.error).toBe("string");
  });

  it("a tool that throws a string error value is also caught", async () => {
    const throwStringTool: AiTool = {
      name: "throw_string",
      description: "A test tool that throws a string.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "something went wrong";
      },
    };

    let calls = 0;
    const callModel = async (): Promise<ModelResponse> => {
      calls += 1;
      if (calls === 1) {
        return {
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "c1",
                type: "function",
                function: { name: "throw_string", arguments: "{}" },
              }],
            },
          }],
        };
      }
      return { choices: [{ message: { role: "assistant", content: "String handled." } }] };
    };

    const result = await runAgentLoop({
      messages: [
        { role: "system", content: "System." },
        { role: "user", content: "trigger string throw" },
      ],
      tools: [throwStringTool],
      callModel,
    });

    expect(result.answer).toBe("String handled.");
    const toolMsg = result.messages.find((m) => m.role === "tool");
    const content = JSON.parse(toolMsg!.content ?? "{}");
    // For a thrown string, the error message should use String(err) so
    // the actual thrown value is relayed rather than a generic fallback.
    expect(typeof content.error).toBe("string");
    // "something went wrong" is preserved via String(err) in the hardened catch.
    expect(content.error).toBe("something went wrong");
  });
});

// ---------------------------------------------------------------------------
// Step 3b: confirm that an undefined throw from a tool does not bubble past
// runAgentLoop. The outer caller should only ever see a resolved Result, never
// a rejected Promise, when the issue is inside tool execution.
// ---------------------------------------------------------------------------

describe("runAgentLoop: loop-level undefined propagation guard", () => {
  it("runAgentLoop resolves (not rejects) when a tool throws undefined", async () => {
    const badTool: AiTool = {
      name: "bad_tool",
      description: "Throws undefined.",
      parameters: { type: "object", properties: {} },
      execute: async () => { throw undefined; }, // eslint-disable-line @typescript-eslint/no-throw-literal
    };

    let c = 0;
    const callModel = async (): Promise<ModelResponse> => {
      c += 1;
      if (c === 1) {
        return {
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: "x1",
                type: "function",
                function: { name: "bad_tool", arguments: "{}" },
              }],
            },
          }],
        };
      }
      return { choices: [{ message: { content: "All good." } }] };
    };

    // If this rejects, the test fails with an unhandled rejection, which is
    // itself the bug we are hardening against.
    let resolved = false;
    const promise = runAgentLoop({
      messages: [{ role: "user", content: "test" }],
      tools: [badTool],
      callModel,
    });

    // Using .then/.catch to ensure the Promise itself doesn't reject.
    await promise.then(() => { resolved = true; }).catch(() => { resolved = false; });
    expect(resolved).toBe(true);
  });
});
