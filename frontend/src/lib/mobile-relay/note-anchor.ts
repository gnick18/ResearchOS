// Content-anchor helpers for phone-note placement (P2, laptop side).
//
// These two pure functions derive a deterministic anchor for every top-level
// block of an experiment's notes/results markdown. The phone uses them to say
// "insert my note AFTER the block with anchor X"; the laptop uses this byte
// identical copy to find that same block in its current doc and insert there.
// Because both sides compute the anchor the same way from the same markdown,
// no anchor needs to travel on the wire (the snapshot shape is unchanged).
//
// MUST stay byte-identical with the other copy in mobile/lib/note-anchor.ts.
// If you change one, change both.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/**
 * Split a markdown document into top-level blocks on blank-line boundaries.
 * Each block is trimmed; empty results are dropped. The order of the returned
 * array is document order, so an index into it is a stable disambiguation hint
 * for the matching anchor.
 */
export function splitBlocks(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * A short, stable anchor for one block. Normalizes the block (trim, collapse
 * every whitespace run to a single space, lowercase) then hashes it with djb2
 * and returns the hash as hex. Normalization means cosmetic whitespace edits
 * do not move the anchor, while a real content change does. This is a content
 * fingerprint for placement, not a security hash.
 */
export function blockAnchor(block: string): string {
  const normalized = block.trim().replace(/\s+/g, ' ').toLowerCase();
  let h = 5381;
  for (let i = 0; i < normalized.length; i += 1) {
    h = ((h << 5) + h + normalized.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
