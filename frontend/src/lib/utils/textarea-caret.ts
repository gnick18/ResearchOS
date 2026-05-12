/**
 * Compute the character offset inside a textarea that corresponds to a given
 * client-coordinate point. Browsers don't expose this natively — `document.
 * caretRangeFromPoint` and `caretPositionFromPoint` only work on
 * contentEditable, not textareas — so we render an off-screen mirror `<div>`
 * styled identically to the textarea's text area, place a marker at each
 * candidate offset, and pick the offset whose rendered position is closest
 * to the drop point.
 *
 * Used to insert dragged thumbnails at the exact spot the user dropped
 * them, rather than at the textarea's pre-drag caret.
 */

const COPIED_STYLE_PROPS: ReadonlyArray<keyof CSSStyleDeclaration> = [
  "boxSizing",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "fontVariant",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "wordSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "whiteSpace",
  "wordWrap",
  "overflowWrap",
  "tabSize",
  "textIndent",
];

function buildMirror(textarea: HTMLTextAreaElement): HTMLDivElement {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  for (const prop of COPIED_STYLE_PROPS) {
    (mirror.style as unknown as Record<string, string>)[prop as string] =
      computed[prop as keyof CSSStyleDeclaration] as string;
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "-9999px";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.height = "auto";
  // Match the textarea's inner content width so wrapping is identical.
  mirror.style.width = `${textarea.clientWidth}px`;
  document.body.appendChild(mirror);
  return mirror;
}

/**
 * Return the character offset in `textarea.value` whose rendered glyph is
 * closest to the given client coordinates. Falls back to the textarea's
 * current `selectionStart` if measurement fails (e.g. detached node).
 */
export function caretOffsetFromPoint(
  textarea: HTMLTextAreaElement,
  clientX: number,
  clientY: number
): number {
  const text = textarea.value;
  if (text.length === 0) return 0;

  const rect = textarea.getBoundingClientRect();
  const computed = window.getComputedStyle(textarea);
  const lineHeight =
    parseFloat(computed.lineHeight) ||
    parseFloat(computed.fontSize) * 1.2 ||
    16;

  // Coordinates relative to the textarea's content (account for scroll +
  // padding/border already because the mirror inherits those).
  const localX = clientX - rect.left + textarea.scrollLeft;
  const localY = clientY - rect.top + textarea.scrollTop;

  const mirror = buildMirror(textarea);
  try {
    const prefixNode = document.createTextNode("");
    const marker = document.createElement("span");
    marker.textContent = "​"; // zero-width space
    const suffixNode = document.createTextNode("");
    mirror.append(prefixNode, marker, suffixNode);
    const mirrorRect = mirror.getBoundingClientRect();

    function measureAt(offset: number): { x: number; y: number } {
      prefixNode.nodeValue = text.slice(0, offset);
      // Render the rest so wrapping matches. If the offset is at the end,
      // an empty trailing node still gives a sane position for the marker.
      suffixNode.nodeValue = text.slice(offset);
      const mr = marker.getBoundingClientRect();
      return { x: mr.left - mirrorRect.left, y: mr.top - mirrorRect.top };
    }

    function distance(p: { x: number; y: number }): number {
      // Prefer matching the line first; within the right line, prefer the
      // closest x. Off-line candidates pay a heavy y-penalty so the search
      // settles on the dropped line even with large x deltas.
      const dy = Math.abs(p.y - localY);
      const dx = Math.abs(p.x - localX);
      return dy > lineHeight / 2 ? dy * 1000 + dx : dx;
    }

    let bestOffset = 0;
    let bestDist = Infinity;

    // Coarse pass: probe ~100 evenly-spaced offsets to localize the line.
    const stepSize = Math.max(1, Math.floor(text.length / 100));
    for (let i = 0; i <= text.length; i += stepSize) {
      const pos = measureAt(i);
      const d = distance(pos);
      if (d < bestDist) {
        bestDist = d;
        bestOffset = i;
      }
    }

    // Refine: scan every offset within one step of the best so far.
    const from = Math.max(0, bestOffset - stepSize);
    const to = Math.min(text.length, bestOffset + stepSize);
    for (let i = from; i <= to; i++) {
      const pos = measureAt(i);
      const d = distance(pos);
      if (d < bestDist) {
        bestDist = d;
        bestOffset = i;
      }
    }

    return bestOffset;
  } catch {
    return textarea.selectionStart ?? 0;
  } finally {
    document.body.removeChild(mirror);
  }
}
