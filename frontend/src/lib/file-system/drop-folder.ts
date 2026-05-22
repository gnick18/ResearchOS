/**
 * Extract a `FileSystemDirectoryHandle` from a `DataTransferItemList`
 * produced by a drop event on the "Link Existing Folder" card.
 *
 * Browser support note: this entire flow is Chromium-only. Both
 * `DataTransferItem.getAsFileSystemHandle()` (used here, preferred)
 * and `window.showDirectoryPicker()` (used by the existing click-handler
 * path in `file-system-context.tsx`) ship together in Chrome / Edge /
 * Brave / Opera and are absent in Safari + Firefox. The parent screen
 * already gates rendering on `isFileSystemAccessSupported()`, which
 * checks for `showDirectoryPicker`; since the two APIs are paired we
 * can assume `getAsFileSystemHandle` is available whenever the screen
 * renders. `webkitGetAsEntry()` is kept as a defensive fallback for
 * forks/variants that ship one half of the surface.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandleWithPermissions extends FileSystemDirectoryHandle {
  queryPermission?: (desc?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (desc?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
}

interface DataTransferItemWithHandle extends DataTransferItem {
  // Chromium-only. Returns the matching FileSystemHandle for a dropped
  // file or directory — same handle type as `showDirectoryPicker()`.
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

// webkitGetAsEntry: legacy / non-standard but widely shipped. The
// lib.dom typedef requires the method to be present and non-undefined,
// which doesn't match runtime reality (Safari + some forks omit it).
// We type the fallback shape as an intersection so an optional method
// is allowed.
type DataTransferItemWithEntry = Omit<DataTransferItem, "webkitGetAsEntry"> & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

export type DropExtractionResult =
  | { kind: "ok"; handle: FileSystemDirectoryHandle }
  | { kind: "no-items" }
  | { kind: "multiple-items" }
  | { kind: "not-a-folder" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

/**
 * Map a drop-extraction failure code to user-facing copy. Kept separate
 * from `extractDirectoryHandleFromDrop` so the failure cases can be
 * exhaustively unit-tested and so consumers can localize later.
 */
export function describeDropExtractionError(
  kind: Exclude<DropExtractionResult["kind"], "ok">,
  message?: string,
): string {
  switch (kind) {
    case "no-items":
      return "Nothing dropped. Try again with a folder.";
    case "multiple-items":
      return "Drop just one folder.";
    case "not-a-folder":
      return "That's a file. Drop a folder instead.";
    case "unsupported":
      return "Your browser doesn't support folder drag-and-drop. Use the Link Folder button instead.";
    case "error":
      return message || "Could not read the dropped folder. Try the Link Folder button instead.";
  }
}

/**
 * Inspect a `DataTransferItemList` from a drop event and try to return
 * a writable `FileSystemDirectoryHandle`. Validates that exactly one
 * item was dropped and that it's a directory (not a file).
 */
export async function extractDirectoryHandleFromDrop(
  items: DataTransferItemList,
): Promise<DropExtractionResult> {
  if (!items || items.length === 0) {
    return { kind: "no-items" };
  }
  if (items.length > 1) {
    return { kind: "multiple-items" };
  }

  const item = items[0] as DataTransferItemWithHandle & DataTransferItemWithEntry;

  if (item.kind !== "file") {
    // `kind: "string"` items are dragged text snippets, not files/folders.
    return { kind: "not-a-folder" };
  }

  // Preferred path: getAsFileSystemHandle returns the same handle type
  // the rest of the codebase expects (the one showDirectoryPicker hands
  // back), so we can route straight into the normal connect pipeline.
  if (typeof item.getAsFileSystemHandle === "function") {
    let handle: FileSystemHandle | null;
    try {
      handle = await item.getAsFileSystemHandle();
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to read dropped item",
      };
    }
    if (!handle) {
      return { kind: "not-a-folder" };
    }
    if (handle.kind !== "directory") {
      return { kind: "not-a-folder" };
    }
    return { kind: "ok", handle: handle as FileSystemDirectoryHandle };
  }

  // Fallback path: webkitGetAsEntry. We can only sniff the type here —
  // we can't produce a writable handle without showDirectoryPicker, so
  // we surface "unsupported" so the caller falls back to the click path.
  if (typeof item.webkitGetAsEntry === "function") {
    const entry = item.webkitGetAsEntry();
    if (!entry) return { kind: "not-a-folder" };
    if (entry.isFile) return { kind: "not-a-folder" };
    if (!entry.isDirectory) return { kind: "not-a-folder" };
    return { kind: "unsupported" };
  }

  return { kind: "unsupported" };
}

/**
 * Optional helper: request readwrite permission on a freshly-dropped
 * directory handle. Not called from the component path today
 * (`finishConnect` already does this via `fileService.verifyPermission`)
 * but exported so future callers can do it inline.
 */
export async function requestReadwriteOnDroppedHandle(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const withPerms = handle as FileSystemHandleWithPermissions;
  if (typeof withPerms.requestPermission !== "function") return "granted";
  return withPerms.requestPermission({ mode: "readwrite" });
}
