import { fileService } from "@/lib/file-system/file-service";
import { taskResultsBase } from "@/lib/tasks/results-paths";
import { imageEvents } from "@/lib/attachments/image-events";
import { encodeAttachmentRefPath } from "@/lib/utils/blob-url-resolver";
import { notesApi } from "@/lib/local-api";
import type { NoteEntry } from "@/lib/types";

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
  // Percent-encode the filename in the markdown destination so filenames with
  // spaces (e.g. a Telegram document named "gel run 2.jpg", or a batch name
  // the user typed with spaces) render inline. CommonMark truncates an
  // un-encoded destination at the first space, so `![](Images/gel run 2.jpg)`
  // is parsed as plain text and the image never renders. The encoded form
  // round-trips back to the literal on-disk name via resolvePath's decodeURI.
  // Do NOT angle-bracket as an alternative: the pre-resolve regex / <img>
  // renderer key off the raw src and don't strip CommonMark brackets.
  const markdownSnippet = `\n![${alt}](${encodeAttachmentRefPath("Images", finalFilename)})\n`;

  imageEvents.emitAttached({ basePath: base, relativePath });

  return {
    relativePath,
    absolutePath,
    finalFilename,
    markdownSnippet,
  };
}

export interface AttachImageToNoteOptions {
  /** The owner of the note (the user whose `users/<owner>/notes/<id>/` folder
   *  the image lands in). The active-note snapshot carries this. */
  ownerUsername: string;
  noteId: number;
  blob: Blob;
  suggestedFilename: string;
  /** Used as alt-text in the appended markdown image link. Defaults to the
   *  filename when omitted. */
  altText?: string;
  /** Override which entry the markdown link is appended to. When the note
   *  has more than one entry, the Telegram bot's entry-picker prompt
   *  resolves to a specific `entryId` before calling this helper. When
   *  omitted (or when the id doesn't match any entry), the helper falls
   *  back to the prior "latest entry by updated_at" behavior — keeping
   *  single-entry notes and direct in-app calls one-shot. */
  entryId?: string;
}

export interface AttachImageToNoteResult {
  /** Path relative to the note's `basePath`, e.g. `Images/foo.png`. Notes
   *  render markdown image links against this same Images/ prefix the way
   *  experiments do. */
  relativePath: string;
  /** Full path from the FS root, e.g.
   *  `users/Grant/notes/42/Images/foo.png`. */
  absolutePath: string;
  finalFilename: string;
  /** The note entry the markdown link was appended to. `null` when the
   *  note had no entries on disk — in that case the caller wrote a fresh
   *  entry containing only the image link. */
  appendedToEntryId: string | null;
}

/**
 * Write an image blob into a note's `Images/` folder and append a markdown
 * image link to the note's latest entry.
 *
 * Mirrors `attachImageToTask` for the on-disk write (same dedupe / blob
 * write / sidecar layout), then layers the note-specific behavior on top:
 *
 *   1. Files land under `users/<owner>/notes/<id>/Images/...`. This matches
 *      the `basePath` NoteDetailPopup uses for inline-drag attachments, so
 *      the bottom ImageStrip on the note popup sees Telegram-sent images
 *      the same way it sees drag-uploaded ones.
 *   2. The markdown image link (`![alt](Images/name.ext)`) is appended to
 *      the LATEST note entry's `content`. "Latest" = the entry with the
 *      most-recent `updated_at`; for running-log notes the user typically
 *      has the most-recent entry tabbed open, and for single-entry notes
 *      there's only one entry to pick.
 *   3. When the note has zero entries, a fresh entry dated today (titled
 *      "Photos") is created and the link goes into its content. This keeps
 *      the photo discoverable in the note body — without an entry the link
 *      has nowhere to live.
 *   4. `note.updated_at` is bumped via the `updateEntry`/`addEntry` calls
 *      so the note's sort order on the dashboard reflects the new arrival.
 */
export async function attachImageToNote(
  opts: AttachImageToNoteOptions
): Promise<AttachImageToNoteResult> {
  // Defensive: a falsy / empty owner produced `users//notes/<id>/...` which
  // `atomicWrite` silently collapsed via `path.split("/").filter(Boolean)`
  // to `users/notes/<id>/...` — a top-level folder the note popup never
  // reads from. Caller bug (NoteDetailPopup passing an empty `note.username`
  // through `setActiveNote`) is fixed upstream; this throw makes the same
  // class of regression loud instead of silent if it recurs.
  if (!opts.ownerUsername) {
    throw new Error(
      `attachImageToNote: ownerUsername is required (got "${opts.ownerUsername}")`,
    );
  }
  const base = `users/${opts.ownerUsername}/notes/${opts.noteId}`;
  const imagesDir = `${base}/Images`;
  const finalFilename = await pickUniqueFilename(imagesDir, opts.suggestedFilename);
  const absolutePath = `${imagesDir}/${finalFilename}`;
  await fileService.writeFileFromBlob(absolutePath, opts.blob);

  const relativePath = `Images/${finalFilename}`;
  const alt = opts.altText ?? opts.suggestedFilename;
  // Percent-encode the destination so spaced filenames render inline — see
  // attachImageToTask for the CommonMark-truncation rationale.
  const markdownLink = `\n![${alt}](${encodeAttachmentRefPath("Images", finalFilename)})\n`;

  imageEvents.emitAttached({ basePath: base, relativePath });

  // Append to the latest entry — or create a fresh one if the note has no
  // entries yet. Use the owner-scoped variants so the write lands in the
  // note owner's folder (the Telegram bot may be running on the owner's
  // session, so this is usually a no-op for ownership, but the explicit
  // owner arg keeps the path consistent with TaskDetailPopup's pattern).
  const note = await notesApi.get(opts.noteId, opts.ownerUsername);
  let appendedToEntryId: string | null = null;
  if (note && note.entries.length > 0) {
    // Caller-picked entry wins when present and resolvable. Multi-entry
    // notes route through the Telegram bot's entry picker, which passes
    // the user-chosen `entryId` back here. Fall back to the latest entry
    // when the override is omitted OR points at an entry that no longer
    // exists (the note got edited between the prompt and the commit).
    const overridden =
      opts.entryId != null
        ? note.entries.find((e) => e.id === opts.entryId) ?? null
        : null;
    const target = overridden ?? pickLatestEntry(note.entries);
    if (target) {
      const newContent = `${target.content}${markdownLink}`;
      await notesApi.updateEntry(
        opts.noteId,
        target.id,
        { content: newContent },
        opts.ownerUsername,
      );
      appendedToEntryId = target.id;
    }
  } else if (note) {
    const today = todayLocalDate();
    const created = await notesApi.addEntry(
      opts.noteId,
      {
        title: "Photos",
        date: today,
        content: markdownLink,
      },
      opts.ownerUsername,
    );
    const newest = created?.entries[created.entries.length - 1];
    appendedToEntryId = newest?.id ?? null;
  }

  return {
    relativePath,
    absolutePath,
    finalFilename,
    appendedToEntryId,
  };
}

function pickLatestEntry(entries: NoteEntry[]): NoteEntry | null {
  if (entries.length === 0) return null;
  let best = entries[0];
  for (const e of entries) {
    if (new Date(e.updated_at).getTime() > new Date(best.updated_at).getTime()) {
      best = e;
    }
  }
  return best;
}

function todayLocalDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
