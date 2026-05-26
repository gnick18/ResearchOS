/**
 * Markdown Block Parser
 *
 * Parses markdown content into blocks for the hybrid editor mode.
 * Each block represents a logical unit that can be edited independently:
 * - Paragraphs, headings, code blocks, blockquotes, lists, tables, etc.
 *
 * CommonMark-aligned paragraph rules (2026-05-26, hybrid CommonMark
 * paragraphs R2). Prior to this rewrite the parser split on every
 * newline, producing one block per line; typing `test\n\n\ntest 2`
 * gave three editable chunks instead of two paragraphs separated by
 * blank space. The new walk groups consecutive non-blank text lines
 * into ONE paragraph until a blank line OR a non-paragraph block
 * signature interrupts. Blank-line runs between paragraphs are
 * consumed as a separator and do NOT emit a block; only a TRAILING
 * blank-line run at end-of-document emits a single `blankLine` block,
 * which is the "+ Add paragraph" affordance target in the editor.
 */

/**
 * Types of markdown blocks
 */
export type BlockType =
  | "heading"
  | "paragraph"
  | "codeBlock"
  | "blockquote"
  | "list"
  | "table"
  | "thematicBreak"
  | "html"
  | "blankLine";

/**
 * Represents a single block in the markdown document
 */
export interface MarkdownBlock {
  /** Unique identifier for the block */
  id: string;
  /** Type of the block */
  type: BlockType;
  /** Raw markdown content of the block */
  content: string;
  /** Character offset where block starts in source */
  startOffset: number;
  /** Character offset where block ends in source (exclusive) */
  endOffset: number;
  /** Line number where block starts (0-indexed) */
  startLine: number;
  /** Line number where block ends (0-indexed, inclusive) */
  endLine: number;
  /** Additional metadata depending on block type */
  meta?: {
    /** For headings: level 1-6 */
    level?: number;
    /** For code blocks: language identifier */
    language?: string;
    /** For lists: whether it's ordered */
    ordered?: boolean;
  };
}

/**
 * Simple string hash function for generating stable IDs
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate a stable ID for a block based on its content and position
 * This ensures the same block gets the same ID across re-parses
 */
function generateBlockId(content: string, startLine: number): string {
  // Use first 100 chars of content for efficiency, combined with line number
  const contentPreview = content.slice(0, 100);
  const contentHash = hashString(contentPreview);
  return `block-${startLine}-${contentHash}`;
}

/**
 * Per-line cache. We pre-walk the source once to compute each line's
 * absolute character offset (cumulative `lineN.length + 1` for the
 * preceding lines) so block boundary detection below can advance i
 * by an arbitrary delta without re-scanning prior text. Stored as a
 * parallel array indexed by line number; the `+1` for the newline is
 * implicit (lineStartOffsets[i+1] - lineStartOffsets[i] - 1 == lines[i].length).
 */
interface LineIndex {
  lines: string[];
  /** Offset where each line starts. lineStartOffsets[lines.length] = content.length + 1 sentinel. */
  lineStartOffsets: number[];
}

function buildLineIndex(content: string): LineIndex {
  const lines = content.split("\n");
  const lineStartOffsets: number[] = new Array(lines.length + 1);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStartOffsets[i] = offset;
    offset += lines[i].length + 1;
  }
  lineStartOffsets[lines.length] = offset;
  return { lines, lineStartOffsets };
}

/**
 * End-of-line position for the *content* of the i'th line — the offset
 * just past the last character of lines[i], NOT including its trailing
 * newline. Used as block.endOffset where the block ends inside the
 * source string (the consumer of endOffset treats it as exclusive of
 * the trailing newline so neighbor blocks splice cleanly).
 */
function lineEndOffset(idx: LineIndex, lineNumber: number): number {
  return idx.lineStartOffsets[lineNumber] + idx.lines[lineNumber].length;
}

/**
 * Block signature detection. Returns the block kind to start at lines[i]
 * or null for "no special signature, treat as paragraph candidate".
 * Setext headings are handled inline (need look-ahead).
 */
type BlockSignature =
  | { kind: "fence"; fenceChar: "`" | "~"; fenceLen: number; language: string }
  | { kind: "atxHeading"; level: number }
  | { kind: "thematicBreak" }
  | { kind: "blockquote" }
  | { kind: "list"; ordered: boolean }
  | { kind: "tableHeader" }
  | { kind: "html"; tagName: string };

