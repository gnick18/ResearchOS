// Cross-folder COPY / MOVE / BULK (Strategy A, two-handle).
//
// Stage 1 shipped copy-one-NOTE. Stage 2 (this file) extends the same two-handle
// machinery to MOVE, to BULK / multi-select, and to the other object types that
// already have a collect/materialize transfer builder.
//
// THE TWO-HANDLE CONTRACT (unchanged from Stage 1): the ACTIVE folder stays
// bound to the module singleton FileService; the DESTINATION is reached through a
// SECOND FileService instance bound to the remembered destination handle. The
// source object is read on the singleton and (for COPY) never touched; for MOVE
// the source is deleted ONLY after the destination write has fully resolved.
//
// TYPE COVERAGE (design addendum M2). A cross-folder transfer needs BOTH a
// COLLECT builder (read the object off the source disk into a portable payload)
// AND a destination-scoped MATERIALIZE twin (write that payload into a second
// folder via an injected FileService + explicit username). Stage 2 ships the
// destination twins for the SELF-CONTAINED tiers whose materialize is
// expressible through the store layer's `ctx` seam:
//
//   EXISTS, two-handle copy/move shipped here:
//     - note        (materializeNoteToDestination, Stage 1)
//     - sequence    (materializeSequenceToDestination)
//     - calculator  (materializeCalculatorToDestination)
//
//   EXISTS as a relay transfer builder, but NOT yet two-handle here:
//     - method, experiment/task, project
//       These materialize through the heavy zip-bundle import pipeline
//       (import/apply.ts, import/project-apply.ts), which is singleton-bound:
//       every write goes through notesApi/tasksApi/methodsApi/projectsApi +
//       getCurrentUserCached, with no destination parameter. A true two-handle
//       materialize for them is a multi-day apply-layer refactor (its own lane),
//       so they are REFUSED here with a clear, typed error rather than a
//       half-built path that could lose data. Follow-up: thread `ctx` through the
//       import-apply layer (or adopt the Strategy-B switch guard) for these three.
//
//   MISSING entirely (no transfer builder at all, M2):
//     - purchases / purchase_items, inventory_items, inventory_stocks,
//       PCR protocols, goals / weekly goals, calendar events, figures,
//       standalone inbox images, one-on-ones / check-ins / IDPs.
//       Phylo trees + big-table datasets are explicitly deferred in the embedded
//       collector. These are REFUSED (never silently no-op'd); building their
//       collectors is a separate later lane.
//
// SAFETY (design addendum C7): a remembered folder whose labRole === "member" is
// the app-managed cache for a JOINED lab the account does not own. Copying or
// moving private data INTO it would push that data to a lab the user does not
// control, so member-folder destinations are hard-refused and excluded by the
// picker.
//
// MOVE SAFETY (design addendum M3): MOVE deletes the source through the per-entity
// TRASHING delete (which routes through _trash/<type>/, a recoverable soft delete),
// NOT a raw deleteFile. The delete runs ONLY after the destination write resolves,
// and we VERIFY the source record is actually gone before reporting "moved". A
// destination-write failure leaves the source untouched (no-op). A delete failure
// AFTER a successful copy surfaces as "copied but could not remove from source",
// never silent data loss.

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
import {
  buildSequenceSendPayload,
  materializeSequenceToDestination,
} from "@/lib/sharing/sequence-transfer";
import {
  buildCalculatorSendPayload,
  materializeCalculatorToDestination,
} from "@/lib/sharing/calculator-transfer";
import { sequencesApi, calculatorsApi, notesApi } from "@/lib/local-api";
import type { TargetContext } from "@/lib/storage/json-store";
import type { ReadBundleResult } from "@/lib/sharing/bundle";
import type {
  Note,
  Method,
  Project,
  Task,
  SequenceDetail,
  CustomCalculator,
} from "@/lib/types";

/** Thrown when a copy/move is refused before any destination write (bad
 *  destination, denied permission, a destination the user does not own, or a
 *  type with no cross-folder transfer path). Distinct from a disk failure so the
 *  caller can surface the right message. */
export class CrossFolderCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossFolderCopyError";
  }
}

// ── Type model ────────────────────────────────────────────────────────────────

/** The object kinds the cross-folder lane can dispatch on. Mirrors the dialog's
 *  ShareTarget kinds (note / experiment / method / project / sequence) plus
 *  calculator. */
export type TransferKind =
  | "note"
  | "sequence"
  | "calculator"
  | "method"
  | "experiment"
  | "project";

