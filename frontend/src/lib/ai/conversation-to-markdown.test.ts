import { describe, it, expect } from "vitest";
import {
  conversationToMarkdown,
  defaultConversationTitle,
} from "./conversation-to-markdown";
import type { ChatMessage } from "./conversation-store";

// A fixture with a user turn and an assistant turn whose answer carries an
// inline embed reference link. The embed link is the load-bearing detail, it
// must survive verbatim so the destination note renders the same live embed.
const EMBED = "[Growth (t-test)](/datahub?doc=42#ros=results)";

const FIXTURE: ChatMessage[] = [
  { id: "u1", role: "user", content: "Run a t-test on my growth data." },
  {
    id: "a1",
    role: "assistant",
    content: `Here is the result.\n\n${EMBED}\n\nThe difference is significant.`,
  },
];

describe("conversationToMarkdown", () => {
  it("includes both turns and the embed link verbatim", () => {
    const md = conversationToMarkdown(FIXTURE, { date: "2026-06-12" });
    // Both turns are present.
    expect(md).toContain("Run a t-test on my growth data.");
    expect(md).toContain("The difference is significant.");
    // The embed reference link survives byte-for-byte, so it renders live.
    expect(md).toContain(EMBED);
    // The user turn is labelled.
    expect(md).toContain("**You**");
    // Dated header.
    expect(md).toContain("### BeakerBot conversation");
    expect(md).toContain("_Saved 2026-06-12_");
  });

  it("keeps a lone embed link on its own paragraph", () => {
    const md = conversationToMarkdown(FIXTURE, { date: "2026-06-12" });
    // The embed link is blank-line separated from the surrounding prose so the
    // note renderer upgrades the lone-paragraph link to a block embed.
    expect(md).toContain(`\n\n${EMBED}\n\n`);
  });

  it("skips empty turns and respects a custom user label", () => {
    const md = conversationToMarkdown(
      [
        { id: "u1", role: "user", content: "Hi" },
        { id: "a1", role: "assistant", content: "" },
        { id: "u2", role: "user", content: "  " },
      ],
      { date: "2026-06-12", userLabel: "Grant" },
    );
    expect(md).toContain("**Grant**");
    expect(md).toContain("Hi");
    // The blank assistant turn and whitespace-only user turn are dropped.
    expect((md.match(/\*\*Grant\*\*/g) ?? []).length).toBe(1);
  });
});

describe("defaultConversationTitle", () => {
  it("derives the title from the first user message plus the date", () => {
    const title = defaultConversationTitle(FIXTURE, { date: "2026-06-12" });
    expect(title).toContain("Run a t-test");
    expect(title).toContain("(2026-06-12)");
  });

  it("truncates a long first message on a word boundary", () => {
    const long: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content:
          "Please compute the unpaired two sample t test comparing wildtype and mutant replicates",
      },
    ];
    const title = defaultConversationTitle(long, { date: "2026-06-12", maxLength: 40 });
    expect(title.length).toBeLessThan(70);
    expect(title).toContain("…");
    expect(title).toContain("(2026-06-12)");
  });

  it("falls back to a generic dated title with no user turn", () => {
    const title = defaultConversationTitle(
      [{ id: "a1", role: "assistant", content: "Hello" }],
      { date: "2026-06-12" },
    );
    expect(title).toBe("BeakerBot chat 2026-06-12");
  });
});
