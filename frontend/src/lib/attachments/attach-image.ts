import { fileService } from "@/lib/file-system/file-service";
import { taskResultsBase } from "@/lib/tasks/results-paths";
import { imageEvents } from "@/lib/attachments/image-events";

function splitFilenameExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

async function pickUniqueFilename(dirPath: string, desired: string): Promise<string> {
  const { stem, ext } = splitFilenameExt(desired);
  let candidate = desired;
  let n = 1;
  while (await fileService.fileExists(`${dirPath}/${candidate}`)) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

export interface AttachImageOptions {
  ownerUsername: string;
  taskId: number;
  /** Override the default `users/{owner}/results/task-{id}` base. Used when the
   *  caller has already resolved a legacy path or is routing to an inbox. */
  basePath?: string;
  blob: Blob;
  suggestedFilename: string;
  /** Used as alt-text in the markdown snippet. Defaults to `suggestedFilename`. */
  altText?: string;
}

export interface AttachImageResult {
  /** Path relative to the markdown file, e.g. `Images/foo.png`. */
  relativePath: string;
  /** Full path from the FS root, e.g. `users/Grant/results/task-5/Images/foo.png`. */
  absolutePath: string;
  finalFilename: string;
  /** Ready-to-insert markdown snippet, surrounded by newlines. */
  markdownSnippet: string;
}

/**
 * Write an image blob into a task's `Images/` folder with deduplicated naming
 * and return the relative path plus a ready-to-insert markdown snippet. The
 * caller decides whether to append the snippet; the Telegram inbound path
 * skips the append so the user can drag the thumbnail in manually later.
 */
export async function attachImageToTask(opts: AttachImageOptions): Promise<AttachImageResult> {
  const base =
    opts.basePath ?? taskResultsBase({ id: opts.taskId, owner: opts.ownerUsername });
  const imagesDir = `${base}/Images`;
  const finalFilename = await pickUniqueFilename(imagesDir, opts.suggestedFilename);
  const absolutePath = `${imagesDir}/${finalFilename}`;
  await fileService.writeFileFromBlob(absolutePath, opts.blob);

  const relativePath = `Images/${finalFilename}`;
  const alt = opts.altText ?? opts.suggestedFilename;
  // NOTE: do NOT angle-bracket the URL here. The HybridMarkdownEditor's
  // pre-resolve regex and the <img> renderer both key off the raw src
  // and don't strip CommonMark brackets, so wrapping in <> breaks the
  // blob-URL cache lookup. The trade-off: filenames with spaces still
  // don't render inline (see the renderer's `[^)\s]+` capture at
  // HybridMarkdownEditor.tsx:568). That's a separate fix.
  const markdownSnippet = `\n![${alt}](${relativePath})\n`;

  imageEvents.emitAttached({ basePath: base, relativePath });

  return {
    relativePath,
    absolutePath,
    finalFilename,
    markdownSnippet,
  };
}