/**
 * A single object to transfer, tagged by kind. `sourceUsername` is the object's
 * owner directory in the SOURCE (active) folder, used by the collect to find the
 * object's on-disk files. The heavy kinds (method/experiment/project) are
 * accepted in the union so the dispatcher can REFUSE them with a clear message
 * rather than the caller having to know which kinds are wired.
 */
export type TransferTarget =
  | { kind: "note"; note: Note; sourceUsername: string }
  | { kind: "sequence"; sequence: SequenceDetail; sourceUsername: string }
  | { kind: "calculator"; calculator: CustomCalculator; sourceUsername: string }
  | { kind: "method"; method: Method; sourceUsername: string }
  | { kind: "experiment"; task: Task; sourceUsername: string }
  | { kind: "project"; project: Project; sourceUsername: string };

/** The kinds with a destination-scoped materialize twin wired up here. The rest
 *  are refused (heavy zip-closure types) or have no builder at all. */
const TWO_HANDLE_KINDS = new Set<TransferKind>(["note", "sequence", "calculator"]);

/** Stable id of a transfer target within its kind, for per-item bulk results and
 *  the source delete. Note/sequence/calculator/experiment ids are numeric. */
function targetId(target: TransferTarget): number | string {
  switch (target.kind) {
    case "note":
      return target.note.id;
    case "sequence":
      return target.sequence.id;
    case "calculator":
      return target.calculator.id;
    case "method":
      return target.method.id;
    case "experiment":
      return target.task.id;
    case "project":
      return target.project.id;
  }
}

/** A short human label for a transfer target, for messages + bulk reports. */
export function describeTarget(target: TransferTarget): string {
  switch (target.kind) {
    case "note":
      return target.note.title || "Untitled note";
    case "sequence":
      return target.sequence.display_name || "Sequence";
    case "calculator":
      return target.calculator.name || "Calculator";
    case "method":
      return target.method.name || "Method";
    case "experiment":
      return target.task.name || "Experiment";
    case "project":
      return target.project.name || "Project";
  }
}

/** Why a kind cannot be transferred cross-folder yet, or null when it can. Used
 *  to refuse with a precise reason rather than a generic failure. */
function unsupportedReason(kind: TransferKind): string | null {
  if (TWO_HANDLE_KINDS.has(kind)) return null;
  if (kind === "method" || kind === "experiment" || kind === "project") {
    return `Copying a ${kind} between folders is not supported yet. Use "Send to a person" to share it, or copy it as a note.`;
  }
  // Defensive: an unknown kind has no path at all.
  return `This item type cannot be copied between folders.`;
}

// ── Eligibility (unchanged from Stage 1) ───────────────────────────────────────

/**
 * Is this remembered folder a legal COPY/MOVE destination? Excludes member
 * folders (joined-lab caches the account does not own, addendum C7) and the
 * currently active folder (a transfer-to-self is a no-op the picker should never
 * offer).
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
 * The remembered folders this account may transfer INTO right now. The active
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
 * note materialize path consumes. For an in-folder, same-account copy there is
 * no relay, no sealing, and no signature to verify: the data was just read off
 * our own disk and is trusted, so `valid` is true.
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

// ── Destination resolution (shared by copy + move + bulk) ──────────────────────

interface ResolvedDestination {
  service: FileService;
  username: string;
  folder: RememberedFolder;
}

/**
 * Guard a destination, request permission once, and stand up the second
 * FileService bound to it. Throws CrossFolderCopyError on any refusal BEFORE any
 * write. Factored out so copy / move / bulk all resolve the handle the same way
 * (bulk resolves it ONCE for the whole batch).
 */
async function resolveDestination(
  destFolderId: string,
): Promise<ResolvedDestination> {
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
      "Cannot copy an object into the folder it already lives in",
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
  const service = new FileService();
  service.setDirectoryHandle(handle);

  const username = await resolveDestinationUsername(service);
  if (!username) {
    throw new CrossFolderCopyError(
      "Could not determine a user in the destination folder",
    );
  }

  return { service, username, folder: target };
}

// ── Per-type collect + materialize dispatch (no handle/permission work) ───────

/** The result of a single materialize: the new destination id + which kind. */
export interface TransferOutcome {
  kind: TransferKind;
  /** The fresh id allocated in the DESTINATION folder. */
  destId: number;
  destUsername: string;
}

/**
 * Collect the target in the SOURCE folder (singleton, unchanged builders) and
 * materialize it into an ALREADY-RESOLVED destination. Refuses unsupported kinds.
 * No handle or permission work happens here; the caller has already resolved the
 * destination (so bulk can reuse one resolution for many items).
 */
