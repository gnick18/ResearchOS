import { describe, expect, it, vi } from "vitest";
import { BEAKERBOT_SYSTEM_PROMPT } from "../system-prompt";

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
    const { runAgentLoop } = await import("../agent-loop");
    type LoopMessage = import("../agent-loop").LoopMessage;
    type ModelResponse = import("../agent-loop").ModelResponse;
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
  });
});
