// Cross-folder COPY (Strategy A, two-handle). NOTES ONLY in v1.
//
// Copies one object from the ACTIVE folder into ANOTHER folder the same account
// already remembers, WITHOUT switching the active folder. The active folder
// stays bound to the module singleton FileService; the destination is reached
// through a SECOND FileService instance bound to the remembered destination
// handle. The source object is never touched (this lane is COPY only, no move,
// no delete).
//
// Flow:
//   1. Resolve the destination handle from the remembered-folders registry and
//      request readwrite permission (the caller invokes this from a user
//      gesture, which the FSA requires for a permission prompt).
//   2. Construct a destination FileService bound to that handle.
//   3. Determine the destination username (the destination folder's Main user,
//      else its single user directory; see resolveDestinationUsername).
//   4. COLLECT the note in the SOURCE folder on the singleton (unchanged
//      buildNoteBundleInput), then MATERIALIZE into the destination via the
//      destination-scoped write path (materializeNoteToDestination).
//
// SAFETY (design addendum C7): a remembered folder whose labRole === "member"
// is the app-managed cache for a lab the account JOINED but does not own.
// Copying private data INTO it would push that data to a lab the user does not
// control, so member-folder destinations are hard-refused here and excluded by
// the picker.

import { FileService } from "@/lib/file-system/file-service";
import {
  getRememberedFolderHandle,
  listRememberedFolders,
  getActiveFolderId,
  type RememberedFolder,
} from "@/lib/file-system/indexeddb-store";
import {
  buildNoteBundleInput,
  materializeNoteToDestination,
} from "@/lib/sharing/note-transfer";
import type { TargetContext } from "@/lib/storage/json-store";
import type { ReadBundleResult } from "@/lib/sharing/bundle";
import type { Note } from "@/lib/types";

/** Thrown when a copy is refused before any write (bad destination, denied
 *  permission, or a destination the user does not own). Distinct from a disk
 *  failure so the caller can surface the right message. */
export class CrossFolderCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossFolderCopyError";
  }
}

/**
 * Is this remembered folder a legal COPY destination? Excludes member folders
 * (joined-lab caches the account does not own, addendum C7) and the currently
 * active folder (a copy-to-self is a no-op the picker should never offer).
 */
export function isEligibleDestination(
  folder: RememberedFolder,
  activeFolderId: string | null,
): boolean {
  if (folder.id === activeFolderId) return false;
  if (folder.labRole === "member") return false;
  return true;
}

/**
 * The remembered folders this account may copy INTO right now. The active
 * folder and every member (joined-lab) folder are excluded. Sorted by the
 * registry's own most-recent-first order.
 */
export async function listEligibleDestinations(): Promise<RememberedFolder[]> {
  const [folders, activeId] = await Promise.all([
    listRememberedFolders(),
    getActiveFolderId(),
  ]);
  return folders.filter((f) => isEligibleDestination(f, activeId));
}

/** Request readwrite permission on a remembered handle. MUST be called from a
 *  user gesture so the FSA prompt can show. Returns true only when granted. */
async function ensureWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const withPerms = handle as unknown as {
    queryPermission?: (opts: { mode: string }) => Promise<string>;
    requestPermission?: (opts: { mode: string }) => Promise<string>;
  };
  try {
    if (withPerms.queryPermission) {
      const q = await withPerms.queryPermission({ mode: "readwrite" });
      if (q === "granted") return true;
    }
    if (withPerms.requestPermission) {
      const r = await withPerms.requestPermission({ mode: "readwrite" });
      return r === "granted";
    }
  } catch {
    return false;
  }
  // No permission API (e.g. a mock handle in tests) means nothing to grant.
  return true;
}

/**
 * Determine which user owns the copy in the DESTINATION folder.
 *
 * The current-user IndexedDB key is GLOBAL (one key for the whole app), so it
 * still reflects the SOURCE folder while we copy without switching active
 * folders. It therefore CANNOT name the destination user. We resolve from the
 * destination folder's own on-disk state instead, in priority order:
 *
 *   1. users/_user_metadata.json `main_user` (the per-folder Main pin).
 *   2. The single subdirectory under users/ (a solo folder has exactly one).
 *
 * v1 default: when users/ holds more than one user and no Main is pinned, we
 * pick the first directory name (sorted). This is the documented simple default;
 * a multi-user destination picker is a later phase. Returns null only when the
 * destination has no users/ directory at all (an empty / uninitialized folder),
 * which the caller treats as an error.
 */