async function materializeInto(
  target: TransferTarget,
  dest: ResolvedDestination,
): Promise<TransferOutcome> {
  const reason = unsupportedReason(target.kind);
  if (reason) throw new CrossFolderCopyError(reason);

  const ctx: TargetContext = { fileService: dest.service, username: dest.username };

  switch (target.kind) {
    case "note": {
      const collected = await buildNoteBundleInput(target.note, target.sourceUsername);
      const readResult = collectToReadResult(collected);
      const { noteId } = await materializeNoteToDestination(readResult, ctx);
      return { kind: "note", destId: noteId, destUsername: dest.username };
    }
    case "sequence": {
      // The collect builder keys on the folder-local user (sender identity); a
      // same-account copy needs no verified sender, so pass the source user.
      const bytes = await buildSequenceSendPayload(
        target.sequence,
        target.sourceUsername,
      );
      const { sequenceId } = await materializeSequenceToDestination(bytes, ctx);
      return { kind: "sequence", destId: sequenceId, destUsername: dest.username };
    }
    case "calculator": {
      const bytes = await buildCalculatorSendPayload(
        target.calculator,
        target.sourceUsername,
      );
      const { calculatorId } = await materializeCalculatorToDestination(bytes, ctx);
      return { kind: "calculator", destId: calculatorId, destUsername: dest.username };
    }
    default:
      // Unreachable: unsupportedReason already rejected the heavy kinds above.
      throw new CrossFolderCopyError(
        `Copying a ${target.kind} between folders is not supported yet.`,
      );
  }
}

// ── Source delete + verify (MOVE only, addendum M3) ───────────────────────────

/**
 * Trash the source object through its per-entity TRASHING delete (recoverable
 * soft delete via _trash/<type>/), then VERIFY the source record is actually
 * gone. Returns true only when the source is verified removed. Never a raw
 * deleteFile. The source folder IS the active folder, so these run on the
 * singleton (no ctx needed).
 *
 * Verification reads the source record back after the delete: the delete APIs
 * have mixed return shapes (notesApi.delete returns void; the cross-owner gate
 * can silently no-op a non-owner delete), so reading-back is the only uniform,
 * trustworthy "did it actually go" signal across types.
 */
async function trashSourceVerified(target: TransferTarget): Promise<boolean> {
  switch (target.kind) {
    case "note": {
      await notesApi.delete(target.note.id, target.sourceUsername);
      const still = await notesApi.get(target.note.id, target.sourceUsername);
      return still == null;
    }
    case "sequence": {
      await sequencesApi.delete(target.sequence.id, target.sourceUsername);
      const still = await sequencesApi.get(target.sequence.id, target.sourceUsername);
      return still == null;
    }
    case "calculator": {
      await calculatorsApi.delete(target.calculator.id, target.sourceUsername);
      const still = await calculatorsApi.get(
        target.calculator.id,
        target.sourceUsername,
      );
      return still == null;
    }
    default:
      // The heavy kinds are refused before any copy, so a move never reaches
      // here for them. Treat as not-removed defensively.
      return false;
  }
}

/** Thrown when a MOVE copied the object into the destination but could NOT remove
 *  it from the source. The destination copy IS present (no data loss); the
 *  source duplicate remains and the user must remove it manually. Carries the
 *  destination outcome so the caller can still surface the new id. */
export class SourceNotRemovedError extends Error {
  constructor(
    public readonly outcome: TransferOutcome,
    public readonly source: TransferTarget,
  ) {
    super(
      `Copied "${describeTarget(source)}" into the destination, but could not remove it from the source folder. The copy is safe; please delete the original manually.`,
    );
    this.name = "SourceNotRemovedError";
  }
}

// ── Public single-object API ───────────────────────────────────────────────────

/**
 * Copy ONE object from the active folder into a remembered destination folder.
 *
 * MUST be invoked from a user gesture (it may prompt for folder permission).
 *
 * BACK-COMPAT (Stage 1): the original NOTE signature
 * `copyObjectToFolder(note, sourceUsername, destFolderId)` is preserved. The new
 * generic form is `copyObjectToFolder(target, destFolderId)` where `target` is a
 * TransferTarget. The two are disambiguated by argument shape.
 */
