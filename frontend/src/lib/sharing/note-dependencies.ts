// Phase 6a (phase6a-foundation bot, 2026-06-12). Note embedded-object scanner.
//
// scanNoteDependencies finds every block-embed reference in a note's markdown
// and returns them in document order, deduped by href. Block embeds are links
// that appear as a lone link on a line (the same criterion used by
// lib/embeds/figure-numbering.ts). Inline mentions and plain links are excluded.
//
// This is a PURE, SYNCHRONOUS function. It reads no I/O and loads no records.
// It only reports what is structurally embedded in the markdown text.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import type { ObjectRefType } from "@/lib/references";
import { parseObjectEmbed } from "@/lib/references";

/** One embedded object dependency found in a note's markdown. */
export interface NoteDependency {
  /** The object type (sequence, note, method, molecule, etc.). */
  type: ObjectRefType;
  /** The local id of the embedded object (as a string, per the reference layer). */
  id: string;
  /** The link caption text. Used as the display name in the dependency panel. */
  caption: string;
  /** The full href of the embed link, including the #ros= fragment. */
  href: string;
}

// The lone-embed-link regex mirrors lib/embeds/figure-numbering.ts line 51:
// a trimmed line that is exactly one markdown link and nothing else.
// We capture the link text (caption) and the URL.
const LONE_EMBED_LINK = /^\[([^\]]*)\]\((\S+)\)$/;

/**
 * Scan a note's markdown for block-embed object references. Returns each embed
 * exactly once (deduped by href), in document order.
 *
 * A block embed is a paragraph that contains a single object-embed link (a link
 * to one of our /deep?param=id#ros=view paths). Inline mentions and plain links
 * are NOT returned. Images ([text](image.png)) are not returned either, since
 * parseObjectEmbed will return null for non-object URLs.
 */
export function scanNoteDependencies(markdown: string): NoteDependency[] {
  if (!markdown) return [];

  const seenHrefs = new Set<string>();
  const result: NoteDependency[] = [];

  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    const match = LONE_EMBED_LINK.exec(trimmed);
    if (!match) continue;

    const caption = match[1] ?? "";
    const href = match[2] ?? "";
    if (!href) continue;

    // Only include object embeds (links to our internal object routes). A plain
    // external link, an image src, or an anchor all return null here.
    const descriptor = parseObjectEmbed(href);
    if (!descriptor) continue;

    // Only block embeds (view !== "chip" i.e. isEmbed === true). A bare mention
    // link with no #ros= fragment is an inline chip, not a block embed.
    if (!descriptor.isEmbed) continue;

    // Dedup by the full href (includes the #ros= fragment + opts, so two embeds
    // of the same object with different views are considered distinct).
    if (seenHrefs.has(href)) continue;
    seenHrefs.add(href);

    result.push({
      type: descriptor.type,
      id: descriptor.id,
      caption,
      href,
    });
  }

  return result;
}
