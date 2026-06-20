// Class Mode (CM-P2): provision a MANAGED OPFS class folder for an instructor.
//
// A class IS a lab IS a folder. When a lab head creates a CLASS, the app mints a
// brand-new app-managed OPFS folder (no OS picker), creates a fresh lab inside it
// (its own labId + team key, the instructor is the sole head member), writes the
// class identity into THAT folder (account_type=lab_head, lab_id, lab_kind=class),
// registers it in the account remembered-folders set, and switches to it. The
// CURRENT folder (the instructor's research lab) is NEVER touched. This is the
// CLASS analog of provision-member-folder.ts (the member-join provisioner) and of
// the LabCreateResume create flow (the research-lab create flow), composed.
//
// ORDERING INVARIANT (design addendum M1, load-bearing): setActiveHandle is the
// POINT OF NO RETURN. Everything folder-local (ensureStructure, the settings
// write, the managed-folder registration) MUST follow it, or the class identity
// lands in the WRONG folder (the Emile-test corruption class). The pure
// createLabLocal can run anytime; we run it right after the switch. A unit test
// asserts the source folder's settings.json is byte-unchanged after a provision.
//
// DURABILITY (design addendum H4): an OPFS class folder is browser-evictable, and
// for the HEAD role the relay mirror is size-gated, so OPFS can be the sole copy.
// We request navigator.storage.persist() and RETURN its boolean grant state so
// the caller can surface a "not persisted, connect a real disk folder" warning.
// Degrades gracefully when the API is unavailable (returns persisted:false).
//
// DIRECTORY: a class is NEVER published to the public lab directory (the directory
// is research-lab only). The retryable genesis publish is queued WITHOUT the
// directory listing (suppressDirectory), mirroring LabCreateResume's background
// publish minus the directory row.
//
// All OPFS / side-effecting dependencies are injectable so this is unit-testable
// without a real OPFS, fileService, settings write, or relay.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import { ensureFolderStructure } from "@/lib/file-system/user-discovery";
import { rememberManagedFolder } from "@/lib/file-system/indexeddb-store";
import { patchUserSettings } from "@/lib/settings/user-settings";
import { createLabLocal, publishLabRemote } from "./lab-create";
import { clearPendingGenesis } from "./lab-genesis-pending";
import type { PendingLabGenesis } from "./lab-membership";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";

/** The OPFS subdirectory name for an instructor's managed class folder. Keyed by
 *  labId so each class gets its own folder. Mirrors managedMemberFolderName but
 *  with the new "class-" prefix so a class folder is never confused with a
 *  member folder in the OPFS root. */
export function managedClassFolderName(labId: string): string {
  // labId is an opaque id; sanitize defensively so it is always a legal single
  // path segment for getDirectoryHandle.
  const safe = labId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `class-${safe || "unknown"}`;
}

/** Minimal OPFS root shape we rely on (getDirectoryHandle with create). */
interface OpfsRoot {
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean },
  ) => Promise<FileSystemDirectoryHandle>;
}

/** The local half of a minted lab the provisioner needs to persist + publish. */
interface MintedClassLab {
  labId: string;
  pending: PendingLabGenesis;
}

/** Injectable dependency surface (real implementations are the module defaults).
 *  Tests pass fakes so no real OPFS, fileService, settings write, lab mint, or
 *  relay publish is needed. */
