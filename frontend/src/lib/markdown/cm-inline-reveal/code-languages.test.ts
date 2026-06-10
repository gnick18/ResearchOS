import { describe, expect, it } from "vitest";
import {
  buildFencedCodeInsertion,
  COMMON_LANGUAGES,
  filterLanguages,
  isCodeBlockInsertSyntax,
  PLAIN_TEXT_CODE,
} from "./code-languages";

/**
 * Pure tests for the code-block language picker core. The picker UI (popup +
 * keyboard nav) is React and verified by source review; the load-bearing logic
 * is the fence-insertion math (language onto the opening fence + caret) and the
 * search filter, which we cover here.
 */

describe("buildFencedCodeInsertion", () => {
  it("writes the language onto the opening fence and parks the caret in the body", () => {
    const { insert, selFrom, selTo } = buildFencedCodeInsertion("", "python");
    expect(insert).toBe("```python\n\n```");
    // Caret on the empty body line, after ```python + newline (3 + 6 + 1 = 10).
    expect(selFrom).toBe(10);
    expect(selTo).toBe(10);
    // The caret offset lands exactly at the start of the (empty) body line.
    expect(insert.slice(selFrom)).toBe("\n```");
  });

  it("wraps a selected body and keeps it selected, offset past the fence line", () => {
    const { insert, selFrom, selTo } = buildFencedCodeInsertion("print(1)", "python");
    expect(insert).toBe("```python\n" + "print(1)" + "\n```");
    expect(insert.slice(selFrom, selTo)).toBe("print(1)");
  });

  it("emits a bare fence with no language token for Plain Text", () => {
    const { insert, selFrom, selTo } = buildFencedCodeInsertion("", PLAIN_TEXT_CODE);
    expect(insert).toBe("```\n\n```");
    // Body line starts after ``` + newline (3 + 0 + 1 = 4).
    expect(selFrom).toBe(4);
    expect(selTo).toBe(4);
  });

  it("treats an empty code the same as Plain Text (bare fence)", () => {
    expect(buildFencedCodeInsertion("x", "").insert).toBe("```\nx\n```");
  });

  it("caret offsets are correct for a multi-character language code", () => {
    // javascript = 10 chars; body starts at 3 + 10 + 1 = 14.
    const { selFrom } = buildFencedCodeInsertion("", "javascript");
    expect(selFrom).toBe(14);
    expect(buildFencedCodeInsertion("", "javascript").insert.slice(0, selFrom)).toBe(
      "```javascript\n",
    );
  });
});

describe("filterLanguages", () => {
  it("returns the full list for an empty or whitespace search", () => {
    expect(filterLanguages("")).toHaveLength(COMMON_LANGUAGES.length);
    expect(filterLanguages("   ")).toHaveLength(COMMON_LANGUAGES.length);
  });

  it("matches on the label (case-insensitive)", () => {
    expect(filterLanguages("python").map((l) => l.code)).toContain("python");
    expect(filterLanguages("PYTHON").map((l) => l.code)).toContain("python");
  });

  it("matches on the fence code", () => {
    expect(filterLanguages("cpp").map((l) => l.code)).toContain("cpp");
  });

  it("matches on an alias (js -> javascript, py -> python)", () => {
    expect(filterLanguages("js").map((l) => l.code)).toContain("javascript");
    expect(filterLanguages("py").map((l) => l.code)).toContain("python");
  });

  it("returns nothing for a non-matching query", () => {
    expect(filterLanguages("zzznotalang")).toHaveLength(0);
  });

  it("ships the ~21 common languages including a Plain Text option", () => {
    expect(COMMON_LANGUAGES.length).toBeGreaterThanOrEqual(21);
    expect(COMMON_LANGUAGES.some((l) => l.code === PLAIN_TEXT_CODE)).toBe(true);
  });
});

describe("isCodeBlockInsertSyntax", () => {
  it("recognizes the Style Guide bare-fence snippet", () => {
    expect(isCodeBlockInsertSyntax("```\ncode block\n```")).toBe(true);
  });

  it("recognizes a bare empty fence", () => {
    expect(isCodeBlockInsertSyntax("```\n\n```")).toBe(true);
  });

  it("rejects inline code and non-fence snippets", () => {
    expect(isCodeBlockInsertSyntax("`inline code`")).toBe(false);
    expect(isCodeBlockInsertSyntax("**bold**")).toBe(false);
    expect(isCodeBlockInsertSyntax("```")).toBe(false);
  });

  it("rejects a fence that already carries a language token", () => {
    expect(isCodeBlockInsertSyntax("```python\n\n```")).toBe(false);
  });
});
