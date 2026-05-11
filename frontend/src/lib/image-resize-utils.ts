/**
 * Helpers for rewriting image width inside markdown source.
 *
 * The on-disk format we standardize on is the HTML form so width percentages
 * survive a markdown round-trip:
 *   <img src="Images/foo.png" alt="..." width="50%" />
 *
 * Both `![alt](src)` markdown images and existing `<img ...>` tags are counted
 * in document order; pass the zero-based index of the image to rewrite.
 */

// Matches either ![alt](src) or <img ...> (counted as a single image either way).
const IMAGE_PATTERN = /(!\[([^\]]*)\]\(([^)]+)\))|(<img\b[^>]*\/?>)/gi;

interface ImageMatch {
  start: number;
  end: number;
  text: string;
}

function findAllImages(markdown: string): ImageMatch[] {
  const matches: ImageMatch[] = [];
  const re = new RegExp(IMAGE_PATTERN.source, IMAGE_PATTERN.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return matches;
}

/**
 * Rewrite a single image's textual representation to use the given width
 * (or strip the width attribute / convert to plain markdown if `width` is null).
 */
function rewriteSingleImage(imgText: string, width: number | null): string {
  // Markdown form: ![alt](src)
  const mdMatch = imgText.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (mdMatch) {
    const alt = mdMatch[1];
    const src = mdMatch[2];
    if (width === null) return `![${alt}](${src})`;
    return `<img src="${src}" alt="${alt}" width="${width}%" />`;
  }

  // HTML form: <img ...>
  if (/^<img\b/i.test(imgText)) {
    if (width === null) {
      return imgText.replace(/\s+width\s*=\s*["']?[^"'\s>]+["']?/i, "");
    }
    if (/\bwidth\s*=/i.test(imgText)) {
      return imgText.replace(/width\s*=\s*["']?[^"'\s>]+["']?/i, `width="${width}%"`);
    }
    return imgText.replace(/<img/i, `<img width="${width}%"`);
  }

  return imgText;
}

/**
 * Rewrite the `imageIndex`-th image (0-based, document order) in `markdown`
 * to use the given width percentage. Pass `width = null` to remove an existing
 * width attribute / convert HTML form back to markdown form.
 *
 * Returns the unchanged string if the index is out of range.
 */
export function rewriteImageWidth(
  markdown: string,
  imageIndex: number,
  width: number | null,
): string {
  const matches = findAllImages(markdown);
  if (imageIndex < 0 || imageIndex >= matches.length) return markdown;

  const target = matches[imageIndex];
  const replaced = rewriteSingleImage(target.text, width);
  if (replaced === target.text) return markdown;
  return markdown.substring(0, target.start) + replaced + markdown.substring(target.end);
}

/**
 * Parse a width value that may come as "50%", "50", or a number, into the
 * integer percentage. Returns null if the value isn't a recognized percentage.
 */
export function parseWidthPercent(width: string | number | undefined | null): number | null {
  if (width === undefined || width === null) return null;
  const str = String(width).trim();
  const match = str.match(/^(\d+)\s*%?$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}
