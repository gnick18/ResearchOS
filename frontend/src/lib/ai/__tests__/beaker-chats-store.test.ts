// deriveChatTitle unit tests (BeakerAI lane, 2026-06-12).
//
// Pins the pure title-derivation used when a fresh BeakerBot conversation is
// first persisted. The disk-touching helpers in this module are exercised
// indirectly through the conversation-store thread tests (where the FSA layer
// is mocked), so here we only cover the pure function.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { deriveChatTitle } from "../beaker-chats-store";

describe("deriveChatTitle", () => {
  it("uses the message as-is when short", () => {
    expect(deriveChatTitle("What is a Tm?")).toBe("What is a Tm?");
  });

  it("collapses whitespace to a single line", () => {
    expect(deriveChatTitle("  line one\n\tline   two ")).toBe("line one line two");
  });

  it("truncates long messages with an ellipsis", () => {
    const long = "a".repeat(80);
    const title = deriveChatTitle(long);
    expect(title.endsWith("...")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(63);
  });

  it("falls back to a generic label for empty input", () => {
    expect(deriveChatTitle("   ")).toBe("New chat");
  });
});