export interface ProvisionClassFolderDeps {
  /** Resolve the OPFS root (navigator.storage.getDirectory). Returns null when
   *  OPFS is unavailable so the caller can fall back gracefully. */
  getOpfsRoot: () => Promise<OpfsRoot | null>;
  /** Point the shared file service at a handle. POINT OF NO RETURN per M1:
   *  everything folder-local must follow this call. */
  setActiveHandle: (handle: FileSystemDirectoryHandle) => void;
  /** Lay down the baseline users/ folder structure in the active folder. */
  ensureStructure: () => Promise<boolean>;
  /** Mint a fresh lab (PURE, network-free): labId + lab key + sealed head
   *  envelope. Wraps createLabLocal so the instructor is a class head instantly,
   *  independent of the relay. */
  mintLab: (params: {
    username: string;
    identity: StoredIdentity;
    oauthEmail: string;
    className?: string;
  }) => MintedClassLab;
  /** Write the per-folder CLASS instructor identity into the active folder's
   *  settings (account_type=lab_head, lab_id, lab_kind=class, the pending genesis,
   *  and the seed classConfig). */
  writeClassSettings: (
    username: string,
    minted: MintedClassLab,
    className?: string,
  ) => Promise<unknown>;
  /** Register the managed class folder in the account set + cache its lab meta +
   *  make it active. Returns the remembered-folder id. */
  registerManaged: (
    handle: FileSystemDirectoryHandle,
    labId: string,
    className?: string,
  ) => Promise<string>;
  /** Request durable (non-evictable) storage and report the grant state. */
  requestPersist: () => Promise<boolean>;
  /** Queue the retryable relay genesis publish WITHOUT a directory listing.
   *  Fire-and-forget from the caller's perspective (best-effort). */
  publishGenesis: (username: string, pending: PendingLabGenesis) => void;
}

function defaultGetOpfsRoot(): Promise<OpfsRoot | null> {
  const storage =
    typeof navigator !== "undefined"
      ? (navigator.storage as unknown as { getDirectory?: () => Promise<OpfsRoot> })
      : undefined;
  if (!storage?.getDirectory) return Promise.resolve(null);
  return storage.getDirectory().catch(() => null);
}

function defaultRequestPersist(): Promise<boolean> {
  const storage =
    typeof navigator !== "undefined"
      ? (navigator.storage as unknown as { persist?: () => Promise<boolean> })
      : undefined;
  if (!storage?.persist) return Promise.resolve(false);
  return storage.persist().catch(() => false);
}

function defaultMintLab(params: {
  username: string;
  identity: StoredIdentity;
  oauthEmail: string;
  className?: string;
}): MintedClassLab {
  const { labId, created } = createLabLocal({
    username: params.username,
    identity: params.identity,
    oauthEmail: params.oauthEmail,
  });
  // The class name rides into the pending genesis as cosmetic branding (labName),
  // exactly like LabCreateResume, so a retried publish still sends it to the relay
  // DO meta. The directory upsert is separately suppressed at publish time.
  const pending: PendingLabGenesis = {
    labId,
    record: created.record,
    envelope: created.envelope,
    ...(params.className?.trim()
      ? { branding: { labName: params.className.trim() } }
      : {}),
  };
  return { labId, pending };
}

const defaultDeps: ProvisionClassFolderDeps = {
  getOpfsRoot: defaultGetOpfsRoot,
  setActiveHandle: (handle) => fileService.setDirectoryHandle(handle),
  ensureStructure: () => ensureFolderStructure(),
  mintLab: defaultMintLab,
  writeClassSettings: (username, minted, className) =>
    // Per-folder class instructor identity. account_type=lab_head is the
    // instructor (head) role; lab_id binds this folder to the class lab;
    // lab_kind=class tags it as a teaching folder; the pending genesis lets the
    // publish retry across reloads; classConfig seeds the teaching config. All
    // written into the NEW folder, never the current one.
    patchUserSettings(username, {
      account_type: "lab_head",
      lab_id: minted.labId,
      lab_kind: "class",
      lab_pending_genesis: minted.pending,
      classConfig: {
        isClass: true,
        ...(className?.trim() ? { courseName: className.trim() } : {}),
      },
    }),
  registerManaged: (handle, labId, className) =>
    rememberManagedFolder(handle, {
      labRole: "class",
      labId,
      labName: className,
    }),
  requestPersist: defaultRequestPersist,
  publishGenesis: (username, pending) => {
    // Fire-and-forget retryable publish WITHOUT a directory listing. A class is
    // never directory-listed, so we call publishLabRemote with
    // suppressDirectory:true (we cannot reuse publishPendingGenesis here because
    // it does NOT suppress the directory upsert). The signed genesis still
    // publishes so the class team key + roster work; only the public directory
    // row is skipped. Best-effort: on success the pending genesis is cleared so
    // the publish stops retrying; on failure it is left in place for a later
    // retry (a reload-time LabGenesisPublishRetry can pick it back up, though
    // that retry path does not yet suppress the directory for classes; see the
    // FLAG note for the orchestrator).
    void (async () => {
      try {
        await publishLabRemote(
          pending.labId,
          {
            record: pending.record,
            envelope: pending.envelope,
            // labKey is unused by the publish path; createLabRemote ships only the
            // public, sealed artifacts. An empty array satisfies the type.
            labKey: new Uint8Array(),
          },
          {
            labName: pending.branding?.labName,
            suppressDirectory: true,
          },
        );
        await clearPendingGenesis(username);
      } catch {
        // Leave the pending genesis in place for a later retry.
      }
    })();
  },
};

