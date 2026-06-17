import { describe, it, expect, afterEach } from "vitest";
import {
  setToolScope,
  getActiveTools,
  setPromptScope,
  getActiveSystemPrompt,
} from "../tool-scope";
import { DEFAULT_TOOLS } from "../tools/registry";
import { BEAKERBOT_SYSTEM_PROMPT } from "../system-prompt";
import type { AiTool } from "../tools/types";

describe("tool scope", () => {
  afterEach(() => {
    setToolScope(null);
    setPromptScope(null);
  });

  it("defaults to the research-shell DEFAULT_TOOLS", () => {
    expect(getActiveTools()).toBe(DEFAULT_TOOLS);
  });

  it("returns the set scope, then restores the default on null", () => {
    const scoped: AiTool[] = [
      {
        name: "x",
        description: "",
        parameters: { type: "object", properties: {} },
        execute: async () => ({}),
      },
    ];
    setToolScope(scoped);
    expect(getActiveTools()).toBe(scoped);
    setToolScope(null);
    expect(getActiveTools()).toBe(DEFAULT_TOOLS);
  });

  it("defaults the system prompt to the research persona, then swaps and restores", () => {
    expect(getActiveSystemPrompt()).toBe(BEAKERBOT_SYSTEM_PROMPT);
    setPromptScope("You are the department admin copilot.");
    expect(getActiveSystemPrompt()).toBe("You are the department admin copilot.");
    setPromptScope(null);
    expect(getActiveSystemPrompt()).toBe(BEAKERBOT_SYSTEM_PROMPT);
  });
});
