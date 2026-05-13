/**
 * Orphaned-attachment garbage collection for any markdown surface that
 * stores its files under `${basePath}/Images/` and `${basePath}/Files/`.
 *
 * Originally lived inline in `TaskDetailPopup.tsx`. Extracted so notes
 * (which auto-save and have no Save button) can call the same logic
 * without the two copies drifting.
 */

import { fileService } from "@/lib/file-system/file-service";

// Capture everything between (...) up to the closing paren, lazily. This
// MUST tolerate whitespace inside the URL — filenames like "Emile ID
// card-1.jpg" are legal on disk, and the original `[^)\s]+` truncated
// them at the first space, which made GC sweep them as unreferenced.
const IMG_REF_REGEX = /!\[[^\]]*\]\(([^)\n]+?)\)/g;
const HTML_IMG_REF_REGEX = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;

export function referencedRelativeNames(
  markdown: string,
  subdir: "Images" | "Files",
): Set<string> {
  const prefix = `${subdir}/`;
  const referenced = new Set<string>();
  const collect = (regex: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(markdown)) !== null) {
      let src = m[1].trim();
      // Strip a CommonMark title: `url "title"` or `url 'title'`. The lazy
      // regex above captures everything inside (...), title included; split
      // here so the title doesn't pollute the path lookup.
      const titleMatch = src.match(/^(.+?)\s+["'].*["']\s*$/);
      if (titleMatch) src = titleMatch[1].trim();
      // Strip angle brackets if the URL was bracketed for safe spaces.
      if (src.startsWith("<") && src.endsWith(">")) src = src.slice(1, -1);
      if (src.startsWith("./")) src = src.slice(2);
      // Strip query/anchor noise.
      const trimmed = src.split("#")[0].split("?")[0];
      if (!trimmed.includes(`${prefix}`)) continue;

      // Treat both same-folder refs (`Images/foo.png`) and legacy
      // subfolder refs (`Images/Mar-02-2026.../foo.png`) as protecting the
      // top-level basename `foo.png` from GC. That's the *only* place
      // GC can delete from anyway (`listFiles` doesn't recurse), so we
      // need to avoid sweeping out files whose only references in the
      // markdown happen to use a stale subdirectory path. Without this,
      // dragging one image to the trash also wipes out any sibling whose
      // only refs were subfolder-style.
      const afterPrefix = trimmed.slice(trimmed.indexOf(prefix) + prefix.length);
      if (!afterPrefix) continue;
      const segments = afterPrefix.split("/").filter(Boolean);
      const basename = segments[segments.length - 1];
      if (basename) referenced.add(basename);
    }
  };
  collect(new RegExp(IMG_REF_REGEX.source, "g"));
  collect(new RegExp(HTML_IMG_REF_REGEX.source, "gi"));
  return referenced;
}

/**
 * After saving a notes/results markdown file, remove any files in
 * `${basePath}/Images/` or `${basePath}/Files/` that are no longer referenced.
 * Failures are swallowed (best-effort cleanup; not safety-critical).
 */
export async function gcUnreferencedAttachments(
  markdown: string,
  basePath: string,
): Promise<void> {
  for (const subdir of ["Images", "Files"] as const) {
    const dirPath = `${basePath}/${subdir}`;
    const dirHandle = await fileService.getDirectory(dirPath);
    if (!dirHandle) continue;
    const onDisk = await fileService.listFiles(dirPath);
    const referenced = referencedRelativeNames(markdown, subdir);
    for (const name of onDisk) {
      if (!referenced.has(name)) {
        await fileService.deleteFile(`${dirPath}/${name}`);
      }
    }
  }
}
