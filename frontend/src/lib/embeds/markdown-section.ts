// Markdown embed hybrid, Phase 7 P7-2 (transclusion). The section extractor.
//
// A transclusion embed renders ONE section of another note live. This module is
// the pure, well-tested core that pulls a named section's markdown out of a body
// string, and the note-aware wrapper that also matches a multi-entry note's
// entry titles. No React, no I/O: given a string (or a Note) and a heading, it
// returns the section's markdown or null.
//
// "Section" means an ATX heading (# .. ######) and everything under it up to (not
// including) the next heading of the SAME OR HIGHER level. A heading match is
// trimmed + case-insensitive on the heading TEXT (the markers and trailing
// whitespace are stripped first). The first matching heading wins on a duplicate.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import type { Note } from "@/lib/types";

/** One ATX heading found in a body, with its level (1..6) and trimmed text. */
export interface SectionHeading {
  level: number;
  text: string;
}

// An ATX heading line: 1..6 leading `#`, a required space, then the text. A
// trailing run of `#` (the optional closing sequence) is stripped from the text.
// Lines indented 4+ spaces are code, not headings, so we only allow up to 3
// leading spaces (CommonMark's rule).
const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** A fenced-code-block opener / closer (``` or ~~~, 3+ of the same char). Used to
 *  skip headings that live inside a fence (those `#` are content, not headings). */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Normalize a heading for matching, trimmed + lowercased. */
function normHeading(s: string): string {
  return s.trim().toLowerCase();
}

/** Split a body into lines, tracking which lines are inside a fenced code block so
 *  the heading scan can ignore `#` that is really code. Returns the lines plus a
 *  parallel boolean array (true = inside a fence, so not a heading). */
function fenceMask(lines: string[]): boolean[] {
  const inFence: boolean[] = [];
  let fenceMarker: string | null = null;
  for (const line of lines) {
    const m = line.match(FENCE);
    if (fenceMarker == null) {
      // Not in a fence. An opener starts one; this opener line itself is fence
      // chrome, mark it as in-fence so it is never read as a heading.
      if (m) {
        fenceMarker = m[1][0]; // ` or ~
        inFence.push(true);
      } else {
        inFence.push(false);
      }
    } else {
      // In a fence. A closing fence of the same char (3+) ends it; the closer
      // line is still fence chrome.
      inFence.push(true);
      if (m && m[1][0] === fenceMarker) {
        fenceMarker = null;
      }
    }
  }
  return inFence;
}

/** Every ATX heading in a body, in document order, skipping fenced code. */
export function listSectionHeadings(markdown: string): SectionHeading[] {
  const lines = (markdown ?? "").split("\n");
  const inFence = fenceMask(lines);
  const out: SectionHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = lines[i].match(ATX_HEADING);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/**
 * Extract the markdown of the section whose heading TEXT matches `heading`
 * (trimmed, case-insensitive). The returned content runs from the line AFTER the
 * matched heading up to (not including) the next heading of the SAME OR HIGHER
 * level, or end of document. Returns null when no heading matches.
 *
 * Nested subheadings (deeper level) stay INSIDE the section; a sibling or shallower
 * heading ends it. On duplicate headings the FIRST match wins. The result is
 * trimmed of leading / trailing blank lines but otherwise byte-faithful.
 */
export function extractMarkdownSection(
  markdown: string,
  heading: string,
): string | null {
  const target = normHeading(heading);
  if (!target) return null;
  const lines = (markdown ?? "").split("\n");
  const inFence = fenceMask(lines);

  let startLine = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = lines[i].match(ATX_HEADING);
    if (m && m[2].trim().toLowerCase() === target) {
      startLine = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startLine === -1) return null;

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = lines[i].match(ATX_HEADING);
    if (m && m[1].length <= startLevel) {
      endLine = i;
      break;
    }
  }

  const body = lines.slice(startLine + 1, endLine).join("\n");
  // Trim leading / trailing blank lines but keep interior structure.
  return body.replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * Note-aware section extractor for a transclusion. Resolution order:
 *   1. If `heading` is empty, return the whole note body (every entry's content
 *      concatenated in order, blank-line separated).
 *   2. An ENTRY whose title matches `heading` (trimmed, case-insensitive) wins,
 *      returning that entry's whole content.
 *   3. Otherwise the first `extractMarkdownSection` hit across the entries, in
 *      entry order (first hit wins).
 * Returns null when nothing matches.
 */
export function extractNoteSection(note: Note, heading: string): string | null {
  const entries = note?.entries ?? [];
  const target = normHeading(heading);

  // Empty heading: the whole note body.
  if (!target) {
    const joined = entries
      .map((e) => e.content ?? "")
      .filter((c) => c.trim().length > 0)
      .join("\n\n");
    return joined.trim().length > 0 ? joined : null;
  }

  // Entry-title match first.
  for (const e of entries) {
    if (normHeading(e.title ?? "") === target) {
      return e.content ?? "";
    }
  }

  // Then a heading inside any entry, first hit wins.
  for (const e of entries) {
    const found = extractMarkdownSection(e.content ?? "", heading);
    if (found != null) return found;
  }
  return null;
}
