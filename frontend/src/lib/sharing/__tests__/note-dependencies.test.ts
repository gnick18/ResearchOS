// Phase 6a (phase6a-foundation bot, 2026-06-12). Unit tests for
// note-dependencies.ts: scanNoteDependencies.

import { describe, it, expect } from "vitest";
import { scanNoteDependencies } from "@/lib/sharing/note-dependencies";

// ── Helpers ──────────────────────────────────────────────────────────────────

// Build a block-embed link (has #ros= fragment so isEmbed=true).
const blockEmbed = (caption: string, href: string) => `[${caption}](${href})`;

// Embed hrefs for different types (all include a #ros= fragment for isEmbed).
const NOTE_HREF = "/notes/5#ros=card";
const METHOD_HREF = "/methods?openMethod=3#ros=card";
const SEQ_HREF = "/sequences?seq=10#ros=map";
const MOL_HREF = "/chemistry?molecule=mol-2#ros=card";

// A bare mention (no #ros= fragment) is an inline chip, not a block embed.
const MENTION_HREF = "/notes/5";

// ── Basic detection ──────────────────────────────────────────────────────────

describe("scanNoteDependencies", () => {
  it("finds a single block embed in a bare-link paragraph", () => {
    const md = blockEmbed("My Note", NOTE_HREF);
    const deps = scanNoteDependencies(md);
    expect(deps).toHaveLength(1);
    expect(deps[0].type).toBe("note");
    expect(deps[0].id).toBe("5");
    expect(deps[0].caption).toBe("My Note");
    expect(deps[0].href).toBe(NOTE_HREF);
  });

  it("finds multiple embeds in document order", () => {
    const md = [
      blockEmbed("Note A", NOTE_HREF),
      "",
      "Some prose between embeds.",
      "",
      blockEmbed("Method B", METHOD_HREF),
      "",
      blockEmbed("Sequence C", SEQ_HREF),
    ].join("\n");

    const deps = scanNoteDependencies(md);
    expect(deps).toHaveLength(3);
    expect(deps[0].type).toBe("note");
    expect(deps[1].type).toBe("method");
    expect(deps[2].type).toBe("sequence");
  });

  it("ignores inline mentions (plain links without #ros=)", () => {
    const md = [
      "See [My Note](" + MENTION_HREF + ") for details.",
      blockEmbed("Method B", METHOD_HREF),
    ].join("\n");

    const deps = scanNoteDependencies(md);
    // Only the block embed, not the inline mention.
    expect(deps).toHaveLength(1);
    expect(deps[0].type).toBe("method");
  });

  it("ignores image links (not an object route)", () => {
    const md = [
      "![photo](./users/alice/notes/1/Images/result.png)",
      blockEmbed("Note A", NOTE_HREF),
    ].join("\n");

    const deps = scanNoteDependencies(md);
    expect(deps).toHaveLength(1);
    expect(deps[0].type).toBe("note");
  });

  it("ignores plain prose paragraphs", () => {
    const md = "Just some text without any links.";
    expect(scanNoteDependencies(md)).toHaveLength(0);
  });

  it("ignores external links", () => {
    const md = "[Google](https://www.google.com#ros=card)";
    // https://www.google.com is not an object route, parseObjectEmbed returns null.
    expect(scanNoteDependencies(md)).toHaveLength(0);
  });

  it("ignores a link that is NOT alone on a line (inline within text)", () => {
    const md = `Some text [Note A](${NOTE_HREF}) and more text.`;
    expect(scanNoteDependencies(md)).toHaveLength(0);
  });

  it("ignores a line with two links (not a lone embed)", () => {
    const md = `[A](${NOTE_HREF}) [B](${METHOD_HREF})`;
    expect(scanNoteDependencies(md)).toHaveLength(0);
  });

  it("deduplicates by href (same embed appearing twice returns one entry)", () => {
    const md = [
      blockEmbed("Note A", NOTE_HREF),
      "",
      "Some prose.",
      "",
      blockEmbed("Note A again", NOTE_HREF),
    ].join("\n");

    const deps = scanNoteDependencies(md);
    expect(deps).toHaveLength(1);
    expect(deps[0].caption).toBe("Note A"); // first occurrence wins
    expect(deps[0].href).toBe(NOTE_HREF);
  });

  it("two embeds with the same object but different view opts are NOT deduped", () => {
    // Different #ros= opts = different href = different entries.
    const hrefMap = "/notes/5#ros=map";
    const hrefCard = "/notes/5#ros=card";
    const md = [
      blockEmbed("Note map", hrefMap),
      blockEmbed("Note card", hrefCard),
    ].join("\n");
    const deps = scanNoteDependencies(md);
    expect(deps).toHaveLength(2);
  });

  it("returns empty array for empty markdown", () => {
    expect(scanNoteDependencies("")).toHaveLength(0);
  });

  it("handles molecule embeds", () => {
    const md = blockEmbed("Aspirin", MOL_HREF);
    const deps = scanNoteDependencies(md);
    expect(deps).toHaveLength(1);
    expect(deps[0].type).toBe("molecule");
    expect(deps[0].id).toBe("mol-2");
  });

  it("preserves caption text faithfully", () => {
    // Standard markdown link text cannot contain unescaped "]"; the
    // objectReferenceMarkdown helper escapes it as "\]". We use a plain caption
    // without brackets to avoid that edge case in this unit test.
    const md = blockEmbed("pUC19 Plasmid Map", SEQ_HREF);
    const deps = scanNoteDependencies(md);
    expect(deps[0].caption).toBe("pUC19 Plasmid Map");
  });
});
