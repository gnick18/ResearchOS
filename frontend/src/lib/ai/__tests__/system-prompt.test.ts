import { describe, expect, it, vi } from "vitest";
import { BEAKERBOT_SYSTEM_PROMPT } from "../system-prompt";
// Hoisted to module top so the (now large) agent-loop + system-prompt module
// graph is evaluated once at load time, not lazily inside the test where its
// cost would count against the 5s per-test timeout and flake under full-suite load.
import { runAgentLoop } from "../agent-loop";
import type { LoopMessage, ModelResponse } from "../agent-loop";

// The system prompt is the only place voice and the hard data-integrity rule are
// stated, so these pins guard against silent drift, the identity, the
// orchestrates-not-computes rule, and the house-voice constraints.

describe("BEAKERBOT_SYSTEM_PROMPT", () => {
  it("establishes the BeakerBot identity inside ResearchOS", () => {
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/BeakerBot/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/ResearchOS/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/local-first/);
  });

  it("states the hard rule, never fabricate the user's data, call a tool instead", () => {
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/NEVER fabricate/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/CALL A TOOL/);
  });

  it("carries the house-voice constraints", () => {
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/em-dash/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/emoji/);
    // No literal em-dash, emoji, or mid-sentence colon list in the prompt itself.
    expect(BEAKERBOT_SYSTEM_PROMPT).not.toMatch(/—/);
  });

  it("instructs the plan-first action flow, propose the plan before acting", () => {
    // The model must propose a whole plan up front, not navigate or click first.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/propose_plan/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/do NOT navigate or click first/i);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/without asking again/i);
    // The destructive carve-out must still be stated, a destructive step confirms
    // even inside an approved plan.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/delete, send, share, pay/i);
  });

  it("instructs the Data Hub analysis flow, list tables then run the engine-computed test", () => {
    // The model lists tables, picks columns, and runs the analysis, and it never
    // computes a statistic, the engine does.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/list_datahub_tables/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/run_datahub_analysis/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/engine computes every number/i);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/Never invent a statistic/i);
  });

  it("instructs the buttons-not-prose choice flow with ask_user", () => {
    // When the answer is one of a few known values, BeakerBot must call ask_user
    // so the user TAPS a button, not type the answer back in prose.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/ask_user/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/button/i);
    // The known-small-set rule and the count-for-a-subset guidance are both there.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/known, small, enumerable set/i);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/count 2/);
    // The analysis flow uses ask_user to pick groups before running. The prompt
    // names all three tools in order (list to learn names, ask to pick, then run).
    const listAt = BEAKERBOT_SYSTEM_PROMPT.indexOf("list_datahub_tables");
    const askAt = BEAKERBOT_SYSTEM_PROMPT.indexOf(
      "ask_user to let the user pick",
    );
    const runAt = BEAKERBOT_SYSTEM_PROMPT.indexOf(
      "run_datahub_analysis on the picked groups",
    );
    expect(listAt).toBeGreaterThanOrEqual(0);
    expect(askAt).toBeGreaterThan(listAt);
    expect(runAt).toBeGreaterThan(askAt);
  });

  it("includes the analysis-finder protocol with trigger, wizard questions, and free-text escape", () => {
    // The analysis finder must be present as a named section.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(
      /Helping the user choose an analysis/i,
    );
    // The trigger phrases must be covered.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/which test should I use/i);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/help me choose an analysis/i);
    // The three wizard questions must be present: goal, group count, pairing.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/Compare groups/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/Two groups/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/Same samples \(paired\)/);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/Different samples \(independent\)/);
    // The free-text escape must be present.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/FREE-TEXT escape/i);
    // The wizard must feed run_datahub_analysis, not a new tool.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(
      /run_datahub_analysis.*planner picks the exact test/,
    );
    // The coverage note must mention what is and isn't supported.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/correlation/i);
  });

  it("includes narrow-panel formatting guidance telling BeakerBot to avoid tables", () => {
    // The panel is a narrow sidebar. BeakerBot must know not to produce wide
    // markdown tables that would overflow it.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/narrow/i);
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/table/i);
    // The guidance must tell the model to avoid tables, not recommend them.
    expect(BEAKERBOT_SYSTEM_PROMPT).toMatch(/Do NOT use markdown tables/i);
  });
});

// The loop carries whatever messages it is given, including the system message,
// straight to the model caller. This pins that the system prompt, when seeded,
// reaches the model unchanged on turn 1.
describe("system prompt reaches the model", () => {
  it("is passed through as the first message to the model caller", async () => {
    const callModel = vi.fn<
      (m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>
    >(async () => ({
      choices: [{ message: { role: "assistant", content: "ok" } }],
    }));

    await runAgentLoop({
      messages: [
        { role: "system", content: BEAKERBOT_SYSTEM_PROMPT },
        { role: "user", content: "hi" },
      ],
      tools: [],
      callModel,
    });

    const sent = callModel.mock.calls[0][0];
    expect(sent[0].role).toBe("system");
    expect(sent[0].content).toBe(BEAKERBOT_SYSTEM_PROMPT);
  }, 15000);
});
