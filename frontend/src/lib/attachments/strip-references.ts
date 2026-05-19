// frontend/src/lib/attachments/strip-references.ts
//
// Story: When a user deletes an attachment from a task's `Images/` or
// `Files/` folder, any inline references to that file in the surrounding
// markdown body (`![alt](Images/foo.png)` or `[doc](Files/bar.pdf)`)
// become dangling — they render as a broken-image popup that asks the
// user to manually clean up.
//
// This helper removes those references in one pass so the popup never
// fires for the common "deleted from this experiment" case. It is
// pure-string (sync); each delete site is responsible for passing the
// current editor value and applying the returned string via its existing
// onChange wiring. That matches the per-tab editor model from
// `1613be79` — the helper has no concept of which markdown file lives on
// disk; it operates on whichever body the caller currently owns.
//
// Both Image and File trash drop-zones previously inlined nearly-identical
// versions of this logic (the Image one missed URL-encoded filenames).
// Centralising fixes that gap and gives any future per-item delete a
// single seam to call.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type AttachmentKind = "Images" | "Files";

/**
 * Remove every markdown + HTML reference to `${kind}/${filename}` from a
 * markdown body. Returns the (possibly unchanged) markdown.
 *
 * Handles:
 *   - Markdown image refs:   `![alt](Images/foo.png "optional title")`
 *   - Markdown file links:   `[label](Files/bar.pdf)`
 *   - HTML `<img>` tags:     `<img src="Images/foo.png" ...>`
 *   - HTML `<a>` tags:       `<a href="Files/bar.pdf">label</a>`
 *   - URL-encoded filenames: a filename with spaces lands as
 *     `Files/READ%20ME.md` in markdown; both raw and percent-encoded
 *     forms are matched.
 *
 * Image refs are stripped only when `kind === "Images"`, file refs only
 * when `kind === "Files"`. This keeps deletes scoped to the right
 * subtree so a file-side delete never accidentally rips out an image
 * reference that happens to share a stem.
 *
 * Idempotent / no-op when no matching ref exists.
 */
export function stripAttachmentReferences(
  markdown: string,
  filename: string,
  kind: AttachmentKind
): string {
  if (!filename) return markdown;
  const variants = new Set([filename, encodeURIComponent(filename)]);
  let next = markdown;
  for (const variant of variants) {
    const esc = escapeRegExp(variant);
    if (kind === "Images") {
      // Markdown image: ![alt](Images/foo.png "optional title")
      const mdRe = new RegExp(
        `!\\[[^\\]]*\\]\\([^)]*Images/${esc}[^)]*\\)\\s*`,
        "g"
      );
      // HTML <img src="...Images/foo.png...">
      const htmlRe = new RegExp(
        `<img\\s+[^>]*src=["'][^"']*Images/${esc}[^"']*["'][^>]*>\\s*`,
        "gi"
      );
      next = next.replace(mdRe, "").replace(htmlRe, "");
    } else {
      // Markdown link: [label](Files/bar.pdf) — the negative-lookbehind
      // for `!` skips the image form so a Files-side strip can never
      // pull out an image accidentally.
      const mdRe = new RegExp(
        `(?<!!)\\[[^\\]]*\\]\\([^)]*Files/${esc}[^)]*\\)\\s*`,
        "g"
      );
      // HTML <a href="...Files/bar.pdf">label</a>
      const htmlRe = new RegExp(
        `<a\\s+[^>]*href=["'][^"']*Files/${esc}[^"']*["'][^>]*>[^<]*</a>\\s*`,
        "gi"
      );
      next = next.replace(mdRe, "").replace(htmlRe, "");
    }
  }
  return next;
}
