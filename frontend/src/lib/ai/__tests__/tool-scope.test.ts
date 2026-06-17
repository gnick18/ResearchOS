import { describe, it, expect, afterEach } from "vitest";
import { setToolScope, getActiveTools } from "../tool-scope";
import { DEFAULT_TOOLS } from "../tools/registry";
import type { AiTool } from "../tools/types";

describe("tool scope", () => {
  afterEach(() => setToolScope(null));

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
});