function detectSignature(
  lines: string[],
  i: number,
): BlockSignature | null {
  const line = lines[i];

  // Fenced code block (open fence)
  if (line.startsWith("```") || line.startsWith("~~~")) {
    const m = line.match(/^(`{3,}|~{3,})(\w*)/);
    if (m) {
      const fenceChar = m[1][0] as "`" | "~";
      const fenceLen = m[1].length;
      const language = m[2] || "";
      return { kind: "fence", fenceChar, fenceLen, language };
    }
  }

  // ATX heading
  const atx = line.match(/^(#{1,6})\s+(.*)$/);
  if (atx) {
    return { kind: "atxHeading", level: atx[1].length };
  }

  // Thematic break
  if (
    /^(-{3,}|\*{3,}|_{3,})$/.test(line) ||
    /^(-\s*){3,}$/.test(line) ||
    /^(\*\s*){3,}$/.test(line) ||
    /^(_\s*){3,}$/.test(line)
  ) {
    return { kind: "thematicBreak" };
  }

  // Blockquote
  if (line.startsWith(">")) {
    return { kind: "blockquote" };
  }

  // List (bullet or ordered)
  if (/^\s*[-*+]\s/.test(line)) {
    return { kind: "list", ordered: false };
  }
  if (/^\s*\d+\.\s/.test(line)) {
    return { kind: "list", ordered: true };
  }

  // Table header (current line has `|` AND next line is a delimiter row)
  if (line.includes("|") && i + 1 < lines.length && /^\|?[\s\-:|]+\|?$/.test(lines[i + 1])) {
    return { kind: "tableHeader" };
  }

  // HTML block
  const htmlMatch = line.match(
    /^<(div|p|ul|ol|li|table|pre|blockquote|h[1-6]|script|style|iframe|form|article|section|nav|aside|header|footer|main|figure|figcaption)/i,
  );
  if (htmlMatch) {
    return { kind: "html", tagName: htmlMatch[1].toLowerCase() };
  }

  return null;
}

/**
 * Parse markdown content into an array of blocks.
 *
 * Paragraph boundary rules (CommonMark-aligned, R2 rewrite):
 *   - A run of one or more BLANK LINES ends the current paragraph and
 *     is consumed as a separator (no block emitted between paragraphs).
 *   - Multiple consecutive blank lines collapse to a single separator
 *     so `test\n\n\n\n\ntest 2` produces exactly 2 blocks.
 *   - A single `\n` inside a run of non-blank text lines is a soft
 *     break: those lines belong to the same paragraph block.
 *   - A non-paragraph block signature (heading, fence, blockquote,
 *     list, table, thematic break, HTML) interrupts a paragraph run.
 *
 * Trailing blank lines (document ends with one or more blank lines)
 * are NOT silently dropped: a single `blankLine` block is emitted at
 * the very end as the "+ Add paragraph" affordance target in the
 * editor. Without it, the editor can't anchor a freshly-created blank
 * block at the end of the document.
 *
 * @param content - The markdown content to parse
 * @returns Array of MarkdownBlock objects
 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];

  if (!content) {
    return blocks;
  }

  const idx = buildLineIndex(content);
  const { lines } = idx;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // BLANK-LINE SEPARATOR. Consume the entire blank-line run silently
    // unless the run reaches the end of the document, in which case we
    // emit a single trailing `blankLine` block so the "+ Add paragraph"
    // affordance in HybridMarkdownEditor still has a block to anchor on.
    if (line.trim() === "") {
      const runStartLine = i;
      const runStartOffset = idx.lineStartOffsets[i];
      while (i < lines.length && lines[i].trim() === "") {
        i++;
      }
      // i now points at the first non-blank line, or past the end.
      if (i >= lines.length) {
        // Trailing blank-line run. Note: split("\n") produces a final
        // empty string for content ending in "\n", so a single trailing
        // newline gives one blank line in the lines array. Skip emit
        // when the trailing run is just that single artifact and is
        // adjacent to the previous block (length 1 starting right at
        // end of content) — otherwise every "test\n" parses as
        // paragraph + blankLine, which clutters the editor. The
        // heuristic: only emit when the trailing run has 2+ blank lines
        // OR the document is entirely blank (no prior blocks).
        const runLineCount = lines.length - runStartLine;
        const shouldEmit = blocks.length === 0 || runLineCount >= 2;
        if (shouldEmit) {
          const lastLineIdx = lines.length - 1;
          const endOffset = lineEndOffset(idx, lastLineIdx);
          const blankContent = lines.slice(runStartLine).join("\n");
          blocks.push({
            id: generateBlockId(blankContent, runStartLine),
            type: "blankLine",
            content: blankContent,
            startOffset: runStartOffset,
            endOffset,
            startLine: runStartLine,
            endLine: lastLineIdx,
          });
        }
        break;
      }
      // Otherwise — separator between blocks. Emit nothing and loop.
      continue;
    }

    const sig = detectSignature(lines, i);

    // FENCED CODE BLOCK. Whole region (open fence -> close fence, or
    // end of document if unclosed) is one block.
    if (sig?.kind === "fence") {
      const startLine = i;
      const startOffset = idx.lineStartOffsets[i];
      const codeLines = [lines[i]];
      i++;
      let endLine = startLine;
      const closingPattern = new RegExp(`^${sig.fenceChar === "`" ? "`" : "~"}{${sig.fenceLen},}\\s*$`);
      while (i < lines.length) {
        codeLines.push(lines[i]);
        endLine = i;
        if (closingPattern.test(lines[i])) {
          i++;
          break;
        }
        i++;
      }
      const codeContent = codeLines.join("\n");
      blocks.push({
        id: generateBlockId(codeContent, startLine),
        type: "codeBlock",
        content: codeContent,
        startOffset,
        endOffset: lineEndOffset(idx, endLine),
        startLine,
        endLine,
        meta: { language: sig.language },
      });
      continue;
    }

    // ATX HEADING. Single line; its own block by signature even if
    // adjacent to non-blank text above/below (CommonMark behavior:
    // a `# Heading` line interrupts a paragraph).
    if (sig?.kind === "atxHeading") {
      const startOffset = idx.lineStartOffsets[i];
      blocks.push({
        id: generateBlockId(line, i),
        type: "heading",
        content: line,
        startOffset,
        endOffset: lineEndOffset(idx, i),
        startLine: i,
        endLine: i,
        meta: { level: sig.level },
      });
      i++;
      continue;
    }

    // THEMATIC BREAK. Single line, own block.
    if (sig?.kind === "thematicBreak") {
      const startOffset = idx.lineStartOffsets[i];
      blocks.push({
        id: generateBlockId(line, i),
        type: "thematicBreak",
        content: line,
        startOffset,
        endOffset: lineEndOffset(idx, i),
        startLine: i,
        endLine: i,
      });
      i++;
      continue;
    }

    // BLOCKQUOTE. Consecutive `>`-prefixed lines (with single-line
    // continuations allowed for lazy continuation per CommonMark).
    if (sig?.kind === "blockquote") {
      const startLine = i;
      const startOffset = idx.lineStartOffsets[i];
      const quoteLines = [lines[i]];
      let endLine = i;
      i++;
      while (i < lines.length) {
        if (lines[i].startsWith(">")) {
          quoteLines.push(lines[i]);
          endLine = i;
          i++;
        } else {
          break;
        }
      }
      const quoteContent = quoteLines.join("\n");
      blocks.push({
        id: generateBlockId(quoteContent, startLine),
        type: "blockquote",
        content: quoteContent,
        startOffset,
        endOffset: lineEndOffset(idx, endLine),
        startLine,
        endLine,
      });
      continue;
    }

    // LIST. Contiguous list items + indented continuation lines + a
    // single blank line BETWEEN items (consumed into the list, not as
    // a paragraph separator) when the next non-blank line is another
    // list item.
    if (sig?.kind === "list") {
      const startLine = i;
      const startOffset = idx.lineStartOffsets[i];
      const isOrdered = sig.ordered;
      const listLines = [lines[i]];
      let endLine = i;
      i++;
      while (i < lines.length) {
        const next = lines[i];
        const isBullet = /^\s*[-*+]\s/.test(next);
        const isOrderedItem = /^\s*\d+\.\s/.test(next);
        if (isBullet || isOrderedItem) {
          listLines.push(next);
          endLine = i;
          i++;
          continue;
        }
        // Single blank line between items: allowed if followed by
        // another list item. Multiple blank lines end the list.
        if (next.trim() === "" && i + 1 < lines.length) {
          const after = lines[i + 1];
          if (/^\s*[-*+]\s/.test(after) || /^\s*\d+\.\s/.test(after)) {
            listLines.push(next);
            endLine = i;
            i++;
            continue;
          }
          break;
        }
        // Indented continuation (lazy continuation of a list item).
        if (/^\s+/.test(next) && next.trim() !== "") {
          listLines.push(next);
          endLine = i;
          i++;
          continue;
        }
        break;
      }
      const listContent = listLines.join("\n");
      blocks.push({
        id: generateBlockId(listContent, startLine),
        type: "list",
        content: listContent,
        startOffset,
        endOffset: lineEndOffset(idx, endLine),
        startLine,
        endLine,
        meta: { ordered: isOrdered },
      });
      continue;
    }

    // TABLE. Header row + delimiter row + body rows (each containing
    // `|`). Ends at the first non-`|` line.
    if (sig?.kind === "tableHeader") {
      const startLine = i;
      const startOffset = idx.lineStartOffsets[i];
      const tableLines = [lines[i], lines[i + 1]];
      let endLine = i + 1;
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        endLine = i;
        i++;
      }
      const tableContent = tableLines.join("\n");
      blocks.push({
        id: generateBlockId(tableContent, startLine),
        type: "table",
        content: tableContent,
        startOffset,
        endOffset: lineEndOffset(idx, endLine),
        startLine,
        endLine,
      });
      continue;
    }

    // HTML BLOCK. Collect lines until either the matching close tag
    // or a blank line. The blank-line terminator matches the prior
    // implementation; rich CommonMark HTML block rules (types 1-7)
    // are out of scope for this rewrite.
    if (sig?.kind === "html") {
      const startLine = i;
      const startOffset = idx.lineStartOffsets[i];
      const htmlLines = [lines[i]];
      const tagName = sig.tagName;
      let endLine = i;
      i++;
      while (i < lines.length) {
        const next = lines[i];
        // Stop BEFORE a blank line (don't swallow the separator).
        if (next.trim() === "") {
          break;
        }
        htmlLines.push(next);
        endLine = i;
        // Close-tag terminator includes the closing line.
        if (new RegExp(`</${tagName}>`, "i").test(next)) {
          i++;
          break;
        }
        i++;
      }
      const htmlContent = htmlLines.join("\n");
      blocks.push({
        id: generateBlockId(htmlContent, startLine),
        type: "html",
        content: htmlContent,
        startOffset,
        endOffset: lineEndOffset(idx, endLine),
        startLine,
        endLine,
      });
      continue;
    }

    // SETEXT HEADING (text line followed by `===` or `---`). Note
    // the look-ahead must come AFTER list/blockquote/etc. signature
    // checks so a `---` thematic break or list-style line never gets
    // misclassified as a heading underline.
    if (
      i + 1 < lines.length &&
      lines[i + 1].length > 0 &&
      (/^=+\s*$/.test(lines[i + 1]) || /^-+\s*$/.test(lines[i + 1])) &&
      // Guard against the empty underline edge-case.
      lines[i + 1].trim().length >= 1
    ) {
      const startLine = i;
      const startOffset = idx.lineStartOffsets[i];
      const underline = lines[i + 1];
      const level = underline.trim()[0] === "=" ? 1 : 2;
      const headingContent = line + "\n" + underline;
      blocks.push({
        id: generateBlockId(headingContent, startLine),
        type: "heading",
        content: headingContent,
        startOffset,
        endOffset: lineEndOffset(idx, i + 1),
        startLine,
        endLine: i + 1,
        meta: { level },
      });
      i += 2;
      continue;
    }

    // PARAGRAPH (default). Consume the current non-blank line plus
    // every following non-blank line that does NOT start a new block
    // signature. A single newline between such lines is a SOFT BREAK
    // and stays inside this paragraph block.
    //
    // Triple-newline paragraph rule (Grant 2026-05-26): a SINGLE blank
    // line between text is ALSO absorbed into the paragraph (as a
    // visible empty line). Only TWO+ consecutive blank lines terminate
    // the paragraph. This raises the bar for accidentally creating a
    // new editor block via casual line spacing. The run ends at:
    //   - two or more consecutive blank lines (true paragraph break,
    //     consumed by the blank-line branch next iteration), or
    //   - a blank line immediately followed by a block signature
    //     (heading, code fence, list, etc.), or
    //   - a non-paragraph block signature on the next non-blank line,
    //     or
    //   - end of document.
    const startLine = i;
    const startOffset = idx.lineStartOffsets[i];
    const paragraphLines = [lines[i]];
    let endLine = i;
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === "") {
        // Look ahead one line to decide whether this blank is a
        // paragraph terminator or an in-paragraph spacer.
        const followed = i + 1 < lines.length ? lines[i + 1] : null;
        if (followed === null) break; // trailing blank → stop
        if (followed.trim() === "") break; // 2+ blanks → true break
        if (detectSignature(lines, i + 1) !== null) break; // blank-before-signature → stop
        // Single blank between text lines: absorb into paragraph.
        paragraphLines.push(next);
        endLine = i;
        i++;
        continue;
      }
      // Detect block signature on the next line. Pass the lines array
      // so the table-header look-ahead (which needs lines[i+1]) works.
      if (detectSignature(lines, i) !== null) break;
      // Setext underline runs through the paragraph branch as a normal
      // soft-break continuation EXCEPT when this is the second line
      // and matches the setext underline pattern. The setext detection
      // above handled the 2-line case before falling through here, so
      // by the time we're collecting paragraph continuation lines past
      // the first, treating an `===` / `---` line as setext underline
      // would be wrong (it's the body of the paragraph, not a heading).
      paragraphLines.push(next);
      endLine = i;
      i++;
    }
    const paraContent = paragraphLines.join("\n");
    blocks.push({
      id: generateBlockId(paraContent, startLine),
      type: "paragraph",
      content: paraContent,
      startOffset,
      endOffset: lineEndOffset(idx, endLine),
      startLine,
      endLine,
    });
  }

  return blocks;
}

/**
 * Find the block that contains a given character offset
 * 
 * @param blocks - Array of blocks to search
 * @param offset - Character offset to find
 * @returns The block containing the offset, or null if not found
 */
export function findBlockAtOffset(blocks: MarkdownBlock[], offset: number): MarkdownBlock | null {
  for (const block of blocks) {
    if (offset >= block.startOffset && offset < block.endOffset) {
      return block;
    }
  }
  return null;
}

/**
 * Find the block that contains a given line number
 * 
 * @param blocks - Array of blocks to search
 * @param lineNumber - Line number (0-indexed) to find
 * @returns The block containing the line, or null if not found
 */
export function findBlockAtLine(blocks: MarkdownBlock[], lineNumber: number): MarkdownBlock | null {
  for (const block of blocks) {
    if (lineNumber >= block.startLine && lineNumber <= block.endLine) {
      return block;
    }
  }
  return null;
}

/**
 * Update a block's content in the full markdown document
 * 
 * @param content - The full markdown content
 * @param block - The block to update
 * @param newBlockContent - The new content for the block
 * @returns The updated full markdown content
 */
export function updateBlockContent(
  content: string,
  block: MarkdownBlock,
  newBlockContent: string
): string {
  return (
    content.substring(0, block.startOffset) +
    newBlockContent +
    content.substring(block.endOffset)
  );
}

/**
 * Convert blank line blocks to visible spacing elements for rendering
 * This preserves the visual spacing that users intend
 * 
 * @param content - Markdown content with potential blank lines
 * @returns Content with blank lines converted to spacing divs
 */
export function preserveBlankLines(content: string): string {
  // Replace 3+ consecutive newlines with spacing divs
  // This preserves intentional spacing while keeping markdown valid
  return content.replace(/\n{3,}/g, (match) => {
    const extraLines = match.length - 2; // Keep 2 newlines for paragraph break
    const spacingDivs = Array(Math.floor(extraLines / 2))
      .fill('\n\n<div class="blank-line">&nbsp;</div>')
      .join('');
    const remaining = extraLines % 2 === 1 ? '\n' : '';
    return '\n\n' + spacingDivs + remaining;
  });
}

/**
 * Get the line number for a given character offset
 * 
 * @param content - The full content
 * @param offset - Character offset
 * @returns Line number (0-indexed)
 */
export function getLineAtOffset(content: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") {
      line++;
    }
  }
  return line;
}

/**
 * Get the character offset for the start of a given line
 * 
 * @param content - The full content
 * @param lineNumber - Line number (0-indexed)
 * @returns Character offset of line start
 */
export function getOffsetAtLine(content: string, lineNumber: number): number {
  let currentLine = 0;
  for (let i = 0; i < content.length; i++) {
    if (currentLine === lineNumber) {
      return i;
    }
    if (content[i] === "\n") {
      currentLine++;
    }
  }
  return content.length;
}

/**
 * Re-parse blocks after a specific block has been edited
 * This is optimized to only re-parse from the changed block onwards
 * 
 * @param content - The full markdown content
 * @param blocks - Current array of blocks
 * @param changedBlockId - ID of the block that was changed
 * @returns New array of blocks with updated positions
 */
export function reparseAfterBlockEdit(
  content: string,
  blocks: MarkdownBlock[],
  changedBlockId: string
): MarkdownBlock[] {
  const changedIndex = blocks.findIndex((b) => b.id === changedBlockId);
  if (changedIndex === -1) {
    return parseMarkdownBlocks(content);
  }

  // For simplicity, just re-parse everything
  // This could be optimized to only re-parse from the changed block onwards
  // but the complexity may not be worth it for typical document sizes
  return parseMarkdownBlocks(content);
}