export type ProvisionClassFolderResult =
  | { ok: true; folderId: string; labId: string; persisted: boolean }
  | {
      ok: false;
      reason: "no-opfs" | "structure-failed" | "error";
      message: string;
    };

/**
 * Provision a managed OPFS CLASS folder for an instructor, mint a fresh class lab
 * inside it, make it the active folder, and record the class identity in it. The
 * CURRENT folder is never touched.
 *
 * Steps, in EXACTLY this order (M1 ordering invariant):
 *  a. Open the OPFS root, mint the lab (PURE, writes nothing folder-local) to get
 *     the labId, then getDirectoryHandle(managedClassFolderName(labId),
 *     {create:true}). The lab mint runs before the active-handle switch because it
 *     is pure (it touches no folder), and we need its labId for the folder name.
 *  b. setActiveHandle(handle)  <-- POINT OF NO RETURN. Everything below follows.
 *  c. ensureStructure().
 *  d. (lab already minted in a, pure) write the class instructor settings.
 *  e. register the managed class folder + cache its lab meta + set active.
 *  f. navigator.storage.persist() for durability; capture the grant state.
 *  g. queue the retryable genesis publish WITHOUT the directory listing.
 *
 * Returns ok:true with the remembered-folder id, the minted labId, and the
 * persisted grant state (so the caller can warn when storage is not durable).
 */
export async function provisionClassFolder(
  params: {
    username: string;
    identity: StoredIdentity;
    oauthEmail: string;
    className?: string;
  },
  depsOverride?: Partial<ProvisionClassFolderDeps>,
): Promise<ProvisionClassFolderResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const { username, identity, oauthEmail, className } = params;

  try {
    const root = await deps.getOpfsRoot();
    if (!root) {
      return {
        ok: false,
        reason: "no-opfs",
        message:
          "This browser has no OPFS, so a managed class folder cannot be created.",
      };
    }

    // Mint the lab FIRST (pure, writes nothing folder-local) so we have the labId
    // to key the OPFS folder name. createLabLocal only throws on a missing OAuth
    // email, which the caller validates upstream.
    const minted = deps.mintLab({ username, identity, oauthEmail, className });

    const handle = await root.getDirectoryHandle(
      managedClassFolderName(minted.labId),
      { create: true },
    );

    // POINT OF NO RETURN (M1). Repoint the shared file service at the new folder
    // BEFORE writing settings so the class identity lands in the new folder, not
    // the instructor's current research-lab folder.
    deps.setActiveHandle(handle);

    const structured = await deps.ensureStructure();
    if (!structured) {
      return {
        ok: false,
        reason: "structure-failed",
        message: "Could not initialize the managed class folder.",
      };
    }

    await deps.writeClassSettings(username, minted, className);

    const folderId = await deps.registerManaged(
      handle,
      minted.labId,
      className,
    );

    // Durability (H4): request persistent storage and capture the grant state.
    // Best-effort, never blocks provisioning.
    const persisted = await deps.requestPersist();

    // Fire-and-forget the retryable genesis publish WITHOUT the directory row.
    deps.publishGenesis(username, minted.pending);

    return { ok: true, folderId, labId: minted.labId, persisted };
  } catch (e) {
    return {
      ok: false,
      reason: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
