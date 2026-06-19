// Lab-as-folder (P1): provision a MANAGED member folder on join.
//
// Locked model (Grant 2026-06-18): a lab IS a folder. A lab you JOINED is a
// LAB-MEMBER folder, an app-managed OPFS folder auto-created on join (no OS
// picker), the local cache where the member's own lab work lives. Joining must
// NOT overwrite the CURRENT folder's lab_id (the Emile-test bug, where a lab head
// who joined another lab corrupted their own folder). Instead it provisions a new
// OPFS folder, writes account_type=member + lab_id into THAT folder, registers it
// in the account remembered-folders set, and switches to it. The current folder
// is left untouched.
//
// The OPFS access (navigator.storage.getDirectory) is the same path the
// dev/ephemeral sessions already use (see file-system-context connectEphemeralDev).
//
// This module is intentionally context-free so the pure activation lib
// (lab-member-activation.ts) can call it. It points the shared fileService at the
// new handle and writes via the normal user-settings path, exactly as a freshly
// connected folder would. The React FileSystemProvider re-reads the active folder
// on its own (getActiveFolderId) after this returns.
//
// All OPFS / side-effecting dependencies are injectable so this is unit-testable
// without a real OPFS.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import { ensureFolderStructure } from "@/lib/file-system/user-discovery";
import { rememberManagedFolder } from "@/lib/file-system/indexeddb-store";
import { patchUserSettings } from "@/lib/settings/user-settings";

/** The OPFS subdirectory name for a lab's managed member folder. Keyed by labId
 *  so each joined lab gets its own folder and a re-join reuses the same one. */
export function managedMemberFolderName(labId: string): string {
  // labId is an opaque relay id; sanitize defensively so it is always a legal
  // single path segment for getDirectoryHandle.
  const safe = labId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `lab-member-${safe || "unknown"}`;
}

/** Minimal OPFS root shape we rely on (getDirectoryHandle with create). */
interface OpfsRoot {
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<FileSystemDirectoryHandle>;
}

/** Injectable dependency surface (real implementations are the module defaults).
 *  Tests pass fakes so no real OPFS, fileService, or settings write is needed. */
export interface ProvisionMemberFolderDeps {
  /** Resolve the OPFS root (navigator.storage.getDirectory). Returns null when
   *  OPFS is unavailable so the caller can fall back gracefully. */
  getOpfsRoot: () => Promise<OpfsRoot | null>;
  /** Point the shared file service at a handle (so settings writes land there). */
  setActiveHandle: (handle: FileSystemDirectoryHandle) => void;
  /** Lay down the baseline users/ folder structure in the active folder. */
  ensureStructure: () => Promise<boolean>;
  /** Write the per-folder member identity into the active folder's settings. */
  writeMemberSettings: (
    username: string,
    labId: string,
  ) => Promise<unknown>;
  /** Register the managed folder in the account set + cache its lab meta + make
   *  it active. Returns the remembered-folder id. */
  registerManaged: (
    handle: FileSystemDirectoryHandle,
    labId: string,
    labName?: string,
  ) => Promise<string>;
}

function defaultGetOpfsRoot(): Promise<OpfsRoot | null> {
  const storage =
    typeof navigator !== "undefined"
      ? (navigator.storage as unknown as { getDirectory?: () => Promise<OpfsRoot> })
      : undefined;
  if (!storage?.getDirectory) return Promise.resolve(null);
  return storage.getDirectory().catch(() => null);
}

const defaultDeps: ProvisionMemberFolderDeps = {
  getOpfsRoot: defaultGetOpfsRoot,
  setActiveHandle: (handle) => fileService.setDirectoryHandle(handle),
  ensureStructure: () => ensureFolderStructure(),
  writeMemberSettings: (username, labId) =>
    // Per-folder member identity. account_type=member is the joined-lab role;
    // lab_id binds this folder to the lab. Written into the NEW folder, never the
    // current one.
    patchUserSettings(username, { account_type: "member", lab_id: labId }),
  registerManaged: (handle, labId, labName) =>
    rememberManagedFolder(handle, {
      labRole: "member",
      labId,
      labName,
    }),
};

export type ProvisionMemberFolderResult =
  | { ok: true; folderId: string }
  | { ok: false; reason: "no-opfs" | "structure-failed" | "error"; message: string };

/**
 * Provision (or reuse) a managed OPFS member folder for a lab the account joined,
 * make it the active folder, and record account_type=member + lab_id in it. The
 * CURRENT folder is never touched.
 *
 * Steps, in order:
 *  1. Open the OPFS root and getDirectoryHandle(managedMemberFolderName(labId),
 *     {create:true}). Idempotent: a re-join reuses the same folder.
 *  2. Point the shared fileService at the new handle so the settings write lands
 *     in the new folder, then ensure the baseline users/ structure.
 *  3. Write the per-folder member identity (account_type=member + lab_id).
 *  4. Register the managed folder in the account remembered set, cache its lab
 *     meta, and set it active.
 *
 * On a freshly created folder this returns ok:true with the remembered-folder id;
 * the folder is EXPECTED to be otherwise empty until P2 wires the relay pull.
 */
export async function provisionMemberFolder(
  params: { labId: string; username: string; labName?: string },
  depsOverride?: Partial<ProvisionMemberFolderDeps>,
): Promise<ProvisionMemberFolderResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const { labId, username, labName } = params;

  try {
    const root = await deps.getOpfsRoot();
    if (!root) {
      return {
        ok: false,
        reason: "no-opfs",
        message:
          "This browser has no OPFS, so a managed lab folder cannot be created.",
      };
    }

    const handle = await root.getDirectoryHandle(managedMemberFolderName(labId), {
      create: true,
    });

    // Point the shared file service at the new folder BEFORE writing settings so
    // the per-folder identity lands in the new folder, not the current one.
    deps.setActiveHandle(handle);

    const structured = await deps.ensureStructure();
    if (!structured) {
      return {
        ok: false,
        reason: "structure-failed",
        message: "Could not initialize the managed lab folder.",
      };
    }

    await deps.writeMemberSettings(username, labId);

    const folderId = await deps.registerManaged(handle, labId, labName);
    return { ok: true, folderId };
  } catch (e) {
    return {
      ok: false,
      reason: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
