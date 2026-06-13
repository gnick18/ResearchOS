// BeakerBot macro runner tests (BeakerAI lane, 2026-06-13).
//
// Pins the deterministic replay contract and, most importantly, the safety
// carve-out, a destructive step STILL self-confirms mid-run even though the macro
// was approved as a whole. Routine steps replay without re-asking, a declined
// destructive step is skipped (the run continues), a dangling tool is skipped, a
// throwing step fails and STOPS the run, a disabled step never runs, and an abort
// stops cleanly.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import {
  runMacro,
  summarizeMacroRun,
  invocationsFromHistory,
  type MacroStepEvent,
} from "../macro-runner";
import type { LoopMessage } from "../agent-loop";
import type { AiTool } from "../tools/types";
import type { MacroStep } from "../beaker-macros-store";

// A minimal fake tool. Read-only by default, opt into action/destructive/throw.
function makeTool(
  name: string,
  opts: {
    action?: boolean;
    destructive?: boolean;
    throws?: boolean;
    record?: (args: Record<string, unknown>) => void;
  } = {},
): AiTool {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {}, additionalProperties: true },
    action: opts.action,
    isDestructive: opts.destructive ? () => true : undefined,
    execute: async (args) => {
      opts.record?.(args);
      if (opts.throws) throw new Error(`${name} blew up`);
      return { ok: true, from: name };
    },
  };
}

const step = (tool: string, args: Record<string, unknown> = {}, enabled?: boolean): MacroStep => ({
  tool,
  args,
  label: tool,
  ...(enabled === undefined ? {} : { enabled }),
});

describe("runMacro routine replay", () => {
  it("runs every step in order with its recorded args, no approval asked", async () => {
    const seen: Record<string, unknown>[] = [];
    const tools = [
      makeTool("lab_digest", { action: true, record: (a) => seen.push(a) }),
      makeTool("write_note", { action: true, record: (a) => seen.push(a) }),
    ];
    const requestApproval = vi.fn();

    const res = await runMacro({
      macro: { name: "rollup", steps: [step("lab_digest", { range: "this week" }), step("write_note", { title: "Summary" })] },
      tools,
      requestApproval,
    });

    expect(res.completed).toBe(true);
    expect(res.failedAt).toBeNull();
    expect(seen).toEqual([{ range: "this week" }, { title: "Summary" }]);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(res.outcomes.map((o) => o.status)).toEqual(["done", "done"]);
  });

  it("emits a running event before each terminal event", async () => {
    const events: MacroStepEvent[] = [];
    await runMacro({
      macro: { name: "m", steps: [step("a", {}, undefined)] },
      tools: [makeTool("a", { action: true })],
      onStep: (e) => events.push(e),
    });
    expect(events.map((e) => e.status)).toEqual(["running", "done"]);
  });
});

describe("runMacro destructive self-confirm (the safety carve-out)", () => {
  it("raises a confirm for a destructive step even inside an approved macro, and runs it on allow", async () => {
    const ran = vi.fn();
    const requestApproval = vi.fn().mockResolvedValue("allow");
    const res = await runMacro({
      macro: { name: "m", steps: [step("send_digest", { to: "lab" })] },
      tools: [makeTool("send_digest", { action: true, destructive: true, record: ran })],
      requestApproval,
    });
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(ran).toHaveBeenCalledOnce();
    expect(res.completed).toBe(true);
  });

  it("skips a declined destructive step and CONTINUES the run", async () => {
    const sent = vi.fn();
    const noted = vi.fn();
    const requestApproval = vi.fn().mockResolvedValue("skip");
    const res = await runMacro({
      macro: {
        name: "m",
        steps: [step("send_digest", { to: "lab" }), step("write_note", { title: "n" })],
      },
      tools: [
        makeTool("send_digest", { action: true, destructive: true, record: sent }),
        makeTool("write_note", { action: true, record: noted }),
      ],
      requestApproval,
    });
    expect(sent).not.toHaveBeenCalled();
    expect(noted).toHaveBeenCalledOnce();
    expect(res.outcomes.map((o) => o.status)).toEqual(["skipped", "done"]);
    expect(res.completed).toBe(true);
  });

  it("skips a destructive step when no approval bridge is available", async () => {
    const sent = vi.fn();
    const res = await runMacro({
      macro: { name: "m", steps: [step("send_digest")] },
      tools: [makeTool("send_digest", { action: true, destructive: true, record: sent })],
      // no requestApproval
    });
    expect(sent).not.toHaveBeenCalled();
    expect(res.outcomes[0].status).toBe("skipped");
  });
});

