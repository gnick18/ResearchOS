/**
 * Markdown Block Parser
 * 
 * Parses markdown content into blocks for the hybrid editor mode.
 * Each block represents a logical unit that can be edited independently:
 * - Paragraphs, headings, code blocks, blockquotes, lists, tables, etc.
 * - Blank lines are tracked as separate blocks for preservation
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
 * Count the number of newlines in a string
 */
function countNewlines(str: string): number {
  let count = 0;
  for (const char of str) {
    if (char === "\n") count++;
  }
  return count;
}

/**
 * Parse markdown content into an array of blocks
 * 
 * @param content - The markdown content to parse
 * @returns Array of MarkdownBlock objects
 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  
  if (!content) {
    return blocks;
  }

  let currentOffset = 0;
  let currentLine = 0;
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const lineStartOffset = currentOffset;
    const lineStartLine = currentLine;

    // Update position tracking
    currentOffset += line.length + 1; // +1 for newline
    currentLine++;

    // Check for blank line
    if (line.trim() === "") {
      // Group consecutive blank lines
      let blankEndLine = lineStartLine;
      let blankEndOffset = currentOffset;
      let blankContent = line;

      while (i + 1 < lines.length && lines[i + 1].trim() === "") {
        i++;
        blankContent += "\n" + lines[i];
        blankEndLine = currentLine;
        blankEndOffset = currentOffset;
        currentOffset += lines[i].length + 1;
        currentLine++;
      }

      blocks.push({
        id: generateBlockId(blankContent, lineStartLine),
        type: "blankLine",
        content: blankContent,
        startOffset: lineStartOffset,
        endOffset: blankEndOffset,
        startLine: lineStartLine,
        endLine: blankEndLine,
      });

      i++;
      continue;
    }

    // Check for fenced code block
    if (line.startsWith("```") || line.startsWith("~~~")) {
      const fenceChar = line[0];
      const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)/);
      
      if (fenceMatch) {
        const fence = fenceMatch[1];
        const language = fenceMatch[2] || "";
        const codeBlockLines = [line];
        let codeEndLine = lineStartLine;
        let codeEndOffset = currentOffset;
        let foundEnd = false;

        // Find the closing fence
        while (i + 1 < lines.length) {
          i++;
          const nextLine = lines[i];
          codeBlockLines.push(nextLine);
          codeEndLine = currentLine;
          codeEndOffset = currentOffset;
          currentOffset += nextLine.length + 1;
          currentLine++;

          // Check for closing fence (must match or exceed opening fence length)
          if (nextLine.startsWith(fenceChar) && nextLine.match(new RegExp(`^${fenceChar.charAt(0)}{${fence.length},}`))) {
            foundEnd = true;
            break;
          }
        }

        const codeContent = codeBlockLines.join("\n");
        blocks.push({
          id: generateBlockId(codeContent, lineStartLine),
          type: "codeBlock",
          content: codeContent,
          startOffset: lineStartOffset,
          endOffset: codeEndOffset,
          startLine: lineStartLine,
          endLine: codeEndLine,
          meta: { language },
        });

        i++;
        continue;
      }
    }

    // Check for heading (ATX style: # Heading)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push({
        id: generateBlockId(line, lineStartLine),
        type: "heading",
        content: line,
        startOffset: lineStartOffset,
        endOffset: currentOffset,
        startLine: lineStartLine,
        endLine: lineStartLine,
        meta: { level },
      });
      i++;
      continue;
    }

    // Check for heading (Setext style: Heading\n======)
    if (i + 1 < lines.length && (lines[i + 1].match(/^[=-]+$/) || lines[i + 1].match(/^[=-]{2,}$/))) {
      const headingLine = line;
      const underlineLine = lines[i + 1];
      const level = underlineLine[0] === "=" ? 1 : 2;
      const headingContent = headingLine + "\n" + underlineLine;

      blocks.push({
        id: generateBlockId(headingContent, lineStartLine),
        type: "heading",
        content: headingContent,
        startOffset: lineStartOffset,
        endOffset: currentOffset + underlineLine.length + 1,
        startLine: lineStartLine,
        endLine: lineStartLine + 1,
        meta: { level },
      });

      i += 2;
      currentOffset += underlineLine.length + 1;
      currentLine++;
      continue;
    }

    // Check for thematic break (horizontal rule)
    if (line.match(/^(-{3,}|\*{3,}|_{3,})$/) || line.match(/^(-\s*){3,}$/) || line.match(/^(\*\s*){3,}$/) || line.match(/^(_\s*){3,}$/)) {
      blocks.push({
        id: generateBlockId(line, lineStartLine),
        type: "thematicBreak",
        content: line,
        startOffset: lineStartOffset,
        endOffset: currentOffset,
        startLine: lineStartLine,
        endLine: lineStartLine,
      });
      i++;
      continue;
    }

    // Check for blockquote
    if (line.startsWith(">")) {
      const quoteLines = [line];
      let quoteEndLine = lineStartLine;
      let quoteEndOffset = currentOffset;

      // Collect consecutive blockquote lines
      while (i + 1 < lines.length && (lines[i + 1].startsWith(">") || (lines[i + 1].trim() === "" && i + 2 < lines.length && lines[i + 2].startsWith(">")))) {
        i++;
        quoteLines.push(lines[i]);
        quoteEndLine = currentLine;
        quoteEndOffset = currentOffset;
        currentOffset += lines[i].length + 1;
        currentLine++;
      }

      const quoteContent = quoteLines.join("\n");
      blocks.push({
        id: generateBlockId(quoteContent, lineStartLine),
        type: "blockquote",
        content: quoteContent,
        startOffset: lineStartOffset,
        endOffset: quoteEndOffset,
        startLine: lineStartLine,
        endLine: quoteEndLine,
      });

      i++;
      continue;
    }

    // Check for list (bullet or ordered)
    const bulletMatch = line.match(/^(\s*)([-*+])\s/);
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s/);
    
    if (bulletMatch || orderedMatch) {
      const isOrdered = !!orderedMatch;
      const listLines = [line];
      let listEndLine = lineStartLine;
      let listEndOffset = currentOffset;
      const listIndent = (bulletMatch || orderedMatch)![1].length;

      // Collect consecutive list items (including nested items and blank lines between)
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        
        // Check if it's another list item (possibly nested)
        const nextBulletMatch = nextLine.match(/^(\s*)([-*+])\s/);
        const nextOrderedMatch = nextLine.match(/^(\s*)(\d+)\.\s/);
        
        if (nextBulletMatch || nextOrderedMatch) {
          i++;
          listLines.push(nextLine);
          listEndLine = currentLine;
          listEndOffset = currentOffset;
          currentOffset += nextLine.length + 1;
          currentLine++;
        } else if (nextLine.trim() === "" && i + 2 < lines.length) {
          // Blank line - check if there's more list content after
          const afterBlankLine = lines[i + 2];
          const afterBulletMatch = afterBlankLine.match(/^(\s*)([-*+])\s/);
          const afterOrderedMatch = afterBlankLine.match(/^(\s*)(\d+)\.\s/);
          
          if (afterBulletMatch || afterOrderedMatch) {
            // Include blank line in list
            i++;
            listLines.push(nextLine);
            listEndLine = currentLine;
            listEndOffset = currentOffset;
            currentOffset += nextLine.length + 1;
            currentLine++;
          } else {
            break;
          }
        } else if (nextLine.match(/^\s+/) && nextLine.trim() !== "") {
          // Indented content (continuation of list item)
          i++;
          listLines.push(nextLine);
          listEndLine = currentLine;
          listEndOffset = currentOffset;
          currentOffset += nextLine.length + 1;
          currentLine++;
        } else {
          break;
        }
      }

      const listContent = listLines.join("\n");
      blocks.push({
        id: generateBlockId(listContent, lineStartLine),
        type: "list",
        content: listContent,
        startOffset: lineStartOffset,
        endOffset: listEndOffset,
        startLine: lineStartLine,
        endLine: listEndLine,
        meta: { ordered: isOrdered },
      });

      i++;
      continue;
    }

    // Check for table
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s-:|]+\|?$/)) {
      const tableLines = [line, lines[i + 1]];
      let tableEndLine = lineStartLine + 1;
      let tableEndOffset = currentOffset + lines[i + 1].length + 1;

      currentOffset += lines[i + 1].length + 1;
      currentLine++;
      i += 2;

      // Collect table body rows
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        tableEndLine = currentLine;
        tableEndOffset = currentOffset;
        currentOffset += lines[i].length + 1;
        currentLine++;
        i++;
      }

      const tableContent = tableLines.join("\n");
      blocks.push({
        id: generateBlockId(tableContent, lineStartLine),
        type: "table",
        content: tableContent,
        startOffset: lineStartOffset,
        endOffset: tableEndOffset,
        startLine: lineStartLine,
        endLine: tableEndLine,
      });

      continue;
    }

    // Check for HTML block
    if (line.match(/^<(div|p|ul|ol|li|table|pre|blockquote|h[1-6]|script|style|iframe|form|article|section|nav|aside|header|footer|main|figure|figcaption)/i)) {
      const htmlLines = [line];
      let htmlEndLine = lineStartLine;
      let htmlEndOffset = currentOffset;
      const tagName = line.match(/^<(\w+)/i)?.[1]?.toLowerCase();
      
      // Simple HTML block detection - collect until closing tag or blank line
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        
        // Check for closing tag
        if (tagName && nextLine.match(new RegExp(`</${tagName}>`, "i"))) {
          i++;
          htmlLines.push(nextLine);
          htmlEndLine = currentLine;
          htmlEndOffset = currentOffset;
          currentOffset += nextLine.length + 1;
          currentLine++;
          break;
        }
        
        // Stop at blank line for self-contained HTML blocks
        if (nextLine.trim() === "") {
          break;
        }
        
        i++;
        htmlLines.push(nextLine);
        htmlEndLine = currentLine;
        htmlEndOffset = currentOffset;
        currentOffset += nextLine.length + 1;
        currentLine++;
      }

      const htmlContent = htmlLines.join("\n");
      blocks.push({
        id: generateBlockId(htmlContent, lineStartLine),
        type: "html",
        content: htmlContent,
        startOffset: lineStartOffset,
        endOffset: htmlEndOffset,
        startLine: lineStartLine,
        endLine: htmlEndLine,
      });

      i++;
      continue;
    }

    // Default: treat as paragraph
    // Collect consecutive non-blank lines that don't start another block
    const paragraphLines = [line];
    let paraEndLine = lineStartLine;
    let paraEndOffset = currentOffset;

    while (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      
      // Stop at blank line
      if (nextLine.trim() === "") break;
      
      // Stop at block starts
      if (
        nextLine.startsWith("#") ||
        nextLine.startsWith(">") ||
        nextLine.startsWith("```") ||
        nextLine.startsWith("~~~") ||
        nextLine.match(/^[-*+]\s/) ||
        nextLine.match(/^\d+\.\s/) ||
        nextLine.match(/^(-{3,}|\*{3,}|_{3,})$/) ||
        (nextLine.includes("|") && i + 2 < lines.length && lines[i + 2]?.match(/^\|?[\s-:|]+\|?$/))
      ) {
        break;
      }

      i++;
      paragraphLines.push(nextLine);
      paraEndLine = currentLine;
      paraEndOffset = currentOffset;
      currentOffset += nextLine.length + 1;
      currentLine++;
    }

    const paraContent = paragraphLines.join("\n");
    blocks.push({
      id: generateBlockId(paraContent, lineStartLine),
      type: "paragraph",
      content: paraContent,
      startOffset: lineStartOffset,
      endOffset: paraEndOffset,
      startLine: lineStartLine,
      endLine: paraEndLine,
    });

    i++;
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
