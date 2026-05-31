/**
 * image-widget.ts: the inline image widget for the CM6 inline-reveal layer
 * (Typora editor chip 2b).
 *
 * When the caret is NOT inside a markdown Image node ( ![alt](src) ), the node
 * is collapsed into an inline Decoration.replace({ widget }) that renders the
 * resolved <img>. Reveal-on-caret is the same selectionSet trigger as the inline
 * markers: caret in -> no widget -> the raw ![alt](src) source shows as editable
 * text.
 *
 * Source resolution mirrors the LiveMarkdownEditor preview exactly:
 *   - The alt / width / src are routed through markdownSanitizeSchema
 *     (allowComments:true) by rendering the ![alt](src) markdown through the
 *     shared render-html pipeline, so a malicious src scheme or attribute is
 *     stripped before it ever reaches the DOM.
 *   - For a LOCAL path (Images/... etc.) we then imperatively override the src
 *     with a blob URL from the existing blobUrlResolver (resolvePath +
 *     getBlobUrl), the SAME singleton + base-path convention the wrapper uses.
 *     A transparent placeholder shows until the async resolve completes, so the
 *     browser never requests (and 404s on) the raw relative path. This blob swap
 *     is deliberately OUTSIDE sanitize: blob: is not an allowed src scheme, and
 *     the URL is produced locally from a file the user already has, exactly as
 *     the React <img> renderer does.
 *
 * View-only: the widget renders a slice of the unchanged document plus a locally
 * minted blob URL. It never dispatches a transaction, so the round-trip holds.
 *
 * House style: no em-dashes, no emojis.
 */

import { WidgetType } from "@codemirror/view";

import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";

import { renderImageHtml } from "./render-html";

/** Transparent 1x1 GIF placeholder while a local blob URL resolves. */
const IMAGE_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Inline image widget. Constructed with the raw Image-node source slice (the
 * full ![alt](src) text) and the editor image base path so relative srcs resolve
 * the same way the preview does.
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly basePath: string | undefined,
  ) {
    super();
  }

  /**
   * Same source + base path -> identical widget, so CM6 keeps the DOM (and does
   * not re-resolve the blob URL). The declared param is WidgetType because TS
   * cannot express that CM6 only passes same-type instances; we guard with
   * instanceof before reading the fields.
   */
  eq(other: WidgetType): boolean {
    return (
      other instanceof ImageWidget &&
      other.source === this.source &&
      other.basePath === this.basePath
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-inline-image";
    wrap.contentEditable = "false";
    // Render the ![alt](src) markdown through the sanitize pipeline, then adopt
    // the sanitized <img> so alt / width / external src are validated. innerHTML
    // is safe here: render-html routes through markdownSanitizeSchema.
    wrap.innerHTML = renderImageHtml(this.source);
    const img = wrap.querySelector("img");
    if (img) {
      const originalSrc = img.getAttribute("src") ?? "";
      if (originalSrc && blobUrlResolver.isLocalPath(originalSrc)) {
        // Local path: placeholder now, blob URL when the async read returns.
        img.setAttribute("data-orig-src", originalSrc);
        img.setAttribute("src", IMAGE_PLACEHOLDER);
        const resolvedPath = blobUrlResolver.resolvePath(originalSrc, this.basePath);
        const cached = blobUrlResolver.getCachedUrl(resolvedPath);
        if (cached) {
          img.setAttribute("src", cached);
        } else {
          void blobUrlResolver.getBlobUrl(resolvedPath).then((url) => {
            // The widget may have been destroyed between the await and the
            // resolve; guard on the still-connected DOM node.
            if (url && img.isConnected) img.setAttribute("src", url);
          });
        }
      }
    }
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
