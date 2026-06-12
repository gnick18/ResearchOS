// Markdown embed hybrid, Phase 7 P7-2 (transclusion). Normalize-on-save.
//
// A user types the familiar `![[Note Title#Heading]]` to transclude a section of
// another note. On save we NORMALIZE that raw syntax to the portable embed link
// `[Heading](/notes/<id>#ros=transclude&section=<encoded heading>)`, the same
// fragment grammar every other embed uses. Doing the rewrite once, on save, keeps
// the stored markdown a real link (collab / version-control / a plain markdown
// reader all keep working) and lets the renderer treat it like any other embed.
//
// This module is PURE and SYNCHRONOUS given a resolver: the caller supplies
// `resolveNoteId(title)` (the disk lookup lives in local-api). On a resolve hit we
// rewrite; on a miss we LEAVE the `![[ ]]` raw so the user never loses their text.
// We never rewrite inside a fenced code block or inline `code`, and we never touch
// an existing image (`![alt](url)`) or link.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

/** A resolver from a note title to its numeric id (as a string), or null when no
 *  note matches. Case-insensitive, first-match-wins is the caller's contract; this
 *  module just calls it. */
export type ResolveNoteId = (title: string) => string | null;

export interface NormalizeResult {
  content: string;
  /** True when at least one `![[ ]]` was rewritten. Lets the caller skip a no-op
   *  write so a note with no transclusions is byte-for-byte unchanged. */
  changed: boolean;
}

/** Percent-encode a heading for the `section=` fragment param. URLSearchParams is
 *  not used (it would `+`-encode spaces); encodeURIComponent matches the parser's
 *  decode (the fragment is parsed via URLSearchParams which decodes `%20`). */
function encodeSection(heading: string): string {
  return encodeURIComponent(heading);
}

/**
 * Build the set of [start, end) character ranges that are "protected" (inside a
 * fenced code block or an inline-code span). A `![[ ]]` whose `!` falls inside any
 * protected range is left untouched.
 *
 * Fenced blocks: a line that is ``` or ~~~ (3+, up to 3 leading spaces) toggles a
 * fence; everything between opener and closer (inclusive of both lines) is
 * protected. Inline code: a run of N backticks opens a span closed by the next run
 * of exactly N backticks on the same logical text (CommonMark). We scan outside
 * fences only.
 */
function protectedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lines = content.split("\n");

  // Map each line to its absolute start offset in `content`.
  const lineStarts: number[] = [];
  let off = 0;
  for (const line of lines) {
    lineStarts.push(off);
    off += line.length + 1; // +1 for the "\n" we split on
  }

  const fenceRe = /^ {0,3}(`{3,}|~{3,})/;
  let fenceMarker: string | null = null;
  let fenceStartOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = lineStarts[i];
    const m = line.match(fenceRe);
    if (fenceMarker == null) {
      if (m) {
        fenceMarker = m[1][0];
        fenceStartOffset = lineStart;
      } else {
        // Outside any fence: protect inline-code spans on this line.
        for (const r of inlineCodeRanges(line, lineStart)) ranges.push(r);
      }
    } else {
      // Inside a fence: the whole line is protected. Close on a matching fence.
      if (m && m[1][0] === fenceMarker) {
        ranges.push([fenceStartOffset, lineStart + line.length]);
        fenceMarker = null;
      }
    }
  }
  // An unclosed fence protects to end of document.
  if (fenceMarker != null) {
    ranges.push([fenceStartOffset, content.length]);
  }
  return ranges;
}

/** Inline-code spans within a single line, as absolute [start, end) ranges. A run
 *  of N backticks opens a span closed by the next run of exactly N backticks. */
function inlineCodeRanges(line: string, base: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const tick = /`+/g;
  let m: RegExpExecArray | null;
  let openIdx = -1;
  let openLen = 0;
  while ((m = tick.exec(line)) !== null) {
    const len = m[0].length;
    if (openIdx === -1) {
      openIdx = m.index;
      openLen = len;
    } else if (len === openLen) {
      out.push([base + openIdx, base + m.index + len]);
      openIdx = -1;
      openLen = 0;
    }
    // A mismatched-length run inside an open span is just content; keep scanning.
  }
  return out;
}

function isProtected(pos: number, ranges: Array<[number, number]>): boolean {
  for (const [s, e] of ranges) {
    if (pos >= s && pos < e) return true;
  }
  return false;
}

// `![[ ... ]]` with the inner text captured. The inner text is split on the FIRST
// `#` into title + heading. We do not allow a `]` inside the inner text (a real
// transclusion target never contains one), which keeps the match tight.
const TRANSCLUSION_RE = /!\[\[([^\]]+)\]\]/g;

/**
 * Rewrite resolvable `![[Note#Heading]]` transclusions to the portable embed link.
 * Unresolved targets and anything inside code are left exactly as written. Pure +
 * synchronous given the resolver; returns the new content plus a `changed` flag.
 */
export function normalizeTransclusions(
  content: string,
  resolveNoteId: ResolveNoteId,
): NormalizeResult {
  if (!content || content.indexOf("![[") === -1) {
    return { content, changed: false };
  }

  const ranges = protectedRanges(content);
  let changed = false;

  const next = content.replace(TRANSCLUSION_RE, (match, inner: string, offset: number) => {
    // Skip when the `!` of this match is inside a protected (code) range.
    if (isProtected(offset, ranges)) return match;

    const hashIdx = inner.indexOf("#");
    const title = (hashIdx === -1 ? inner : inner.slice(0, hashIdx)).trim();
    const heading = hashIdx === -1 ? "" : inner.slice(hashIdx + 1).trim();
    if (!title) return match;

    const id = resolveNoteId(title);
    if (!id) return match; // unresolved: leave the raw text intact

    changed = true;
    const linkText = heading || title;
    const sectionFrag = heading ? `&section=${encodeSection(heading)}` : "";
    return `[${escapeLinkText(linkText)}](/notes/${encodeURIComponent(id)}#ros=transclude${sectionFrag})`;
  });

  return { content: next, changed };
}

/** Escape link text so a `[` or `]` in a heading cannot break the `[text](url)`
 *  form. Mirrors references.ts's escapeLinkText (kept local to stay pure). */
function escapeLinkText(name: string): string {
  return (name ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]");
}
