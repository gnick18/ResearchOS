import { describe, it, expect } from "vitest";
import { isBlockLevelInsertSyntax } from "./block-insert-syntax";

describe("isBlockLevelInsertSyntax", () => {
  it("treats every block-level Style Guide snippet as block-level", () => {
    const block = [
      "# Heading 1",
      "## Heading 2",
      "### Heading 3",
      "> quote text",
      "- list item",
      "* bullet",
      "1. list item",
      "- [ ] task",
      "- [x] done",
      "---",
      "| Table | Header |",
    ];
    for (const s of block) {
      expect(isBlockLevelInsertSyntax(s), s).toBe(true);
    }
  });

  it("treats inline snippets as NOT block-level (gluing them is correct)", () => {
    const inline = [
      "**bold text**",
      "*italic text*",
      "<u>underline</u>",
      "~~strikethrough~~",
      "[link text](url)",
      "![alt text](image.png)",
      "`inline code`",
      "```\ncode block\n```",
      "plain words",
    ];
    for (const s of inline) {
      expect(isBlockLevelInsertSyntax(s), s).toBe(false);
    }
  });

  it("judges a multi-line snippet by its first line", () => {
    expect(isBlockLevelInsertSyntax("## Heading\nbody")).toBe(true);
    expect(isBlockLevelInsertSyntax("body\n## Heading")).toBe(false);
  });
});
