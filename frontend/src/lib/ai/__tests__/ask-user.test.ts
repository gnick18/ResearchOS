// ask_user tool unit tests (ai ask-user bot, 2026-06-11).
//
// The pure helpers that read the model's choice arguments, plus the tool shape.
// The loop's behavior around ask_user (raising the choice request, returning the
// selection, the graceful no-choice on dismiss) is covered in
// agent-loop-ask-user.test.ts, this file pins the building blocks.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  askUserTool,
  parseAskUserArgs,
  readOptions,
  readQuestion,
  readSelect,
  readCount,
  ASK_USER_TOOL_NAME,
} from "../tools/ask-user";

describe("readQuestion", () => {
  it("returns the trimmed question", () => {
    expect(readQuestion({ question: "  Which group?  " })).toBe("Which group?");
  });
  it("returns an empty string when missing or not a string", () => {
    expect(readQuestion({})).toBe("");
    expect(readQuestion({ question: 5 })).toBe("");
  });
});

describe("readOptions", () => {
  it("keeps non-empty trimmed strings in order and drops duplicates", () => {
    expect(
      readOptions({ options: ["  Control ", "Drug", "Control", ""] }),
    ).toEqual(["Control", "Drug"]);
  });
  it("returns an empty array when options is missing or not an array", () => {
    expect(readOptions({})).toEqual([]);
    expect(readOptions({ options: "Control" })).toEqual([]);
  });
});

describe("readSelect", () => {
  it("returns 'multiple' only for the literal, else defaults to 'one'", () => {
    expect(readSelect({ select: "multiple" })).toBe("multiple");
    expect(readSelect({ select: "one" })).toBe("one");
    expect(readSelect({})).toBe("one");
    expect(readSelect({ select: "many" })).toBe("one");
  });
});

describe("readCount", () => {
  it("returns a positive integer count", () => {
    expect(readCount({ count: 2 })).toBe(2);
  });
  it("returns undefined for non-integers, zero, negatives, or missing", () => {
    expect(readCount({})).toBeUndefined();
    expect(readCount({ count: 0 })).toBeUndefined();
    expect(readCount({ count: -1 })).toBeUndefined();
    expect(readCount({ count: 1.5 })).toBeUndefined();
    expect(readCount({ count: "2" })).toBeUndefined();
  });
});

describe("parseAskUserArgs", () => {
  it("parses a single-select question with options and no count", () => {
    const parsed = parseAskUserArgs({
      question: "Which table?",
      options: ["qPCR", "Growth"],
    });
    expect(parsed).toEqual({
      question: "Which table?",
      options: ["qPCR", "Growth"],
      select: "one",
    });
    // A "one" selection never carries a count.
    expect("count" in parsed).toBe(false);
  });

  it("parses a multi-select with an exact count", () => {
    const parsed = parseAskUserArgs({
      question: "Which two groups?",
      options: ["Control", "Drug A", "Drug B"],
      select: "multiple",
      count: 2,
    });
    expect(parsed.select).toBe("multiple");
    expect(parsed.count).toBe(2);
    expect(parsed.options).toEqual(["Control", "Drug A", "Drug B"]);
  });

  it("drops a count when select is 'one'", () => {
    const parsed = parseAskUserArgs({
      question: "Yes or no?",
      options: ["Yes", "No"],
      select: "one",
      count: 2,
    });
    expect("count" in parsed).toBe(false);
  });
});

describe("askUserTool shape", () => {
  it("is named ask_user and is NOT an action tool (it is the choice gate, not an action)", () => {
    expect(askUserTool.name).toBe(ASK_USER_TOOL_NAME);
    expect(askUserTool.name).toBe("ask_user");
    expect(askUserTool.action).toBeFalsy();
  });

  it("requires a question and options in its parameters", () => {
    expect(askUserTool.parameters.required).toContain("question");
    expect(askUserTool.parameters.required).toContain("options");
  });

  it("execute is a fail-safe that never invents a pick", async () => {
    const result = (await askUserTool.execute({
      question: "Which group?",
      options: ["A", "B"],
    })) as { chosen: boolean };
    expect(result.chosen).toBe(false);
  });
});
