/**
 * Centralized duplicate-filename detection for user-driven file uploads.
 *
 * The collision-handling logic in ResearchOS used to live in 5+ different
 * upload surfaces (LiveMarkdownEditor capture-phase listener, FileStrip,
 * TaskDetailPopup universal drop, NoteDetailPopup file picker, InboxPanel
 * send-to-task), each of which silently auto-suffixed the dropped filename
 * via its own copy of `pickUniqueFilename`. The result: a user dropping
 * `gel.png` onto a folder that already had `gel.png` would silently get
 * `gel-1.png` (or `gel (2).png` in the ELN pipeline) with no UI signal.
 *
 * This module centralizes the partition of a dropped-files batch into
 *   1. "no collision" (safe to write as-is)
 *   2. "needs user decision" (one `DuplicateInfo` per collision)
 *
 * The dialog component `<DuplicateUploadDialog>` consumes the `collisions`
 * array and surfaces a Rename / Replace / Cancel choice. The wrapper hook
 * `useDuplicateResolver` walks the queue and returns a `Map` of resolutions.
 *
 * Suffix convention: `foo.png` → `foo (1).png` → `foo (2).png` if `(1)` is
 * also taken, etc. Matches the ELN apply pipeline's style — see
 * `pickUniqueImageFilename` in `lib/import/eln/sidecar-lookup.ts`. The
 * legacy `-1`/`-2` style used by `attach-image.ts` and `move-image.ts` is
 * NOT preserved by this helper; the centralized helper standardizes on
 * `(N)` because the new dialog surfaces the suggestion to the user, and
 * `(1)` reads more naturally than `-1`.
 *
 * Case sensitivity: the `existingNames` comparison is exact-match
 * (case-sensitive) by default — this matches FSA / OPFS / file-service
 * semantics on Linux, which is what the user's directory handle exposes.
 * On macOS / Windows with case-insensitive backing stores the user's OS
 * will surface the collision via its own mechanism if our exact-match
 * misses it (we'd still write to disk; the OS would either alias or
 * reject). v1 doesn't unicode-normalize; a `café.png` drop alongside an
 * existing `café.png` with different NFC/NFD encodings would slip past.
 * That's an edge case worth tracking — see the §8 entry.
 */

function splitFilenameExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Generate the next available "(N)" suffix that doesn't collide with
 * `existingNames`. Counter starts at 1 so the user sees "foo (1).png"
 * rather than the import-pipeline's "foo (2).png" — the latter looks
 * weird in the dialog ("(2) implies (1) already exists, but it doesn't").
 *
 * Pathological cap: bails after 1000 iterations with a timestamp suffix
 * to keep the function total. The dialog never surfaces this case
 * because 1000 collisions on a single name is operator error.
 */
export function suggestUniqueName(
  desired: string,
  existingNames: ReadonlySet<string>,
): string {
  if (!existingNames.has(desired)) return desired;
  const { stem, ext } = splitFilenameExt(desired);
  for (let n = 1; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

export interface DuplicateInfo {
  /** The file the user dropped / picked. */
  file: File;
  /** The filename that collides at the destination (== `file.name`). */
  existingName: string;
  /** Suggested non-colliding name, e.g. `foo (1).png`. Generated up front
   *  so the dialog can show it before the user has to think. */
  suggestedName: string;
}

export interface DuplicateUploadCheckResult {
  /** No collision — safe to write to disk as-is. */
  uniqueFiles: File[];
  /** Need user decision via the dialog. */
  collisions: DuplicateInfo[];
}

/**
 * Partition a batch of dropped/picked files into "safe to write" and
 * "needs confirmation". The `existingNames` set should be the on-disk
 * filenames at the destination — typically from `fileService.listFiles`
 * or `image-folder.ts`'s helpers.
 *
 * Within a single batch, two files with the same name are also a
 * collision against each other (so `foo.png` + `foo.png` drop together
 * surfaces ONE collision for the second instance, and the first goes
 * through `uniqueFiles` as-is). The collision's `suggestedName` accounts
 * for both the destination set AND the batch's earlier `uniqueFiles`
 * entries.
 */
export function checkForDuplicates(
  files: readonly File[],
  existingNames: ReadonlySet<string>,
): DuplicateUploadCheckResult {
  const uniqueFiles: File[] = [];
  const collisions: DuplicateInfo[] = [];
  // Track names that this batch has already "claimed" for uniqueFiles, so
  // a drop of [foo.png, foo.png] against an empty destination surfaces
  // the second one as a collision rather than silently overwriting the
  // first when the caller writes them sequentially.
  const claimedThisBatch = new Set<string>();

  for (const file of files) {
    const name = file.name;
    if (existingNames.has(name) || claimedThisBatch.has(name)) {
      // Suggest a name that avoids both the destination set AND any names
      // the batch has already claimed.
      const combined = new Set<string>(existingNames);
      for (const n of claimedThisBatch) combined.add(n);
      const suggested = suggestUniqueName(name, combined);
      collisions.push({ file, existingName: name, suggestedName: suggested });
    } else {
      uniqueFiles.push(file);
      claimedThisBatch.add(name);
    }
  }

  return { uniqueFiles, collisions };
}