export async function copyObjectToFolder(
  note: Note,
  sourceUsername: string,
  destFolderId: string,
): Promise<{ noteId: number; destUsername: string }>;
export async function copyObjectToFolder(
  target: TransferTarget,
  destFolderId: string,
): Promise<TransferOutcome>;
export async function copyObjectToFolder(
  a: Note | TransferTarget,
  b: string,
  c?: string,
): Promise<{ noteId: number; destUsername: string } | TransferOutcome> {
  // Stage 1 form: (note, sourceUsername, destFolderId).
  if (typeof c === "string") {
    const note = a as Note;
    const target: TransferTarget = { kind: "note", note, sourceUsername: b };
    const dest = await resolveDestination(c);
    const outcome = await materializeInto(target, dest);
    return { noteId: outcome.destId, destUsername: outcome.destUsername };
  }
  // Generic form: (target, destFolderId).
  const target = a as TransferTarget;
  const dest = await resolveDestination(b);
  return materializeInto(target, dest);
}

/**
 * MOVE ONE object from the active folder into a remembered destination folder.
 *
 * Ordering (addendum M3): COPY into the destination, AWAIT the destination write
 * fully resolving, THEN trash the source through its per-entity trashing delete
 * and VERIFY the source is gone. If the destination write fails, the source is
 * never touched (a plain throw, no-op). If the source delete fails AFTER a
 * successful copy, throws SourceNotRemovedError (the copy is safe, the source
 * duplicate remains), never silent data loss.
 *
 * MUST be invoked from a user gesture (it may prompt for folder permission).
 */
export async function moveObjectToFolder(
  target: TransferTarget,
  destFolderId: string,
): Promise<TransferOutcome> {
  // Refuse unsupported kinds up front, before resolving a handle.
  const reason = unsupportedReason(target.kind);
  if (reason) throw new CrossFolderCopyError(reason);

  const dest = await resolveDestination(destFolderId);
  // COPY first. A failure here leaves the source untouched (no-op).
  const outcome = await materializeInto(target, dest);

  // Only after the destination write resolved do we touch the source.
  const removed = await trashSourceVerified(target);
  if (!removed) {
    throw new SourceNotRemovedError(outcome, target);
  }
  return outcome;
}

// ── Bulk / multi-select ────────────────────────────────────────────────────────

/** The result of one item in a bulk transfer. */
export type BulkItemResult =
  | { ok: true; target: TransferTarget; outcome: TransferOutcome }
  | { ok: false; target: TransferTarget; reason: string; copiedButNotRemoved?: boolean };

export interface BulkTransferResult {
  mode: "copy" | "move";
  destFolderId: string;
  destUsername: string;
  items: BulkItemResult[];
  /** Convenience counts for the summary line ("Moved 7 of 9"). */
  okCount: number;
  failCount: number;
}

/**
 * Transfer MANY objects into ONE destination folder, in copy or move mode.
 *
 * The destination handle + permission are resolved ONCE for the whole batch (a
 * single permission prompt). Items are processed SEQUENTIALLY so any intra-batch
 * embedded-object dedup resolves against the destination's live state as it grows
 * (matching the design's bulk note). Items may be heterogeneous kinds; each is
 * dispatched per type. A no-builder / unsupported kind is reported as a failed
 * item and does NOT abort the batch. For move, each item uses the same
 * verified-then-trash ordering as moveObjectToFolder (copy, verify, trash); a
 * source-delete failure marks that item failed (copiedButNotRemoved) but the
 * batch continues.
 *
 * MUST be invoked from a user gesture (the single permission prompt).
 */
export async function bulkTransfer(
  items: TransferTarget[],
  destFolderId: string,
  mode: "copy" | "move",
): Promise<BulkTransferResult> {
  // Resolve the destination ONCE. A refusal here aborts the whole batch (there is
  // no destination to write into).
  const dest = await resolveDestination(destFolderId);

  const results: BulkItemResult[] = [];
  for (const target of items) {
    // Per-item refusal for unsupported kinds, reported not thrown (batch goes on).
    const reason = unsupportedReason(target.kind);
    if (reason) {
      results.push({ ok: false, target, reason });
      continue;
    }
    try {
      const outcome = await materializeInto(target, dest);
      if (mode === "copy") {
        results.push({ ok: true, target, outcome });
        continue;
      }
      // MOVE: only after the copy resolved, trash + verify the source.
      const removed = await trashSourceVerified(target);
      if (removed) {
        results.push({ ok: true, target, outcome });
      } else {
        results.push({
          ok: false,
          target,
          copiedButNotRemoved: true,
          reason: `Copied into the destination, but could not remove "${describeTarget(target)}" from the source. The copy is safe; delete the original manually.`,
        });
      }
    } catch (err) {
      const message =
        err instanceof CrossFolderCopyError
          ? err.message
          : `Could not ${mode} "${describeTarget(target)}"`;
      results.push({ ok: false, target, reason: message });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return {
    mode,
    destFolderId,
    destUsername: dest.username,
    items: results,
    okCount,
    failCount: results.length - okCount,
  };
}
