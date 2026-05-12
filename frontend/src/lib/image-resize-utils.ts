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
 * Rewrite a single image's textual representation to use the given width.
 *
 * Size rules:
 *  - Markdown form (`![alt](src)`) can't carry a width attribute, so picking
 *    a size promotes it to the HTML form `<img src=".." alt=".." width="N%" />`.
 *  - Picking "Remove width" (width === null) demotes HTML form back to the
 *    simpler markdown form, dropping any incidental HTML attributes — markdown
 *    form is the canonical representation when no width is needed.
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
      // Simplify back to markdown form using src + alt; other attributes are
      // dropped, which is fine because the popover's "Remove width" path is
      // meant as a reset to the canonical form.
      const srcMatch = imgText.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      const altMatch = imgText.match(/\balt\s*=\s*["']([^"']*)["']/i);
      if (srcMatch) {
        const src = srcMatch[1];
        const alt = altMatch ? altMatch[1] : "";
        return `![${alt}](${src})`;
      }
      // No src extractable — fall back to stripping the width attribute only.
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
 * Check whether an image's text representation matches the given src/alt.
 * Handles both markdown `![alt](src)` and HTML `<img src="..." alt="..." />` forms.
 */
function imageMatchesSrcAlt(imgText: string, src: string, alt: string): boolean {
  const mdMatch = imgText.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (mdMatch) {
    return mdMatch[2] === src && mdMatch[1] === alt;
  }
  const srcMatch = imgText.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  const altMatch = imgText.match(/\balt\s*=\s*["']([^"']*)["']/i);
  const imgSrc = srcMatch ? srcMatch[1] : "";
  const imgAlt = altMatch ? altMatch[1] : "";
  return imgSrc === src && imgAlt === alt;
}

/**
 * Rewrite the first image in `markdown` whose src+alt matches the given pair.
 * This is the StrictMode-safe alternative to `rewriteImageWidth` — identifying
 * images by stable React props rather than a render-time counter avoids the
 * double-render counter inflation in dev.
 *
 * Limitation: if two images share the same src+alt in the same block, only
 * the first is rewritten. For typical content (distinct file paths) this is
 * not an issue.
 */
export function rewriteImageBySrcAlt(
  markdown: string,
  src: string,
  alt: string,
  width: number | null,
): string {
  const matches = findAllImages(markdown);
  const target = matches.find((m) => imageMatchesSrcAlt(m.text, src, alt));
  if (!target) return markdown;
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