export async function resolveDestinationUsername(
  destService: FileService,
): Promise<string | null> {
  // 1. Per-folder Main pin.
  const meta = await destService.readJson<{ main_user?: unknown }>(
    "users/_user_metadata.json",
  );
  if (meta && typeof meta.main_user === "string" && meta.main_user.length > 0) {
    return meta.main_user;
  }

  // 2. Fall back to the user directories under users/. Reserved singletons
  // (lab / public) are skipped so a solo folder resolves to its one real user.
  const RESERVED = new Set(["public", "lab"]);
  const dirs = (await destService.listDirectories("users")).filter(
    (d) => !RESERVED.has(d),
  );
  if (dirs.length === 0) return null;
  // Exactly one -> unambiguous. More than one -> documented simple default
  // (first sorted). listDirectories already returns a sorted list.
  return dirs[0];
}

/**
 * Adapt the COLLECT output (a BuildBundleInput) into the ReadBundleResult the
 * materialize path consumes. For an in-folder, same-account copy there is no
 * relay, no sealing, and no signature to verify: the data was just read off our
 * own disk and is trusted, so `valid` is true. This avoids a needless
 * serialize -> seal -> read round-trip through the bundle engine.
 */
function collectToReadResult(
  input: Awaited<ReturnType<typeof buildNoteBundleInput>>,
): ReadBundleResult {
  return {
    valid: true,
    shareUuid: input.shareUuid,
    version: input.version,
    entityType: input.entityType,
    entity: input.entity,
    attachments: input.attachments,
    sender: input.sender,
    embeddedObjects: input.embeddedObjects ?? [],
    metadata: {},
  };
}

/**
 * Copy ONE note from the active folder into a remembered destination folder.
 *
 * MUST be invoked from a user gesture (it may prompt for folder permission).
 * Returns the new note id allocated in the DESTINATION folder.
 *
 * @param note            The source note (read from the active folder).
 * @param sourceUsername  The note's owner in the SOURCE folder (its on-disk
 *                        owner directory), used by the collect to find the
 *                        note's Images/ folder.
 * @param destFolderId    The remembered-folder id to copy INTO.
 */
export async function copyObjectToFolder(
  note: Note,
  sourceUsername: string,
  destFolderId: string,
): Promise<{ noteId: number; destUsername: string }> {
  // Guard the destination against the active folder and member folders BEFORE
  // touching any handle, so an ineligible target never even prompts.
  const folders = await listRememberedFolders();
  const activeId = await getActiveFolderId();
  const target = folders.find((f) => f.id === destFolderId);
  if (!target) {
    throw new CrossFolderCopyError("Destination folder is no longer remembered");
  }
  if (!isEligibleDestination(target, activeId)) {
    if (target.labRole === "member") {
      throw new CrossFolderCopyError(
        "Cannot copy into a joined lab folder you do not own",
      );
    }
    throw new CrossFolderCopyError(
      "Cannot copy a note into the folder it already lives in",
    );
  }

  const handle = await getRememberedFolderHandle(destFolderId);
  if (!handle) {
    throw new CrossFolderCopyError("Destination folder handle is unavailable");
  }

  const granted = await ensureWritePermission(handle);
  if (!granted) {
    throw new CrossFolderCopyError(
      "Permission to write to the destination folder was denied",
    );
  }

  // SECOND FileService instance, bound to the destination handle. The module
  // singleton stays on the source folder untouched.
  const destService = new FileService();
  destService.setDirectoryHandle(handle);

  const destUsername = await resolveDestinationUsername(destService);
  if (!destUsername) {
    throw new CrossFolderCopyError(
      "Could not determine a user in the destination folder",
    );
  }

  // COLLECT in the SOURCE folder on the singleton (unchanged), then MATERIALIZE
  // into the destination via the destination-scoped write path.
  const collected = await buildNoteBundleInput(note, sourceUsername);
  const readResult = collectToReadResult(collected);
  const ctx: TargetContext = { fileService: destService, username: destUsername };
  const { noteId } = await materializeNoteToDestination(readResult, ctx);

  return { noteId, destUsername };
}