describe("runMacro dangling / failed / disabled / abort", () => {
  it("skips a step whose tool is no longer registered and continues", async () => {
    const noted = vi.fn();
    const res = await runMacro({
      macro: { name: "m", steps: [step("old_tool"), step("write_note")] },
      tools: [makeTool("write_note", { action: true, record: noted })],
    });
    expect(res.outcomes.map((o) => o.status)).toEqual(["skipped-dangling", "done"]);
    expect(noted).toHaveBeenCalledOnce();
    expect(res.completed).toBe(true);
  });

  it("fails and STOPS the run when a step throws, later steps do not run", async () => {
    const later = vi.fn();
    const res = await runMacro({
      macro: { name: "m", steps: [step("boom"), step("after")] },
      tools: [
        makeTool("boom", { action: true, throws: true }),
        makeTool("after", { action: true, record: later }),
      ],
    });
    expect(res.failedAt).toBe(0);
    expect(res.completed).toBe(false);
    expect(later).not.toHaveBeenCalled();
    expect(res.outcomes.map((o) => o.status)).toEqual(["failed"]);
    expect(res.outcomes[0].error).toContain("boom blew up");
  });

  it("never runs a disabled step and emits no event for it", async () => {
    const off = vi.fn();
    const on = vi.fn();
    const events: MacroStepEvent[] = [];
    const res = await runMacro({
      macro: { name: "m", steps: [step("off", {}, false), step("on", {}, true)] },
      tools: [
        makeTool("off", { action: true, record: off }),
        makeTool("on", { action: true, record: on }),
      ],
      onStep: (e) => events.push(e),
    });
    expect(off).not.toHaveBeenCalled();
    expect(on).toHaveBeenCalledOnce();
    expect(events.every((e) => e.step.tool === "on")).toBe(true);
    expect(res.completed).toBe(true);
  });

  it("stops cleanly when the signal is already aborted", async () => {
    const ran = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const res = await runMacro({
      macro: { name: "m", steps: [step("a")] },
      tools: [makeTool("a", { action: true, record: ran })],
      signal: controller.signal,
    });
    expect(ran).not.toHaveBeenCalled();
    expect(res.aborted).toBe(true);
    expect(res.completed).toBe(false);
  });
});

describe("summarizeMacroRun", () => {
  it("reports a clean run with the done count", async () => {
    const res = await runMacro({
      macro: { name: "rollup", steps: [step("a"), step("b")] },
      tools: [makeTool("a", { action: true }), makeTool("b", { action: true })],
    });
    expect(summarizeMacroRun("rollup", res)).toBe("Ran /rollup. 2 steps done.");
  });

  it("notes skipped steps and singular wording", async () => {
    const res = await runMacro({
      macro: { name: "m", steps: [step("known"), step("gone")] },
      tools: [makeTool("known", { action: true })],
    });
    expect(summarizeMacroRun("m", res)).toBe("Ran /m. 1 step done, 1 skipped.");
  });

  it("reports a failed step with its label, reason, and the count that ran before", async () => {
    const res = await runMacro({
      macro: { name: "m", steps: [step("ok"), step("boom"), step("after")] },
      tools: [
        makeTool("ok", { action: true }),
        makeTool("boom", { action: true, throws: true }),
        makeTool("after", { action: true }),
      ],
    });
    const msg = summarizeMacroRun("m", res);
    expect(msg).toContain('stopped at "boom"');
    expect(msg).toContain("boom blew up");
    expect(msg).toContain("1 step ran before it");
  });

  it("reports an aborted run", async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await runMacro({
      macro: { name: "m", steps: [step("a")] },
      tools: [makeTool("a", { action: true })],
      signal: controller.signal,
    });
    expect(summarizeMacroRun("m", res)).toBe(
      "Stopped /m early. 0 steps ran before you stopped it.",
    );
  });
});

describe("invocationsFromHistory (capture for Save as macro)", () => {
  const label = (tool: string) => `do ${tool}`;

  it("captures assistant tool_calls after the last user turn, with parsed args", () => {
    const history: LoopMessage[] = [
      { role: "system", content: "prompt" },
      { role: "user", content: "first ask" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: { name: "old_digest", arguments: "{}" },
          },
        ],
      },
      { role: "user", content: "the run we save" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "2",
            type: "function",
            function: {
              name: "lab_digest",
              arguments: '{"range":"this week"}',
            },
          },
        ],
      },
      { role: "tool", content: "ok", tool_call_id: "2" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "3",
            type: "function",
            function: { name: "write_note", arguments: '{"title":"S"}' },
          },
        ],
      },
      { role: "assistant", content: "done" },
    ];
    const invs = invocationsFromHistory(history, label);
    expect(invs).toEqual([
      { tool: "lab_digest", args: { range: "this week" }, label: "do lab_digest" },
      { tool: "write_note", args: { title: "S" }, label: "do write_note" },
    ]);
  });

  it("captures a tool_call with unparseable args as empty args, never dropping it", () => {
    const history: LoopMessage[] = [
      { role: "user", content: "ask" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "1", type: "function", function: { name: "t", arguments: "{bad" } },
        ],
      },
    ];
    expect(invocationsFromHistory(history, label)).toEqual([
      { tool: "t", args: {}, label: "do t" },
    ]);
  });

  it("returns nothing when the last turn called no tools", () => {
    const history: LoopMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(invocationsFromHistory(history, label)).toEqual([]);
  });
});
