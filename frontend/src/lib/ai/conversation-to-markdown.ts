// Serialize a BeakerBot conversation to markdown for export (BeakerAI export
// bot, 2026-06-12).
//
// The whole point of this module is that BeakerBot assistant turns are ALREADY
// markdown, and they ALREADY carry their inline embed references verbatim as
// `[name](/path#ros=view)` links. The note / experiment markdown renderer reads
// the same `#ros=` fragment (see lib/references.ts, rendered via
// RenderedMarkdown / ObjectEmbed), so when we drop an assistant turn into a note
// untouched, the SAME live embeds render in the destination for free. We never
// reconstruct an embed, we just concatenate `message.content` without escaping.
//
// So the serializer's only job is framing: a small dated header, a bold "You"
// label before each user turn, and the assistant turn written through as-is.
// Keeping the assistant content byte-for-byte is what makes the embeds survive,
// so this module deliberately does NOT touch the links.
//
// Pure and unit-tested. No DOM, no apis, no side effects.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { ChatMessage } from "@/lib/ai/conversation-store";

export interface ConversationToMarkdownOptions {
  /** Heading text for the exported section. Defaults to "BeakerBot conversation". */
  heading?: string;
  /** ISO-ish date string for the header line. Defaults to today (YYYY-MM-DD). */
  date?: string;
  /** Label printed before each user turn. Defaults to "You". */
  userLabel?: string;
}

/** Today's date as YYYY-MM-DD, the same slice the note entry helpers use. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Serialize the full transcript to a single markdown string.
 *
 * Each user turn is written as a bold label line ("**You**") followed by the
 * user text. Each assistant turn is written through verbatim, because it is
 * already markdown and already holds its embed reference links inline. The
 * result starts with a small dated header so an existing note shows it as its
 * own clearly labelled block.
 */
export function conversationToMarkdown(
  messages: ChatMessage[],
  opts: ConversationToMarkdownOptions = {},
): string {
  const heading = opts.heading ?? "BeakerBot conversation";
  const date = opts.date ?? today();
  const userLabel = opts.userLabel ?? "You";

  const parts: string[] = [`### ${heading}`, `_Saved ${date}_`];

  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    if (message.role === "user") {
      // Label the human turn, then the text on its own line. The blank line
      // keeps the label and the text as separate paragraphs in the renderer.
      parts.push(`**${userLabel}**\n\n${content}`);
    } else {
      // Assistant turns are already markdown with embed links inline. Write
      // them VERBATIM so the destination renders the same live embeds. Do not
      // escape, wrap, or reflow.
      parts.push(content);
    }
  }

  // Blank-line separate every block so each turn is its own paragraph and a
  // lone embed link stays a lone paragraph (the renderer only upgrades a
  // paragraph that is exactly one embed link to a block embed).
  return parts.join("\n\n");
}

/**
 * Derive a default note title from the first user message, truncated, with the
 * date appended. Falls back to a generic dated title when there is no user turn
 * yet. Single-line, whitespace-collapsed, so it reads cleanly in a notes list.
 */
export function defaultConversationTitle(
  messages: ChatMessage[],
  opts: { date?: string; maxLength?: number } = {},
): string {
  const date = opts.date ?? today();
  const maxLength = opts.maxLength ?? 50;

  const firstUser = messages.find(
    (m) => m.role === "user" && m.content.trim().length > 0,
  );
  if (!firstUser) {
    return `BeakerBot chat ${date}`;
  }

  // Collapse whitespace to a single line, then truncate on a whole word where
  // possible so the title does not cut mid-word.
  const flat = firstUser.content.trim().replace(/\s+/g, " ");
  let stem = flat;
  if (flat.length > maxLength) {
    const cut = flat.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(" ");
    stem = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/\s+$/, "") + "…";
  }
  return `${stem} (${date})`;
}
