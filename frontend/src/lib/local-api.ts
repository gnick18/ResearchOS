import { JsonStore, getPublicStore, getLabStore, getCurrentUserCached, clearCurrentUserCache } from "./storage/json-store";
import { fileService } from "./file-system/file-service";
import { trashNote, restoreTrashedNote } from "./notes/notes-trash";
import {
  trashEntity,
  restoreSequenceFromTrash,
  type TrashEntityType,
} from "./trash";
import { recordProjectActivity } from "./project-activity/event-log";
import type { RetentionEntry, RetentionEntryCreate } from "./lab/retention";
import { HISTORY_ENGINE_ENABLED, recordNoteHistory, recordTaskHistory, recordProjectHistory, recordInventoryItemVersion, recordInventoryStockVersion } from "./history";
import type { HistoryEditKind } from "./history";
// Phase 2 chunk 4: when the Loro pilot is on, the note's Loro doc IS the
// history store; the legacy delta writer is suppressed to avoid double-writing.
import { LORO_PILOT_ENABLED, PURCHASE_LORO_ENABLED } from "./loro/config";
import { getCurrentUser, getMainUser, storeCurrentUser, storeMainUser, clearCurrentUser, clearMainUser } from "./file-system/indexeddb-store";
import { shiftTask } from "./engine/shift";
import { readSharingIdentity } from "./sharing/identity/sidecar";
import { loadUserCaptureKeys } from "./mobile-relay/keys";
import { notifyRecipient } from "./mobile-relay/client";
import { formatDate, parseDate } from "./engine/dates";
import { readStreak } from "./streak/streak-sidecar";
import { canonicalEndDate, computeTaskEndDate } from "./tasks/end-date";
import { taskCompletionEvents } from "./tasks/task-completion-events";
import {
  taskResultsBase,
  legacyTaskResultsBase,
} from "./tasks/results-paths";
import { discoverUsers } from "./file-system/user-discovery";
import { ensureLabUserMetadata, fallbackUserColor, setUserMetadataField, getUserMetadata, readAllUserMetadata, readMainUser, renameUserMetadataEntry, writeMainUser, type UserMetadataEntry } from "./file-system/user-metadata";
import JSZip from "jszip";
import type {
  Project,
  ProjectCreate,
  ProjectUpdate,
  Task,
  TaskCreate,
  TaskUpdate,
  MethodGatheredChecks,
  TaskMoveRequest,
  Dependency,
  DependencyCreate,
  Method,
  MethodCreate,
  MethodUpdate,
  Event,
  EventCreate,
  EventUpdate,
  HighLevelGoal,
  HighLevelGoalCreate,
  HighLevelGoalUpdate,
  SmartGoal,
  PCRProtocol,
  PCRProtocolCreate,
  PCRProtocolUpdate,
  LCGradientProtocol,
  LCGradientProtocolCreate,
  LCGradientProtocolUpdate,
  PlateProtocol,
  PlateProtocolCreate,
  PlateProtocolUpdate,
  CellCultureSchedule,
  CellCultureScheduleCreate,
  CellCultureScheduleUpdate,
  CellCultureActualEvent,
  MassSpecProtocol,
  MassSpecProtocolCreate,
  MassSpecProtocolUpdate,
  CodingWorkflowProtocol,
  CodingWorkflowProtocolCreate,
  CodingWorkflowProtocolUpdate,
  QPCRAnalysisProtocol,
  QPCRAnalysisProtocolCreate,
  QPCRAnalysisProtocolUpdate,
  PurchaseItem,
  PurchaseItemCreate,
  PurchaseItemUpdate,
  PurchaseOrderStatus,
  FundingAccount,
  FundingAccountCreate,
  FundingAccountUpdate,
  FunderIdType,
  LabLink,
  LabLinkCreate,
  LabLinkUpdate,
  Note,
  NoteCreate,
  NoteUpdate,
  NoteEntry,
  WeeklyGoal,
  WeeklyGoalCreate,
  WeeklyGoalUpdate,
  SharedNotebook,
  OneOnOne,
  OneOnOneActionItem,
  IDP,
  IdpGoal,
  IdpActionRow,
  IdpSectionKey,
  CareerStage,
  CheckinCompact,
  CheckinCompactRow,
  CheckinOnboarding,
  CheckinOnboardingItem,
  CheckinRotation,
  CheckinRotationTrack,
  NoteComment,
  TaskComment,
  ImageMetadata,
  FileMetadata,
  CatalogItem,
  ShiftResult,
  SharedUser,
  ShareRequest,
  SharedItemEntry,
  Notification,
  SharedItemNotification,
  EventReminderNotification,
  ShiftAlertNotification,
  LabCommentNotification,
  PurchaseAssignmentNotification,
  PurchaseOrderedNotification,
  ShiftedAlertEntry,
  ShiftedAlertsFile,
  SeenShiftAlertsFile,
  SequenceMeta,
  SequenceRecord,
  SequenceDetail,
  SequenceCreate,
  SequenceUpdate,
  SeqType,
  InventoryItem,
  InventoryItemCreate,
  InventoryItemUpdate,
  InventoryStock,
  InventoryStockCreate,
  InventoryStockUpdate,
  InventoryStockStatus,
  StorageNode,
  StorageNodeCreate,
  StorageNodeUpdate,
  CustomCalculator,
  CustomCalculatorCreate,
  CustomCalculatorUpdate,
} from "./types";
import { sequenceStore } from "./sequences/sequence-store";
import { genbankToDetail, genbankToRecord, deriveSeqType } from "./sequences/parse";
import { genbankToJson } from "@/vendor/bio-parsers";
// Runtime helpers (values, not types) for the per-item ordering status
// (purchases-ordered-stage, 2026-05-29).
import {
  DEFAULT_PURCHASE_ORDER_STATUS,
  normalizeOrderStatus,
} from "./types";
import {
  WHOLE_LAB_SENTINEL,
  isWholeLabShared,
  normalizeSharedWith,
  canRead,
  canWriteIgnoringPiRole,
  pairingSharedWith,
  membersSharedWith,
  type Viewer,
  type ShareableRecord,
} from "./sharing/unified";
import { mondayOf } from "./weekly-goals/week";
import { computeFundingSpend, computeUncategorizedSpend } from "./funding/spend";
import { SharedNotebookStore } from "./shared-notebooks/store";
import { OneOnOneStore, OneOnOneActionItemStore } from "./one-on-one/store";
import {
  normalizeOneOnOne,
  normalizeOneOnOneActionItem,
  normalizeWeeklyGoal,
} from "./one-on-one/normalize";
import {
  reconcileSyncedTask,
  pushCompletionToTask,
  reconcileCompletionFromTask,
  type TaskSyncOps,
  type SyncedTaskDraft,
} from "./one-on-one/action-item-sync";
import { IdpStore } from "./idp/store";
import { normalizeIdpForViewer } from "./idp/visibility";
import { allSkillIds } from "./idp/competencies";
import { CheckinCompactStore } from "./checkins/compact-store";
import { CheckinOnboardingStore } from "./checkins/onboarding-store";
import { CheckinRotationStore } from "./checkins/rotation-store";
import { COMPACT_SEED_LABELS, ONBOARDING_SEED_LABELS } from "./checkins/seeds";
import {
  addRowToTasks,
  reconcileRowTask,
  reconcileRowStatusFromTask,
  deleteRowTask,
  type IdpTaskSyncOps,
  type IdpSyncedTaskDraft,
} from "./idp/action-task-sync";
import type { Notebook } from "./types";
import { normalizeTransclusions } from "./embeds/normalize-transclusions";

const projectsStore = new JsonStore<Project>("projects");
const tasksStore = new JsonStore<Task>("tasks");
const dependenciesStore = new JsonStore<Dependency>("dependencies");
const methodsStore = new JsonStore<Method>("methods");
const publicMethodsStore = getPublicStore<Method>("methods");
const eventsStore = new JsonStore<Event>("events");
const goalsStore = new JsonStore<HighLevelGoal>("goals");
const pcrStore = new JsonStore<PCRProtocol>("pcr_protocols");
const publicPcrStore = getPublicStore<PCRProtocol>("pcr_protocols");
const lcGradientStore = new JsonStore<LCGradientProtocol>("lc_gradients");
const publicLcGradientStore = getPublicStore<LCGradientProtocol>("lc_gradients");
const plateLayoutStore = new JsonStore<PlateProtocol>("plate_layouts");
const publicPlateLayoutStore = getPublicStore<PlateProtocol>("plate_layouts");
const cellCultureScheduleStore = new JsonStore<CellCultureSchedule>("cell_culture_schedules");
const publicCellCultureScheduleStore = getPublicStore<CellCultureSchedule>("cell_culture_schedules");
const massSpecStore = new JsonStore<MassSpecProtocol>("mass_spec_methods");
const publicMassSpecStore = getPublicStore<MassSpecProtocol>("mass_spec_methods");
const codingWorkflowStore = new JsonStore<CodingWorkflowProtocol>("coding_workflows");
const publicCodingWorkflowStore = getPublicStore<CodingWorkflowProtocol>("coding_workflows");
const qpcrAnalysisStore = new JsonStore<QPCRAnalysisProtocol>("qpcr_analyses");
const publicQpcrAnalysisStore = getPublicStore<QPCRAnalysisProtocol>("qpcr_analyses");
const purchaseItemsStore = new JsonStore<PurchaseItem>("purchase_items");
// Lab data-retention registry (LAB_ARCHIVE_CONTINUITY.md). PI-owned, lives under
// the current (PI) user's folder. See `retentionApi` below.
const retentionStore = new JsonStore<RetentionEntry>("lab_retention");
const catalogStore = new JsonStore<CatalogItem>("item_catalog");
const labLinksStore = new JsonStore<LabLink>("lab_links");
const notesStore = new JsonStore<Note>("notes");
// Custom Calculator Builder (Phase 1, 2026-06-10). ADDITIVE per-user store at
// `users/<owner>/calculators/<id>.json`. Mirrors `notesStore` / `eventsStore`
// exactly: user-scoped JsonStore, per-user numeric counters. Holds the
// user-authored `CustomCalculator` records the builder saves. No existing
// on-disk record shape changes. Gated in the UI by `CALC_BUILDER_ENABLED`.
const calculatorsStore = new JsonStore<CustomCalculator>("calculators");
// Weekly goals widget (PI beta feedback, weekly-goals widget, 2026-05-29).
// DATA-SHAPE CHANGE: a new per-user store at
// `users/<owner>/weekly_goals/<id>.json`. Mirrors `notesStore` /
// `eventsStore` exactly — user-scoped JsonStore, per-user counters. The
// lightweight standalone "weekly goal" record (see `WeeklyGoal` in
// types.ts) is DISTINCT from the Gantt `goalsStore` (`HighLevelGoal`); it
// is never placed on the Gantt.
const weeklyGoalsStore = new JsonStore<WeeklyGoal>("weekly_goals");
// Shared Notebooks Phase 1 (notebooks-data bot, 2026-06-02). A string-keyed
// per-user store at `users/<owner>/shared_notebooks/<uuid>.json` (NOT a
// JsonStore — notebook ids are UUIDs, not numeric counters; see
// `lib/shared-notebooks/store.ts` for why). Reuses the same per-user file
// layout so `labApi.getSharedNotebooks` walks notebooks like notes / goals.
const sharedNotebooksStore = new SharedNotebookStore();
// 1:1 revamp (oneonone data+strip bot, 2026-06-07). String-keyed per-user
// stores at `users/<labHead>/one_on_ones/<uuid>.json` and
// `users/<labHead>/one_on_one_action_items/<uuid>.json` (sibling of the notebook
// store; see lib/one-on-one/store.ts). A 1:1 is owned by the lab head; the
// member discovers it via `labApi.getOneOnOnes`.
const oneOnOnesStore = new OneOnOneStore();
const oneOnOneActionItemsStore = new OneOnOneActionItemStore();
const idpsStore = new IdpStore();
// Check-ins Phase 3b (checkins-phase3b bot, 2026-06-12). String-keyed per-user
// stores at `users/<spaceOwner>/checkin_compacts/<uuid>.json` and
// `users/<spaceOwner>/checkin_onboarding/<uuid>.json` (sibling of the one-on-one
// store). Each record hangs off a check-in space and lives in the space owner's
// folder with `shared_with` = every member at "edit". See
// `checkinCompactsApi` / `checkinOnboardingApi` below.
const checkinCompactsStore = new CheckinCompactStore();
const checkinOnboardingStore = new CheckinOnboardingStore();
const checkinRotationsStore = new CheckinRotationStore();
const fundingAccountsStore = getLabStore<FundingAccount>("funding_accounts");

// Inventory v1 data layer (inventory-chunk1 sub-bot of HR, 2026-06-07).
// Per-user stores at `users/<owner>/inventory_items/<id>.json` and
// `users/<owner>/inventory_stocks/<id>.json` (FLAG-2). Whole-lab-edit by
// default (design §6.1); the "lab inventory" is the computed union of every
// member's shared records, read via `fetchAllInventory*IncludingShared`.
const inventoryItemsStore = new JsonStore<InventoryItem>("inventory_items");
const inventoryStocksStore = new JsonStore<InventoryStock>("inventory_stocks");
// StorageNode (the location tree: room -> freezer -> ... -> box). Path
// `users/<owner>/storage_nodes/<id>.json` (FLAG-1/FLAG-2, v2). Same whole-lab-
// edit default + computed-union read path as the inventory stores.
const storageNodesStore = new JsonStore<StorageNode>("storage_nodes");

async function loadLabUsers(): Promise<{
  usernames: string[];
  metadata: Record<string, UserMetadataEntry>;
}> {
  const usernames = await discoverUsers();
  const metadata = await ensureLabUserMetadata(usernames);
  return { usernames, metadata };
}

/**
 * VCP R3 attribution stamps (VCP R3 attribution stamps, 2026-05-26):
 * resolves the actor for the `last_edited_by` field on every update path.
 * Falls back to `"unknown"` when the IndexedDB user lookup misses (e.g.
 * pre-onboarding flows or test harnesses without a fake user); the field
 * is optional in the type so a write with `"unknown"` is recoverable on
 * any subsequent edit by a real signed-in user.
 *
 * For PI cross-owner edits the caller passes `actor` explicitly (the PI's
 * username, sourced from the unlock-session state). The "(PI)" badge is a
 * UI render concern resolved in `AttributionChip`, not a stored field.
 */
async function resolveAttributionActor(actor?: string | null): Promise<string> {
  if (actor && actor.length > 0) return actor;
  const u = await getCurrentUserCached();
  return u && u !== "_no_user_" ? u : "unknown";
}

/**
 * VCP R3 — build the `{ last_edited_by, last_edited_at }` stamp pair to
 * merge into any `update*` patch. Centralized so the eight entity
 * surfaces don't drift on field naming.
 */
async function buildAttributionStamp(actor?: string | null): Promise<{
  last_edited_by: string;
  last_edited_at: string;
}> {
  return {
    last_edited_by: await resolveAttributionActor(actor),
    last_edited_at: new Date().toISOString(),
  };
}

function colorFor(
  metadata: Record<string, UserMetadataEntry>,
  username: string,
): string {
  return metadata[username]?.color ?? fallbackUserColor(username);
}

/** Returns the optional gradient stop 2. `null` when the user only has a
 *  solid primary color (the default). Auto-assigned users never get a
 *  secondary — gradients are opt-in via Settings. */
function colorSecondaryFor(
  metadata: Record<string, UserMetadataEntry>,
  username: string,
): string | null {
  return metadata[username]?.color_secondary ?? null;
}

/** VCP R2 trash everywhere (2026-05-26): shared owner-only delete gate.
 *  OQ9 locks: only the record owner may delete. A lab head may cross-delete
 *  any member's record (role privilege); the `sessionId` is preserved purely
 *  so the trash entry's audit fields can group with the rest of a batch.
 *
 *  ACL hardening (2026-06-08): this gate previously treated ANY non-null
 *  `sessionId` as authorization for a cross-owner delete. Since the PI
 *  edit-session was removed, callers pass the constant `"lab-head-action"`
 *  sentinel as `sessionId`, which silently opened the cross-owner delete to
 *  every caller for free. The sessionId bypass is replaced with a real role
 *  check against the live process viewer: a cross-owner delete now requires
 *  the current user to actually be a lab head. `sessionId` no longer
 *  authorizes anything; it only rides along into the audit fields.
 *
 *  Returns `null` when the delete is gated (caller no-ops); otherwise
 *  returns the resolved attribution fields to thread into `trashEntity`. */
async function resolveDeleteAttribution(
  targetOwner: string,
  actor: string,
  sessionId: string | null,
  apiTag: string,
): Promise<{ actor: string; sessionId: string | null } | null> {
  if (actor !== targetOwner) {
    const viewer = await buildCurrentViewer();
    if (viewer.account_type !== "lab_head") {
      console.warn(
        `[${apiTag}] refused: non-owner ${actor} cannot delete record owned by ${targetOwner} (not a lab head)`,
      );
      return null;
    }
  }
  return { actor, sessionId };
}

/** VCP R2 trash everywhere (2026-05-26): unified soft-delete dispatcher.
 *  Used by every non-Note entity's `delete` method. Reads the live
 *  record's `name`/`title` for the trash filename slug, captures the
 *  parent_id field when present, and routes through `trashEntity()`.
 *
 *  R3 will fold the Notes shim into this same path (the duplication
 *  exists because notes have a top-level legacy `deleted_at` shape
 *  preserved by `notesApi.delete` → `trashNote` for one release). */
async function softDeleteEntity(args: {
  owner: string;
  entityType: TrashEntityType;
  id: number;
  actor: string;
  sessionId: string | null;
  parentId?: number | null;
  parentEntityType?: TrashEntityType;
}): Promise<void> {
  const { owner, entityType, id, actor, sessionId, parentId, parentEntityType } = args;
  const parent =
    parentId !== undefined && parentId !== null && parentEntityType
      ? { parent_id: parentId, parent_entity_type: parentEntityType }
      : undefined;
  await trashEntity({
    owner,
    entityType,
    id,
    deletedBy: actor,
    sessionId,
    parent,
  });
}

/**
 * Phase 6a portable identity (phase6a-foundation bot, 2026-06-12): lazy backfill
 * for a Project that predates the source_uuid field. Fire-and-forget write-through.
 * Pass ownerOverride when reading a cross-user project.
 */
function backfillProjectSourceUuid(project: Project, ownerOverride?: string): Project {
  if (project.source_uuid) return project;
  // Only backfill records in the current user's own store. A cross-user read
  // (ownerOverride set) must never mint or write into another user's folder, so
  // a read never mutates data we do not own and two readers cannot race to stamp
  // different ids onto one file. That owner backfills their own copy on read.
  if (ownerOverride) return project;
  const uuid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  void projectsStore.update(project.id, { source_uuid: uuid }).catch(() => { /* fire-and-forget */ });
  return { ...project, source_uuid: uuid };
}

export const projectsApi = {
  list: async (): Promise<Project[]> => {
    // Phase 6a: lazy-backfill source_uuid on read.
    return (await projectsStore.listAll()).map((p) => backfillProjectSourceUuid(p));
  },

  listWithShared: async (): Promise<Project[]> => {
    return (await projectsStore.listAll()).map((p) => backfillProjectSourceUuid(p));
  },

  get: async (id: number, owner?: string): Promise<Project | null> => {
    const project = owner ? await projectsStore.getForUser(id, owner) : await projectsStore.get(id);
    // Phase 6a: lazy-backfill source_uuid on read.
    return project ? backfillProjectSourceUuid(project, owner) : null;
  },

  /**
   * Create a new project owned by the current user.
   *
   * Hard guard: `name` MUST be a non-empty string after trimming. Empty /
   * whitespace / undefined names are rejected with a thrown Error so a
   * malformed call site cannot persist a blank project file to disk. This
   * is defense-in-depth on top of UI-layer guards (e.g. the home page's
   * `if (!newName.trim()) return;` and the ELN importer's
   * `pickImportedProjectName` collision suffix). The on-disk shape always
   * comes out with `name.trim().length > 0`, which downstream consumers
   * (home cards, search index, share manifests) rely on for a visible label.
   */
  create: async (data: ProjectCreate): Promise<Project> => {
    // Orphan-project diagnostic instrumentation (orphan v2 sub-bot,
    // 2026-05-21). Every call to projectsApi.create is logged with the
    // incoming name AND a fresh stack trace so we can pinpoint which call
    // site is responsible if a blank-name project surfaces again. The
    // hard guard below still throws on empty names; this warn fires for
    // ALL calls so legitimate creates also trace, giving a baseline to
    // diff against. Console-only, no UI noise.
    if (typeof console !== "undefined") {
      const trace = new Error("projectsApi.create call-site trace").stack;
      console.warn(
        `[projectsApi.create] call with name=${JSON.stringify(data?.name)} (typeof=${typeof data?.name})`,
        { input: data, stack: trace },
      );
    }
    if (!data.name || typeof data.name !== "string" || data.name.trim().length === 0) {
      throw new Error("projectsApi.create: name is required and cannot be empty");
    }
    const now = new Date().toISOString();
    const currentUser = (await getCurrentUserCached()) ?? "";
    const project = await projectsStore.create({
      name: data.name,
      weekend_active: data.weekend_active ?? false,
      tags: data.tags ?? null,
      color: data.color ?? null,
      created_at: now,
      sort_order: data.sort_order ?? 0,
      is_archived: false,
      archived_at: null,
      owner: currentUser,
      shared_with: [],
      // is_hidden is only set by the misc-purchases bootstrap; ordinary
      // projects leave it undefined (treated as false on read).
      ...(data.is_hidden ? { is_hidden: true } : {}),
      // Project -> grant link (metadata implementation bot, 2026-05-28).
      // Only persist the field when the caller supplied a value, so projects
      // created without a grant link stay clean (absent = unlinked). null is
      // a valid explicit "unlinked" value the edit form may send.
      ...(data.funding_account_id !== undefined
        ? { funding_account_id: data.funding_account_id }
        : {}),
      // Cross-boundary PROJECT sharing (v1): only the project-import path
      // supplies this provenance stamp. Ordinary creates omit it, so the field
      // stays absent (= not imported) on a clean project.
      ...(data.imported_from !== undefined
        ? { imported_from: data.imported_from }
        : {}),
      // Phase 6a portable identity: mint once at create time so a cross-user
      // bundle can resolve this project by identity rather than by local id.
      source_uuid: (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    });
    // Onboarding v4 §6.1: notify the home-create-project walkthrough
    // step that a new project landed, so BeakerBot can advance without
    // depending on the 500ms polling tick. Cheap no-op when no tour is
    // active. SSR-safe via the `window` typeof check.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tour:project-created", {
          detail: { id: project.id },
        }),
      );
    }
    return project;
  },

  // When `owner` is set (receiver of a shared project with permission "edit"),
  // the write lands in the owner's directory instead of the current user's.
  // VCP R3 attribution stamps: stamp last_edited_by + last_edited_at on
  // every patch. For PI cross-owner edits `last_edited_by` is the PI's
  // username; the "(PI)" badge is a UI render concern.
  //
  // VC Phase 3 (FLAG-5, Project): `historyMeta` lets the restore / undo-restore
  // flows stamp the resulting history row with a non-"update" kind ("revert" /
  // "undo-revert") and the version index it reverted TO. It DEFAULTS to
  // { kind: "update" }, so every existing caller is BYTE-FOR-BYTE unchanged.
  // Mirrors tasksApi.update's signature.
  update: async (
    id: number,
    data: ProjectUpdate,
    owner?: string,
    historyMeta: { kind: HistoryEditKind; revert_target_version?: number } = {
      kind: "update",
    },
  ): Promise<Project | null> => {
    // VC Phase 3 (Project): capture the pre-edit state for the delta store
    // BEFORE the write. Only read when the engine is enabled (recordProjectHistory
    // also short-circuits on the flag), so the no-history path adds zero disk
    // reads. Owner-routed read mirrors the write routing below.
    const prevState = HISTORY_ENGINE_ENABLED
      ? owner
        ? await projectsStore.getForUser(id, owner)
        : await projectsStore.get(id)
      : null;

    // VC Phase 3 (FLAG-revert_undo_window, Project): `revert_undo_window: null`
    // is the explicit CLEAR signal from the undo flow. The store's partial-merge
    // skips `undefined` but would otherwise write `null` into the live project,
    // so we strip the key from the patch and delete it from the persisted record
    // below. A genuine window object passes straight through. Denylisted in
    // canonicalize (revert_undo_window), so it never touches the history delta.
    // Mirrors tasksApi.update's clear handling.
    const clearUndoWindow = data.revert_undo_window === null;
    const { revert_undo_window: rawWindow, ...restData } = data;
    const windowToWrite = rawWindow ?? undefined;

    const patch = {
      ...restData,
      ...(clearUndoWindow ? {} : { revert_undo_window: windowToWrite }),
      ...(await buildAttributionStamp(data.last_edited_by)),
    };
    let result = owner
      ? await projectsStore.updateForUser(id, patch, owner)
      : await projectsStore.update(id, patch);

    // VC Phase 3 (Project): finalize the window CLEAR. The partial-merge store
    // cannot delete a key, so when the undo flow asked to clear we rewrite the
    // record once more with the field removed. Cheap (only on undo). Mirrors
    // tasksApi.update's clear finalization.
    if (clearUndoWindow && result && result.revert_undo_window !== undefined) {
      const { revert_undo_window: _drop, ...withoutWindow } = result;
      result = owner
        ? await projectsStore.saveForUser(id, withoutWindow as Project, owner)
        : await projectsStore.save(id, withoutWindow as Project);
    }

    // Best-effort history append AFTER the live record is persisted. Failures
    // never throw into the save path (recordProjectHistory swallows). No-op when
    // the flag is off. The history file lives under the PROJECT OWNER's folder:
    // the owner arg when routed cross-owner, else the signed-in user.
    if (HISTORY_ENGINE_ENABLED && result) {
      const effectiveOwner = owner ?? (await getCurrentUserCached()) ?? "";
      await recordProjectHistory({
        type: historyMeta.kind,
        id,
        owner: effectiveOwner,
        actor: result.last_edited_by ?? effectiveOwner,
        prevState,
        nextState: result,
        revertTargetVersion: historyMeta.revert_target_version,
      });
    }

    return result;
  },

  // VCP R2 trash everywhere (2026-05-26): soft-delete via `_trash/projects/`.
  // Was a hard-delete in R1 (notes-only trash). Now mirrors `notesApi.delete`:
  // owner-only gate at the API layer (OQ9), routed through the unified
  // `trashEntity()` writer in `@/lib/trash`. PI cross-owner deletes during
  // a Phase 5 unlock are recorded with `deleted_during_session = sessionId`.
  //
  // Project archive vs trash (proposal §3h): `is_archived: true` and the
  // `_trash` block are INDEPENDENT states. A project may be archived first,
  // then trashed — the trashed copy preserves `is_archived: true` and a
  // future restore strips only the `_trash` block. Archive means "done,
  // keep for reference"; trash means "gone, with recovery window". The
  // Projects UI surfaces both buttons separately.
  //
  // Cross-owner cleanup: if any foreign tasks were hosted INTO this project
  // (Option C share), their `external_project` ref is cleared and the
  // `<id>-hosted.json` sidecar is deleted. Without this the sidecar sits
  // orphaned on disk and the hosted tasks render as "shared into a deleted
  // project" until the next reconcile-sweep run. Cleanup is best-effort —
  // errors are logged but never block the project delete. Cleanup still
  // runs in the trash path; restore does NOT recreate the hosted-manifest
  // sidecar (foreign receivers will need to re-host).
  delete: async (
    id: number,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;
    const attribution = await resolveDeleteAttribution(
      currentUser,
      actor,
      sessionId,
      "projectsApi.delete",
    );
    if (!attribution) return;

    if (currentUser) {
      try {
        const { cleanupHostedManifestOnProjectDelete } = await import(
          "./sharing/project-hosting"
        );
        await cleanupHostedManifestOnProjectDelete(
          currentUser,
          id,
          async (owner, taskId) => tasksStore.getForUser(taskId, owner),
          async (owner, task) => {
            await tasksStore.updateForUser(
              task.id,
              { external_project: task.external_project },
              owner
            );
          }
        );
      } catch (err) {
        console.warn(
          `[projectsApi.delete] hosted-manifest cleanup failed for project ${id}:`,
          err
        );
      }
    }
    await softDeleteEntity({
      owner: currentUser,
      entityType: "project",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
    });
  },

  /**
   * Scan the current user's `projects/` folder and delete any file whose
   * parsed JSON is malformed: missing `id`, non-integer `id`, or an empty /
   * whitespace-only `name`. Returns the list of removed file paths.
   *
   * Recovery hatch for the orphan-card bug: when a project record on disk
   * loses its name (e.g. via a buggy historical create path or a manual
   * edit), the home page renders a blank card and the standard
   * `projectsApi.delete(id)` would not be wired up if id itself is bad. This
   * helper sweeps by file content, not by id, so it always converges.
   *
   * Best-effort, silent per-file: a read error on one file does not block
   * the rest of the sweep.
   */
  purgeMalformed: async (): Promise<string[]> => {
    const currentUser = await getCurrentUserCached();
    if (!currentUser) return [];
    const dirPath = `users/${currentUser}/projects`;
    const fileNames = await fileService.listFiles(dirPath);
    const removed: string[] = [];
    for (const fileName of fileNames) {
      if (!fileName.endsWith(".json")) continue;
      // Skip the per-project hosted-tasks sidecar (e.g. `1-hosted.json`).
      // Its shape is `{ version, hostedTasks }`, with no `id` / `name`, and
      // it should not be swept by a malformed-record sweep.
      if (fileName.endsWith("-hosted.json")) continue;
      const filePath = `${dirPath}/${fileName}`;
      const record = await fileService.readJson<Partial<Project>>(filePath);
      const idValid = record && Number.isInteger(record.id) && (record.id as number) > 0;
      const nameValid =
        record && typeof record.name === "string" && record.name.trim().length > 0;
      if (!record || !idValid || !nameValid) {
        const ok = await fileService.deleteFile(filePath);
        if (ok) removed.push(filePath);
      }
    }
    return removed;
  },

  reorder: async (projectIds: number[]): Promise<void> => {
    for (let i = 0; i < projectIds.length; i++) {
      await projectsStore.update(projectIds[i], { sort_order: i });
    }
  },

  archive: async (id: number, isArchived: boolean, owner?: string): Promise<Project | null> => {
    const archivedAt = isArchived ? new Date().toISOString() : null;
    const patch = { is_archived: isArchived, archived_at: archivedAt };
    const result = owner
      ? await projectsStore.updateForUser(id, patch, owner)
      : await projectsStore.update(id, patch);
    if (result) {
      void recordProjectActivity(result.owner, id, { type: "project_archived", archived: isArchived });
    }
    return result;
  },

  /**
   * Read this project's hosted-from-others manifest (`<id>-hosted.json`).
   * Drift entries are dropped on read (with an async write-back of the
   * repaired manifest). Caller gets the agreed entries — every one's task
   * file is guaranteed to exist with a matching `external_project` ref.
   *
   * Returns the FULL Task objects (loaded from each owner's directory),
   * decorated with `is_shared_with_me: true` and the host-project
   * `external_project` ref so the merge layer can colour them by host
   * project. Callers that only want the manifest entries should call
   * `readHostedManifestNormalized` from `lib/sharing/project-hosting`
   * directly.
   */
  // Overview prose lives in a sidecar markdown file at
  // `users/<owner>/projects/<id>-overview.md` (Project Surface L6). The
  // existing `users/<owner>/projects/<id>.json` is untouched: storing prose
  // as raw markdown avoids JSON-escape pain and keeps the body greppable
  // and external-editable.
  //
  // Owner-routing mirrors `get` / `update`: pass `owner` when a receiver
  // with edit permission needs to read/write the original owner's file.
  // Missing file is NOT an error — it means "no overview written yet" —
  // and resolves to an empty string for callers.
  getOverview: async (id: number, owner?: string): Promise<string> => {
    const effectiveOwner = owner ?? (await getCurrentUserCached()) ?? "";
    if (!effectiveOwner) return "";
    const path = `users/${effectiveOwner}/projects/${id}-overview.md`;
    const text = await fileService.readText(path);
    return text ?? "";
  },

  setOverview: async (id: number, body: string, owner?: string): Promise<void> => {
    const effectiveOwner = owner ?? (await getCurrentUserCached()) ?? "";
    if (!effectiveOwner) throw new Error("No current user; cannot save project overview");
    await fileService.ensureDir(`users/${effectiveOwner}/projects`);
    const path = `users/${effectiveOwner}/projects/${id}-overview.md`;
    await fileService.writeText(path, body);
    void recordProjectActivity(effectiveOwner, id, { type: "prose_edited" });
  },

  listHostedTasks: async (
    projectOwner: string,
    projectId: number
  ): Promise<Task[]> => {
    const { readHostedManifestNormalized } = await import(
      "./sharing/project-hosting"
    );
    const entries = await readHostedManifestNormalized(
      projectOwner,
      projectId,
      async (owner, id) => tasksStore.getForUser(id, owner)
    );
    const tasks: Task[] = [];
    for (const entry of entries) {
      const raw = await tasksStore.getForUser(entry.taskId, entry.owner);
      if (!raw) continue;
      const normalized = normalizeTaskRecord(raw);
      tasks.push(
        computeTaskEndDate({
          ...normalized,
          owner: entry.owner,
          // The current user is the destination project's owner (or someone
          // viewing it). They aren't the task's owner, so flag it as
          // "shared with me" at the Gantt/merge layer.
          is_shared_with_me: true,
          // Hosted tasks are display-only for the destination side. The
          // task owner remains the only writer in v1; receivers see "view"
          // even if the task owner has shared edit rights via `shared_with`.
          shared_permission: "view",
        })
      );
    }
    return tasks;
  },
};

// Reads/writes route to the owner's directory when `owner` is provided —
// used by the receiver of a shared task with permission "edit". Without
// `owner`, falls back to the current user's directory (the usual case).
async function getTaskForCaller(id: number, owner?: string): Promise<Task | null> {
  const raw = owner ? await tasksStore.getForUser(id, owner) : await tasksStore.get(id);
  return raw ? normalizeTaskRecord(raw) : null;
}
async function updateTaskForCaller(id: number, data: Partial<Task>, owner?: string): Promise<Task | null> {
  return owner ? tasksStore.updateForUser(id, data, owner) : tasksStore.update(id, data);
}

// Legacy single-method shape: tasks created before multi-method support stored
// the linked method as `method_id` (singular). We've since moved to
// `method_ids` (plural). Files on disk for those old tasks still have
// `method_id` populated and `method_ids: []`. This helper promotes the legacy
// field into the new shape in memory so downstream code can rely on
// `method_ids` exclusively. Files self-heal on the next write since the
// JsonStore spread keeps unknown keys but our writers no longer emit
// `method_id` — over time, edited tasks lose the field naturally. For a
// one-shot disk cleanup, see `tasksApi.repairMethodLinks`.
function normalizeTaskRecord(raw: Task): Task {
  const legacy = raw as Task & { method_id?: number | null };
  let normalized: Task = raw;
  if (
    (!raw.method_ids || raw.method_ids.length === 0) &&
    typeof legacy.method_id === "number"
  ) {
    normalized = { ...raw, method_ids: [legacy.method_id] };
  }
  // Invariant: ∀ a ∈ method_attachments: a.method_id ∈ method_ids. On-disk
  // files predating the tasksApi.update invariant guard (and any task seeded
  // by an earlier demo generator) may carry attachment rows for methods that
  // have since been detached. Drop them on read so callers, the export
  // extractor, and the UI never see the inconsistent shape. The next write
  // through tasksApi.update persists the cleaned form — old files self-heal.
  const methodIds = normalized.method_ids ?? [];
  const attachments = normalized.method_attachments ?? [];
  const filtered = attachments.some((a) => !methodIds.includes(a.method_id))
    ? attachments.filter((a) => methodIds.includes(a.method_id))
    : attachments;
  // Backfill on attachments written before their respective features landed
  // (LC Phase 1a, Markdown Phase 2B, Plate Phase 2C, owner-disambiguation
  // routing-fix). Without this, the field is `undefined` at runtime for any
  // older task, which trips strict null checks in the per-type tab content's
  // snapshot-vs-source branching. For `owner`, null = same user as the task
  // (legacy current-user-first behavior preserved). Each new structured
  // method type that adds a `_*: string | null` slot on TaskMethodAttachment
  // appends one more clause here.
  const needsLcBackfill = filtered.some(
    (a) => !Object.prototype.hasOwnProperty.call(a, "lc_gradient"),
  );
  const needsBodyOverrideBackfill = filtered.some(
    (a) => !Object.prototype.hasOwnProperty.call(a, "body_override"),
  );
  const needsPlateBackfill = filtered.some(
    (a) => !Object.prototype.hasOwnProperty.call(a, "plate_annotation"),
  );
  const needsCellCultureBackfill = filtered.some(
    (a) => !Object.prototype.hasOwnProperty.call(a, "cell_culture_schedule"),
  );
  const needsOwnerBackfill = filtered.some(
    (a) => !Object.prototype.hasOwnProperty.call(a, "owner"),
  );
  const needsQpcrAnalysisBackfill = filtered.some(
    (a) => !Object.prototype.hasOwnProperty.call(a, "qpcr_analysis"),
  );
  // Lab-mode comment thread, mirror of Note.comments. Existing tasks on disk
  // predating the comments addition read with `comments: undefined`; default
  // to [] in-memory so callers and the CommentsThread component never see
  // the missing-field shape.
  if (normalized.comments === undefined) {
    normalized = { ...normalized, comments: [] };
  }
  if (
    filtered !== attachments ||
    needsLcBackfill ||
    needsBodyOverrideBackfill ||
    needsPlateBackfill ||
    needsCellCultureBackfill ||
    needsOwnerBackfill ||
    needsQpcrAnalysisBackfill
  ) {
    normalized = {
      ...normalized,
      method_attachments: filtered.map((a) => {
        let next = a;
        if (!Object.prototype.hasOwnProperty.call(next, "lc_gradient")) {
          next = { ...next, lc_gradient: null };
        }
        if (!Object.prototype.hasOwnProperty.call(next, "body_override")) {
          next = { ...next, body_override: null };
        }
        if (!Object.prototype.hasOwnProperty.call(next, "plate_annotation")) {
          next = { ...next, plate_annotation: null };
        }
        if (!Object.prototype.hasOwnProperty.call(next, "cell_culture_schedule")) {
          next = { ...next, cell_culture_schedule: null };
        }
        if (!Object.prototype.hasOwnProperty.call(next, "owner")) {
          next = { ...next, owner: null };
        }
        if (!Object.prototype.hasOwnProperty.call(next, "qpcr_analysis")) {
          next = { ...next, qpcr_analysis: null };
        }
        return next;
      }),
    };
  }
  return normalized;
}

/**
 * Phase 6a portable identity (phase6a-foundation bot, 2026-06-12): lazy backfill
 * for a Task that predates the source_uuid field. Returns the record with the
 * field set; fires a best-effort write-through so the field persists on the next
 * read without going through a full tasksApi.update (which would stamp
 * last_edited_at and trigger history). Pass ownerOverride when reading a
 * cross-user task (mirrors the tasksApi.get owner routing).
 */
function backfillTaskSourceUuid(task: Task, ownerOverride?: string): Task {
  if (task.source_uuid) return task;
  // Own-store only. A cross-user read (ownerOverride set) never mints or writes
  // into another user's folder; that owner backfills their own copy on read.
  if (ownerOverride) return task;
  const uuid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  void tasksStore.update(task.id, { source_uuid: uuid }).catch(() => { /* fire-and-forget */ });
  return { ...task, source_uuid: uuid };
}

export const tasksApi = {
  // When `owner` is set (the project being listed is shared with the current
  // user), the query reads from the owner's tasks dir instead of the current
  // user's. Without it, a receiver opening a shared project sees nothing —
  // or worse, sees their own tasks whose numeric `project_id` collides with
  // the shared project's id, since per-user id spaces are independent.
  listByProject: async (projectId: number, owner?: string): Promise<Task[]> => {
    const tasks = owner
      ? (await tasksStore.listAllForUser(owner)).filter((t) => t.project_id === projectId)
      : await tasksStore.query({ project_id: projectId });
    // Phase 6a: lazy-backfill source_uuid on tasks that predate the field.
    return tasks.map(computeTaskEndDate).map((t) => backfillTaskSourceUuid(t, owner));
  },

  get: async (id: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(id, owner);
    if (!task) return null;
    // Backfill the `owner` field with whichever directory the task was read
    // from. `owner` is set when reading a shared task from the actual owner's
    // dir; otherwise it's the current user's. Older tasks have `owner: ""`
    // on disk; without this their per-user results path would resolve to
    // `users//results/...`.
    const effectiveOwner = owner ?? (await getCurrentUserCached()) ?? "";
    // Phase 6a: lazy-backfill source_uuid; pass effectiveOwner so the
    // write-through lands in the right directory.
    return backfillTaskSourceUuid(computeTaskEndDate(withOwnerFallback(task, effectiveOwner)), effectiveOwner);
  },
  
  create: async (data: {
    project_id?: number | null;
    name: string;
    start_date: string;
    duration_days?: number;
    is_high_level?: boolean;
    task_type?: "experiment" | "purchase" | "list";
    weekend_override?: boolean | null;
    method_ids?: number[];
    tags?: string[];
    sort_order?: number;
    experiment_color?: string | null;
    sub_tasks?: Array<{ id: string; text: string; is_complete: boolean }>;
    pcr_gradient?: string | null;
    pcr_ingredients?: string | null;
    method_attachments?: Array<{
      method_id: number;
      owner?: string | null;
      pcr_gradient?: string | null;
      pcr_ingredients?: string | null;
      lc_gradient?: string | null;
      body_override?: string | null;
      plate_annotation?: string | null;
      cell_culture_schedule?: string | null;
      variation_notes?: string | null;
      compound_snapshots?: string | null;
      qpcr_analysis?: string | null;
    }>;
  }): Promise<Task> => {
    const durationDays = data.duration_days || 1;
    const endDate = canonicalEndDate({ start_date: data.start_date, duration_days: durationDays });

    // Record the creator as the owner. The file lives under their dir already,
    // but downstream code (per-user results paths, shared-task routing) reads
    // the field directly, so persisting it avoids relying on the directory
    // location later.
    const currentUser = (await getCurrentUserCached()) ?? "";

    const task = await tasksStore.create({
      project_id: data.project_id ?? 0,
      name: data.name,
      start_date: data.start_date,
      duration_days: durationDays,
      end_date: endDate,
      is_high_level: data.is_high_level ?? false,
      is_complete: false,
      task_type: data.task_type ?? "list",
      weekend_override: data.weekend_override ?? null,
      method_ids: data.method_ids ?? [],
      deviation_log: null,
      tags: data.tags ?? null,
      sort_order: data.sort_order ?? 0,
      experiment_color: data.experiment_color ?? null,
      sub_tasks: data.sub_tasks ?? null,
      method_attachments: (data.method_attachments ?? []).map((a) => ({
        method_id: a.method_id,
        owner: a.owner ?? null,
        pcr_gradient: a.pcr_gradient ?? null,
        pcr_ingredients: a.pcr_ingredients ?? null,
        lc_gradient: a.lc_gradient ?? null,
        body_override: a.body_override ?? null,
        plate_annotation: a.plate_annotation ?? null,
        cell_culture_schedule: a.cell_culture_schedule ?? null,
        variation_notes: a.variation_notes ?? null,
        compound_snapshots: a.compound_snapshots ?? null,
        qpcr_analysis: a.qpcr_analysis ?? null,
      })),
      owner: currentUser,
      shared_with: [],
      // Phase 6a portable identity: mint once at create time.
      source_uuid: (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    });
    // Onboarding v4 §6.5: notify the workbench-create-experiment-submit
    // walkthrough beat that an experiment landed. The submit step's
    // manual-advance is gated on this event (disabledUntilEvent), its
    // onEnter listener stamps the created task as a tour artifact, and the
    // TourController's detach watcher uses it to suppress the false "Looks
    // like that closed" recovery when TaskModal closes on a successful
    // create. Dispatched here (not in TaskModal) so BOTH the modal-driven
    // create AND the tour's programmatic `ensureFirstExperimentExists`
    // helper fire the same event. Gated on experiments — lists / purchases
    // don't drive this beat. Cheap no-op when no tour is active. SSR-safe.
    if (typeof window !== "undefined" && task.task_type === "experiment") {
      window.dispatchEvent(
        new CustomEvent("tour:experiment-created", {
          detail: { id: task.id },
        }),
      );
    }
    return task;
  },

  // VC Phase 3 (FLAG-5, Task): `historyMeta` lets the restore / undo-restore
  // flows stamp the resulting history row with a non-"update" kind ("revert" /
  // "undo-revert") and the version index it reverted TO. It DEFAULTS to
  // { kind: "update" }, so every existing caller is BYTE-FOR-BYTE unchanged.
  // Mirrors notesApi.update's signature.
  update: async (
    id: number,
    data: TaskUpdate,
    owner?: string,
    historyMeta: { kind: HistoryEditKind; revert_target_version?: number } = {
      kind: "update",
    },
  ): Promise<Task | null> => {
    const existing = await getTaskForCaller(id, owner);
    if (!existing) return null;

    // Always recompute. end_date is derived from (start_date, duration_days),
    // so any update — even one that doesn't touch those fields — should rewrite
    // it. Otherwise a previously-corrupted end_date persists across edits to
    // unrelated fields like name or is_complete.
    const endDate = canonicalEndDate({
      start_date: data.start_date ?? existing.start_date,
      duration_days: data.duration_days ?? existing.duration_days,
    });

    // VC Phase 3 (FLAG-revert_undo_window, Task): `revert_undo_window: null` is
    // the explicit CLEAR signal from the undo flow. The store's partial-merge
    // skips `undefined` but would otherwise write `null` into the live task, so
    // we strip the key from the patch and delete it from the persisted record
    // below. A genuine window object passes straight through. Denylisted either
    // way (canonicalize end_date + revert_undo_window), so it never touches the
    // history delta. Mirrors notesApi.update's clear handling.
    const clearUndoWindow = data.revert_undo_window === null;

    // Normalize `project_id: null` → `0`. The persisted Task shape (see
    // types.ts) has `project_id: number`, and the canonical "no project"
    // sentinel on disk is `0` — this is how `tasksApi.create` records it
    // (`project_id: data.project_id ?? 0`) and how `listByProject` and
    // related filters expect it. Callers (notably the ELN-import
    // BulkSortScreen) pass `null` to mean "unassign"; normalize here so a
    // single boundary owns the convention and downstream reads can rely on
    // `task.project_id` being a number.
    const { project_id: rawProjectId, revert_undo_window: rawWindow, ...restData } = data;
    const normalizedProjectId =
      rawProjectId === null ? 0 : rawProjectId;
    // Coalesce null -> undefined so the patch type stays `RevertUndoWindow |
    // undefined` (matches Partial<Task>); the null clear is handled separately.
    const windowToWrite = rawWindow ?? undefined;

    // Invariant: ∀ a ∈ method_attachments: a.method_id ∈ method_ids. Whenever
    // a write touches either side of the method relationship, prune the
    // attachments array so per-task overrides (variation_notes, pcr_gradient,
    // pcr_ingredients) can't outlive the method link. addMethod/removeMethod
    // already keep both sides in sync; this guards arbitrary `update` payloads
    // (and reconciles drift carried in from a normalized read).
    const writePatch: Partial<Task> = {
      ...restData,
      ...(normalizedProjectId !== undefined ? { project_id: normalizedProjectId } : {}),
      ...(clearUndoWindow ? {} : { revert_undo_window: windowToWrite }),
      end_date: endDate,
      // VCP R3 attribution stamps: actor + timestamp. The data.last_edited_by
      // override path is for PI cross-owner edits — callers pass the PI's
      // username explicitly; the "(PI)" badge is a UI render concern.
      ...(await buildAttributionStamp(data.last_edited_by)),
    };
    if (data.method_ids !== undefined || data.method_attachments !== undefined) {
      const nextMethodIds = data.method_ids ?? existing.method_ids ?? [];
      const nextAttachments =
        data.method_attachments ?? existing.method_attachments ?? [];
      writePatch.method_attachments = nextAttachments.filter((a) =>
        nextMethodIds.includes(a.method_id)
      );
    }

    // VC Phase 3 (Task): capture the pre-edit state for the delta store BEFORE
    // the write. `existing` is already the pre-edit record (read at the top), so
    // we reuse it rather than a second disk read; only meaningful when the
    // engine is enabled (recordTaskHistory also short-circuits on the flag).
    const prevState = HISTORY_ENGINE_ENABLED ? existing : null;

    let result = await updateTaskForCaller(id, writePatch, owner);

    // VC Phase 3 (Task): finalize the window CLEAR. The partial-merge store
    // cannot delete a key, so when the undo flow asked to clear we rewrite the
    // record once more with the field removed. Cheap (only on undo). Mirrors
    // notesApi.update's clear finalization.
    if (clearUndoWindow && result && result.revert_undo_window !== undefined) {
      const { revert_undo_window: _drop, ...withoutWindow } = result;
      result = owner
        ? await tasksStore.saveForUser(id, withoutWindow as Task, owner)
        : await tasksStore.save(id, withoutWindow as Task);
    }

    // Best-effort history append AFTER the live record is persisted. Failures
    // never throw into the save path (recordTaskHistory swallows). No-op when
    // the flag is off. The history file lives under the TASK OWNER's folder
    // (mirror notesApi.update's effectiveOwner resolution): the owner arg when
    // routed cross-owner, else the signed-in user.
    if (HISTORY_ENGINE_ENABLED && result) {
      const effectiveOwner = owner ?? (await getCurrentUserCached()) ?? "";
      await recordTaskHistory({
        type: historyMeta.kind,
        id,
        owner: effectiveOwner,
        actor: result.last_edited_by ?? effectiveOwner,
        prevState,
        nextState: result,
        revertTargetVersion: historyMeta.revert_target_version,
      });
    }

    // Project activity emissions (best-effort). For tasks hosted INTO a
    // foreign project (Option C), the activity log lives in the foreign
    // project owner's directory, not the task owner's. Native tasks (no
    // external_project) have project_owner === task.owner.
    if (result && result.project_id !== 0) {
      const projectOwner =
        result.external_project?.owner ?? result.owner;
      if (data.is_complete === true && !existing.is_complete) {
        void recordProjectActivity(projectOwner, result.project_id, {
          type: "task_completed",
          task_id: result.id,
          task_owner: result.owner,
          task_name: result.name,
        });
        // Milestone twirl detection (twirl-milestones bot). Emit a
        // client-side completion event from this single chokepoint so the
        // milestone hook can fire the celebratory twirl on the FIRST
        // experiment-complete / FIRST whole-project-done without hooking
        // every UI surface that can toggle a task complete. Best-effort:
        // we read the project owner's task list to decide whether the
        // project is now fully done, and swallow any failure (a missed
        // event just defers the easter-egg, never blocks the write).
        void (async () => {
          try {
            const activeUser = (await getCurrentUserCached()) ?? "";
            if (!activeUser) return;
            const ownerTasks = await tasksStore.listAllForUser(projectOwner);
            const projectTasks = ownerTasks.filter(
              (t) => t.project_id === result.project_id,
            );
            const projectFullyComplete =
              projectTasks.length > 0 &&
              projectTasks.every((t) => t.is_complete);
            taskCompletionEvents.emitCompleted({
              username: activeUser,
              projectOwner,
              projectId: result.project_id,
              taskType: result.task_type,
              projectFullyComplete,
            });
          } catch (err) {
            console.warn(
              "[local-api] task-completion milestone emit failed",
              err,
            );
          }
        })();
      }
      if (writePatch.method_attachments !== undefined) {
        const before = new Map(
          (existing.method_attachments ?? []).map(
            (a) => [`${a.owner ?? ""}:${a.method_id}`, a] as const
          )
        );
        const after = new Map(
          (writePatch.method_attachments ?? []).map(
            (a) => [`${a.owner ?? ""}:${a.method_id}`, a] as const
          )
        );
        for (const [key, a] of after) {
          if (!before.has(key)) {
            void recordProjectActivity(projectOwner, result.project_id, {
              type: "method_added",
              task_id: result.id,
              task_owner: result.owner,
              task_name: result.name,
              method_id: a.method_id,
              method_owner: a.owner,
            });
          }
        }
        for (const [key, a] of before) {
          if (!after.has(key)) {
            void recordProjectActivity(projectOwner, result.project_id, {
              type: "method_removed",
              task_id: result.id,
              task_owner: result.owner,
              task_name: result.name,
              method_id: a.method_id,
              method_owner: a.owner,
            });
          }
        }
      }
    }

    return result;
  },

  // VCP R2 trash everywhere (2026-05-26): soft-delete via `_trash/tasks/`.
  // Was a hard-delete in R1. Now owner-only gated (OQ9) and routed through
  // the unified `trashEntity()` writer. Per proposal §3a, experiments ARE
  // tasks (`task_type: "experiment"`); they land in `_trash/tasks/`, not
  // `_trash/experiments/` (the latter stays empty by design).
  //
  // Parent reference: tasks carry `project_id`, captured on the trash entry
  // so restore-with-dependencies can surface a "parent project is also in
  // trash" prompt when the user restores the task.
  //
  // Cascade cleanup (all best-effort; failures are logged but never block
  // the task delete or each other):
  //   1. Dependency records in `users/<owner>/dependencies/` referencing this
  //      task as parent or child. Orphan deps were surfaced by the
  //      /experiments take-3 debugger on Grant's real data folder.
  //   2. Receivers' `_shared_with_me.json` entries that point at this task.
  //      Without this, receivers see ghost rows for tasks the owner deleted.
  //   3. Cross-owner hosted-manifest entry, if this task was hosted into a
  //      foreign project (`external_project` set). Reuses
  //      `unshareFromProject` for the bidirectional cleanup.
  //   4. The task's results subtree on disk:
  //      `users/<owner>/results/task-<id>/` (notes.md + results.md +
  //      NotesPDFs/ + ResultsPDFs/ + the per-tab Images/ + Files/ folders)
  //      plus the legacy global `results/task-<id>/` path for pre-namespacing
  //      data. This became the SOLE cleanup mechanism for orphan attachments
  //      after the drop-behavior paradigm shift at `e0ffbefb` made
  //      "attached but not body-referenced" a valid state — the per-save GC
  //      sweep (`gcUnreferencedAttachments`) was removed and the cascade
  //      here is the safety net.
  //
  // Cleanups run BEFORE the file delete so we can still read fields like
  // `shared_with` and `external_project`. Trash entries do NOT carry the
  // results subtree — those bytes are hard-removed at delete time (R2
  // tradeoff; results recovery is out of scope for the trash window).
  delete: async (
    id: number,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;
    const task = await tasksStore.get(id);
    // Owner gate uses the task's owner field when available; falls back to
    // the active user for malformed records.
    const targetOwner = task?.owner ?? currentUser;
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "tasksApi.delete",
    );
    if (!attribution) return;

    if (task && currentUser) {
      // 1. Orphan dependencies.
      try {
        const allDeps = await dependenciesStore.listAll();
        const orphans = allDeps.filter(
          (d) => d.parent_id === id || d.child_id === id
        );
        for (const dep of orphans) {
          try {
            await dependenciesStore.delete(dep.id);
          } catch (err) {
            console.warn(
              `[tasksApi.delete] failed to delete dep record ${dep.id} for task ${id}:`,
              err
            );
          }
        }
      } catch (err) {
        console.warn(
          `[tasksApi.delete] dependency cleanup failed for task ${id}:`,
          err
        );
      }

      // 2. Receivers' `_shared_with_me.json` entries.
      try {
        const recipients = (task.shared_with ?? [])
          .map((s) => s.username)
          .filter((u): u is string => typeof u === "string" && u.length > 0);
        for (const username of recipients) {
          try {
            await removeReceiverShare(username, "task", id, currentUser);
          } catch (err) {
            console.warn(
              `[tasksApi.delete] failed to remove _shared_with_me entry for ${username}/${id}:`,
              err
            );
          }
        }
      } catch (err) {
        console.warn(
          `[tasksApi.delete] shared_with cleanup failed for task ${id}:`,
          err
        );
      }

      // 3. Cross-owner hosted-manifest entry.
      if (task.external_project) {
        try {
          const { unshareFromProject } = await import(
            "./sharing/project-hosting"
          );
          await unshareFromProject(
            {
              taskOwner: currentUser,
              taskId: id,
              projectOwner: task.external_project.owner,
              projectId: task.external_project.id,
            },
            {
              loadTask: async (owner, taskId) =>
                tasksStore.getForUser(taskId, owner),
              saveTask: async (owner, t) => {
                await tasksStore.saveForUser(t.id, t, owner);
              },
            }
          );
        } catch (err) {
          console.warn(
            `[tasksApi.delete] hosted-manifest cleanup failed for task ${id}:`,
            err
          );
        }
      }

      // 4. Recursively remove the task's results subtree (per-user canonical
      //    path + legacy global path). Best-effort: `deleteDirectory`
      //    returns false on a missing path, so we don't need to probe
      //    existence first.
      try {
        await fileService.deleteDirectory(taskResultsBase(task));
      } catch (err) {
        console.warn(
          `[tasksApi.delete] results-subtree cleanup failed for task ${id}:`,
          err
        );
      }
      try {
        await fileService.deleteDirectory(legacyTaskResultsBase(id));
      } catch (err) {
        console.warn(
          `[tasksApi.delete] legacy results-subtree cleanup failed for task ${id}:`,
          err
        );
      }
    }

    // Route through trash. project_id is the parent reference so the
    // restore-with-dependencies prompt can fire when both the task and
    // its parent Project sit in trash.
    await softDeleteEntity({
      owner: targetOwner,
      entityType: "task",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
      parentId: task?.project_id ?? null,
      parentEntityType: "project",
    });
  },

  listByMethod: async (methodId: number): Promise<Task[]> => {
    const allTasks = await tasksStore.listAll();
    return allTasks.filter((t) => t.method_ids?.includes(methodId));
  },

  move: async (id: number, data: TaskMoveRequest, owner?: string): Promise<ShiftResult> => {
    const newStartDate = parseDate(data.new_start_date);
    // Streak Phase S4 / proposal L9: load the active user's PTO list so the
    // shift cascade treats those weekdays as skip-days same as weekends. Best
    // effort — if the sidecar is missing or unreadable, ptoDates falls back
    // to [] and behavior is identical to pre-S4. The PTO list is always read
    // from the ACTIVE user (the caller's session), never `owner`, since PTO
    // is per-individual private data and the L9 invariant is "the user's
    // PTO" not "the task owner's PTO".
    const activeUser = await getCurrentUserCached();
    let ptoDates: readonly string[] = [];
    if (activeUser) {
      try {
        const streak = await readStreak(activeUser);
        ptoDates = streak.pto_dates;
      } catch {
        // Sidecar missing or unreadable; preserve pre-S4 behavior.
        ptoDates = [];
      }
    }
    const result = await shiftTask(id, newStartDate, data.confirmed ?? false, owner, ptoDates);
    // Append a `_shifted-alerts.json` entry for every affected task that's
    // shared with someone, so receivers can decide whether to realign their
    // own dependent work on their next load. Best-effort; never throws.
    if (!result.requires_confirmation) {
      await recordShiftAlerts(result, owner);
    }
    return result;
  },
  
  replicate: async (id: number, count: number, offsetDays: number): Promise<Task[]> => {
    const original = await tasksStore.get(id);
    if (!original) return [];
    
    const created: Task[] = [];
    for (let i = 1; i <= count; i++) {
      const newStart = new Date(parseDate(original.start_date));
      newStart.setDate(newStart.getDate() + offsetDays * i);
      
      const startStr = formatDate(newStart);
      const newTask = await tasksStore.create({
        ...original,
        start_date: startStr,
        end_date: canonicalEndDate({ start_date: startStr, duration_days: original.duration_days }),
        is_complete: false,
      });
      created.push(newTask);
    }
    return created;
  },
  
  resetPcr: async (id: number, methodId?: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(id, owner);
    if (!task) return null;

    if (methodId) {
      const attachments = task.method_attachments?.map((a) => {
        if (a.method_id === methodId) {
          return { ...a, pcr_gradient: null, pcr_ingredients: null };
        }
        return a;
      });
      return updateTaskForCaller(id, { method_attachments: attachments }, owner);
    }

    return updateTaskForCaller(id, {
      method_attachments: task.method_attachments?.map((a) => ({
        ...a,
        pcr_gradient: null,
        pcr_ingredients: null,
      })),
    }, owner);
  },

  // `methodOwner` is the picker-resolved owner namespace of the method
  // being attached (e.g. "public" for a public method, a username for
  // someone's private method, `null` for same-user-as-task / locally-owned).
  // Threading it directly from the picker context sidesteps the bare-id
  // `allMethods.filter` collision class — when two methods share the same
  // id across namespaces, `candidates[0]` is non-deterministic. Callers
  // that already know the owner pass it; callers that don't (legacy paths,
  // tasksApi.update with method_ids drift) fall back to the lookup, which
  // resolves correctly when there's no collision and degrades to "first
  // match" when there is.
  addMethod: async (
    taskId: number,
    methodId: number,
    methodOwner?: string | null,
    owner?: string,
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const methodIds = [...(task.method_ids || [])];
    if (!methodIds.includes(methodId)) {
      methodIds.push(methodId);
    }

    const attachments = [...(task.method_attachments || [])];
    if (!attachments.find((a) => a.method_id === methodId)) {
      let resolvedOwner: string | null =
        methodOwner === undefined ? null : methodOwner;
      if (methodOwner === undefined) {
        try {
          const allMethods = await fetchAllMethodsIncludingShared();
          const candidates = allMethods.filter((m) => m.id === methodId);
          if (candidates.length > 0) {
            resolvedOwner = candidates[0].owner ?? null;
          }
        } catch (err) {
          console.warn("[addMethod] could not resolve method owner:", err);
        }
      }
      attachments.push({
        method_id: methodId,
        owner: resolvedOwner,
        pcr_gradient: null,
        pcr_ingredients: null,
        lc_gradient: null,
        body_override: null,
        plate_annotation: null,
        cell_culture_schedule: null,
        variation_notes: null,
        compound_snapshots: null,
        qpcr_analysis: null,
      });
    }

    return updateTaskForCaller(taskId, { method_ids: methodIds, method_attachments: attachments }, owner);
  },

  removeMethod: async (taskId: number, methodId: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const methodIds = (task.method_ids || []).filter((id) => id !== methodId);
    const attachments = (task.method_attachments || []).filter((a) => a.method_id !== methodId);

    return updateTaskForCaller(taskId, { method_ids: methodIds, method_attachments: attachments }, owner);
  },

  /**
   * One-shot disk-level cleanup: walks every task owned by the current user
   * and promotes any legacy top-level `method_id` into `method_ids` if the
   * new array is empty. Writes back so the on-disk JSON gets the new shape.
   *
   * The lazy `normalizeTaskRecord` already covers in-memory reads, so this
   * function is purely for users who want the disk shape cleaned up
   * eagerly (and for confidence that all legacy task records have been
   * migrated). Returns counts so the UI can show a summary.
   *
   * Only touches tasks under `users/{currentUser}/tasks/`. Tasks belonging
   * to other users (shared-with-me) are not modified, even if the caller
   * has edit permission — they self-heal next time the owner edits.
   */
  repairMethodLinks: async (): Promise<{ scanned: number; repaired: number; alreadyCorrect: number; failed: number }> => {
    const tasks = await tasksStore.listAll();
    let repaired = 0;
    let alreadyCorrect = 0;
    let failed = 0;
    for (const raw of tasks) {
      const legacy = raw as Task & { method_id?: number | null };
      const needsPromotion =
        (!raw.method_ids || raw.method_ids.length === 0) &&
        typeof legacy.method_id === "number";
      const hasLegacyKey = "method_id" in raw;
      if (!needsPromotion && !hasLegacyKey) {
        alreadyCorrect += 1;
        continue;
      }
      try {
        const next: Task = needsPromotion
          ? { ...raw, method_ids: [legacy.method_id as number] }
          : raw;
        // Drop the legacy field from the persisted shape.
        const persisted: Record<string, unknown> = { ...next };
        delete persisted.method_id;
        await tasksStore.save(raw.id, persisted as unknown as Task);
        repaired += 1;
      } catch (err) {
        console.warn(`[repairMethodLinks] failed to repair task ${raw.id}:`, err);
        failed += 1;
      }
    }
    return { scanned: tasks.length, repaired, alreadyCorrect, failed };
  },

  updateMethodPcr: async (
    taskId: number,
    methodId: number,
    data: { pcr_gradient?: string; pcr_ingredients?: string },
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, ...data };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  updateMethodLc: async (
    taskId: number,
    methodId: number,
    data: { lc_gradient?: string },
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, ...data };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  resetLc: async (id: number, methodId?: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(id, owner);
    if (!task) return null;

    if (methodId) {
      const attachments = task.method_attachments?.map((a) => {
        if (a.method_id === methodId) {
          return { ...a, lc_gradient: null };
        }
        return a;
      });
      return updateTaskForCaller(id, { method_attachments: attachments }, owner);
    }

    return updateTaskForCaller(id, {
      method_attachments: task.method_attachments?.map((a) => ({
        ...a,
        lc_gradient: null,
      })),
    }, owner);
  },

  // Writes a per-task markdown body override to the attachment for `methodId`.
  // Mirrors `updateMethodLc`: edits on the experiment page write here so the
  // source method's `.md` file stays untouched (the canonical reusable
  // protocol), while each task can document its own variation against the
  // source. Pass `body: ""` to override with an empty body; pass `null` via
  // `resetMarkdownOverride` to revert to "use source body unchanged".
  updateMethodMarkdownOverride: async (
    taskId: number,
    methodId: number,
    body: string,
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, body_override: body };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  resetMarkdownOverride: async (
    taskId: number,
    methodId: number,
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, body_override: null };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  updateMethodPlate: async (
    taskId: number,
    methodId: number,
    data: { plate_annotation?: string },
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, ...data };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  resetPlate: async (id: number, methodId?: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(id, owner);
    if (!task) return null;

    if (methodId) {
      const attachments = task.method_attachments?.map((a) => {
        if (a.method_id === methodId) {
          return { ...a, plate_annotation: null };
        }
        return a;
      });
      return updateTaskForCaller(id, { method_attachments: attachments }, owner);
    }

    return updateTaskForCaller(id, {
      method_attachments: task.method_attachments?.map((a) => ({
        ...a,
        plate_annotation: null,
      })),
    }, owner);
  },

  updateMethodCellCulture: async (
    taskId: number,
    methodId: number,
    data: { cell_culture_schedule?: string },
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, ...data };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  resetCellCulture: async (id: number, methodId?: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(id, owner);
    if (!task) return null;

    if (methodId) {
      const attachments = task.method_attachments?.map((a) => {
        if (a.method_id === methodId) {
          return { ...a, cell_culture_schedule: null };
        }
        return a;
      });
      return updateTaskForCaller(id, { method_attachments: attachments }, owner);
    }

    return updateTaskForCaller(id, {
      method_attachments: task.method_attachments?.map((a) => ({
        ...a,
        cell_culture_schedule: null,
      })),
    }, owner);
  },

  updateMethodQpcrAnalysis: async (
    taskId: number,
    methodId: number,
    data: { qpcr_analysis?: string },
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, ...data };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  resetQpcrAnalysis: async (id: number, methodId?: number, owner?: string): Promise<Task | null> => {
    const task = await getTaskForCaller(id, owner);
    if (!task) return null;

    if (methodId) {
      const attachments = task.method_attachments?.map((a) => {
        if (a.method_id === methodId) {
          return { ...a, qpcr_analysis: null };
        }
        return a;
      });
      return updateTaskForCaller(id, { method_attachments: attachments }, owner);
    }

    return updateTaskForCaller(id, {
      method_attachments: task.method_attachments?.map((a) => ({
        ...a,
        qpcr_analysis: null,
      })),
    }, owner);
  },

  /** Convenience: append one actual event to the per-task cell culture
   *  snapshot without round-tripping the whole instance through the UI.
   *  If no snapshot exists yet, one is seeded with the source schedule's
   *  planned events. Returns the updated task. */
  appendCellCultureEvent: async (
    taskId: number,
    methodId: number,
    event: CellCultureActualEvent,
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id !== methodId) return a;
      let snapshot: { planned_events: unknown[]; actual_events: CellCultureActualEvent[] };
      if (a.cell_culture_schedule) {
        try {
          const parsed = JSON.parse(a.cell_culture_schedule);
          snapshot = {
            planned_events: Array.isArray(parsed?.planned_events) ? parsed.planned_events : [],
            actual_events: Array.isArray(parsed?.actual_events)
              ? (parsed.actual_events as CellCultureActualEvent[])
              : [],
            ...parsed,
          };
        } catch {
          snapshot = { planned_events: [], actual_events: [] };
        }
      } else {
        snapshot = { planned_events: [], actual_events: [] };
      }
      const next = {
        ...snapshot,
        actual_events: [...snapshot.actual_events, event],
      };
      return { ...a, cell_culture_schedule: JSON.stringify(next) };
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  saveVariationNote: async (
    taskId: number,
    methodId: number,
    variationNotes: string,
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) => {
      if (a.method_id === methodId) {
        return { ...a, variation_notes: variationNotes };
      }
      return a;
    });

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },

  // Overwrite the gathered-reagent checklist state for one attached method. The
  // companion phone syncs the FULL map each time, so this replaces (last write
  // wins), never merges. Mirrors saveVariationNote.
  saveGatheredChecks: async (
    taskId: number,
    methodId: number,
    gathered: MethodGatheredChecks,
    owner?: string
  ): Promise<Task | null> => {
    const task = await getTaskForCaller(taskId, owner);
    if (!task) return null;

    const attachments = (task.method_attachments || []).map((a) =>
      a.method_id === methodId ? { ...a, gathered_checks: gathered } : a
    );

    return updateTaskForCaller(taskId, { method_attachments: attachments }, owner);
  },
  
  checkDuplicate: async (
    projectId: number,
    name: string,
    taskType: string,
    excludeTaskId?: number
  ): Promise<{ has_duplicate: boolean; matching_tasks: Task[] }> => {
    const tasks = await tasksStore.query({ project_id: projectId, task_type: taskType as Task["task_type"] });
    const matching = tasks.filter((t) => 
      t.name.toLowerCase() === name.toLowerCase() && 
      t.id !== excludeTaskId
    );
    return {
      has_duplicate: matching.length > 0,
      matching_tasks: matching,
    };
  },
  
  convertType: async (
    id: number,
    newTaskType: "experiment" | "purchase" | "list",
    owner?: string
  ): Promise<Task | null> => {
    return updateTaskForCaller(id, { task_type: newTaskType }, owner);
  },

  /**
   * Cross-owner task → project sharing. Writes BOTH sides (task
   * `external_project` + destination project's hosted manifest). See
   * `frontend/src/lib/sharing/project-hosting.ts` for the contract,
   * drift-detection, and repair pattern.
   *
   * `taskOwner` is the original owner of the task (where the file lives).
   * Today this is always the current user — only the task's own owner can
   * share it into a foreign project — but parametrize for symmetry with
   * other `*Api` patterns and future delegated actions.
   *
   * Returns the updated task (with `external_project` set).
   */
  shareIntoProject: async (
    taskOwner: string,
    taskId: number,
    projectOwner: string,
    projectId: number
  ): Promise<Task | null> => {
    const sharedBy = (await getCurrentUserCached()) ?? taskOwner;
    const { shareIntoProject } = await import("./sharing/project-hosting");
    const result = await shareIntoProject(
      { taskOwner, taskId, projectOwner, projectId },
      {
        loadTask: async (owner, id) => tasksStore.getForUser(id, owner),
        saveTask: async (owner, task) => {
          await tasksStore.saveForUser(task.id, task, owner);
        },
        sharedBy,
      }
    );
    return result.task;
  },

  /**
   * Cross-owner unshare. Clears `external_project` on the task AND removes
   * the manifest entry. Symmetric for v1: both the originating task owner
   * AND the destination project owner can call this.
   */
  unshareFromProject: async (
    taskOwner: string,
    taskId: number,
    projectOwner: string,
    projectId: number
  ): Promise<Task | null> => {
    const { unshareFromProject } = await import("./sharing/project-hosting");
    const result = await unshareFromProject(
      { taskOwner, taskId, projectOwner, projectId },
      {
        loadTask: async (owner, id) => tasksStore.getForUser(id, owner),
        saveTask: async (owner, task) => {
          await tasksStore.saveForUser(task.id, task, owner);
        },
      }
    );
    return result.task;
  },

  // Append a comment to a task's thread. Mirror of notesApi.addComment.
  // When `owner` is set (current user is a receiver editing a shared task),
  // the read + write routes through the owner's directory so the comment
  // lands on the owner's task file — same cross-user pattern as every other
  // mutating tasks call. Append-only by design; no edit. Author must be a
  // real username, not "lab" (the caller in CommentsThread enforces this).
  //
  // Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23): `options`
  // carries the optional `parent_id` (threading) + `mentions` (denormalized
  // @-mention list). Both stay optional for callers that haven't been
  // updated yet — existing tests pass undefined and get pre-Phase-2
  // behavior. After the comment lands, fan-out bell notifications to the
  // owner / mentioned users / lab heads via dispatchCommentNotifications.
  addComment: async (
    taskId: number,
    text: string,
    author: string,
    owner?: string,
    options?: { parent_id?: string | null; mentions?: string[] },
  ): Promise<Task | null> => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const task = owner
      ? await tasksStore.getForUser(taskId, owner)
      : await tasksStore.get(taskId);
    if (!task) return null;
    const newComment: TaskComment = {
      id: crypto.randomUUID(),
      author,
      text: trimmed,
      created_at: new Date().toISOString(),
    };
    if (options?.parent_id) newComment.parent_id = options.parent_id;
    if (options?.mentions && options.mentions.length > 0) {
      newComment.mentions = options.mentions;
    }
    const comments = [...(task.comments || []), newComment];
    const patch = { comments };
    const updated = owner
      ? await tasksStore.updateForUser(taskId, patch, owner)
      : await tasksStore.update(taskId, patch);
    if (updated) {
      // Notification fan-out — never blocks the write. The owner of the
      // task file is whichever directory the file lives in (owner arg) or
      // the current user (the only writer who can update their own dir).
      const ownerUsername =
        owner || updated.owner || (await getCurrentUserCached());
      void dispatchCommentNotifications({
        commentId: newComment.id,
        author,
        text: trimmed,
        ownerUsername,
        recordType: "task",
        recordId: taskId,
        recordName: updated.name,
        mentions: options?.mentions ?? [],
      });
    }
    return updated ? normalizeTaskRecord(updated) : null;
  },

  // Remove a comment from a task's thread. Mirror of notesApi.deleteComment.
  // Only the comment's author can call this — the UI enforces that, but the
  // API doesn't (caller-trusted, like every other path in this app's
  // local-only model).
  deleteComment: async (
    taskId: number,
    commentId: string,
    owner?: string,
  ): Promise<Task | null> => {
    const task = owner
      ? await tasksStore.getForUser(taskId, owner)
      : await tasksStore.get(taskId);
    if (!task) return null;
    const comments = (task.comments || []).filter((c) => c.id !== commentId);
    const patch = { comments };
    const updated = owner
      ? await tasksStore.updateForUser(taskId, patch, owner)
      : await tasksStore.update(taskId, patch);
    return updated ? normalizeTaskRecord(updated) : null;
  },
};

export const dependenciesApi = {
  list: async (projectId?: number): Promise<Dependency[]> => {
    if (projectId) {
      const tasks = await tasksStore.query({ project_id: projectId });
      const taskIds = new Set(tasks.map((t) => t.id));
      const allDeps = await dependenciesStore.listAll();
      return allDeps.filter(
        (d) => taskIds.has(d.parent_id) && taskIds.has(d.child_id)
      );
    }
    return dependenciesStore.listAll();
  },
  
  create: async (data: DependencyCreate): Promise<Dependency> => {
    return dependenciesStore.create(data);
  },
  
  delete: async (id: number): Promise<void> => {
    await dependenciesStore.delete(id);
  },
};

// Legacy field name: `source_path` was previously called `github_path` back
// when method content lived in a GitHub repo. Files on disk for old methods
// still carry `github_path` populated and `source_path` missing. This helper
// promotes the legacy field in memory so downstream code can rely on
// `source_path` exclusively. For one-shot disk cleanup, see
// `methodsApi.repairSourcePaths`.
//
// Also handles the demo-seed shape (scripts/generate-demo-data.mjs's
// `methodJson()`), which writes `source_path: null` and stashes the body
// path under `attachments[0].path` with `attachment_type: "markdown"`.
// The `attachments` array isn't part of the Method type — readJson
// passes the field through verbatim, but no consumer looks at it. Promote
// the first markdown attachment's path into `source_path` so the methods
// page, export pipeline, etc. find the body via the canonical field.
type LegacyMethodAttachment = { attachment_type?: string; path?: string };
function normalizeMethodRecord(raw: Method): Method {
  const legacy = raw as Method & {
    github_path?: string | null;
    attachments?: LegacyMethodAttachment[];
  };
  if (raw.source_path == null && typeof legacy.github_path === "string") {
    return { ...raw, source_path: legacy.github_path };
  }
  if (raw.source_path == null && Array.isArray(legacy.attachments)) {
    const mdAttachment = legacy.attachments.find(
      (a) => a?.attachment_type === "markdown" && typeof a.path === "string"
    );
    if (mdAttachment?.path) {
      return { ...raw, source_path: mdAttachment.path };
    }
  }
  return raw;
}

/**
 * Phase 6a portable identity (phase6a-foundation bot, 2026-06-12): lazy backfill
 * for a Method that predates the source_uuid field. Fire-and-forget write-through;
 * the caller gets the enriched record immediately. Distinguishes public methods
 * (owner === "public") so the write lands in the right store.
 */
function backfillMethodSourceUuid(method: Method, currentUser: string): Method {
  if (method.source_uuid) return method;
  // Own-store only. A read never mints or writes into a public/communal method
  // ("public" sentinel) or another user's shared method (that owner backfills
  // their own copy), so a read never mutates a file we do not own and the
  // identity stays stable. An own method is ownerless (bare own store) or owned
  // by the current user.
  const isOwn = !method.owner || method.owner === currentUser;
  if (method.owner === "public" || !isOwn) return method;
  const uuid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  if (method.owner) {
    void methodsStore.updateForUser(method.id, { source_uuid: uuid }, method.owner).catch(() => { /* fire-and-forget */ });
  } else {
    void methodsStore.update(method.id, { source_uuid: uuid }).catch(() => { /* fire-and-forget */ });
  }
  return { ...method, source_uuid: uuid };
}

// R1d: a one-shot warning fired when a caller routes a `methodsApi.create`
// to the public namespace using only the deprecated `is_public: true`
// alias (no whole-lab "*" entry in `shared_with`). The flag is module
// scoped so the warning never spams a session no matter how many
// migration-era callsites still pass the boolean. Cleared in the R1
// schema rip phase when the alias goes away.
let __methodsCreateLegacyIsPublicWarned = false;
function warnLegacyIsPublicOnMethodCreateOnce(): void {
  if (__methodsCreateLegacyIsPublicWarned) return;
  __methodsCreateLegacyIsPublicWarned = true;
  console.warn(
    "[methodsApi.create] `is_public: true` is deprecated. Pass " +
      "`shared_with: [{ username: \"*\", level: \"read\" }]` instead. " +
      "The boolean alias will be removed after one release of back-compat.",
  );
}

export const methodsApi = {
  list: async (): Promise<Method[]> => {
    const privateMethods = await methodsStore.listAll();
    const publicMethods = await publicMethodsStore.listAll();
    const currentUser = (await getCurrentUserCached()) ?? "";

    // Phase 6a: lazy-backfill source_uuid after legacy normalization. Only the
    // current user's own methods write through; public/foreign are left as-is.
    const marked = [
      ...privateMethods.map((m) => backfillMethodSourceUuid(normalizeMethodRecord({ ...m, is_public: false }), currentUser)),
      ...publicMethods.map((m) => backfillMethodSourceUuid(normalizeMethodRecord({ ...m, is_public: true }), currentUser)),
    ];
    return marked;
  },

  // When `owner` is set, the read targets the owner's private methods dir
  // (used by receivers viewing a shared method). The sentinel `"public"`
  // routes to the shared public store, so callers can thread an
  // attachment's `owner` field uniformly without special-casing — public
  // method attachments carry `owner: "public"` per the routing-fix
  // contract (3f8b42d2).
  get: async (id: number, owner?: string): Promise<Method | null> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    if (owner === "public") {
      const publicMethod = await publicMethodsStore.get(id);
      // Phase 6a: lazy-backfill source_uuid on read.
      return publicMethod
        ? backfillMethodSourceUuid(normalizeMethodRecord({ ...publicMethod, is_public: true }), currentUser)
        : null;
    }
    if (owner) {
      const ownerMethod = await methodsStore.getForUser(id, owner);
      if (ownerMethod) return backfillMethodSourceUuid(normalizeMethodRecord({ ...ownerMethod, is_public: false }), currentUser);
      return null;
    }
    const method = await methodsStore.get(id);
    if (method) return backfillMethodSourceUuid(normalizeMethodRecord({ ...method, is_public: false }), currentUser);

    const publicMethod = await publicMethodsStore.get(id);
    if (publicMethod) return backfillMethodSourceUuid(normalizeMethodRecord({ ...publicMethod, is_public: true }), currentUser);

    return null;
  },

  create: async (data: MethodCreate): Promise<Method> => {
    // Lab Mode retirement R1d (R1d shared_with API manager,
    // 2026-05-23): the unified sharing primitive is now the source of
    // truth for the public-vs-private routing decision. Callers pass
    // `shared_with: [{ username: "*", level: "read" }]` to land in the
    // whole-lab (public) namespace; an empty / absent `shared_with`
    // means private. The legacy `is_public: true` boolean is still
    // honored as a deprecated alias for one release of back-compat,
    // with a one-shot console.warn when it is the only sharing signal
    // (i.e. no `shared_with` whole-lab entry to corroborate it). The
    // on-disk record still gets `is_public` written so receiver-side
    // back-compat readers keep working until the R1 schema rip lands.
    const sharedWithInput = normalizeSharedWith(data.shared_with);
    const wholeLabViaSharedWith = isWholeLabShared(sharedWithInput);
    const legacyIsPublic = data.is_public === true;
    if (legacyIsPublic && !wholeLabViaSharedWith) {
      warnLegacyIsPublicOnMethodCreateOnce();
    }
    const wantPublic = wholeLabViaSharedWith || legacyIsPublic;

    if (wantPublic) {
      // Ensure the unified "*" entry lands on disk even when the caller
      // only passed the legacy boolean. Preserves any other recipients
      // the caller listed alongside the sentinel.
      const hasSentinel = sharedWithInput.some(
        (s) => s.username === WHOLE_LAB_SENTINEL,
      );
      const sharedWithPersisted: SharedUser[] = hasSentinel
        ? sharedWithInput
        : [...sharedWithInput, { username: WHOLE_LAB_SENTINEL, level: "read" }];
      return publicMethodsStore.create({
        ...data,
        source_path: data.source_path ?? null,
        method_type: data.method_type ?? null,
        folder_path: data.folder_path ?? null,
        parent_method_id: data.parent_method_id ?? null,
        tags: data.tags ?? null,
        is_public: true,
        created_by: null,
        owner: "public",
        shared_with: sharedWithPersisted,
        // Phase 6a portable identity: mint once at create time.
        source_uuid: (typeof crypto !== "undefined" && "randomUUID" in crypto)
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2),
      });
    }

    const currentUser = await getCurrentUserCached();
    return methodsStore.create({
      ...data,
      source_path: data.source_path ?? null,
      method_type: data.method_type ?? null,
      folder_path: data.folder_path ?? null,
      parent_method_id: data.parent_method_id ?? null,
      tags: data.tags ?? null,
      is_public: false,
      created_by: null,
      owner: currentUser,
      shared_with: sharedWithInput,
      // Phase 6a portable identity: mint once at create time.
      source_uuid: (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    });
  },

  // When `owner` is set (receiver of a shared method with permission "edit"),
  // the write lands in the owner's private methods dir. Public methods are
  // shared globally and are never owner-routed.
  // VCP R3 attribution stamps: every update path lands the actor + when.
  update: async (id: number, data: MethodUpdate, owner?: string): Promise<Method | null> => {
    const patch = { ...data, ...(await buildAttributionStamp(data.last_edited_by)) };
    if (owner) {
      return methodsStore.updateForUser(id, patch, owner);
    }
    let method = await methodsStore.get(id);
    if (method) {
      return methodsStore.update(id, patch);
    }

    method = await publicMethodsStore.get(id);
    if (method) {
      return publicMethodsStore.update(id, patch);
    }

    return null;
  },

  getChildren: async (id: number): Promise<Method[]> => {
    const allMethods = await methodsApi.list();
    return allMethods.filter((m) => m.parent_method_id === id);
  },

  getExperiments: async (id: number): Promise<MethodExperiment[]> => {
    const tasks = await tasksStore.listAll();
    return tasks.filter((t) => t.method_ids?.includes(id) && t.task_type === "experiment").map((t) => ({
      id: t.id,
      name: t.name,
      project_id: t.project_id,
      start_date: t.start_date,
      duration_days: t.duration_days,
      end_date: t.end_date,
      is_complete: t.is_complete,
      task_type: t.task_type,
      experiment_color: t.experiment_color,
      variation_notes: null,
    }));
  },

  // Forks always land in the current user's library — "make my own copy" is
  // the whole point. The owner arg only routes the read of the source method
  // so a receiver editing a shared method can still fork it.
  fork: async (
    id: number,
    data: { new_name: string; new_source_path: string; deviations: string },
    owner?: string
  ): Promise<Method> => {
    const original = await methodsApi.get(id, owner);
    if (!original) throw new Error("Method not found");

    return methodsStore.create({
      ...original,
      name: data.new_name,
      source_path: data.new_source_path,
      parent_method_id: id,
      is_public: false,
      // Phase 6a portable identity: a fork gets its own fresh uuid (it is a
      // new object, not the same identity as the original).
      source_uuid: (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    });
  },

  saveDeviation: async (data: { task_id: number; deviations: string }): Promise<Task | null> => {
    return tasksStore.update(data.task_id, { deviation_log: data.deviations });
  },

  // Wrap an existing method into a freshly-created compound that lists the
  // source method as its first component. The compound lands in the current
  // user's namespace (Q-V1 lock: compounds are private-only in v2), so
  // wrapping a shared/public method copies the *reference* — not the method
  // file itself. Used by the "+ Add component (extend into kit)" affordance
  // on every non-compound method viewer.
  wrapAsCompound: async (
    methodId: number,
    options?: { name?: string; folderPath?: string },
    owner?: string,
  ): Promise<Method> => {
    const source = await methodsApi.get(methodId, owner);
    if (!source) throw new Error(`Method ${methodId} not found.`);
    // methodsApi.create hard-codes `owner: ""` on the persisted record (the
    // ownership-by-file-location convention predates an explicit owner
    // field). Backfill the actual current user so downstream consumers of
    // the freshly-created compound — notably validateCompoundComponents'
    // fallback chain `(c.owner ?? currentMethodId.owner ?? "")` — can
    // resolve component owners against the source's `(id, owner)` key. The
    // built-in `save` overwrites the same file we just wrote.
    const currentUser = await getCurrentUserCached();
    const compoundName = options?.name ?? `${source.name} (kit)`;
    const created = await methodsApi.create({
      name: compoundName,
      source_path: null,
      method_type: "compound",
      folder_path: options?.folderPath ?? source.folder_path,
      is_public: false,
      components: [
        {
          method_id: source.id,
          owner: source.owner && source.owner !== currentUser ? source.owner : null,
          ordering: 0,
        },
      ],
    });
    const withOwner = await methodsStore.save(created.id, {
      ...created,
      owner: currentUser,
    });
    return withOwner;
  },

  // VCP R2 trash everywhere (2026-05-26): soft-delete via `_trash/methods/`.
  // Was a hard-delete in R1. Owner-only gated (OQ9), routed through
  // `trashEntity()`. Public methods (`is_public: true`) live in
  // `users/public/methods/` and are NOT subject to per-user trash — they
  // hard-delete as before since "public" is not an owner who can issue a
  // restore in their own trash. Private methods land in the owner's
  // `_trash/methods/`.
  delete: async (
    id: number,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;

    // Resolve the method's owner from disk — private and public paths
    // both need a probe so the trash routing picks the right home.
    const privateMethod = await methodsStore.get(id);
    const publicMethod = privateMethod ? null : await publicMethodsStore.get(id);
    if (publicMethod) {
      // Public methods bypass the per-user trash flow (no owner who can
      // own the trash entry). Hard-delete preserved for back-compat.
      await publicMethodsStore.delete(id);
      return;
    }
    if (!privateMethod) {
      // Nothing on disk. Tolerate the double-delete to keep callers idempotent.
      await methodsStore.delete(id);
      await publicMethodsStore.delete(id);
      return;
    }
    const targetOwner = privateMethod.owner || currentUser;
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "methodsApi.delete",
    );
    if (!attribution) return;
    await softDeleteEntity({
      owner: targetOwner,
      entityType: "method",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
      parentId: privateMethod.parent_method_id ?? null,
      parentEntityType: "method",
    });
  },

  /**
   * One-shot disk-level cleanup: walks every method (private + public) and
   * rewrites any record that still carries the legacy `github_path` field
   * into the new `source_path` shape, dropping the legacy key. The lazy
   * `normalizeMethodRecord` covers in-memory reads already; this is for
   * eagerly tidying the on-disk JSON for confidence and cleaner files.
   */
  repairSourcePaths: async (): Promise<{ scanned: number; repaired: number; alreadyCorrect: number; failed: number }> => {
    const records: Array<{ method: Method; store: typeof methodsStore | typeof publicMethodsStore }> = [];
    for (const m of await methodsStore.listAll()) records.push({ method: m, store: methodsStore });
    for (const m of await publicMethodsStore.listAll()) records.push({ method: m, store: publicMethodsStore });

    let repaired = 0;
    let alreadyCorrect = 0;
    let failed = 0;
    for (const { method, store } of records) {
      const legacy = method as Method & { github_path?: string | null };
      const hasLegacyKey = "github_path" in method;
      const needsPromotion = method.source_path == null && typeof legacy.github_path === "string";
      if (!needsPromotion && !hasLegacyKey) {
        alreadyCorrect += 1;
        continue;
      }
      try {
        const next: Method = needsPromotion
          ? { ...method, source_path: legacy.github_path as string }
          : method;
        const persisted: Record<string, unknown> = { ...next };
        delete persisted.github_path;
        await store.save(method.id, persisted as unknown as Method);
        repaired += 1;
      } catch (err) {
        console.warn(`[repairSourcePaths] failed to repair method ${method.id}:`, err);
        failed += 1;
      }
    }
    return { scanned: records.length, repaired, alreadyCorrect, failed };
  },
};

// ── Inventory (v1 data layer) ────────────────────────────────────────────────
// inventory-chunk1 sub-bot of HR (2026-06-07). The catalog-item / stock-instance
// split from `plans/INVENTORY_DESIGN.md`. Mirrors `methodsApi` closely (CRUD +
// owner-routed getForUser/saveForUser + a fetchAll...IncludingShared read path +
// per-user counters via JsonStore). No UI here. See `lib/inventory/config.ts`
// for the `INVENTORY_ENABLED` flag (chunk 2 gates the surface on it).

/** The whole-lab-edit default for a new inventory record (design §6.1). Uses
 *  the canonical `WHOLE_LAB_SENTINEL` from `lib/sharing/unified.ts`, NOT a
 *  hand-built string, so it stays in lockstep with `canRead` / `canWrite`. */
function wholeLabEditShare(): SharedUser[] {
  return [{ username: WHOLE_LAB_SENTINEL, level: "edit" }];
}

/** UTC day number (whole days since the epoch) for a date, used so the expiry
 *  comparison is day-level. Expiration dates are stored at UTC midnight (see
 *  `dateInputToIso`); comparing raw timestamps flips "expired" at UTC midnight,
 *  which lands the previous evening in a US (UTC-negative) timezone and reads as
 *  an off-by-one. Comparing day numbers keeps an item "expires today" for its
 *  whole stored day. */
function utcDayNumber(d: Date): number {
  return Math.floor(d.getTime() / 86_400_000);
}

/**
 * Derive the persisted `status` of a stock from its own fields + its parent
 * item (design §5.2, "derived-and-persisted"). Recomputed on every write.
 *
 * Precedence, highest first:
 *   1. `expired`  — `expiration_date` is in the past.
 *   2. `empty`    — when `units_per_scan` is set: `units_remaining <= 0`;
 *                   otherwise: `container_count <= 0`.
 *   3. manual tap — a directly-set `low` / `empty` is HONORED and never
 *                   clobbered back to `in_stock` by a recompute. (A manual
 *                   `empty` on a still-positive count is preserved.)
 *   4. `low`      — when `units_per_scan` is set: `units_remaining` is below
 *                   the item's `low_at_count` threshold (units, not containers);
 *                   otherwise: summed container_count is below `low_at_count`.
 *   5. `in_stock` — otherwise.
 *
 * `summedCount` is the total container_count across ALL stocks of the item
 * (the low signal is item-level, not per-stock; design §2.3, §10). Callers
 * pass it so this stays a pure function; when omitted it falls back to this
 * stock's own count (single-stock case).
 *
 * When `units_per_scan` is set the low signal uses `units_remaining` directly
 * (a per-stock unit ledger) rather than the summed container count. The
 * `units_remaining` ledger does not cross container boundaries.
 *
 * `now` is injectable for deterministic tests.
 */
export function deriveInventoryStatus(
  stock: {
    container_count: number;
    expiration_date: string | null;
    status?: InventoryStockStatus;
    units_per_scan?: number;
    units_remaining?: number;
  },
  item: { low_at_count: number | null } | null | undefined,
  options?: { summedCount?: number; now?: Date; manualStatus?: InventoryStockStatus | null },
): InventoryStockStatus {
  const now = options?.now ?? new Date();
  const count = Number.isFinite(stock.container_count) ? stock.container_count : 0;

  // 1. Expiry wins outright — it is a fact about the reagent, not a tap. The
  //    comparison is day-level (UTC) so a stock is "expired" only once its
  //    stored expiry DAY has fully passed, not at the instant of UTC midnight.
  if (stock.expiration_date) {
    const exp = new Date(stock.expiration_date);
    if (!Number.isNaN(exp.getTime()) && utcDayNumber(now) > utcDayNumber(exp)) {
      return "expired";
    }
  }

  // Detect whether this stock is running the units-per-scan ledger.
  const trackedByUnits =
    typeof stock.units_per_scan === "number" &&
    stock.units_per_scan > 0 &&
    typeof stock.units_remaining === "number";

  if (trackedByUnits) {
    const remaining = stock.units_remaining as number;

    // 2a. Units ledger empty.
    if (remaining <= 0) return "empty";

    // 3. Honor a manual low/empty tap.
    const manual = options?.manualStatus ?? stock.status;
    if (manual === "low" || manual === "empty") return manual;

    // 4a. Units-based low signal vs item threshold.
    const threshold = item?.low_at_count ?? null;
    if (threshold != null && remaining < threshold) return "low";

    return "in_stock";
  }

  // 2. A zero (or negative) count is empty regardless of taps.
  if (count <= 0) return "empty";

  // 3. Honor a manual low/empty tap (the caller's intent), so a human flag is
  //    not silently recomputed away while the count is still positive.
  const manual = options?.manualStatus ?? stock.status;
  if (manual === "low" || manual === "empty") return manual;

  // 4. Count-based low signal (item-level threshold vs summed counts).
  const summed = options?.summedCount ?? count;
  const threshold = item?.low_at_count ?? null;
  if (threshold != null && summed < threshold) return "low";

  // 5. Default.
  return "in_stock";
}

/**
 * Read-boundary normalizer for an `InventoryItem` (template:
 * normalizeMethodRecord / normalizeSequenceMeta). Tolerates legacy / absent
 * fields so records written before a field existed keep loading. Additive +
 * lazy — no on-disk migration. `owner` is back-filled from the directory the
 * record was read from when absent.
 */
export function normalizeInventoryItemRecord(
  raw: InventoryItem,
  fallbackOwner?: string,
): InventoryItem {
  return {
    ...raw,
    name: raw.name ?? "",
    category: raw.category ?? "reagent",
    catalog_number: raw.catalog_number ?? null,
    vendor: raw.vendor ?? null,
    cas: raw.cas ?? null,
    url: raw.url ?? null,
    container_label: raw.container_label ?? null,
    storage_class: raw.storage_class ?? null,
    hazard_note: raw.hazard_note ?? null,
    sds_url: raw.sds_url ?? null,
    notes: raw.notes ?? null,
    low_at_count: raw.low_at_count ?? null,
    track_consumption: raw.track_consumption ?? false,
    product_barcode: raw.product_barcode ?? null,
    registry: raw.registry ?? null,
    owner: raw.owner ?? fallbackOwner ?? "",
    shared_with: normalizeSharedWith(raw.shared_with),
    created_by: raw.created_by ?? null,
    tags: raw.tags ?? null,
  };
}

/**
 * Read-boundary normalizer for an `InventoryStock`. Defaults a missing
 * `container_count` to 1 (design §13 Q2: a status-only stock with count 1 is
 * valid), derives a missing `status`, and back-fills the optional fields to
 * `null`. Note that `deriveInventoryStatus` runs WITHOUT the parent item here
 * (read-time, single-record), so a legacy record missing `status` gets the
 * count/expiry-derived value; the item-level low signal is recomputed on the
 * next write or by the widget computations (chunk 3).
 */
export function normalizeInventoryStockRecord(
  raw: InventoryStock,
  fallbackOwner?: string,
): InventoryStock {
  const container_count =
    typeof raw.container_count === "number" && Number.isFinite(raw.container_count)
      ? raw.container_count
      : 1;
  const expiration_date = raw.expiration_date ?? null;
  const status: InventoryStockStatus =
    raw.status ??
    deriveInventoryStatus(
      { container_count, expiration_date, status: undefined },
      null,
    );
  return {
    ...raw,
    item_id: raw.item_id,
    lot_number: raw.lot_number ?? null,
    container_count,
    status,
    received_date: raw.received_date ?? null,
    expiration_date,
    opened_date: raw.opened_date ?? null,
    last_touched_at: raw.last_touched_at ?? null,
    amount_per_container: raw.amount_per_container ?? null,
    unit: raw.unit ?? null,
    concentration: raw.concentration ?? null,
    location_text: raw.location_text ?? null,
    location_node_id: raw.location_node_id ?? null,
    position: raw.position ?? null,
    purchase_item_id: raw.purchase_item_id ?? null,
    container_code: raw.container_code ?? null,
    ...(raw.units_per_scan != null ? { units_per_scan: raw.units_per_scan } : {}),
    ...(raw.units_remaining != null ? { units_remaining: raw.units_remaining } : {}),
    // scan_unit_label: FLAG (scan-manager web sub-bot, 2026-06-08). New additive
    // field. Absent on every pre-existing stock. Lazy-normalize to null on read.
    ...(raw.scan_unit_label != null ? { scan_unit_label: raw.scan_unit_label } : {}),
    notes: raw.notes ?? null,
    owner: raw.owner ?? fallbackOwner ?? "",
    shared_with: normalizeSharedWith(raw.shared_with),
    created_by: raw.created_by ?? null,
  };
}

export const inventoryItemsApi = {
  list: async (): Promise<InventoryItem[]> => {
    const items = await inventoryItemsStore.listAll();
    return items.map((m) => normalizeInventoryItemRecord(m));
  },

  // `owner` routes the read into another member's dir (a receiver viewing a
  // whole-lab-shared item). Mirrors methodsApi.get's owner-routing.
  get: async (id: number, owner?: string): Promise<InventoryItem | null> => {
    if (owner) {
      const rec = await inventoryItemsStore.getForUser(id, owner);
      return rec ? normalizeInventoryItemRecord(rec, owner) : null;
    }
    const rec = await inventoryItemsStore.get(id);
    return rec ? normalizeInventoryItemRecord(rec) : null;
  },

  getForUser: async (id: number, owner: string): Promise<InventoryItem | null> => {
    const rec = await inventoryItemsStore.getForUser(id, owner);
    return rec ? normalizeInventoryItemRecord(rec, owner) : null;
  },

  create: async (data: InventoryItemCreate): Promise<InventoryItem> => {
    const currentUser = await getCurrentUserCached();
    const shared_with = data.shared_with ?? wholeLabEditShare();
    const stamp = await buildAttributionStamp(data.created_by);
    const created = await inventoryItemsStore.create({
      name: data.name,
      category: data.category ?? "reagent",
      catalog_number: data.catalog_number ?? null,
      vendor: data.vendor ?? null,
      cas: data.cas ?? null,
      url: data.url ?? null,
      container_label: data.container_label ?? null,
      storage_class: data.storage_class ?? null,
      hazard_note: data.hazard_note ?? null,
      sds_url: data.sds_url ?? null,
      notes: data.notes ?? null,
      low_at_count: data.low_at_count ?? null,
      track_consumption: data.track_consumption ?? false,
      product_barcode: data.product_barcode ?? null,
      registry: data.registry ?? null,
      tags: data.tags ?? null,
      owner: currentUser,
      shared_with,
      created_by: data.created_by ?? currentUser,
      last_edited_by: stamp.last_edited_by,
      last_edited_at: stamp.last_edited_at,
    });
    const normalized = normalizeInventoryItemRecord(created, currentUser);
    void recordInventoryItemVersion(normalized, currentUser);
    return normalized;
  },

  // Owner-routed create — bumps the TARGET user's counter so a PI / collaborator
  // adding an item into another member's namespace doesn't collide ids.
  createForUser: async (
    data: InventoryItemCreate,
    owner: string,
  ): Promise<InventoryItem> => {
    const shared_with = data.shared_with ?? wholeLabEditShare();
    const stamp = await buildAttributionStamp(data.created_by);
    const created = await inventoryItemsStore.createForUser(
      {
        name: data.name,
        category: data.category ?? "reagent",
        catalog_number: data.catalog_number ?? null,
        vendor: data.vendor ?? null,
        cas: data.cas ?? null,
        url: data.url ?? null,
        container_label: data.container_label ?? null,
        storage_class: data.storage_class ?? null,
        hazard_note: data.hazard_note ?? null,
        sds_url: data.sds_url ?? null,
        notes: data.notes ?? null,
        low_at_count: data.low_at_count ?? null,
        track_consumption: data.track_consumption ?? false,
        product_barcode: data.product_barcode ?? null,
        registry: data.registry ?? null,
        tags: data.tags ?? null,
        owner,
        shared_with,
        created_by: data.created_by ?? owner,
        last_edited_by: stamp.last_edited_by,
        last_edited_at: stamp.last_edited_at,
      },
      owner,
    );
    return normalizeInventoryItemRecord(created, owner);
  },

  update: async (
    id: number,
    data: InventoryItemUpdate,
    owner?: string,
  ): Promise<InventoryItem | null> => {
    const currentUser = await getCurrentUserCached();
    const patch = { ...data, ...(await buildAttributionStamp(data.last_edited_by)) };
    const updated = owner
      ? await inventoryItemsStore.updateForUser(id, patch, owner)
      : await inventoryItemsStore.update(id, patch);
    if (!updated) return null;
    const normalized = normalizeInventoryItemRecord(updated, owner);
    void recordInventoryItemVersion(normalized, currentUser);
    return normalized;
  },

  saveForUser: async (
    id: number,
    data: InventoryItem,
    owner: string,
  ): Promise<InventoryItem> => {
    const saved = await inventoryItemsStore.saveForUser(id, data, owner);
    return normalizeInventoryItemRecord(saved, owner);
  },

  // chunk-5 bot (2026-06-07): soft-delete via `_trash/inventory_items/`.
  // Mirrors the VCP R2 "trash everywhere" pattern used by methods, tasks, etc.
  delete: async (
    id: number,
    owner?: string,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;
    const rec = owner
      ? await inventoryItemsStore.getForUser(id, owner)
      : await inventoryItemsStore.get(id);
    if (!rec) return;
    const targetOwner = rec.owner || owner || currentUser;
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "inventoryItemsApi.delete",
    );
    if (!attribution) return;
    await softDeleteEntity({
      owner: targetOwner,
      entityType: "inventory_item",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
    });
  },
};

export const inventoryStocksApi = {
  list: async (): Promise<InventoryStock[]> => {
    const stocks = await inventoryStocksStore.listAll();
    return stocks.map((s) => normalizeInventoryStockRecord(s));
  },

  // All stocks for one item (current user's namespace). Cross-user reads use
  // listForUser / the IncludingShared aggregate.
  listForItem: async (itemId: number, owner?: string): Promise<InventoryStock[]> => {
    const stocks = owner
      ? await inventoryStocksStore.listAllForUser(owner)
      : await inventoryStocksStore.listAll();
    return stocks
      .map((s) => normalizeInventoryStockRecord(s, owner))
      .filter((s) => s.item_id === itemId);
  },

  get: async (id: number, owner?: string): Promise<InventoryStock | null> => {
    if (owner) {
      const rec = await inventoryStocksStore.getForUser(id, owner);
      return rec ? normalizeInventoryStockRecord(rec, owner) : null;
    }
    const rec = await inventoryStocksStore.get(id);
    return rec ? normalizeInventoryStockRecord(rec) : null;
  },

  getForUser: async (id: number, owner: string): Promise<InventoryStock | null> => {
    const rec = await inventoryStocksStore.getForUser(id, owner);
    return rec ? normalizeInventoryStockRecord(rec, owner) : null;
  },

  // Sum the container_count across an item's stocks (the item-level low signal
  // basis). `existing` lets a write include the about-to-be-saved record in the
  // sum before it lands on disk.
  _summedCountForItem: async (
    itemId: number,
    owner: string,
    overrideStockId?: number,
    overrideCount?: number,
  ): Promise<number> => {
    const stocks = (await inventoryStocksStore.listAllForUser(owner)).filter(
      (s) => s.item_id === itemId,
    );
    let sum = 0;
    for (const s of stocks) {
      if (overrideStockId != null && s.id === overrideStockId) {
        sum += overrideCount ?? 0;
      } else {
        const c =
          typeof s.container_count === "number" && Number.isFinite(s.container_count)
            ? s.container_count
            : 0;
        sum += c;
      }
    }
    if (overrideStockId == null && overrideCount != null) sum += overrideCount;
    return sum;
  },

  create: async (data: InventoryStockCreate, owner?: string): Promise<InventoryStock> => {
    const currentUser = await getCurrentUserCached();
    const targetOwner = owner ?? currentUser;
    // Stock inherits the parent item's sharing (design §5.2); fall back to the
    // whole-lab-edit default when the item can't be read.
    const parentItem = await inventoryItemsStore.getForUser(data.item_id, targetOwner);
    const shared_with =
      data.shared_with ??
      (parentItem ? normalizeSharedWith(parentItem.shared_with) : wholeLabEditShare());

    const container_count = data.container_count ?? 1;
    const expiration_date = data.expiration_date ?? null;
    const nowIso = new Date().toISOString();
    const stamp = await buildAttributionStamp(data.created_by);

    // Derive status with the item-level low threshold + the summed count
    // (including this new stock's count, which isn't on disk yet).
    const summed = await inventoryStocksApi._summedCountForItem(
      data.item_id,
      targetOwner,
      undefined,
      container_count,
    );
    const status = deriveInventoryStatus(
      {
        container_count,
        expiration_date,
        status: data.status,
        units_per_scan: data.units_per_scan,
        units_remaining: data.units_remaining,
      },
      parentItem ? { low_at_count: parentItem.low_at_count ?? null } : null,
      { summedCount: summed, manualStatus: data.status ?? null },
    );

    const payload: Omit<InventoryStock, "id"> = {
      item_id: data.item_id,
      lot_number: data.lot_number ?? null,
      container_count,
      status,
      received_date: data.received_date ?? null,
      expiration_date,
      opened_date: data.opened_date ?? null,
      last_touched_at: data.last_touched_at ?? nowIso,
      amount_per_container: data.amount_per_container ?? null,
      unit: data.unit ?? null,
      concentration: data.concentration ?? null,
      location_text: data.location_text ?? null,
      location_node_id: data.location_node_id ?? null,
      position: data.position ?? null,
      purchase_item_id: data.purchase_item_id ?? null,
      container_code: data.container_code ?? null,
      ...(data.units_per_scan != null ? { units_per_scan: data.units_per_scan } : {}),
      ...(data.units_remaining != null ? { units_remaining: data.units_remaining } : {}),
      ...(data.scan_unit_label != null ? { scan_unit_label: data.scan_unit_label } : {}),
      notes: data.notes ?? null,
      owner: targetOwner,
      shared_with,
      created_by: data.created_by ?? targetOwner,
      last_edited_by: stamp.last_edited_by,
      last_edited_at: stamp.last_edited_at,
    };

    const created = owner
      ? await inventoryStocksStore.createForUser(payload, owner)
      : await inventoryStocksStore.create(payload);
    const normalized = normalizeInventoryStockRecord(created, targetOwner);
    void recordInventoryStockVersion(normalized, currentUser);
    return normalized;
  },

  update: async (
    id: number,
    data: InventoryStockUpdate,
    owner?: string,
  ): Promise<InventoryStock | null> => {
    const currentUser = await getCurrentUserCached();
    const targetOwner = owner ?? currentUser;
    const existing = owner
      ? await inventoryStocksStore.getForUser(id, owner)
      : await inventoryStocksStore.get(id);
    if (!existing) return null;

    // Merge the patch onto the existing record so status derivation sees the
    // post-write field values.
    const merged: InventoryStock = { ...existing };
    const mergedRecord = merged as unknown as Record<string, unknown>;
    for (const key of Object.keys(data) as (keyof InventoryStockUpdate)[]) {
      const value = data[key];
      if (value !== undefined) {
        mergedRecord[key as string] = value;
      }
    }

    const itemId = merged.item_id;
    const parentItem = await inventoryItemsStore.getForUser(itemId, targetOwner);
    const summed = await inventoryStocksApi._summedCountForItem(
      itemId,
      targetOwner,
      id,
      merged.container_count,
    );
    // A manual status tap arrives via `data.status`; honor it. When the patch
    // doesn't set status, fall back to the stored value so an existing manual
    // low/empty isn't clobbered.
    const manualStatus = data.status ?? existing.status ?? null;
    const status = deriveInventoryStatus(
      {
        container_count: merged.container_count,
        expiration_date: merged.expiration_date,
        status: data.status,
        units_per_scan: merged.units_per_scan,
        units_remaining: merged.units_remaining,
      },
      parentItem ? { low_at_count: parentItem.low_at_count ?? null } : null,
      { summedCount: summed, manualStatus },
    );

    const stamp = await buildAttributionStamp(data.last_edited_by);
    const patch: Partial<InventoryStock> = {
      ...data,
      status,
      last_touched_at: data.last_touched_at ?? new Date().toISOString(),
      last_edited_by: stamp.last_edited_by,
      last_edited_at: stamp.last_edited_at,
    };

    const updated = owner
      ? await inventoryStocksStore.updateForUser(id, patch, owner)
      : await inventoryStocksStore.update(id, patch);
    if (!updated) return null;
    const normalized = normalizeInventoryStockRecord(updated, targetOwner);
    void recordInventoryStockVersion(normalized, currentUser);
    return normalized;
  },

  saveForUser: async (
    id: number,
    data: InventoryStock,
    owner: string,
  ): Promise<InventoryStock> => {
    const saved = await inventoryStocksStore.saveForUser(id, data, owner);
    return normalizeInventoryStockRecord(saved, owner);
  },

  // chunk-5 bot (2026-06-07): soft-delete via `_trash/inventory_stocks/`.
  delete: async (
    id: number,
    owner?: string,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;
    const rec = owner
      ? await inventoryStocksStore.getForUser(id, owner)
      : await inventoryStocksStore.get(id);
    if (!rec) return;
    const targetOwner = rec.owner || owner || currentUser;
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "inventoryStocksApi.delete",
    );
    if (!attribution) return;
    await softDeleteEntity({
      owner: targetOwner,
      entityType: "inventory_stock",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
    });
  },
};

/**
 * Whole-lab read aggregate for inventory items (template:
 * `cabinetApi.getNotes` — walk every member's dir, stamp owner, then a
 * `canRead` gate per record). Returns the union of every member's items the
 * `viewer` may read, with `is_shared_with_me` overlaid for items owned by
 * someone else. This is "the lab inventory" the design calls a computed union
 * (§6.1).
 */
export const fetchAllInventoryItemsIncludingShared = async (): Promise<
  InventoryItem[]
> => {
  const viewer = await buildCurrentViewer();
  const currentUser = viewer.username;
  const usernames = await discoverUsers();
  const out: InventoryItem[] = [];
  for (const username of usernames) {
    const items = await inventoryItemsStore.listAllForUser(username);
    for (const raw of items) {
      const item = normalizeInventoryItemRecord(raw, username);
      if (!canRead(item, viewer)) continue;
      out.push({
        ...item,
        is_shared_with_me: item.owner !== currentUser,
      });
    }
  }
  return out;
};

/** Mirror of `fetchAllInventoryItemsIncludingShared` for stocks. */
export const fetchAllInventoryStocksIncludingShared = async (): Promise<
  InventoryStock[]
> => {
  const viewer = await buildCurrentViewer();
  const currentUser = viewer.username;
  const usernames = await discoverUsers();
  const out: InventoryStock[] = [];
  for (const username of usernames) {
    const stocks = await inventoryStocksStore.listAllForUser(username);
    for (const raw of stocks) {
      const stock = normalizeInventoryStockRecord(raw, username);
      if (!canRead(stock, viewer)) continue;
      out.push({
        ...stock,
        is_shared_with_me: stock.owner !== currentUser,
      });
    }
  }
  return out;
};

// ── Storage nodes (v2 location tree) ─────────────────────────────────────────
// inventory box-finder foundation (2026-06-07). The recursive `StorageNode`
// tree from `plans/INVENTORY_DESIGN.md` §5.3. Mirrors `inventoryItemsApi`
// (CRUD + owner-routed getForUser/saveForUser + a fetchAll...IncludingShared
// read path + per-user counters via JsonStore). No UI here, and no history
// wiring yet (FLAG-H ships the recorder/adapter in a later chunk). The map UI,
// BoxGrid, and tree view are the NEXT chunk.

/**
 * Read-boundary normalizer for a `StorageNode` (template:
 * `normalizeInventoryItemRecord`). Tolerates legacy / absent fields so records
 * written before a field existed keep loading. Additive + lazy — no on-disk
 * migration. `owner` is back-filled from the directory the record was read from
 * when absent.
 */
export function normalizeStorageNodeRecord(
  raw: StorageNode,
  fallbackOwner?: string,
): StorageNode {
  return {
    ...raw,
    name: raw.name ?? "",
    kind: raw.kind ?? "other",
    parent_id: raw.parent_id ?? null,
    temperature: raw.temperature ?? null,
    box_rows: raw.box_rows ?? null,
    box_cols: raw.box_cols ?? null,
    notes: raw.notes ?? null,
    owner: raw.owner ?? fallbackOwner ?? "",
    shared_with: normalizeSharedWith(raw.shared_with),
    created_by: raw.created_by ?? null,
  };
}

export const storageNodesApi = {
  list: async (): Promise<StorageNode[]> => {
    const nodes = await storageNodesStore.listAll();
    return nodes.map((n) => normalizeStorageNodeRecord(n));
  },

  // `owner` routes the read into another member's dir (a viewer browsing a
  // whole-lab-shared location tree). Mirrors inventoryItemsApi.get's routing.
  get: async (id: number, owner?: string): Promise<StorageNode | null> => {
    if (owner) {
      const rec = await storageNodesStore.getForUser(id, owner);
      return rec ? normalizeStorageNodeRecord(rec, owner) : null;
    }
    const rec = await storageNodesStore.get(id);
    return rec ? normalizeStorageNodeRecord(rec) : null;
  },

  getForUser: async (id: number, owner: string): Promise<StorageNode | null> => {
    const rec = await storageNodesStore.getForUser(id, owner);
    return rec ? normalizeStorageNodeRecord(rec, owner) : null;
  },

  // Direct children of a node (the tree expansion primitive). `parent_id ===
  // null` returns the top-level nodes. Reads the current user's namespace
  // unless `owner` routes elsewhere.
  listChildren: async (
    parentId: number | null,
    owner?: string,
  ): Promise<StorageNode[]> => {
    const nodes = owner
      ? await storageNodesStore.listAllForUser(owner)
      : await storageNodesStore.listAll();
    return nodes
      .map((n) => normalizeStorageNodeRecord(n, owner))
      .filter((n) => (n.parent_id ?? null) === (parentId ?? null));
  },

  create: async (
    data: StorageNodeCreate,
    owner?: string,
  ): Promise<StorageNode> => {
    const currentUser = await getCurrentUserCached();
    const targetOwner = owner ?? currentUser;
    const shared_with = data.shared_with ?? wholeLabEditShare();
    const stamp = await buildAttributionStamp(data.created_by);
    const payload: Omit<StorageNode, "id"> = {
      name: data.name,
      kind: data.kind ?? "other",
      parent_id: data.parent_id ?? null,
      temperature: data.temperature ?? null,
      box_rows: data.box_rows ?? null,
      box_cols: data.box_cols ?? null,
      notes: data.notes ?? null,
      owner: targetOwner,
      shared_with,
      created_by: data.created_by ?? targetOwner,
      last_edited_by: stamp.last_edited_by,
      last_edited_at: stamp.last_edited_at,
    };
    const created = owner
      ? await storageNodesStore.createForUser(payload, owner)
      : await storageNodesStore.create(payload);
    return normalizeStorageNodeRecord(created, targetOwner);
  },

  // Owner-routed create — bumps the TARGET user's counter so a PI / collaborator
  // adding a node into another member's namespace doesn't collide ids.
  createForUser: async (
    data: StorageNodeCreate,
    owner: string,
  ): Promise<StorageNode> => storageNodesApi.create(data, owner),

  update: async (
    id: number,
    data: StorageNodeUpdate,
    owner?: string,
  ): Promise<StorageNode | null> => {
    const patch = { ...data, ...(await buildAttributionStamp(data.last_edited_by)) };
    const updated = owner
      ? await storageNodesStore.updateForUser(id, patch, owner)
      : await storageNodesStore.update(id, patch);
    if (!updated) return null;
    return normalizeStorageNodeRecord(updated, owner);
  },

  saveForUser: async (
    id: number,
    data: StorageNode,
    owner: string,
  ): Promise<StorageNode> => {
    const saved = await storageNodesStore.saveForUser(id, data, owner);
    return normalizeStorageNodeRecord(saved, owner);
  },

  // Soft-delete via `_trash/storage_nodes/` (VCP R2 "trash everywhere"),
  // mirroring inventoryItemsApi.delete. The caller is responsible for any
  // child-node / placed-stock warnings (a UI concern in the next chunk).
  delete: async (
    id: number,
    owner?: string,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;
    const rec = owner
      ? await storageNodesStore.getForUser(id, owner)
      : await storageNodesStore.get(id);
    if (!rec) return;
    const targetOwner = rec.owner || owner || currentUser;
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "storageNodesApi.delete",
    );
    if (!attribution) return;
    await softDeleteEntity({
      owner: targetOwner,
      entityType: "storage_node",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
    });
  },
};

/**
 * Whole-lab read aggregate for storage nodes (template:
 * `fetchAllInventoryItemsIncludingShared`). Returns the union of every
 * member's location nodes the viewer may read, with `is_shared_with_me`
 * overlaid for nodes owned by someone else. This is "the lab freezer map" as a
 * computed union (design §6.1).
 */
export const fetchAllStorageNodesIncludingShared = async (): Promise<
  StorageNode[]
> => {
  const viewer = await buildCurrentViewer();
  const currentUser = viewer.username;
  const usernames = await discoverUsers();
  const out: StorageNode[] = [];
  for (const username of usernames) {
    const nodes = await storageNodesStore.listAllForUser(username);
    for (const raw of nodes) {
      const node = normalizeStorageNodeRecord(raw, username);
      if (!canRead(node, viewer)) continue;
      out.push({
        ...node,
        is_shared_with_me: node.owner !== currentUser,
      });
    }
  }
  return out;
};

// ── sequencesApi ────────────────────────────────────────────────────────────
// SnapGene-style sequence/plasmid library (proposal Phase 1). Mirrors the other
// *Api shapes (list / get / create / update / delete + getForUser cross-user +
// a listByProject collection filter). The on-disk truth is a GenBank file
// (`{id}.gb`) plus a `{id}.meta.json` sidecar — see lib/sequences/sequence-store
// and the SequenceMeta type. DATA-SHAPE FLAGGED: review before merge.

/**
 * Normalize-on-read for the sequence sidecar (forward-compat, template:
 * normalizeMethodRecord / normalizeTaskRecord). Back-fills defaults for fields
 * added after a record was first written so older `{id}.meta.json` files keep
 * loading cleanly. Currently: `project_ids` defaults to `[]` and `seq_type`
 * defaults to "dna" if a pre-field record is missing them.
 */
function normalizeSequenceMeta(raw: SequenceMeta): SequenceMeta {
  return {
    ...raw,
    project_ids: Array.isArray(raw.project_ids) ? raw.project_ids : [],
    seq_type: (raw.seq_type as SeqType) ?? "dna",
    added_at: raw.added_at ?? new Date(0).toISOString(),
    display_name: raw.display_name ?? `Sequence ${raw.id}`,
  };
}

export const sequencesApi = {
  /** List the current user's sequences as light summary records (no bases). */
  list: async (): Promise<SequenceRecord[]> => {
    const username = await getCurrentUserCached();
    return sequencesApi.getForUser(username);
  },

  /** List a specific user's sequences (cross-user read), summary records. */
  getForUser: async (username: string): Promise<SequenceRecord[]> => {
    const metas = await sequenceStore.listMetaForUser(username);
    const records: SequenceRecord[] = [];
    for (const rawMeta of metas) {
      const meta = normalizeSequenceMeta(rawMeta);
      const raw = await sequenceStore.getRawForUser(meta.id, username);
      const genbank = raw?.genbank ?? "";
      records.push(genbankToRecord(genbank, meta));
    }
    return records;
  },

  /** Sequences linked to a given project id (collection filter). */
  listByProject: async (projectId: number | string): Promise<SequenceRecord[]> => {
    const id = String(projectId);
    const all = await sequencesApi.list();
    return all.filter((s) => s.project_ids.includes(id));
  },

  /** Sequences with no project link yet ("Unfiled" collection). */
  listUnfiled: async (): Promise<SequenceRecord[]> => {
    const all = await sequencesApi.list();
    return all.filter((s) => s.project_ids.length === 0);
  },

  /** Load one sequence in full (bases + annotations) for the read view. */
  get: async (id: number, owner?: string): Promise<SequenceDetail | null> => {
    const username = owner ?? (await getCurrentUserCached());
    const raw = await sequenceStore.getRawForUser(id, username);
    if (!raw) return null;
    const meta = normalizeSequenceMeta(raw.meta);
    return genbankToDetail(raw.genbank, meta);
  },

  /** Add a new sequence from GenBank text. Derives seq_type from the parse. */
  create: async (data: SequenceCreate): Promise<SequenceRecord | null> => {
    // Derive molecule kind from the parsed GenBank when the caller didn't pin
    // it explicitly. Falls back to "dna".
    let seqType: SeqType = data.seq_type ?? "dna";
    if (!data.seq_type) {
      const parsed = genbankToJson(data.genbank, {}).find(
        (r) => r.success && r.parsedSequence,
      );
      if (parsed?.parsedSequence) {
        seqType = deriveSeqType(parsed.parsedSequence);
      }
    }
    const meta: Omit<SequenceMeta, "id"> = {
      display_name: data.display_name,
      project_ids: data.project_ids ?? [],
      added_at: new Date().toISOString(),
      seq_type: seqType,
      // NCBI Datasets provenance, set only when the create came from the
      // "Download from NCBI" import (undefined otherwise, never stamped on a
      // native / file create). Sidecar-only, additive, no migration.
      ...(data.source ? { source: data.source } : {}),
      ...(data.ncbi_accession ? { ncbi_accession: data.ncbi_accession } : {}),
      ...(data.organism ? { organism: data.organism } : {}),
      ...(data.tax_id ? { tax_id: data.tax_id } : {}),
      ...(data.tax_lineage && data.tax_lineage.length > 0
        ? { tax_lineage: data.tax_lineage }
        : {}),
    };
    const { meta: fullMeta, genbank } = await sequenceStore.create(
      data.genbank,
      meta,
    );
    return genbankToRecord(genbank, fullMeta);
  },

  /** Patch a sequence. `genbank` replaces the .gb source; the rest patch the
   *  sidecar. Returns the refreshed summary record. */
  update: async (
    id: number,
    data: SequenceUpdate,
    owner?: string,
  ): Promise<SequenceRecord | null> => {
    const username = owner ?? (await getCurrentUserCached());
    if (data.genbank !== undefined) {
      await sequenceStore.writeGenbank(id, data.genbank, username);
    }
    const metaPatch: Partial<Omit<SequenceMeta, "id">> = {};
    if (data.display_name !== undefined) metaPatch.display_name = data.display_name;
    if (data.project_ids !== undefined) metaPatch.project_ids = data.project_ids;
    if (data.seq_type !== undefined) metaPatch.seq_type = data.seq_type;
    // NCBI taxonomy enrichment: the opt-in enrich apply patches organism / tax id
    // / named lineage onto the sidecar (additive, only sent by the enrich flow).
    if (data.organism !== undefined) metaPatch.organism = data.organism;
    if (data.tax_id !== undefined) metaPatch.tax_id = data.tax_id;
    if (data.tax_lineage !== undefined) metaPatch.tax_lineage = data.tax_lineage;
    let meta = await sequenceStore.updateMeta(id, metaPatch, username);
    if (!meta) {
      const raw = await sequenceStore.getRawForUser(id, username);
      if (!raw) return null;
      meta = normalizeSequenceMeta(raw.meta);
    }
    const raw = await sequenceStore.getRawForUser(id, username);
    return genbankToRecord(raw?.genbank ?? "", normalizeSequenceMeta(meta));
  },

  /** Soft-delete a sequence into the recoverable trash. seq delete trash bot
   *  (2026-06-04): this moves BOTH `{id}.gb` + `{id}.meta.json` into
   *  `_trash/sequences/` (the GenBank embedded inside the trash record) and
   *  records one index entry. It does NOT hard-delete — recovery is via
   *  `sequencesApi.restore` (Undo toast) or the /trash page. The owner-only
   *  delete gate (OQ9) applies: a non-owner without an active PI unlock
   *  no-ops. The hard `sequenceStore.delete` survives ONLY as the
   *  trash-expiry purge primitive (runAutoCleanupPass hard-deletes the trash
   *  `.json`, which carries both files, so no separate purge of the pair is
   *  needed). Returns true when a sequence was trashed. */
  delete: async (
    id: number,
    owner?: string,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<boolean> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const targetOwner = owner ?? currentUser;
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "sequencesApi.delete",
    );
    if (!attribution) return false;
    const trashed = await trashEntity({
      owner: targetOwner,
      entityType: "sequence",
      id,
      deletedBy: attribution.actor,
      sessionId: attribution.sessionId,
    });
    return trashed != null;
  },

  /** Inverse of `delete`. Restores both files of a trashed sequence back to
   *  the live library and returns the refreshed summary record (or null when
   *  the trash entry was missing). Callers expose this via the Undo toast and
   *  the /trash page Restore button. */
  restore: async (
    id: number,
    owner?: string,
  ): Promise<SequenceRecord | null> => {
    const username = owner ?? (await getCurrentUserCached());
    // restore audit bot: the acting user (who restored) is the current user;
    // `username` is the owner folder, which equals the actor on a self-restore.
    const restoredBy = await getCurrentUserCached();
    const sidecar = await restoreSequenceFromTrash(username, id, restoredBy);
    if (!sidecar) return null;
    const raw = await sequenceStore.getRawForUser(id, username);
    if (!raw) return null;
    return genbankToRecord(raw.genbank, normalizeSequenceMeta(raw.meta));
  },
};

export const eventsApi = {
  list: async (): Promise<Event[]> => {
    return eventsStore.listAll();
  },
  
  get: async (id: number): Promise<Event | null> => {
    return eventsStore.get(id);
  },
  
  create: async (data: EventCreate): Promise<Event> => {
    return eventsStore.create({
      ...data,
      event_type: data.event_type ?? "conference",
      end_date: data.end_date ?? null,
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
      location: data.location ?? null,
      url: data.url ?? null,
      notes: data.notes ?? null,
      color: data.color ?? null,
    });
  },
  
  update: async (id: number, data: EventUpdate): Promise<Event | null> => {
    return eventsStore.update(id, data);
  },
  
  delete: async (id: number): Promise<void> => {
    await eventsStore.delete(id);
  },
};

export const goalsApi = {
  list: async (): Promise<HighLevelGoal[]> => {
    return goalsStore.listAll();
  },
  
  get: async (id: number): Promise<HighLevelGoal | null> => {
    return goalsStore.get(id);
  },
  
  create: async (data: HighLevelGoalCreate): Promise<HighLevelGoal> => {
    return goalsStore.create({
      project_id: data.project_id ?? null,
      name: data.name,
      start_date: data.start_date,
      end_date: data.end_date,
      color: data.color ?? null,
      smart_goals: data.smart_goals ?? [],
      is_complete: false,
      created_at: new Date().toISOString(),
    });
  },
  
  // VCP R3 attribution stamps.
  update: async (id: number, data: HighLevelGoalUpdate): Promise<HighLevelGoal | null> => {
    const patch = { ...data, ...(await buildAttributionStamp(data.last_edited_by)) };
    return goalsStore.update(id, patch);
  },

  // VCP R2 trash everywhere (2026-05-26): soft-delete via
  // `_trash/high_level_goals/`. Goals are file-scoped (no owner field)
  // so the active user IS the owner and gating defaults pass through.
  // The on-disk path is `users/<u>/goals/`, NOT `high_level_goals/`
  // (the trash subdir name is descriptive; `liveRecordPath` maps to the
  // actual store prefix).
  delete: async (
    id: number,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;
    const attribution = await resolveDeleteAttribution(
      currentUser,
      actor,
      sessionId,
      "goalsApi.delete",
    );
    if (!attribution) return;
    const goal = await goalsStore.get(id);
    await softDeleteEntity({
      owner: currentUser,
      entityType: "high_level_goal",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
      parentId: goal?.project_id ?? null,
      parentEntityType: "project",
    });
  },
  
  addSmartGoal: async (id: number, smartGoal: { id: string; text: string; is_complete: boolean }): Promise<HighLevelGoal | null> => {
    const goal = await goalsStore.get(id);
    if (!goal) return null;
    
    const smartGoals = [...(goal.smart_goals || []), smartGoal];
    return goalsStore.update(id, { smart_goals: smartGoals });
  },
  
  toggleSmartGoal: async (id: number, smartGoalId: string, isComplete: boolean): Promise<HighLevelGoal | null> => {
    const goal = await goalsStore.get(id);
    if (!goal) return null;
    
    const smartGoals = (goal.smart_goals || []).map((sg) => {
      if (sg.id === smartGoalId) {
        return { ...sg, is_complete: isComplete };
      }
      return sg;
    });
    return goalsStore.update(id, { smart_goals: smartGoals });
  },
  
  deleteSmartGoal: async (id: number, smartGoalId: string): Promise<HighLevelGoal | null> => {
    const goal = await goalsStore.get(id);
    if (!goal) return null;
    
    const smartGoals = (goal.smart_goals || []).filter((sg) => sg.id !== smartGoalId);
    return goalsStore.update(id, { smart_goals: smartGoals });
  },
};

// ── Custom Calculator Builder (Phase 1, 2026-06-10) ──────────────────────────
//
// ADDITIVE per-user entity. Stores user-authored `CustomCalculator` records at
// `users/<owner>/calculators/<id>.json` via `calculatorsStore`. Mirrors the
// simple per-user JsonStore wiring (`goalsApi` / `notesApi`): `list`/`get`/
// `create`/`update`/`delete` on the current user, plus owner-routed
// `getForUser`/`listForUser`/`saveForUser` for the eventual cross-user (shared
// / lab) read paths. Phase 1 persists the `shared_with` selection but does NO
// propagation (that is Phase 2), so there is no public/lab mirror store here.
/**
 * Lazy-normalize a calculator record's `shared_with` to the unified
 * `{ username, level }[]` shape on the read path (Phase 2, 2026-06-10).
 *
 * Phase 1 wrote `shared_with: string[]` (the whole-lab share was the literal
 * "*" string in that array). `normalizeSharedWith` ignores non-object entries,
 * so a bare-string Phase 1 record would normalize to [] and silently lose its
 * lab share. We bridge that here: a `string[]` is mapped to entries first (the
 * "*" string becoming the whole-lab read sentinel), THEN normalized. A record
 * already on the unified shape passes through unchanged (normalize is
 * idempotent). The record is not rewritten on disk; the next save lands the new
 * shape via the write path.
 */
function normalizeCalculatorSharedWith(raw: unknown): SharedUser[] {
  if (Array.isArray(raw) && raw.every((e) => typeof e === "string")) {
    // Phase 1 string[] form. Map each username string to a read-level entry
    // (the "*" sentinel is just another username here), then normalize.
    return normalizeSharedWith(
      (raw as string[]).map((username) => ({ username, level: "read" as const })),
    );
  }
  return normalizeSharedWith(raw);
}

/** Project a raw on-disk calculator onto the read shape, normalizing
 *  `shared_with` (so a Phase 1 record keeps its sharing) and stamping `owner`. */
function normalizeCalculatorRecord(
  raw: CustomCalculator,
  owner: string,
): CustomCalculator {
  return {
    ...raw,
    owner: raw.owner ?? owner,
    shared_with: normalizeCalculatorSharedWith(raw.shared_with),
  };
}

export const calculatorsApi = {
  list: async (): Promise<CustomCalculator[]> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    return (await calculatorsStore.listAll()).map((c) =>
      normalizeCalculatorRecord(c, currentUser),
    );
  },

  listForUser: async (owner: string): Promise<CustomCalculator[]> => {
    return (await calculatorsStore.listAllForUser(owner)).map((c) =>
      normalizeCalculatorRecord(c, owner),
    );
  },

  get: async (id: number, owner?: string): Promise<CustomCalculator | null> => {
    // Owner routing mirrors notesApi / methodsApi: a numeric id is ambiguous
    // across per-user namespaces, so a caller that knows the namespace passes
    // `owner`; otherwise the current user's record is read.
    const raw = owner
      ? await calculatorsStore.getForUser(id, owner)
      : await calculatorsStore.get(id);
    if (!raw) return null;
    const effectiveOwner = owner ?? (await getCurrentUserCached()) ?? "";
    return normalizeCalculatorRecord(raw, effectiveOwner);
  },

  create: async (data: CustomCalculatorCreate): Promise<CustomCalculator> => {
    const now = new Date().toISOString();
    return calculatorsStore.create({
      name: data.name,
      description: data.description ?? "",
      ...(data.field !== undefined ? { field: data.field } : {}),
      inputs: data.inputs ?? [],
      steps: data.steps ?? [],
      conditionals: data.conditionals ?? [],
      outputs: data.outputs ?? [],
      // Always persist the unified shape, normalizing whatever the caller
      // handed us (a unified array, or a stray Phase 1 string[]).
      shared_with: normalizeCalculatorSharedWith(data.shared_with ?? []),
      created_at: now,
      updated_at: now,
    });
  },

  update: async (
    id: number,
    data: CustomCalculatorUpdate,
    owner?: string,
  ): Promise<CustomCalculator | null> => {
    // `updated_at` is re-stamped on every write. Owner-routed when the caller
    // knows the namespace; otherwise the current user's record is patched. When
    // the patch carries `shared_with`, normalize it to the unified shape so the
    // write always lands `{ username, level }[]` on disk (Phase 2).
    const patch = {
      ...data,
      ...(data.shared_with !== undefined
        ? { shared_with: normalizeCalculatorSharedWith(data.shared_with) }
        : {}),
      updated_at: new Date().toISOString(),
    };
    const saved = owner
      ? await calculatorsStore.updateForUser(id, patch, owner)
      : await calculatorsStore.update(id, patch);
    if (!saved) return null;
    const effectiveOwner = owner ?? (await getCurrentUserCached()) ?? "";
    return normalizeCalculatorRecord(saved, effectiveOwner);
  },

  delete: async (id: number, owner?: string): Promise<boolean> => {
    return owner
      ? calculatorsStore.deleteForUser(id, owner)
      : calculatorsStore.delete(id);
  },
};

/**
 * Whole-lab read aggregate for custom calculators (Phase 2, 2026-06-10;
 * template: `fetchAllInventoryItemsIncludingShared` / `labLinksApi.list` —
 * walk every member's dir, normalize + stamp owner, then a `canRead` gate per
 * record). Returns the union of the current user's own calculators PLUS every
 * other member's calculators the viewer may read (today only via the whole-lab
 * "*" share). A shared-in calculator is a LIVE REFERENCE read straight from the
 * owner's file (an owner edit propagates), tagged `is_shared_with_me: true` so
 * the UI badges it and gates it read-only. External shares are copies, not
 * references, so they are NOT part of this aggregate (they already live in the
 * recipient's own folder and surface via `list`).
 */
export const fetchAllCalculatorsIncludingShared = async (): Promise<
  CustomCalculator[]
> => {
  const viewer = await buildCurrentViewer();
  const currentUser = viewer.username;
  const usernames = await discoverUsers();
  const out: CustomCalculator[] = [];
  for (const username of usernames) {
    const calcs = await calculatorsStore.listAllForUser(username);
    for (const raw of calcs) {
      const calc = normalizeCalculatorRecord(raw, username);
      // `normalizeCalculatorRecord` always stamps owner, so `username` here is
      // the concrete owner. Own records always pass; cross-user records MUST
      // clear canRead (owner / explicit username / "*" sentinel). A private
      // calculator owned by another member is never returned.
      const record: ShareableRecord = {
        owner: calc.owner ?? username,
        shared_with: calc.shared_with,
      };
      if (record.owner !== currentUser && !canRead(record, viewer)) continue;
      out.push({
        ...calc,
        is_shared_with_me: calc.owner !== currentUser,
      });
    }
  }
  return out;
};

export const pcrApi = {
  list: async (): Promise<PCRProtocol[]> => {
    const privateProtocols = await pcrStore.listAll();
    const publicProtocols = await publicPcrStore.listAll();
    
    return [
      ...privateProtocols.map((p) => ({ ...p, is_public: false })),
      ...publicProtocols.map((p) => ({ ...p, is_public: true })),
    ];
  },
  
  get: async (id: number, owner?: string): Promise<PCRProtocol | null> => {
    // Owner routing matches the convention in projectsApi / tasksApi /
    // methodsApi: when the caller knows the protocol's namespace (e.g. a
    // receiver of a shared task, or a method whose source_path points at a
    // public protocol), pass the explicit `owner`. Per-user id spaces mean
    // a numeric id alone is ambiguous — alex's private pcr_protocols/1 and
    // public pcr_protocols/1 are different records.
    //
    // Semantics:
    //   - owner === "public": read only from users/public/pcr_protocols/{id}.json
    //   - owner === <username>: read only from users/<owner>/pcr_protocols/{id}.json
    //   - owner === undefined: legacy private-then-public fallback for callers
    //     that genuinely don't know the namespace.
    if (owner) {
      if (owner === "public") {
        const publicProtocol = await publicPcrStore.get(id);
        return publicProtocol ? { ...publicProtocol, is_public: true } : null;
      }
      const ownerProtocol = await pcrStore.getForUser(id, owner);
      return ownerProtocol ? { ...ownerProtocol, is_public: false } : null;
    }

    const protocol = await pcrStore.get(id);
    if (protocol) return { ...protocol, is_public: false };

    const publicProtocol = await publicPcrStore.get(id);
    if (publicProtocol) return { ...publicProtocol, is_public: true };

    return null;
  },
  
  create: async (data: PCRProtocolCreate): Promise<PCRProtocol> => {
    const isPublic = data.is_public ?? false;
    if (isPublic) {
      return publicPcrStore.create({
        name: data.name,
        gradient: data.gradient,
        ingredients: data.ingredients,
        notes: data.notes ?? null,
        is_public: true,
        created_by: null,
      });
    }
    
    return pcrStore.create({
      name: data.name,
      gradient: data.gradient,
      ingredients: data.ingredients,
      notes: data.notes ?? null,
      is_public: false,
      created_by: null,
    });
  },
  
  // Owner routing mirrors `pcrApi.get` (see commit 1d122fc0). When the caller
  // knows the protocol's namespace (e.g. a receiver editing a shared task's
  // PCR protocol, or a public-method PCR), pass the explicit `owner` so the
  // write lands in the right user's directory rather than the legacy
  // private-first scan that can silently target the current user's namespace.
  //
  // Semantics:
  //   - owner === "public": write only to users/public/pcr_protocols/{id}.json
  //   - owner === <username>: write only to users/<owner>/pcr_protocols/{id}.json
  //   - owner === undefined: legacy private-then-public fallback (callers that
  //     genuinely don't know the namespace)
  update: async (id: number, data: PCRProtocolUpdate, owner?: string): Promise<PCRProtocol | null> => {
    if (owner) {
      if (owner === "public") {
        const publicProtocol = await publicPcrStore.get(id);
        return publicProtocol ? publicPcrStore.update(id, data) : null;
      }
      const ownerProtocol = await pcrStore.getForUser(id, owner);
      return ownerProtocol ? pcrStore.updateForUser(id, data, owner) : null;
    }

    let protocol = await pcrStore.get(id);
    if (protocol) {
      return pcrStore.update(id, data);
    }

    protocol = await publicPcrStore.get(id);
    if (protocol) {
      return publicPcrStore.update(id, data);
    }

    return null;
  },
  
  delete: async (id: number): Promise<void> => {
    await pcrStore.delete(id);
    await publicPcrStore.delete(id);
  },
  
  getDefaultGradient: async () => {
    return {
      initial: [{ name: "Initial Denaturation", temperature: 95, duration: "2 min" }],
      cycles: [{
        repeats: 30,
        steps: [
          { name: "Denaturation", temperature: 95, duration: "20 sec" },
          { name: "Annealing", temperature: 60, duration: "20 sec" },
          { name: "Extension", temperature: 72, duration: "1 min" },
        ],
      }],
      final: [{ name: "Final Extension", temperature: 72, duration: "5 min" }],
      hold: { name: "Hold", temperature: 4, duration: "Indef." },
    };
  },
  
  getDefaultIngredients: async () => {
    return [
      { id: "1", name: "Template DNA", concentration: "10 ng/uL", amount_per_reaction: "1", checked: false },
      { id: "2", name: "Forward Primer", concentration: "10 uM", amount_per_reaction: "0.5", checked: false },
      { id: "3", name: "Reverse Primer", concentration: "10 uM", amount_per_reaction: "0.5", checked: false },
      { id: "4", name: "dNTPs", concentration: "10 mM", amount_per_reaction: "0.5", checked: false },
      { id: "5", name: "Buffer", concentration: "10X", amount_per_reaction: "2.5", checked: false },
      { id: "6", name: "Polymerase", concentration: "5 U/uL", amount_per_reaction: "0.25", checked: false },
      { id: "7", name: "Water", concentration: "-", amount_per_reaction: "to 25", checked: false },
    ];
  },
};

// ── LC Gradient API ──────────────────────────────────────────────────────────
//
// Storage shape mirrors pcrApi exactly: per-user `users/<u>/lc_gradients/<id>.json`
// for private records, `users/public/lc_gradients/<id>.json` for is_public:true.
// Per-user counter file `_counters.json` carries a `lc_gradient` line on first
// create (managed by JsonStore.create). Methods reference these records via
// `source_path: "lc_gradient://protocol/{id}"` — owner-aware resolution mirrors
// `pcr://protocol/{id}` to keep namespaces consistent.

export const lcGradientApi = {
  list: async (): Promise<LCGradientProtocol[]> => {
    const privateProtocols = await lcGradientStore.listAll();
    const publicProtocols = await publicLcGradientStore.listAll();

    return [
      ...privateProtocols.map((p) => ({ ...p, is_public: false })),
      ...publicProtocols.map((p) => ({ ...p, is_public: true })),
    ];
  },

  get: async (id: number, owner?: string): Promise<LCGradientProtocol | null> => {
    if (owner) {
      if (owner === "public") {
        const publicProtocol = await publicLcGradientStore.get(id);
        return publicProtocol ? { ...publicProtocol, is_public: true } : null;
      }
      const ownerProtocol = await lcGradientStore.getForUser(id, owner);
      return ownerProtocol ? { ...ownerProtocol, is_public: false } : null;
    }

    const protocol = await lcGradientStore.get(id);
    if (protocol) return { ...protocol, is_public: false };

    const publicProtocol = await publicLcGradientStore.get(id);
    if (publicProtocol) return { ...publicProtocol, is_public: true };

    return null;
  },

  create: async (data: LCGradientProtocolCreate): Promise<LCGradientProtocol> => {
    const isPublic = data.is_public ?? false;
    const now = new Date().toISOString();
    const base = {
      name: data.name,
      description: data.description ?? null,
      gradient_steps: data.gradient_steps,
      column: data.column,
      detection_wavelength_nm: data.detection_wavelength_nm ?? null,
      ingredients: data.ingredients,
      created_at: now,
      updated_at: now,
      created_by: null,
    };
    if (isPublic) {
      return publicLcGradientStore.create({ ...base, is_public: true });
    }
    return lcGradientStore.create({ ...base, is_public: false });
  },

  update: async (
    id: number,
    data: LCGradientProtocolUpdate,
    owner?: string,
  ): Promise<LCGradientProtocol | null> => {
    const patch = { ...data, updated_at: new Date().toISOString() };
    if (owner) {
      if (owner === "public") {
        const publicProtocol = await publicLcGradientStore.get(id);
        return publicProtocol ? publicLcGradientStore.update(id, patch) : null;
      }
      const ownerProtocol = await lcGradientStore.getForUser(id, owner);
      return ownerProtocol ? lcGradientStore.updateForUser(id, patch, owner) : null;
    }

    let protocol = await lcGradientStore.get(id);
    if (protocol) {
      return lcGradientStore.update(id, patch);
    }

    protocol = await publicLcGradientStore.get(id);
    if (protocol) {
      return publicLcGradientStore.update(id, patch);
    }

    return null;
  },

  delete: async (id: number): Promise<void> => {
    await lcGradientStore.delete(id);
    await publicLcGradientStore.delete(id);
  },

  /** Defaults seeded into the new-method dialog for `method_type === "lc_gradient"`.
   *  Realistic reverse-phase HPLC starting point — 5%→95% acetonitrile over
   *  25 minutes at 0.3 mL/min, the typical proteomics/peptide workflow. */
  getDefaultGradientSteps: (): import("./types").LCGradientStep[] => [
    { time_min: 0, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 },
    { time_min: 2, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 },
    { time_min: 22, percent_a: 5, percent_b: 95, flow_ml_min: 0.3 },
    { time_min: 25, percent_a: 5, percent_b: 95, flow_ml_min: 0.3 },
    { time_min: 26, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 },
    { time_min: 30, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 },
  ],

  getDefaultColumn: (): import("./types").LCGradientColumn => ({
    manufacturer: "",
    model: "",
    length_mm: 150,
    inner_diameter_mm: 2.1,
    particle_size_um: 1.7,
  }),

  getDefaultIngredients: (): import("./types").LCIngredient[] => [
    { id: "a", name: "Water + 0.1% formic acid", role: "solvent_a", concentration: "0.1% FA" },
    { id: "b", name: "Acetonitrile + 0.1% formic acid", role: "solvent_b", concentration: "0.1% FA" },
  ],
};

// ── Plate Layout API ─────────────────────────────────────────────────────────
//
// Storage shape mirrors pcrApi / lcGradientApi exactly: per-user
// `users/<u>/plate_layouts/<id>.json` for private records,
// `users/public/plate_layouts/<id>.json` for is_public:true. Per-user counter
// file `_counters.json` carries a `plate_layout` line on first create
// (managed by JsonStore.create). Methods reference these records via
// `source_path: "plate://protocol/{id}"` — owner-aware resolution mirrors
// the other structured types to keep namespaces consistent.

export const plateApi = {
  list: async (): Promise<PlateProtocol[]> => {
    const privateProtocols = await plateLayoutStore.listAll();
    const publicProtocols = await publicPlateLayoutStore.listAll();

    return [
      ...privateProtocols.map((p) => ({ ...p, is_public: false })),
      ...publicProtocols.map((p) => ({ ...p, is_public: true })),
    ];
  },

  get: async (id: number, owner?: string): Promise<PlateProtocol | null> => {
    if (owner) {
      if (owner === "public") {
        const publicProtocol = await publicPlateLayoutStore.get(id);
        return publicProtocol ? { ...publicProtocol, is_public: true } : null;
      }
      const ownerProtocol = await plateLayoutStore.getForUser(id, owner);
      return ownerProtocol ? { ...ownerProtocol, is_public: false } : null;
    }

    const protocol = await plateLayoutStore.get(id);
    if (protocol) return { ...protocol, is_public: false };

    const publicProtocol = await publicPlateLayoutStore.get(id);
    if (publicProtocol) return { ...publicProtocol, is_public: true };

    return null;
  },

  create: async (data: PlateProtocolCreate): Promise<PlateProtocol> => {
    const isPublic = data.is_public ?? false;
    const now = new Date().toISOString();
    const base = {
      name: data.name,
      description: data.description ?? null,
      plate_size: data.plate_size,
      region_labels: data.region_labels ?? [],
      created_at: now,
      updated_at: now,
      created_by: null,
    };
    if (isPublic) {
      return publicPlateLayoutStore.create({ ...base, is_public: true });
    }
    return plateLayoutStore.create({ ...base, is_public: false });
  },

  update: async (
    id: number,
    data: PlateProtocolUpdate,
    owner?: string,
  ): Promise<PlateProtocol | null> => {
    const patch = { ...data, updated_at: new Date().toISOString() };
    if (owner) {
      if (owner === "public") {
        const publicProtocol = await publicPlateLayoutStore.get(id);
        return publicProtocol ? publicPlateLayoutStore.update(id, patch) : null;
      }
      const ownerProtocol = await plateLayoutStore.getForUser(id, owner);
      return ownerProtocol ? plateLayoutStore.updateForUser(id, patch, owner) : null;
    }

    let protocol = await plateLayoutStore.get(id);
    if (protocol) {
      return plateLayoutStore.update(id, patch);
    }

    protocol = await publicPlateLayoutStore.get(id);
    if (protocol) {
      return publicPlateLayoutStore.update(id, patch);
    }

    return null;
  },

  delete: async (id: number): Promise<void> => {
    await plateLayoutStore.delete(id);
    await publicPlateLayoutStore.delete(id);
  },

  /** Defaults seeded into the new-method dialog for `method_type === "plate"`.
   *  Empty 96-well plate is the most common scientific default. */
  getDefaultPlateSize: (): import("./types").PlateSize => 96,
  getDefaultRegionLabels: (): import("./types").PlateRegionLabel[] => [],
};

// ── Cell Culture Schedule API ────────────────────────────────────────────────
//
// Per-user `users/<u>/cell_culture_schedules/<id>.json` for private records,
// `users/public/cell_culture_schedules/<id>.json` for is_public:true. Per-user
// `_counters.json` carries a `cell_culture_schedules` line. Methods reference
// records via `source_path: "cell_culture://protocol/{id}"`. Mirrors pcrApi /
// lcGradientApi exactly so cross-type batch ops stay shapely.

export const cellCultureApi = {
  list: async (): Promise<CellCultureSchedule[]> => {
    const privateSchedules = await cellCultureScheduleStore.listAll();
    const publicSchedules = await publicCellCultureScheduleStore.listAll();

    return [
      ...privateSchedules.map((s) => ({ ...s, is_public: false })),
      ...publicSchedules.map((s) => ({ ...s, is_public: true })),
    ];
  },

  get: async (id: number, owner?: string): Promise<CellCultureSchedule | null> => {
    if (owner) {
      if (owner === "public") {
        const pub = await publicCellCultureScheduleStore.get(id);
        return pub ? { ...pub, is_public: true } : null;
      }
      const ownerSchedule = await cellCultureScheduleStore.getForUser(id, owner);
      return ownerSchedule ? { ...ownerSchedule, is_public: false } : null;
    }

    const schedule = await cellCultureScheduleStore.get(id);
    if (schedule) return { ...schedule, is_public: false };

    const publicSchedule = await publicCellCultureScheduleStore.get(id);
    if (publicSchedule) return { ...publicSchedule, is_public: true };

    return null;
  },

  create: async (data: CellCultureScheduleCreate): Promise<CellCultureSchedule> => {
    const isPublic = data.is_public ?? false;
    const now = new Date().toISOString();
    const base = {
      name: data.name,
      description: data.description ?? null,
      cell_line: data.cell_line,
      media: data.media,
      planned_events: data.planned_events,
      created_at: now,
      updated_at: now,
      created_by: null,
    };
    if (isPublic) {
      return publicCellCultureScheduleStore.create({ ...base, is_public: true });
    }
    return cellCultureScheduleStore.create({ ...base, is_public: false });
  },

  update: async (
    id: number,
    data: CellCultureScheduleUpdate,
    owner?: string,
  ): Promise<CellCultureSchedule | null> => {
    const patch = { ...data, updated_at: new Date().toISOString() };
    if (owner) {
      if (owner === "public") {
        const pub = await publicCellCultureScheduleStore.get(id);
        return pub ? publicCellCultureScheduleStore.update(id, patch) : null;
      }
      const ownerSchedule = await cellCultureScheduleStore.getForUser(id, owner);
      return ownerSchedule
        ? cellCultureScheduleStore.updateForUser(id, patch, owner)
        : null;
    }

    let schedule = await cellCultureScheduleStore.get(id);
    if (schedule) {
      return cellCultureScheduleStore.update(id, patch);
    }

    schedule = await publicCellCultureScheduleStore.get(id);
    if (schedule) {
      return publicCellCultureScheduleStore.update(id, patch);
    }

    return null;
  },

  delete: async (id: number): Promise<void> => {
    await cellCultureScheduleStore.delete(id);
    await publicCellCultureScheduleStore.delete(id);
  },

  /** Defaults seeded into the new-method dialog for `method_type === "cell_culture"`.
   *  Realistic HeLa-cell starting cadence: feed M/W/F, split 1:5 on day 7. */
  getDefaultPlannedEvents: (): import("./types").CellCulturePlannedEvent[] => [
    { day_offset: 0, event_type: "observe", notes: "Seed plate; record initial confluence" },
    { day_offset: 2, event_type: "feed" },
    { day_offset: 4, event_type: "feed" },
    { day_offset: 6, event_type: "observe", notes: "Check confluence before split" },
    { day_offset: 7, event_type: "split", split_ratio: "1:5" },
  ],

  getDefaultCellLine: (): import("./types").CellCultureCellLine => ({
    name: "HeLa",
    species: "Homo sapiens",
    tissue: "Cervix (adenocarcinoma)",
    notes: "",
  }),

  getDefaultMedia: (): import("./types").CellCultureMedia => ({
    base_medium: "DMEM (high glucose)",
    serum_percent: 10,
    supplements: [
      { name: "PenStrep", concentration: "1", units: "%" },
      { name: "L-Glutamine", concentration: "2", units: "mM" },
    ],
  }),
};

// ── Coding Workflow API ──────────────────────────────────────────────────────
//
// Storage shape mirrors pcrApi / lcGradientApi / plateApi exactly: per-user
// `users/<u>/coding_workflows/<id>.json` for private records,
// `users/public/coding_workflows/<id>.json` for is_public:true. Per-user
// `_counters.json` carries a `coding_workflows` line. Methods reference
// records via `source_path: "coding_workflow://protocol/{id}"`. No per-task
// state per Q-B4 lock — the API surface intentionally omits any task-side
// mutation helpers.

export const codingWorkflowApi = {
  list: async (): Promise<CodingWorkflowProtocol[]> => {
    const privateProtocols = await codingWorkflowStore.listAll();
    const publicProtocols = await publicCodingWorkflowStore.listAll();

    return [
      ...privateProtocols.map((p) => ({ ...p, is_public: false })),
      ...publicProtocols.map((p) => ({ ...p, is_public: true })),
    ];
  },

  get: async (id: number, owner?: string): Promise<CodingWorkflowProtocol | null> => {
    if (owner) {
      if (owner === "public") {
        const pub = await publicCodingWorkflowStore.get(id);
        return pub ? { ...pub, is_public: true } : null;
      }
      const ownerProtocol = await codingWorkflowStore.getForUser(id, owner);
      return ownerProtocol ? { ...ownerProtocol, is_public: false } : null;
    }

    const protocol = await codingWorkflowStore.get(id);
    if (protocol) return { ...protocol, is_public: false };

    const publicProtocol = await publicCodingWorkflowStore.get(id);
    if (publicProtocol) return { ...publicProtocol, is_public: true };

    return null;
  },

  create: async (data: CodingWorkflowProtocolCreate): Promise<CodingWorkflowProtocol> => {
    const isPublic = data.is_public ?? false;
    const now = new Date().toISOString();
    const base = {
      name: data.name,
      description: data.description ?? null,
      language: data.language,
      language_label: data.language_label ?? null,
      embedded_code: data.embedded_code ?? null,
      external_path: data.external_path ?? null,
      output_renderer:
        data.output_renderer ?? deriveOutputRenderer(data.language, data.external_path ?? null),
      created_at: now,
      updated_at: now,
      created_by: null,
    };
    if (isPublic) {
      return publicCodingWorkflowStore.create({ ...base, is_public: true });
    }
    return codingWorkflowStore.create({ ...base, is_public: false });
  },

  update: async (
    id: number,
    data: CodingWorkflowProtocolUpdate,
    owner?: string,
  ): Promise<CodingWorkflowProtocol | null> => {
    const patch = { ...data, updated_at: new Date().toISOString() };
    if (owner) {
      if (owner === "public") {
        const pub = await publicCodingWorkflowStore.get(id);
        return pub ? publicCodingWorkflowStore.update(id, patch) : null;
      }
      const ownerProtocol = await codingWorkflowStore.getForUser(id, owner);
      return ownerProtocol
        ? codingWorkflowStore.updateForUser(id, patch, owner)
        : null;
    }

    let protocol = await codingWorkflowStore.get(id);
    if (protocol) {
      return codingWorkflowStore.update(id, patch);
    }

    protocol = await publicCodingWorkflowStore.get(id);
    if (protocol) {
      return publicCodingWorkflowStore.update(id, patch);
    }

    return null;
  },

  delete: async (id: number): Promise<void> => {
    await codingWorkflowStore.delete(id);
    await publicCodingWorkflowStore.delete(id);
  },

  /** Default seeded into the new-method dialog. Python is the most common
   *  scientific scripting language; users can switch via the picker. */
  getDefaultLanguage: (): import("./types").CodingWorkflowLanguage => "python",

  /** Pythonic starter snippet for the embedded code field — shows the user
   *  the shape of a scientific helper without picking sides on libraries. */
  getDefaultEmbeddedCode: (): string =>
    "# Reusable script — paste your code here, or set External path\n" +
    "# below to hand off to your editor.\n",
};

/** Decide which renderer to use for a given language + external_path.
 *  When the language is Python and the external path points at a .ipynb,
 *  the viewer can parse the embedded body as a notebook. Otherwise the
 *  default is syntax-highlight. External-only workflows (no embedded code)
 *  fall through to null so the viewer renders a "Open in your editor" CTA
 *  without an empty `<pre>`. */
function deriveOutputRenderer(
  language: import("./types").CodingWorkflowLanguage,
  externalPath: string | null,
): import("./types").CodingWorkflowOutputRenderer {
  if (language === "python" && externalPath && externalPath.toLowerCase().endsWith(".ipynb")) {
    return "ipynb";
  }
  return "syntax-highlight";
}

// ── qPCR Analysis API ────────────────────────────────────────────────────────
//
// Per-user `users/<u>/qpcr_analyses/<id>.json` for private records,
// `users/public/qpcr_analyses/<id>.json` for is_public:true. Per-user
// `_counters.json` carries a `qpcr_analyses` line. Methods reference records
// via `source_path: "qpcr_analysis://protocol/{id}"`. Mirrors pcrApi /
// lcGradientApi / cellCultureApi exactly so cross-type batch ops stay shapely.
// qPCR enters v2 as analysis-only and composes with PCR via the composition
// primitive — see METHODS_EXPANSION_V2_PROPOSAL.md §5.

export const qpcrAnalysisApi = {
  list: async (): Promise<QPCRAnalysisProtocol[]> => {
    const privateProtocols = await qpcrAnalysisStore.listAll();
    const publicProtocols = await publicQpcrAnalysisStore.listAll();

    return [
      ...privateProtocols.map((p) => ({ ...p, is_public: false })),
      ...publicProtocols.map((p) => ({ ...p, is_public: true })),
    ];
  },

  get: async (id: number, owner?: string): Promise<QPCRAnalysisProtocol | null> => {
    if (owner) {
      if (owner === "public") {
        const pub = await publicQpcrAnalysisStore.get(id);
        return pub ? { ...pub, is_public: true } : null;
      }
      const ownerProtocol = await qpcrAnalysisStore.getForUser(id, owner);
      return ownerProtocol ? { ...ownerProtocol, is_public: false } : null;
    }

    const protocol = await qpcrAnalysisStore.get(id);
    if (protocol) return { ...protocol, is_public: false };

    const publicProtocol = await publicQpcrAnalysisStore.get(id);
    if (publicProtocol) return { ...publicProtocol, is_public: true };

    return null;
  },

  create: async (data: QPCRAnalysisProtocolCreate): Promise<QPCRAnalysisProtocol> => {
    const isPublic = data.is_public ?? false;
    const now = new Date().toISOString();
    const base = {
      name: data.name,
      description: data.description ?? null,
      chemistry: data.chemistry,
      chemistry_label: data.chemistry_label ?? null,
      references: data.references,
      standard_curve: data.standard_curve,
      melt_curve: data.melt_curve ?? null,
      use_delta_delta_cq: data.use_delta_delta_cq,
      created_at: now,
      updated_at: now,
      created_by: null,
    };
    if (isPublic) {
      return publicQpcrAnalysisStore.create({ ...base, is_public: true });
    }
    return qpcrAnalysisStore.create({ ...base, is_public: false });
  },

  update: async (
    id: number,
    data: QPCRAnalysisProtocolUpdate,
    owner?: string,
  ): Promise<QPCRAnalysisProtocol | null> => {
    const patch = { ...data, updated_at: new Date().toISOString() };
    if (owner) {
      if (owner === "public") {
        const pub = await publicQpcrAnalysisStore.get(id);
        return pub ? publicQpcrAnalysisStore.update(id, patch) : null;
      }
      const ownerProtocol = await qpcrAnalysisStore.getForUser(id, owner);
      return ownerProtocol ? qpcrAnalysisStore.updateForUser(id, patch, owner) : null;
    }

    let protocol = await qpcrAnalysisStore.get(id);
    if (protocol) {
      return qpcrAnalysisStore.update(id, patch);
    }

    protocol = await publicQpcrAnalysisStore.get(id);
    if (protocol) {
      return publicQpcrAnalysisStore.update(id, patch);
    }

    return null;
  },

  delete: async (id: number): Promise<void> => {
    await qpcrAnalysisStore.delete(id);
    await publicQpcrAnalysisStore.delete(id);
  },

  /** Defaults seeded into the new-method dialog for
   *  `method_type === "qpcr_analysis"`. SYBR Green is the most common
   *  starting chemistry; a single target + ACT1 housekeeping reference is
   *  the minimal ΔΔCq-ready shape. */
  getDefaultReferences: (): import("./types").QPCRReference[] => [
    { id: "target-1", target: "TARGET_GENE", channel: "FAM", is_reference: false },
    { id: "ref-1", target: "ACT1", channel: "FAM", is_reference: true },
  ],

  getDefaultStandardCurve: (): import("./types").QPCRStandardCurvePoint[] => [],

  getDefaultMeltCurve: (): import("./types").QPCRMeltCurveConfig => ({
    start_c: 60,
    end_c: 95,
    ramp_rate_c_per_sec: 0.1,
  }),
};

// ── Mass Spec API ────────────────────────────────────────────────────────────
//
// Storage shape mirrors pcrApi / lcGradientApi exactly: per-user
// `users/<u>/mass_spec_methods/<id>.json` for private records,
// `users/public/mass_spec_methods/<id>.json` for is_public:true. Per-user
// counter file `_counters.json` carries a `mass_spec_methods` line on first
// create (managed by JsonStore.create). Methods reference these records via
// `source_path: "mass_spec://protocol/{id}"` — owner-aware resolution
// mirrors the other structured types to keep namespaces consistent.

export const massSpecApi = {
  list: async (): Promise<MassSpecProtocol[]> => {
    const privateProtocols = await massSpecStore.listAll();
    const publicProtocols = await publicMassSpecStore.listAll();

    return [
      ...privateProtocols.map((p) => ({ ...p, is_public: false })),
      ...publicProtocols.map((p) => ({ ...p, is_public: true })),
    ];
  },

  get: async (id: number, owner?: string): Promise<MassSpecProtocol | null> => {
    if (owner) {
      if (owner === "public") {
        const publicProtocol = await publicMassSpecStore.get(id);
        return publicProtocol ? { ...publicProtocol, is_public: true } : null;
      }
      const ownerProtocol = await massSpecStore.getForUser(id, owner);
      return ownerProtocol ? { ...ownerProtocol, is_public: false } : null;
    }

    const protocol = await massSpecStore.get(id);
    if (protocol) return { ...protocol, is_public: false };

    const publicProtocol = await publicMassSpecStore.get(id);
    if (publicProtocol) return { ...publicProtocol, is_public: true };

    return null;
  },

  create: async (data: MassSpecProtocolCreate): Promise<MassSpecProtocol> => {
    const isPublic = data.is_public ?? false;
    const now = new Date().toISOString();
    const base = {
      name: data.name,
      description: data.description ?? null,
      ionization_mode: data.ionization_mode,
      ionization_label: data.ionization_label ?? null,
      instrument: data.instrument ?? null,
      source: data.source,
      scan: data.scan,
      calibration: data.calibration,
      created_at: now,
      updated_at: now,
      created_by: null,
    };
    if (isPublic) {
      return publicMassSpecStore.create({ ...base, is_public: true });
    }
    return massSpecStore.create({ ...base, is_public: false });
  },

  update: async (
    id: number,
    data: MassSpecProtocolUpdate,
    owner?: string,
  ): Promise<MassSpecProtocol | null> => {
    // VCP R3 attribution stamps: keep the existing `updated_at` (used by
    // sorts and the protocol library's "recently edited" rail) AND land
    // the new `last_edited_at` mirror so the AttributionChip can render
    // a consistent value across types. `updated_at` stays canonical here
    // (FLAG: this entity already had it pre-R3).
    const patch = {
      ...data,
      updated_at: new Date().toISOString(),
      ...(await buildAttributionStamp(data.last_edited_by)),
    };
    if (owner) {
      if (owner === "public") {
        const publicProtocol = await publicMassSpecStore.get(id);
        return publicProtocol ? publicMassSpecStore.update(id, patch) : null;
      }
      const ownerProtocol = await massSpecStore.getForUser(id, owner);
      return ownerProtocol ? massSpecStore.updateForUser(id, patch, owner) : null;
    }

    let protocol = await massSpecStore.get(id);
    if (protocol) {
      return massSpecStore.update(id, patch);
    }

    protocol = await publicMassSpecStore.get(id);
    if (protocol) {
      return publicMassSpecStore.update(id, patch);
    }

    return null;
  },

  // VCP R2 trash everywhere (2026-05-26): soft-delete via
  // `_trash/mass_spec_protocols/`. The store prefix is the legacy
  // "mass_spec_methods" — the descriptive trash subdir name is
  // independent (kept as `mass_spec_protocols` for the trash UI). Public
  // protocols hard-delete same as public methods: no per-user owner who
  // could surface a restore. Private protocols carry an optional
  // `owner?` field (see types.ts §MassSpecProtocol) — when absent we
  // fall back to the active user as owner.
  delete: async (
    id: number,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;

    const privateProtocol = await massSpecStore.get(id);
    const publicProtocol = privateProtocol ? null : await publicMassSpecStore.get(id);
    if (publicProtocol) {
      await publicMassSpecStore.delete(id);
      return;
    }
    if (!privateProtocol) {
      await massSpecStore.delete(id);
      await publicMassSpecStore.delete(id);
      return;
    }
    const targetOwner = privateProtocol.owner || currentUser;
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "massSpecApi.delete",
    );
    if (!attribution) return;
    await softDeleteEntity({
      owner: targetOwner,
      entityType: "mass_spec_protocol",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
    });
  },

  /** Defaults seeded into the new-method dialog for `method_type === "mass_spec"`.
   *  Sensible ESI+ Q-Exactive-style starting point — the most common LC-MS
   *  workflow. User refines after Create. */
  getDefaultIonizationMode: (): import("./types").IonizationMode => "esi_pos",

  getDefaultSource: (): import("./types").MassSpecSourceParams => ({
    source_temp_c: 250,
    capillary_kv: 3.5,
    nebulizer_gas_lpm: 1.2,
    drying_gas_lpm: 10,
    drying_gas_temp_c: 350,
    ei_energy_ev: null,
    maldi_laser_nm: null,
    maldi_laser_energy: null,
    maldi_matrix: null,
    other_notes: null,
  }),

  getDefaultScan: (): import("./types").MassSpecScanParams => ({
    scan_mz_low: 200,
    scan_mz_high: 2000,
    scan_rate_hz: 2,
    resolution_r: 70000,
    is_msms: false,
    msms_isolation_window_mz: null,
    msms_collision_energy_ev: null,
  }),

  getDefaultCalibration: (): import("./types").MassSpecCalibration => ({
    reference_standard: "",
    calibration_date: null,
    expected_accuracy_ppm: 2,
    notes: null,
  }),
};

/**
 * Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 3. Build the
 * EFFECTIVE patch a purchase update writes, given the existing record and the
 * caller's partial data. This is the SAME total_price recompute + attribution
 * stamp that purchasesApi.update applies, factored out so the Loro write-through
 * path produces a byte-identical .json mirror (legacy readers stay correct).
 *
 * The returned object is a PARTIAL: it carries only the caller's changed fields
 * plus the derived total_price and the attribution stamp, never a full record.
 * That keeps the Loro merge-at-save per-key (a concurrent remote edit to an
 * untouched field is preserved). `existing` supplies the prior price / quantity
 * / shipping so total_price recomputes the same way whether or not those three
 * are part of this edit.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */
export async function buildPurchaseUpdatePatch(
  existing: Pick<PurchaseItem, "price_per_unit" | "quantity" | "shipping_fees">,
  data: PurchaseItemUpdate,
): Promise<PurchaseItemUpdate & { total_price: number; last_edited_by: string; last_edited_at: string }> {
  const pricePerUnit = data.price_per_unit ?? existing.price_per_unit;
  const quantity = data.quantity ?? existing.quantity;
  const shippingFees = data.shipping_fees ?? existing.shipping_fees;
  const total = pricePerUnit * quantity + shippingFees;
  return {
    ...data,
    total_price: total,
    ...(await buildAttributionStamp(data.last_edited_by)),
  };
}

export const purchasesApi = {
  // `owner` routes the read into a specific user's `purchase_items/` directory
  // instead of the current viewer's. Without it, shared purchase tasks (read
  // from the owner's directory) silently match items belonging to whatever
  // task happens to share the same numeric id in the viewer's own folder —
  // same shape of bug the task-refetch fix at TaskDetailPopup.tsx:314 closed
  // for tasks. Pass `task.is_shared_with_me ? task.owner : undefined`.
  listByTask: async (taskId: number, owner?: string): Promise<PurchaseItem[]> => {
    const items = owner
      ? (await purchaseItemsStore.listAllForUser(owner)).filter((item) => item.task_id === taskId)
      : await purchaseItemsStore.query({ task_id: taskId });
    return items.map(item => ({
      ...item,
      total_price: item.total_price ?? (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
      vendor: item.vendor ?? null,
      category: item.category ?? null,
      // Pre-feature records have no order_status — normalize to the default
      // so UI grouping / filters can treat it as always present.
      order_status: normalizeOrderStatus(item.order_status),
    }));
  },

  listAll: async (): Promise<PurchaseItem[]> => {
    const items = await purchaseItemsStore.listAll();
    return items.map(item => ({
      ...item,
      total_price: item.total_price ?? (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
      vendor: item.vendor ?? null,
      category: item.category ?? null,
      // Normalize the funding FK to null for pre-rework records (funding-rework).
      funding_account_id: item.funding_account_id ?? null,
      order_status: normalizeOrderStatus(item.order_status),
    }));
  },

  // Merged-view loader mirroring `fetchAllTasksIncludingShared` for purchase
  // items. `purchasesApi.listAll()` only reads the current user's
  // `purchase_items/` directory, so shared purchase tasks render with empty
  // item rows + $0 totals on the purchases page (AGENTS.md §6 multi-user-
  // data-isolation gap). This loader also reads each shared-task owner's
  // `purchase_items/` directory and filters to the shared task ids.
  //
  // Returns purchases decorated with `owner` so callers can key the
  // `purchasesByTask` map on the same composite `${owner}:${task_id}` shape
  // that the sweep fix at `8de2c24d` introduced on the consuming page. The
  // current user's own items get `owner: currentUser` (no schema change —
  // mirrors the `withOwnerFallback` overlay used for tasks/projects).
  //
  // Surfacing rules match `fetchAllTasksIncludingShared`:
  //   - individually-shared tasks (`_shared_with_me.json#tasks`)
  //   - tasks belonging to shared projects (`_shared_with_me.json#projects`,
  //     filtered to that owner's tasks whose `project_id` matches)
  // Cross-owner hosted tasks (Option C) are intentionally NOT included —
  // hosted tasks are display-only at the destination side; the host's
  // purchases live on the source side and surface via the host's own
  // purchases page.
  listAllIncludingShared: async (
    currentUser: string,
  ): Promise<Array<PurchaseItem & { owner: string }>> => {
    const own = await purchaseItemsStore.listAll();
    const ownDecorated: Array<PurchaseItem & { owner: string }> = own.map((item) => ({
      ...item,
      owner: currentUser,
      total_price:
        item.total_price ??
        (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
      vendor: item.vendor ?? null,
      category: item.category ?? null,
      // Normalize the funding FK to null for pre-rework records (funding-rework).
      funding_account_id: item.funding_account_id ?? null,
      order_status: normalizeOrderStatus(item.order_status),
    }));

    // Build the set of (owner, taskId) pairs the viewer can see via shares.
    const sharedPairs: Array<{ owner: string; taskId: number }> = [];
    try {
      const manifest = await fileService.readJson<SharedManifest>(
        `users/${currentUser}/_shared_with_me.json`,
      );
      const seen = new Set<string>(); // dedup across the two surfaces below
      for (const entry of manifest?.tasks ?? []) {
        const key = `${entry.owner}:${entry.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sharedPairs.push({ owner: entry.owner, taskId: entry.id });
      }
      for (const projEntry of manifest?.projects ?? []) {
        let ownerTasks;
        try {
          ownerTasks = await tasksStore.listAllForUser(projEntry.owner);
        } catch (err) {
          console.warn(
            `[purchasesApi.listAllIncludingShared] failed to load tasks for shared project ${projEntry.owner}/${projEntry.id}:`,
            err,
          );
          continue;
        }
        for (const t of ownerTasks) {
          if (t.project_id !== projEntry.id) continue;
          const key = `${projEntry.owner}:${t.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          sharedPairs.push({ owner: projEntry.owner, taskId: t.id });
        }
      }
    } catch (err) {
      console.warn(
        "[purchasesApi.listAllIncludingShared] failed to read shared manifest:",
        err,
      );
    }

    // Group shared pairs by owner so we read each owner's purchase_items
    // directory at most once, then filter to the visible task ids per owner.
    const byOwner = new Map<string, Set<number>>();
    for (const { owner, taskId } of sharedPairs) {
      if (!byOwner.has(owner)) byOwner.set(owner, new Set());
      byOwner.get(owner)!.add(taskId);
    }

    const shared: Array<PurchaseItem & { owner: string }> = [];
    for (const [owner, visibleTaskIds] of byOwner) {
      let ownerItems: PurchaseItem[];
      try {
        ownerItems = await purchaseItemsStore.listAllForUser(owner);
      } catch (err) {
        console.warn(
          `[purchasesApi.listAllIncludingShared] failed to load purchases for ${owner}:`,
          err,
        );
        continue;
      }
      for (const item of ownerItems) {
        if (!visibleTaskIds.has(item.task_id)) continue;
        shared.push({
          ...item,
          owner,
          total_price:
            item.total_price ??
            (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
          vendor: item.vendor ?? null,
          category: item.category ?? null,
          funding_account_id: item.funding_account_id ?? null,
          order_status: normalizeOrderStatus(item.order_status),
        });
      }
    }

    return [...ownDecorated, ...shared];
  },

  // `owner` routes the write into the target user's purchase_items directory
  // instead of the current viewer's. Used by Lab Head Phase 5 R1 PI edit
  // sessions so cross-owner creates land in the target member's folder with
  // a target-scoped id (bumps the member's _counters.json, not the PI's).
  create: async (data: PurchaseItemCreate, owner?: string): Promise<PurchaseItem> => {
    const total = (data.price_per_unit ?? 0) * data.quantity + (data.shipping_fees ?? 0);
    const payload = {
      ...data,
      link: data.link ?? null,
      cas: data.cas ?? null,
      price_per_unit: data.price_per_unit ?? 0,
      shipping_fees: data.shipping_fees ?? 0,
      total_price: total,
      notes: data.notes ?? null,
      // Funding link (funding-rework, 2026-06-08): the FK is authoritative,
      // the string rides along as the display label.
      funding_account_id: data.funding_account_id ?? null,
      funding_string: data.funding_string ?? null,
      vendor: data.vendor ?? null,
      catalog_number: data.catalog_number ?? null,
      category: data.category ?? null,
      // Per-item ordering status (purchases-ordered-stage, 2026-05-29). New
      // line items start in "needs_ordering" unless the caller seeds one.
      order_status: data.order_status ?? DEFAULT_PURCHASE_ORDER_STATUS,
      // Purchase documents (PURCHASE_DOCS_AND_ROUTING.md). Default to an empty
      // array so every record carries a normalized attachments field.
      attachments: data.attachments ?? [],
    };
    return owner
      ? purchaseItemsStore.createForUser(payload, owner)
      : purchaseItemsStore.create(payload);
  },

  update: async (
    id: number,
    data: PurchaseItemUpdate,
    owner?: string,
  ): Promise<PurchaseItem | null> => {
    // ACL hardening (2026-06-08): a cross-owner write (owner set and not the
    // current user) lands in another member's purchase_items folder. This was
    // previously ungated at the API layer, so any caller that passed an
    // `owner` could write to that user's folder regardless of role. Enforce
    // that only a lab head may write cross-owner; own-record writes (no owner,
    // or owner === current user) are unaffected. Legitimate lab-head purchase
    // edits (PI approve/decline/flag via pi-actions, the PI row editor) all
    // run as a lab head and pass; non-lab-head shared-purchase views are
    // read-only at the editor level, so no legitimate member flow breaks.
    if (owner) {
      const currentUser = await getCurrentUserCached();
      if (owner !== currentUser) {
        const viewer = await buildCurrentViewer();
        if (viewer.account_type !== "lab_head") {
          throw new Error(
            `[purchasesApi.update] refused: ${currentUser ?? "anonymous"} cannot edit purchase item owned by ${owner} (not a lab head)`,
          );
        }
      }
    }
    const existing = owner
      ? await purchaseItemsStore.getForUser(id, owner)
      : await purchaseItemsStore.get(id);
    if (!existing) return null;

    // VCP R3 attribution stamps + total_price recompute, factored into
    // buildPurchaseUpdatePatch so the Loro write-through path (chunk 3) produces
    // the same effective patch and a byte-identical .json mirror.
    const patch = await buildPurchaseUpdatePatch(existing, data);
    return owner
      ? purchaseItemsStore.updateForUser(id, patch, owner)
      : purchaseItemsStore.update(id, patch);
  },

  /**
   * Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29):
   * assign (or unassign) a purchase item to a lab member who will place
   * the order. Sets `assigned_to` via the same owner-routed `update`
   * path, then — when assigning to someone OTHER than the requester
   * (the item owner) — posts a `purchase_assignment` bell to the
   * assignee.
   *
   * `owner` is the item owner's username (the requester). Omit it for the
   * current user's own items; the caller passes it for shared / lab-mode
   * edits so the write lands in the owner's folder. `actor` is who is
   * doing the assigning (defaults to the current user) and is stamped as
   * the notification's `from_user`. Pass `assignedTo: null` to clear an
   * assignment (no notification fired).
   */
  assign: async (
    id: number,
    assignedTo: string | null,
    options?: { owner?: string; actor?: string },
  ): Promise<PurchaseItem | null> => {
    const owner =
      options?.owner ?? (await getCurrentUserCached()) ?? undefined;
    const actor = options?.actor ?? (await getCurrentUserCached()) ?? "";
    const updated = await purchasesApi.update(id, { assigned_to: assignedTo }, options?.owner);
    if (!updated) return null;

    // Requester = the item owner (the data folder the item lives in).
    const requester = owner ?? actor;
    // Notify the assignee only when assigning to a real, different user.
    if (assignedTo && assignedTo !== requester) {
      const notif: PurchaseAssignmentNotification = {
        id: newAlertId(),
        type: "purchase_assignment",
        from_user: actor || requester,
        owner_username: requester,
        purchase_item_id: id,
        task_id: updated.task_id,
        item_name: updated.item_name,
        created_at: new Date().toISOString(),
        read: false,
      };
      await appendPurchaseNotification(assignedTo, notif);
    }
    return updated;
  },

  /**
   * Per-item ordering status transition (purchases-ordered-stage,
   * 2026-05-29). Sets a single line item's `order_status` and — on the
   * transition INTO "ordered" (from any non-ordered stage) — fires the
   * `purchase_ordered` bell to the requester (the item owner) so they learn
   * their supply was placed. This REPLACES the stopgap where the parent
   * task's complete-toggle stood in for "ordered" (the old
   * `notifyOrdered`, removed here): the bell now tracks the real per-item
   * stage instead of the whole-order completion.
   *
   * The bell fires only when ALL of these hold (mirrors the prior
   * notifyOrdered guards, now per item):
   *   - the new status is "ordered" and the item was NOT already "ordered"
   *     (so re-affirming "ordered", or moving ordered -> received, is
   *     silent — no duplicate bell)
   *   - the item was handed off to someone OTHER than the requester
   *     (`assigned_to` set and != owner); an item the requester keeps for
   *     themselves needs no "it was ordered" ping
   *   - the actor is NOT the requester (you don't bell yourself for marking
   *     your own item ordered)
   *
   * `owner` is the item owner's username (the requester) — omit for the
   * current user's own items, pass it for shared / lab-mode items so the
   * write + read route into the owner's folder. `actor` is who flipped the
   * status (the bell's `from_user`); defaults to the current user.
   *
   * Returns the updated item plus whether a bell was sent.
   */
  setOrderStatus: async (
    id: number,
    status: PurchaseOrderStatus,
    options?: { owner?: string; actor?: string },
  ): Promise<{ item: PurchaseItem | null; notified: boolean }> => {
    const actor = options?.actor ?? (await getCurrentUserCached()) ?? "";
    const requester =
      options?.owner ?? (await getCurrentUserCached()) ?? "";

    // Read the prior status so we only bell on the actual transition INTO
    // "ordered", never on a re-save of an already-ordered item.
    const existing = options?.owner
      ? await purchaseItemsStore.getForUser(id, options.owner)
      : await purchaseItemsStore.get(id);
    if (!existing) return { item: null, notified: false };
    const priorStatus = normalizeOrderStatus(existing.order_status);

    // Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 4 = the
    // last purchase write seam, setOrderStatus, routed to match chunk 3. When
    // PURCHASE_LORO_ENABLED the order_status flip lands in the item's Loro doc
    // (persisting the .loro sidecar AND the byte-identical .json mirror + relay
    // fan-out); the mirror keeps every legacy reader correct and `updated`
    // stays the projected PurchaseItem so the bell-gating below is unchanged.
    // Flag off, it falls through to purchasesApi.update EXACTLY as before. The
    // helper is loaded with a lazy `await import` because purchase-write-through
    // statically imports buildPurchaseUpdatePatch FROM this module; a static
    // import here would close that cycle. openPurchaseDoc needs a concrete
    // sidecar-folder owner, so we pass `requester` (already resolved above as
    // options?.owner ?? current user, the same folder the legacy update would
    // have written into).
    let updated: PurchaseItem | null;
    if (PURCHASE_LORO_ENABLED) {
      const { writePurchaseUpdateThroughLoro } = await import(
        "./loro/purchase-write-through"
      );
      updated = await writePurchaseUpdateThroughLoro(
        requester,
        id,
        { order_status: status },
        actor || undefined,
      );
    } else {
      updated = await purchasesApi.update(
        id,
        { order_status: status },
        options?.owner,
      );
    }
    if (!updated) return { item: null, notified: false };

    const enteringOrdered = status === "ordered" && priorStatus !== "ordered";
    if (!enteringOrdered) return { item: updated, notified: false };

    const assignee = updated.assigned_to;
    // Only items handed off to someone else trigger the requester-facing
    // "it was ordered" bell, and the requester marking their own item is
    // silent (they already know).
    if (
      !requester ||
      !assignee ||
      assignee === requester ||
      (actor && actor === requester)
    ) {
      return { item: updated, notified: false };
    }

    const notif: PurchaseOrderedNotification = {
      id: newAlertId(),
      type: "purchase_ordered",
      from_user: actor || assignee,
      owner_username: requester,
      purchase_item_id: updated.id,
      task_id: updated.task_id,
      item_name: updated.item_name,
      created_at: new Date().toISOString(),
      read: false,
    };
    await appendPurchaseNotification(requester, notif);
    return { item: updated, notified: true };
  },

  // VCP R2 trash everywhere (2026-05-26): soft-delete via
  // `_trash/purchase_items/`. PurchaseItems inherit ownership from the
  // task (`task_id` parent ref) — the owner of the trash entry is the
  // task owner, accessed via the `owner` arg the caller passes for
  // shared-task purchases (see comment on `delete` above and the
  // `listByTask` doc-comment). The parent reference uses `task_id` so a
  // restore-with-dependencies prompt can fire if both the purchase and
  // its parent task sit in trash.
  delete: async (
    id: number,
    owner?: string,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const targetOwner = owner ?? currentUser;
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "purchasesApi.delete",
    );
    if (!attribution) return;
    const existing = owner
      ? await purchaseItemsStore.getForUser(id, owner)
      : await purchaseItemsStore.get(id);
    await softDeleteEntity({
      owner: targetOwner,
      entityType: "purchase_item",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
      parentId: existing?.task_id ?? null,
      parentEntityType: "task",
    });
  },

  searchCatalog: async (q: string): Promise<CatalogItem[]> => {
    const items = await catalogStore.listAll();
    const query = q.toLowerCase();
    return items.filter(
      (item) =>
        item.item_name.toLowerCase().includes(query) ||
        (item.cas?.toLowerCase().includes(query) ?? false)
    );
  },
  
  updateCatalogItem: async (id: number, data: Partial<CatalogItem>): Promise<CatalogItem | null> => {
    return catalogStore.update(id, data);
  },
  
  createCatalogItem: async (data: Partial<CatalogItem>): Promise<CatalogItem> => {
    return catalogStore.create({
      item_name: data.item_name ?? "",
      link: data.link ?? null,
      cas: data.cas ?? null,
      catalog_number: data.catalog_number ?? null,
      price_per_unit: data.price_per_unit ?? 0,
    });
  },
  
  listFundingAccounts: async (): Promise<FundingAccount[]> => {
    return fundingAccountsStore.listAll();
  },
  
  createFundingAccount: async (data: FundingAccountCreate): Promise<FundingAccount> => {
    return fundingAccountsStore.create({
      ...data,
      description: data.description ?? null,
      total_budget: data.total_budget ?? 0,
      // No stored `spent` / `remaining` (funding-rework, 2026-06-08): spend is
      // derived live from purchase items via computeFundingSpend.
      // Structured grant metadata (metadata implementation bot, 2026-05-28).
      // Default each to null on create so a freshly-created account has a
      // consistent on-disk shape; the editor fills them in later. `...data`
      // above already carries any value the caller passed, but the explicit
      // `?? null` normalizes `undefined` to `null` for a clean file.
      award_number: data.award_number ?? null,
      funder_name: data.funder_name ?? null,
      funder_id: data.funder_id ?? null,
      funder_id_type: data.funder_id_type ?? null,
      award_title: data.award_title ?? null,
    });
  },

  // Partial-update via the store's spread-merge (filters `undefined`, so
  // omitted fields keep their existing value; `null` explicitly clears).
  // The structured grant fields ride along on `...data` untouched. No
  // `remaining` recompute (funding-rework, 2026-06-08): it is no longer stored.
  updateFundingAccount: async (id: number, data: FundingAccountUpdate): Promise<FundingAccount | null> => {
    const existing = await fundingAccountsStore.get(id);
    if (!existing) return null;
    return fundingAccountsStore.update(id, data);
  },
  
  deleteFundingAccount: async (id: number): Promise<void> => {
    await fundingAccountsStore.delete(id);
  },
  
  getFundingSummary: async () => {
    // Spend is computed live from purchase line items (funding-rework,
    // 2026-06-08) — the on-disk `spent` field is gone. We read every purchase
    // item across the lab and roll up by `funding_account_id` so the summary
    // matches what the spending dashboard and the funding nav show.
    const currentUser = (await getCurrentUserCached()) ?? "";
    const [accounts, items] = await Promise.all([
      fundingAccountsStore.listAll(),
      currentUser
        ? purchasesApi.listAllIncludingShared(currentUser)
        : purchasesApi.listAll(),
    ]);
    const totalBudget = accounts.reduce((sum, a) => sum + a.total_budget, 0);
    const totalSpent = accounts.reduce(
      (sum, a) => sum + computeFundingSpend(a, items),
      0,
    );
    const uncategorizedSpent = computeUncategorizedSpend(accounts, items);

    return {
      accounts,
      total_budget: totalBudget,
      total_spent: totalSpent,
      total_remaining: totalBudget - totalSpent,
      uncategorized_spent: uncategorizedSpent,
    };
  },
};

/**
 * Lab data-retention registry (LAB_ARCHIVE_CONTINUITY.md phase 1a). PI-owned,
 * scoped to the current (PI) user's folder. No bytes move here, an entry records
 * who / where / how long a member's data is retained for compliance.
 */
export const retentionApi = {
  list: (): Promise<RetentionEntry[]> => retentionStore.listAll(),
  create: (entry: RetentionEntryCreate): Promise<RetentionEntry> =>
    retentionStore.create(entry),
  update: (id: number, patch: Partial<RetentionEntry>): Promise<RetentionEntry | null> =>
    retentionStore.update(id, patch),
  delete: (id: number): Promise<boolean> => retentionStore.delete(id),
};

/**
 * Lab-share restore (links lab-share restore bot, 2026-05-29): build the
 * unified-sharing `Viewer` for the CURRENT signed-in user. The `account_type`
 * drives the implicit Lab Head view-all branch inside `canRead`. We read
 * `settings.json` directly via `fileService` (mirroring the existing
 * lab-head fan-out in `dispatchCommentNotifications`) rather than pulling in
 * `readUserSettings`, keeping local-api free of the settings module's deps.
 *
 * UserSettings stores `account_type` as `"member" | "lab_head"`; the unified
 * `Viewer` union is `"solo" | "lab" | "lab_head"`. Only "lab_head" carries a
 * privilege, so anything else collapses to the conservative "lab".
 */
export async function buildCurrentViewer(): Promise<Viewer> {
  const username = (await getCurrentUserCached()) ?? "";
  let accountType: Viewer["account_type"] = "lab";
  try {
    const s = await fileService.readJson<{ account_type?: string }>(
      `users/${username}/settings.json`,
    );
    if (s?.account_type === "lab_head") accountType = "lab_head";
  } catch {
    // Settings read failure is non-fatal: fall back to the conservative
    // "lab" viewer (no implicit view-all). canRead still honors owner +
    // explicit / "*" shares.
  }
  return { username, account_type: accountType };
}

/** The whole-lab `shared_with` shape for a LabLink. Edit-level "*" so the
 *  lab can collaboratively maintain shared bookmarks, matching the
 *  migrate-unified mapping for LabLink. */
const LINK_WHOLE_LAB_SHARE: SharedUser[] = [
  { username: WHOLE_LAB_SENTINEL, level: "edit", permission: "edit" },
];

export const labLinksApi = {
  // Lab-share restore (links lab-share restore bot, 2026-05-29): the Links
  // page aggregates across the whole lab. We return the viewer's OWN links
  // PLUS links owned by OTHER members that the viewer is allowed to see.
  //
  // PRIVACY GATE: every cross-user record is run through the unified
  // `canRead(link, viewer)` before it can enter the result. `canRead`
  // returns true only when (a) the viewer owns it, (b) the viewer is a
  // lab_head (implicit view-all), or (c) `shared_with` contains the
  // viewer's username OR the "*" whole-lab sentinel. A link that is private
  // to another member (empty `shared_with`, or one that names neither this
  // viewer nor "*") is NEVER returned. Ids are per-user namespaced, so no
  // cross-user de-dupe is needed; we carry `owner` defensively so the UI can
  // badge shared-in (non-owned) cards.
  list: async (): Promise<LabLink[]> => {
    const viewer = await buildCurrentViewer();
    const usernames = await discoverUsers();
    const out: LabLink[] = [];
    for (const username of usernames) {
      const userLinks = await labLinksStore.listAllForUser(username);
      for (const link of userLinks) {
        const owner = link.owner || username;
        // Own links always pass; cross-user records MUST clear canRead.
        if (owner === viewer.username) {
          out.push({ ...link, owner });
          continue;
        }
        const shareable = { owner, shared_with: link.shared_with ?? [] };
        if (!canRead(shareable, viewer)) continue;
        out.push({ ...link, owner });
      }
    }
    return out;
  },

  get: async (id: number): Promise<LabLink | null> => {
    return labLinksStore.get(id);
  },

  create: async (data: LabLinkCreate): Promise<LabLink> => {
    const owner = (await getCurrentUserCached()) ?? "";
    // Visibility toggle (default "Just me"): the page passes
    // `whole_lab: true` for the "Whole lab" option, which stamps the
    // edit-level "*" sentinel. Otherwise `shared_with` stays empty (private).
    const sharedWith = data.whole_lab ? LINK_WHOLE_LAB_SHARE : [];
    return labLinksStore.create({
      title: data.title,
      url: data.url,
      description: data.description ?? null,
      category: data.category ?? null,
      color: data.color ?? null,
      preview_image_url: data.preview_image_url ?? null,
      sort_order: 0,
      created_at: new Date().toISOString(),
      owner,
      shared_with: sharedWith,
    });
  },

  // VCP R3 attribution stamps.
  update: async (id: number, data: LabLinkUpdate): Promise<LabLink | null> => {
    const { whole_lab, ...rest } = data;
    const patch: Partial<LabLink> = {
      ...rest,
      ...(await buildAttributionStamp(data.last_edited_by)),
    };
    // Preserve owner on update: stamp it if the record predates owner
    // stamping (pre-R1b links). Never reassign an existing owner.
    const existing = await labLinksStore.get(id);
    if (existing && !existing.owner) {
      patch.owner = (await getCurrentUserCached()) ?? "";
    }
    // Visibility toggle round-trips through update too: flip the "*"
    // sentinel in lockstep, mirroring the create path.
    if (whole_lab !== undefined) {
      patch.shared_with = whole_lab ? LINK_WHOLE_LAB_SHARE : [];
    }
    return labLinksStore.update(id, patch);
  },

  // VCP R2 trash everywhere (2026-05-26): soft-delete via
  // `_trash/lab_links/`. LabLinks have an optional `owner?` field added
  // post-R1b sharing migration. When absent, the active user is treated
  // as the owner for trash routing (the file lives in their folder).
  delete: async (
    id: number,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const currentUser = (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? currentUser;
    const sessionId = options?.sessionId ?? null;
    const link = await labLinksStore.get(id);
    const targetOwner = link?.owner || currentUser;
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "labLinksApi.delete",
    );
    if (!attribution) return;
    await softDeleteEntity({
      owner: targetOwner,
      entityType: "lab_link",
      id,
      actor: attribution.actor,
      sessionId: attribution.sessionId,
    });
  },

  getPreview: async (url: string): Promise<{ title: string; description: string | null; image: string | null; site_name: string | null }> => {
    return {
      title: url,
      description: null,
      image: null,
      site_name: null,
    };
  },
};

// VC Phase 2 (vc-entry-history sub-bot of HR, 2026-05-30): the note BODY lives
// in `entries[]`, which is edited via addEntry / updateEntry / deleteEntry, NOT
// via notesApi.update (the title/description path that already records history).
// Without this helper a user typing + saving note content saw only "created
// note" in their history; the actual writing was never versioned. This wires
// the SAME contract notesApi.update uses into the entry paths:
//   - no-op when the flag is off (mirrors recordNoteHistory's own guard, but we
//     also short-circuit here to skip the owner resolution),
//   - records AFTER the live record is persisted,
//   - best-effort: recordNoteHistory swallows every error, so a history-write
//     failure never throws into the save path.
// `prevState` is the pre-edit note the caller already read (the entry methods
// must read it to compute the new entries array), so this adds NO extra disk
// read. Because each editor save fires EXACTLY ONE of update / addEntry /
// updateEntry / deleteEntry (the body persists through updateEntry, the
// title/description through update; the popup never calls both for one logical
// save), this produces exactly one history row per save: no double-record.
async function recordEntryHistory(
  noteId: number,
  owner: string | undefined,
  prevState: Note,
  nextState: Note | null,
): Promise<void> {
  if (!HISTORY_ENGINE_ENABLED || !nextState) return;
  // When the Loro pilot is on, the Loro doc's native history is the sole
  // notes history source (no double-write; the sidebar reads from makeLoroHistoryEngine).
  if (LORO_PILOT_ENABLED) return;
  // `owner` is the note OWNER's folder (the history file lives there); for a
  // self-edit it falls back to the signed-in user. `actor` is WHO made the edit
  // (the signed-in user), mirroring notesApi.update's actor resolution so a PI
  // cross-owner entry edit records the PI as the actor, not the note owner.
  const actor = await resolveAttributionActor(null);
  const effectiveOwner = owner ?? actor;
  await recordNoteHistory({
    type: "update",
    id: noteId,
    owner: effectiveOwner,
    actor,
    prevState,
    nextState,
  });
}

// Markdown embed hybrid P7-2 (embeds manager, 2026-06-12): normalize a user-typed
// `![[Note Title#Heading]]` transclusion into the portable embed link on save. The
// resolver lists all notes once and matches a title case-insensitively, first match
// wins, and NEVER matches the note onto itself (a self-transclusion-by-title still
// resolves to this note's id so the render-time cycle guard catches the loop). Pure
// + best-effort: a list failure leaves every `![[ ]]` raw (the resolver returns
// null), so the content is unchanged and the save proceeds. Returns the possibly-
// rewritten content; identical bytes when nothing matched (guarded by `changed`).
async function normalizeEntryContent(
  content: string | undefined,
  selfNoteId: number,
): Promise<string | undefined> {
  if (content == null || content.indexOf("![[") === -1) return content;
  let all: Note[] = [];
  try {
    all = await notesStore.listAll();
  } catch {
    return content; // resolver unavailable: leave every transclusion raw
  }
  const byTitle = new Map<string, string>();
  for (const n of all) {
    const key = (n.title ?? "").trim().toLowerCase();
    if (!key) continue;
    // First match wins: only set the key once.
    if (!byTitle.has(key)) byTitle.set(key, String(n.id));
  }
  const { content: next } = normalizeTransclusions(content, (title) => {
    const id = byTitle.get(title.trim().toLowerCase());
    return id ?? null;
  });
  return next;
}

// Back-compat heal (unified Share verifier follow-up, 2026-06-04): notes
// from the pre-R1 coarse-toggle era could set `is_shared = true` WITHOUT
// writing the "*" whole-lab sentinel into `shared_with`. The unified
// canRead / ACL surfaces read ONLY `shared_with` (never the legacy
// boolean), so such a note rendered as "only you" in the new per-person
// ACL tab AND was silently unreadable by labmates. Materialize the
// sentinel on read so the `is_shared` <-> "*" invariant holds for every
// reader; the next save persists it to disk. Purely additive + idempotent
// (a no-op once the sentinel is present, or when `is_shared` is false).
function healLegacyNoteShare(note: Note): Note {
  if (note.is_shared && !isWholeLabShared(note.shared_with ?? [])) {
    return {
      ...note,
      shared_with: [
        ...normalizeSharedWith(note.shared_with),
        { username: WHOLE_LAB_SENTINEL, level: "read" },
      ],
    };
  }
  return note;
}

/**
 * Phase 6a portable identity (phase6a-foundation bot, 2026-06-12): lazy backfill
 * for a Note that predates the source_uuid field. Fire-and-forget write-through;
 * the caller gets the enriched record immediately. Pass ownerOverride when
 * reading cross-user notes so the write lands in the right directory.
 */
function backfillNoteSourceUuid(note: Note, ownerOverride?: string): Note {
  if (note.source_uuid) return note;
  // Own-store only. A cross-user read (ownerOverride set) never mints or writes
  // into another user's folder; that owner backfills their own copy on read.
  if (ownerOverride) return note;
  const uuid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  void notesStore.update(note.id, { source_uuid: uuid }).catch(() => { /* fire-and-forget */ });
  return { ...note, source_uuid: uuid };
}

/**
 * Own + shared NOTES union (BeakerAI lane, 2026-06-12). Mirrors
 * `fetchAllInventoryItemsIncludingShared` / `labLinksApi.list`: walk every member's
 * notes dir, heal the legacy share, then gate each cross-user record through the
 * unified `canRead(record, viewer)` so a private note from another member is NEVER
 * returned. The viewer's OWN notes always pass. `owner` is back-filled from
 * `note.username` (the author stamp) or the directory the record was read from, so
 * the summary tools can scope by member without re-reading. No de-dupe needed,
 * note ids are per-user namespaced. Read-only, no on-disk write.
 */
export const fetchAllNotesIncludingShared = async (): Promise<
  Array<Note & { owner: string }>
> => {
  const viewer = await buildCurrentViewer();
  const currentUser = viewer.username;
  const usernames = await discoverUsers();
  const out: Array<Note & { owner: string }> = [];
  for (const username of usernames) {
    let userNotes: Note[];
    try {
      userNotes = await notesStore.listAllForUser(username);
    } catch {
      // One member's unreadable notes dir never breaks the whole-lab roll-up.
      continue;
    }
    for (const raw of userNotes) {
      const note = healLegacyNoteShare(raw);
      const owner = note.username || username;
      // Own notes always pass; cross-user records MUST clear canRead (owner /
      // explicit username / "*" sentinel / lab_head view-all).
      if (owner === currentUser) {
        out.push({ ...note, owner });
        continue;
      }
      const shareable = { owner, shared_with: note.shared_with ?? [] };
      if (!canRead(shareable, viewer)) continue;
      out.push({ ...note, owner });
    }
  }
  return out;
};

export const notesApi = {
  list: async (): Promise<Note[]> => {
    return (await notesStore.listAll()).map(healLegacyNoteShare).map((n) => backfillNoteSourceUuid(n));
  },

  get: async (id: number, owner?: string): Promise<Note | null> => {
    const note = owner
      ? await notesStore.getForUser(id, owner)
      : await notesStore.get(id);
    // Phase 6a: heal legacy share first, then lazy-backfill source_uuid.
    return note ? backfillNoteSourceUuid(healLegacyNoteShare(note), owner) : null;
  },

  create: async (data: { title: string; description?: string; is_running_log?: boolean; is_shared?: boolean; entries?: Array<{ title: string; date: string; content?: string }> }): Promise<Note> => {
    const now = new Date().toISOString();
    const entries: NoteEntry[] = (data.entries ?? []).map((e) => ({
      id: crypto.randomUUID(),
      title: e.title,
      date: e.date,
      content: e.content ?? "",
      created_at: now,
      updated_at: now,
    }));
    
    // VC Phase 2 (vc-entry-history sub-bot of HR, 2026-05-30): stamp the
    // ORIGINAL AUTHOR onto the note. `username` is the creator-attribution
    // field (per the version-control proposal), NOT the owner-folder routing
    // (the store writes to `users/<currentUser>/notes/...` independent of this
    // field). It was previously left "" on create, which made
    // canRestoreNoteVersion compute isOwner=false for a user's OWN freshly
    // created note (the popup passes noteOwner = note.username), so the
    // "Restore this version" footer never rendered even for the owner. We stamp
    // the signed-in user here so author == owner-folder for newly created notes.
    // Callers that route to a different owner folder (none today) would still
    // record THIS user as the author, which matches the existing semantics of
    // every other create path. Empty-username legacy notes are handled
    // defensively in the popup's owner resolution.
    const author = (await getCurrentUserCached()) ?? "";

    return notesStore.create({
      title: data.title,
      description: data.description ?? "",
      is_running_log: data.is_running_log ?? false,
      is_shared: data.is_shared ?? false,
      entries,
      comments: [],
      created_at: now,
      updated_at: now,
      username: author,
      // Phase 6a portable identity: mint once at create time.
      source_uuid: (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    });
  },
  
  // `owner` routes the write into a specific user's notes directory instead
  // of the current viewer's. Used by Lab Head Phase 5 R1 PI edit sessions so
  // cross-owner edits land in the target user's folder.
  // VCP R3 attribution stamps: keep the existing `updated_at` write (note
  // sort orders rely on it) AND land `last_edited_at` / `last_edited_by`
  // so the AttributionChip has consistent fields with the other 7
  // entity types. FLAG: notes already had `username` (creator) +
  // `updated_at` (write-time) before R3; we keep both, the new fields
  // are additive.
  // VC Phase 2 (FLAG-5): `historyMeta` lets the restore / undo-restore flows
  // stamp the resulting history row with a non-"update" kind ("revert" /
  // "undo-revert") and the version index it reverted TO. It DEFAULTS to
  // { kind: "update" }, so every existing caller is byte-for-byte unchanged.
  update: async (
    id: number,
    data: NoteUpdate,
    owner?: string,
    historyMeta: { kind: HistoryEditKind; revert_target_version?: number } = {
      kind: "update",
    },
  ): Promise<Note | null> => {
    const stamp = await buildAttributionStamp(data.last_edited_by);
    // VC Phase 2 (FLAG-1): `revert_undo_window: null` is the explicit CLEAR
    // signal from the undo flow. The store's partial-merge skips `undefined`
    // but would otherwise write `null` into the live note, so we strip the key
    // from the patch and delete it from the persisted record below. A genuine
    // window object passes straight through. Denylisted (FLAG-2) either way, so
    // it never touches the history delta.
    const clearUndoWindow = data.revert_undo_window === null;
    const { revert_undo_window: rawWindow, ...rest } = data;
    // Coalesce null -> undefined so the patch type is `RevertUndoWindow |
    // undefined` (matches Partial<Note>); the null clear is handled separately.
    const windowToWrite = rawWindow ?? undefined;
    const patch = {
      ...rest,
      ...(clearUndoWindow ? {} : { revert_undo_window: windowToWrite }),
      updated_at: new Date().toISOString(),
      ...stamp,
    };
    // VCP Phase 0: capture the pre-edit state for the delta store BEFORE the
    // write. Only read when the history engine is enabled so the default-off
    // path adds zero extra disk reads (recordNoteHistory also short-circuits on
    // the flag; this guard avoids the prevState fetch entirely).
    const prevState = HISTORY_ENGINE_ENABLED
      ? owner
        ? await notesStore.getForUser(id, owner)
        : await notesStore.get(id)
      : null;
    let updated = owner
      ? await notesStore.updateForUser(id, patch, owner)
      : await notesStore.update(id, patch);
    // VC Phase 2 (FLAG-1): finalize the window CLEAR. The partial-merge store
    // cannot delete a key, so when the undo flow asked to clear we write the
    // record once more with the field removed. Cheap (only on undo).
    if (clearUndoWindow && updated && updated.revert_undo_window !== undefined) {
      const { revert_undo_window: _drop, ...withoutWindow } = updated;
      updated = owner
        ? await notesStore.saveForUser(id, withoutWindow as Note, owner)
        : await notesStore.save(id, withoutWindow as Note);
    }
    // Best-effort history append AFTER the live record is persisted. Failures
    // never throw into the save path (recordNoteHistory swallows). No-op when
    // HISTORY_ENGINE_ENABLED is off, so Phase 0 cherry-picks inertly (no
    // _history/ writes). Also suppressed when LORO_PILOT_ENABLED: the Loro
    // doc's native history is the sole notes history source under the flag
    // (the sidebar reads from makeLoroHistoryEngine; no double-write).
    if (HISTORY_ENGINE_ENABLED && !LORO_PILOT_ENABLED && updated) {
      const effectiveOwner = owner ?? (await getCurrentUserCached()) ?? "";
      await recordNoteHistory({
        type: historyMeta.kind,
        id,
        owner: effectiveOwner,
        actor: stamp.last_edited_by,
        prevState,
        nextState: updated,
        revertTargetVersion: historyMeta.revert_target_version,
      });
    }
    return updated;
  },

  // Soft-delete: move the note's JSON to `users/<owner>/_trash/notes/<id>-<slug>.json`
  // instead of hard-removing it. The next `restore(id, owner)` call
  // brings it back at the same id. See `lib/trash/` (VCP R1) for the
  // file layout + recovery semantics; `lib/notes/notes-trash.ts` is a
  // deprecation shim that delegates into the new layer.
  //
  // Owner-only delete gating (VCP R1 OQ9, 2026-05-26): only the note's
  // owner may delete it. A PI deleting cross-owner during a Phase 5
  // unlock is the documented carve-out — the caller must pass `actor`
  // + `sessionId` so the trash entry records the PI as the deleter +
  // groups with the audit log. Edit-access shared users are rejected
  // here at the API layer (defensive — the UI also hides the Delete
  // button via the read-only gate).
  delete: async (
    id: number,
    owner?: string,
    options?: { actor?: string; sessionId?: string | null },
  ): Promise<void> => {
    const targetOwner = owner ?? (await getCurrentUserCached()) ?? "";
    const actor = options?.actor ?? (await getCurrentUserCached()) ?? "";
    const sessionId = options?.sessionId ?? null;
    // Gate: owner self-delete (actor === owner) is always allowed; a
    // cross-owner delete requires the live process user to be a lab head.
    // ACL hardening (2026-06-08): this used to treat any non-null `sessionId`
    // as authorization, which the removed PI edit-session left wide open via
    // the constant sentinel. Route through the shared role-checked gate so
    // notes match every other entity's delete contract. `sessionId` only
    // rides along into the trash entry's audit fields now.
    const attribution = await resolveDeleteAttribution(
      targetOwner,
      actor,
      sessionId,
      "notesApi.delete",
    );
    if (!attribution) return;
    await trashNote(targetOwner, id, {
      actor: attribution.actor,
      sessionId: attribution.sessionId,
    });
  },

  // Inverse of `delete`. Returns the restored Note on success, `null`
  // if the trash entry was missing (already purged or never existed).
  // Callers expose this via an "Undo" toast immediately after delete.
  restore: async (id: number, owner?: string): Promise<Note | null> => {
    const targetOwner = owner ?? (await getCurrentUserCached());
    return await restoreTrashedNote(targetOwner, id);
  },

  addEntry: async (
    noteId: number,
    data: { title: string; date: string; content?: string },
    owner?: string,
  ): Promise<Note | null> => {
    const note = owner
      ? await notesStore.getForUser(noteId, owner)
      : await notesStore.get(noteId);
    if (!note) return null;

    const now = new Date().toISOString();
    // P7-2 transclusion: rewrite any `![[Note#Heading]]` to the portable embed link
    // before persisting. Byte-unchanged when the content has no `![[ ]]`.
    const normalizedContent = await normalizeEntryContent(data.content ?? "", noteId);
    const newEntry: NoteEntry = {
      id: crypto.randomUUID(),
      title: data.title,
      date: data.date,
      content: normalizedContent ?? "",
      created_at: now,
      updated_at: now,
    };

    const entries = [...(note.entries || []), newEntry];
    const updated = owner
      ? await notesStore.updateForUser(noteId, { entries, updated_at: now }, owner)
      : await notesStore.update(noteId, { entries, updated_at: now });
    // VC Phase 2 (vc-entry-history sub-bot of HR): the note BODY lives in
    // entries[], so an entry mutation is a real content edit and MUST be
    // versioned. recordNoteHistory is best-effort (swallows errors, never
    // throws into the save path) and a no-op when the flag is off; `note` is
    // the pre-edit state we already read above, so no extra disk read.
    await recordEntryHistory(noteId, owner, note, updated);
    return updated;
  },

  updateEntry: async (
    noteId: number,
    entryId: string,
    data: { title?: string; date?: string; content?: string },
    owner?: string,
  ): Promise<Note | null> => {
    const note = owner
      ? await notesStore.getForUser(noteId, owner)
      : await notesStore.get(noteId);
    if (!note) return null;

    const now = new Date().toISOString();
    // P7-2 transclusion: this is the primary note-body save path. Normalize any
    // `![[Note#Heading]]` in the new content into the portable embed link before
    // persisting. Only runs when `content` is part of this patch AND it actually
    // contains `![[`, so a title / date only edit (or content with no transclusion)
    // is byte-for-byte unchanged.
    const normalizedContent =
      data.content !== undefined
        ? await normalizeEntryContent(data.content, noteId)
        : undefined;
    const patchedData =
      normalizedContent !== undefined ? { ...data, content: normalizedContent } : data;
    const entries = (note.entries || []).map((e) => {
      if (e.id === entryId) {
        return { ...e, ...patchedData, updated_at: now };
      }
      return e;
    });

    const updated = owner
      ? await notesStore.updateForUser(noteId, { entries, updated_at: now }, owner)
      : await notesStore.update(noteId, { entries, updated_at: now });
    // VC Phase 2: this is the PRIMARY note-content save path (the editor body
    // persists through here). Version it. See addEntry for the contract.
    await recordEntryHistory(noteId, owner, note, updated);
    return updated;
  },

  deleteEntry: async (
    noteId: number,
    entryId: string,
    owner?: string,
  ): Promise<Note | null> => {
    const note = owner
      ? await notesStore.getForUser(noteId, owner)
      : await notesStore.get(noteId);
    if (!note) return null;

    const entries = (note.entries || []).filter((e) => e.id !== entryId);
    const patch = { entries, updated_at: new Date().toISOString() };
    const updated = owner
      ? await notesStore.updateForUser(noteId, patch, owner)
      : await notesStore.update(noteId, patch);
    // VC Phase 2: removing an entry deletes note content; version it.
    await recordEntryHistory(noteId, owner, note, updated);
    return updated;
  },
  
  reorderEntries: async (noteId: number, entryIds: string[]): Promise<Note | null> => {
    const note = await notesStore.get(noteId);
    if (!note) return null;

    const entriesMap = new Map((note.entries || []).map((e) => [e.id, e]));
    const entries = entryIds.map((id) => entriesMap.get(id)).filter(Boolean) as NoteEntry[];

    return notesStore.update(noteId, { entries, updated_at: new Date().toISOString() });
  },

  // Append a comment to a shared note. Lab-mode (#13): the viewer is usually
  // a different user than the note owner, so we read/write through the
  // owner's directory directly — same cross-user pattern as shared tasks.
  // Append-only by design; no edit. Author must be a real username, not "lab".
  //
  // Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23): `options`
  // carries the optional `parent_id` (threading) + `mentions` (denormalized
  // @-mention list). After the write, fan-out bell notifications to the
  // owner / mentioned users / lab heads via dispatchCommentNotifications.
  addComment: async (
    noteId: number,
    ownerUsername: string,
    text: string,
    author: string,
    options?: { parent_id?: string | null; mentions?: string[] },
  ): Promise<Note | null> => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const note = await notesStore.getForUser(noteId, ownerUsername);
    if (!note) return null;
    const newComment: NoteComment = {
      id: crypto.randomUUID(),
      author,
      text: trimmed,
      created_at: new Date().toISOString(),
    };
    if (options?.parent_id) newComment.parent_id = options.parent_id;
    if (options?.mentions && options.mentions.length > 0) {
      newComment.mentions = options.mentions;
    }
    const comments = [...(note.comments || []), newComment];
    const updated = await notesStore.updateForUser(
      noteId,
      { comments, updated_at: new Date().toISOString() },
      ownerUsername,
    );
    if (updated) {
      void dispatchCommentNotifications({
        commentId: newComment.id,
        author,
        text: trimmed,
        ownerUsername,
        recordType: "note",
        recordId: noteId,
        recordName: updated.title,
        mentions: options?.mentions ?? [],
      });
    }
    return updated;
  },

  // Remove a comment. Only the comment's author can call this — the UI
  // enforces that, but the API doesn't (caller-trusted, like every other
  // path in this app's local-only model).
  deleteComment: async (
    noteId: number,
    ownerUsername: string,
    commentId: string,
  ): Promise<Note | null> => {
    const note = await notesStore.getForUser(noteId, ownerUsername);
    if (!note) return null;
    const comments = (note.comments || []).filter((c) => c.id !== commentId);
    return notesStore.updateForUser(
      noteId,
      { comments, updated_at: new Date().toISOString() },
      ownerUsername,
    );
  },
};

// ── Weekly goals (PI beta feedback, weekly-goals widget, 2026-05-29) ─────────
//
// Current-user-scoped CRUD for the trainee's OWN weekly goals. The owner is
// always the current user (these writes land in the viewer's own
// `weekly_goals` dir via the default user-scoped JsonStore). The PI surface
// does NOT read through here — it reads the sharing-respecting aggregation
// `labApi.getWeeklyGoals({ shared_only: true })` (mirroring notes). This is
// the same separation Notes use: per-user CRUD here; cross-lab read in
// labApi, gated by sharing.
//
// Sharing mirrors notes exactly:
//   - `is_shared` is the coarse flag (set/clear together with the "*"
//     whole-lab `shared_with` sentinel).
//   - default for a NEW goal is shared-to-lab ("*") so a 1:1 goal is
//     visible to the PI — but it still flows through `canRead`, never a
//     bypass.
export const weeklyGoalsApi = {
  /** List the current user's own weekly goals (newest week first). */
  list: async (): Promise<WeeklyGoal[]> => {
    const goals = await weeklyGoalsStore.listAll();
    return goals.sort((a, b) => b.week_of.localeCompare(a.week_of) || b.id - a.id);
  },

  get: async (id: number): Promise<WeeklyGoal | null> => {
    return weeklyGoalsStore.get(id);
  },

  create: async (data: WeeklyGoalCreate): Promise<WeeklyGoal> => {
    const owner = await getCurrentUserCached();
    const now = new Date().toISOString();
    // Default a 1:1 goal to whole-lab shared so the PI sees it. The "*"
    // sentinel + `is_shared` flag are set together, mirroring how notes
    // carry both fields. Owner-only is the explicit opt-out
    // (`is_shared: false`).
    const isShared = data.is_shared ?? true;
    return weeklyGoalsStore.create({
      owner,
      text: data.text,
      week_of: data.week_of ?? mondayOf(),
      is_complete: false,
      created_at: now,
      created_by: owner,
      is_shared: isShared,
      shared_with: isShared ? [{ username: WHOLE_LAB_SENTINEL, level: "read" }] : [],
    });
  },

  update: async (id: number, data: WeeklyGoalUpdate): Promise<WeeklyGoal | null> => {
    // Keep `is_shared` and the "*" sentinel in lockstep, same as the
    // create path: flipping the share flag rewrites `shared_with`.
    const patch: Partial<WeeklyGoal> = { ...data };
    if (data.is_shared !== undefined) {
      patch.shared_with = data.is_shared
        ? [{ username: WHOLE_LAB_SENTINEL, level: "read" }]
        : [];
    }
    return weeklyGoalsStore.update(id, patch);
  },

  delete: async (id: number): Promise<void> => {
    await weeklyGoalsStore.delete(id);
  },
};

// ── Shared Notebooks (notebooks-data bot, 2026-06-02) ────────────────────────
//
// See docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md +
// docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md. A Notebook is a shared
// container of NOTES between 1..N members. Everything inside it is shared
// between every member at "edit" (via `membersSharedWith`), so all read AND
// write. EITHER role can create one (no role gate).
//
// 1:1 revamp (oneonone data+strip bot, 2026-06-07): a notebook is now a PLAIN
// NOTE CONTAINER. The weekly-task + meeting machinery that used to live here
// moved to the distinct `oneOnOnesApi` (lab-head <-> member 1:1). A notebook no
// longer holds weekly goals. In-notebook ITEM creation routes through
// `createNote` so each note lands with the correct `notebook_id` +
// `membersSharedWith` share list; the personal notes path is untouched.

/**
 * Resolve a notebook by its (globally-unique) id across the lab. The record
 * lives in its creator's folder, which may not be the current viewer, so we
 * walk `discoverUsers()` and return the first hit. The id is a UUID, so at
 * most one user's folder holds it. Stamps `owner` defensively from the folder
 * for any pre-stamp record. Returns null if no such notebook exists.
 */
async function findSharedNotebook(id: string): Promise<SharedNotebook | null> {
  const usernames = await discoverUsers();
  for (const username of usernames) {
    const rec = await sharedNotebooksStore.getForUser(id, username);
    if (rec) return { ...rec, owner: rec.owner || username };
  }
  return null;
}

/**
 * Re-stamp every NOTE currently carrying `notebookId` with a fresh
 * `shared_with` (notebooks-gen Phase 1, the add/remove-member share-list flip).
 * Notes live in their author's own folder, so we walk every user's folder and
 * route each write to that owner. `is_shared` is kept in lockstep with whether
 * the new share list reaches anyone besides the note's owner. Best-effort per
 * note; a single write failure must not abort the whole flip.
 *
 * 1:1 revamp (oneonone data+strip bot, 2026-06-07): a notebook is a plain note
 * container now, so this no longer touches weekly goals. Weekly goals belong to
 * 1:1s (`one_on_one_id`), not notebooks.
 */
async function restampNotebookItems(
  notebookId: string,
  shared_with: SharedUser[],
): Promise<void> {
  const usernames = await discoverUsers();
  const isShared = shared_with.length > 0;
  for (const username of usernames) {
    const userNotes = await notesStore.listAllForUser(username);
    for (const note of userNotes) {
      if (note.notebook_id !== notebookId) continue;
      try {
        await notesStore.updateForUser(
          note.id,
          { shared_with, is_shared: isShared },
          username,
        );
      } catch {
        // best-effort
      }
    }
  }
}

export const notebooksApi = {
  /**
   * Create a generalized notebook with an explicit member list (notebooks-gen
   * Phase 1). The creator MUST be `members[0]` (= created_by = owner); pass the
   * full member array INCLUDING the creator. length 1 = private/unshared,
   * length >= 2 = shared. `shared_with` = `membersSharedWith(members)` (every
   * member at "edit"). Both `create` (shared) and `createPersonal` (private)
   * route through this.
   */
  createForMembers: async (params: {
    members: string[];
    title?: string;
  }): Promise<Notebook> => {
    const creator = await getCurrentUserCached();
    // Normalize: dedupe, ensure the creator is members[0].
    const seen = new Set<string>();
    const members: string[] = [];
    for (const m of [creator, ...params.members]) {
      if (typeof m !== "string" || m.length === 0) continue;
      if (seen.has(m)) continue;
      seen.add(m);
      members.push(m);
    }
    const now = new Date().toISOString();
    const data: Omit<Notebook, "id"> = {
      members,
      created_by: creator,
      created_at: now,
      owner: creator,
      shared_with: membersSharedWith(members),
    };
    if (params.title !== undefined) data.title = params.title;
    return sharedNotebooksStore.create(data);
  },

  /**
   * Create a PERSONAL (private, unshared) notebook owned solely by the current
   * user (`members: [creator]`). It lives only in the creator's folder; no
   * other username is in `shared_with`, so it stays readable/writable only by
   * the owner. Promote it later with `addMember`.
   */
  createPersonal: async (params: { title?: string } = {}): Promise<Notebook> => {
    return notebooksApi.createForMembers({
      members: [],
      ...(params.title !== undefined ? { title: params.title } : {}),
    });
  },

  /**
   * Create a shared notebook between the current user and `otherMember`. The
   * creator becomes `members[0]` / `created_by` / `owner`; both members are
   * written into `shared_with` at "edit". No role gate: a PI or a student may
   * create one. Kept for back-compat; routes through the generalized
   * member/share-list logic (`membersSharedWith`).
   */
  create: async (params: {
    otherMember: string;
    title?: string;
  }): Promise<Notebook> => {
    return notebooksApi.createForMembers({
      members: [params.otherMember],
      ...(params.title !== undefined ? { title: params.title } : {}),
    });
  },

  /** Read a notebook from the current user's folder (creator-scoped). For a
   *  cross-member read, use `labApi.getSharedNotebooks`. */
  get: async (id: string): Promise<SharedNotebook | null> => {
    return sharedNotebooksStore.get(id);
  },

  /** List the current user's OWN notebooks (the ones they created). The
   *  full set the viewer participates in (including those the OTHER member
   *  created) comes from `labApi.getSharedNotebooks`. */
  list: async (): Promise<SharedNotebook[]> => {
    return sharedNotebooksStore.listAll();
  },

  /** Rename a shared notebook, updating BOTH members' mirror copies so the
   *  rename survives either member being removed from the lab. Falls back to a
   *  single-folder update if the notebook can no longer be discovered. */
  updateTitle: async (
    id: string,
    title: string,
  ): Promise<SharedNotebook | null> => {
    const notebook = await findSharedNotebook(id);
    if (!notebook) return sharedNotebooksStore.update(id, { title });
    return sharedNotebooksStore.updateForMembers(id, notebook.members, {
      title,
    });
  },

  /** Set or clear the color / subject_icon appearance fields, mirrored to all
   *  members' folders exactly like updateTitle. Pass null to REMOVE a field
   *  (applyPatch treats null as "delete the key from the record"). */
  updateAppearance: async (
    id: string,
    patch: { color?: string | null; subject_icon?: string | null },
  ): Promise<SharedNotebook | null> => {
    const fields: Record<string, string | null> = {};
    if (patch.color !== undefined) fields.color = patch.color;
    if (patch.subject_icon !== undefined) fields.subject_icon = patch.subject_icon;
    const notebook = await findSharedNotebook(id);
    if (!notebook)
      return sharedNotebooksStore.update(id, fields as Partial<SharedNotebook>);
    return sharedNotebooksStore.updateForMembers(
      id,
      notebook.members,
      fields as Partial<SharedNotebook>,
    );
  },

  /** Delete a shared notebook from BOTH members' folders (it is a shared
   *  entity owned equally by both). Falls back to a single-folder delete if
   *  the notebook can no longer be discovered. */
  delete: async (id: string): Promise<void> => {
    const notebook = await findSharedNotebook(id);
    if (!notebook) {
      await sharedNotebooksStore.delete(id);
      return;
    }
    await sharedNotebooksStore.deleteForMembers(id, notebook.members);
  },

  /**
   * Add a member to a notebook (notebooks-gen Phase 1, the locked "promotion
   * flip"). Recomputes `shared_with = membersSharedWith(members)` on the
   * notebook (mirrored to every member folder), THEN re-stamps EVERY note
   * currently carrying this `notebook_id` with the new share list, so the
   * notebook's existing contents become shared with the new member.
   * Items live in their author's folder, so we route each re-stamp to that
   * owner. The confirm-dialog warning is a Phase 2/UI concern. Returns the
   * updated notebook, or null if the notebook can't be found. No-op (returns the
   * notebook unchanged) if `username` is already a member.
   */
  addMember: async (
    id: string,
    username: string,
  ): Promise<Notebook | null> => {
    if (typeof username !== "string" || username.length === 0) return null;
    const notebook = await findSharedNotebook(id);
    if (!notebook) return null;
    if (notebook.members.includes(username)) return notebook;
    const members = [...notebook.members, username];
    const shared_with = membersSharedWith(members);
    const updated = await sharedNotebooksStore.updateForMembers(id, members, {
      members,
      shared_with,
    });
    // Promotion flip: re-share every existing item in this notebook.
    await restampNotebookItems(id, shared_with);
    return updated;
  },

  /**
   * Remove a member from a notebook. Recomputes `shared_with` on the notebook
   * and on its items so the removed member loses access. The LAST/OWNER member
   * (members[0]) cannot be removed (returns null no-op); deleting the notebook
   * entirely is the path for that. Returns the updated notebook, or null if the
   * notebook can't be found, the user isn't a member, or the target is the
   * owner.
   */
  removeMember: async (
    id: string,
    username: string,
  ): Promise<Notebook | null> => {
    const notebook = await findSharedNotebook(id);
    if (!notebook) return null;
    if (!notebook.members.includes(username)) return null;
    // Never remove the owner (members[0]); the notebook must always have one.
    if (username === notebook.members[0]) return null;
    const members = notebook.members.filter((m) => m !== username);
    const shared_with = membersSharedWith(members);
    // Walk the OLD member set so the removed member's mirror copy is rewritten
    // too (we narrow its share list); then drop its copy.
    const updated = await sharedNotebooksStore.updateForMembers(
      id,
      notebook.members,
      { members, shared_with },
    );
    await sharedNotebooksStore.deleteForMembers(id, [username]);
    await restampNotebookItems(id, shared_with);
    return updated;
  },

  /**
   * Move a note INTO a notebook (`notebookId` set) or OUT to floating
   * (`notebookId === null`). Enforces exactly-one-notebook-per-note: a single
   * `notebook_id` is replaced, never appended. Recomputes the note's
   * `shared_with` to the target notebook's `membersSharedWith(members)`, or
   * clears it (back to the note's own owner) when moving to floating. Routes
   * through the owner-aware note update path. Pass `owner` when moving a note
   * that lives in another member's folder. Returns the updated note.
   */
  moveNoteToNotebook: async (
    noteId: number,
    notebookId: string | null,
    owner?: string,
  ): Promise<Note> => {
    if (notebookId === null) {
      const patch: Partial<Note> = { notebook_id: undefined, shared_with: [] };
      const updated = await notesStore.updateForUser(
        noteId,
        patch,
        owner ?? (await getCurrentUserCached()),
      );
      if (!updated) throw new Error(`Note ${noteId} not found`);
      return healLegacyNoteShare(updated);
    }
    const notebook = await findSharedNotebook(notebookId);
    if (!notebook) {
      throw new Error(`Notebook ${notebookId} not found`);
    }
    // A single-member (personal) notebook shares with nobody, so the note must
    // stay fully private: is_shared false AND an empty share list (membersSharedWith
    // would otherwise list the owner, which trips the "Shared with lab" filter).
    const isMultiMember = notebook.members.length >= 2;
    const patch: Partial<Note> = {
      notebook_id: notebookId,
      is_shared: isMultiMember,
      shared_with: isMultiMember ? membersSharedWith(notebook.members) : [],
    };
    const updated = await notesStore.updateForUser(
      noteId,
      patch,
      owner ?? (await getCurrentUserCached()),
    );
    if (!updated) throw new Error(`Note ${noteId} not found`);
    return healLegacyNoteShare(updated);
  },

  /**
   * Create a NOTE inside a shared notebook. The note lands in the current
   * user's notes folder (any member can add), stamped with the `notebook_id`
   * and `shared_with` = both members at "edit", so the other member reads +
   * edits it. Throws if the notebook does not exist or the current user is not
   * a member.
   */
  createNote: async (params: {
    notebookId: string;
    title: string;
    description?: string;
    is_running_log?: boolean;
    entries?: Array<{ title: string; date: string; content?: string }>;
  }): Promise<Note> => {
    const notebook = await findSharedNotebook(params.notebookId);
    if (!notebook) {
      throw new Error(`Shared notebook ${params.notebookId} not found`);
    }
    const author = (await getCurrentUserCached()) ?? "";
    if (!notebook.members.includes(author)) {
      throw new Error(
        `User ${author} is not a member of notebook ${params.notebookId}`,
      );
    }
    const now = new Date().toISOString();
    const entries: NoteEntry[] = (params.entries ?? []).map((e) => ({
      id: crypto.randomUUID(),
      title: e.title,
      date: e.date,
      content: e.content ?? "",
      created_at: now,
      updated_at: now,
    }));
    return notesStore.create({
      title: params.title,
      description: params.description ?? "",
      is_running_log: params.is_running_log ?? false,
      // Coarse "shared at all" flag, kept in lockstep with the explicit share
      // list. A single-member (personal) notebook shares with nobody, so the
      // note stays private; a multi-member notebook shares with every member.
      // The real read gate is still `canRead` over `shared_with`.
      is_shared: notebook.members.length >= 2,
      entries,
      comments: [],
      created_at: now,
      updated_at: now,
      username: author,
      notebook_id: params.notebookId,
      shared_with:
        notebook.members.length >= 2
          ? membersSharedWith(notebook.members)
          : [],
      // Phase 6a portable identity: mint once at create time.
      source_uuid: (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    });
  },

};

/** @deprecated use `notebooksApi` (notebooks-gen Phase 1 renamed the export;
 *  Phase 2 removes this alias + renames call sites). */
export const sharedNotebooksApi = notebooksApi;

// ── Lab-head <-> member 1:1 (oneonone data+strip bot, 2026-06-07) ────────────
//
// See docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md. A OneOnOne is a
// distinct advising workspace between exactly ONE lab head and ONE member
// (NOT a notebook). The lab head sets it up (create is lab-head-only); both
// people edit. It scopes weekly goals, weekly meeting notes, freeform shared
// notes, and action items via `one_on_one_id`. Every item carries
// `shared_with = membersSharedWith([labHead, member])` (both at "edit").
//
// CRUD here is owner-aware exactly like the notebook path: the 1:1 record +
// action items live in the LAB HEAD's folder; notes + weekly goals live in
// their author's folder. Cross-user reads route through `labApi.getOneOnOne*`.

/**
 * Resolve a 1:1 by its (globally-unique) id across the lab. The record lives in
 * the lab head's folder, which may not be the current viewer, so we walk
 * `discoverUsers()` and return the first hit. Stamps `owner` defensively.
 * Returns null if no such 1:1 exists.
 */
async function findOneOnOne(id: string): Promise<OneOnOne | null> {
  const usernames = await discoverUsers();
  for (const username of usernames) {
    const rec = await oneOnOnesStore.getForUser(id, username);
    if (rec) return normalizeOneOnOne({ ...rec, owner: rec.owner || username });
  }
  return null;
}

/** Throw unless `actor` is one of the space's (normalized) members. */
function assertMember(oneOnOne: OneOnOne, actor: string): void {
  const members = normalizeOneOnOne(oneOnOne).members;
  if (!members.includes(actor)) {
    throw new Error(
      `User ${actor} is not a member of 1:1 ${oneOnOne.id}`,
    );
  }
}

/** The `shared_with` for a space's items: every member at "edit". */
function oneOnOneShareList(oneOnOne: OneOnOne): SharedUser[] {
  return membersSharedWith(normalizeOneOnOne(oneOnOne).members);
}

/**
 * Propagate a synced check-in task's `shared_with` into each recipient's
 * `users/<recipient>/_shared_with_me.json` manifest (+ bell notification), and
 * prune recipients no longer shared with. The D4 ops write the task straight
 * into the space owner's folder via the raw `tasksStore`, which sets
 * `shared_with` on the RECORD but never touches recipients' manifests.
 * `fetchAllTasksIncludingShared` (the Lists view's source) reads ONLY those
 * manifests, so without this the assignee never sees the to-do in their own
 * Lists. This mirrors what `tasksApi.shareTaskAs` does for a normal owner-
 * scoped share. The owner reads the task as owner, so they are never added.
 */
async function propagateCheckinTaskShares(input: {
  owner: string;
  taskId: number;
  name: string;
  prevShared: SharedUser[];
  nextShared: SharedUser[];
}): Promise<void> {
  const sharedAt = new Date().toISOString();
  const nextNames = new Set(input.nextShared.map((s) => s.username));
  for (const prev of input.prevShared) {
    if (prev.username !== input.owner && !nextNames.has(prev.username)) {
      await removeReceiverShare(prev.username, "task", input.taskId, input.owner);
    }
  }
  for (const next of input.nextShared) {
    if (next.username === input.owner) continue;
    const permission = next.level === "edit" ? "edit" : "view";
    await addReceiverShare(
      next.username,
      "task",
      { id: input.taskId, owner: input.owner, permission, shared_at: sharedAt },
      input.name,
    );
  }
}

// Check-ins revamp Phase 2 (checkins-phase2 bot, 2026-06-12). The owner-scoped
// task operations backing the D4 action-item -> Task sync. Every write lands in
// the SPACE OWNER's task namespace via the per-user `tasksStore`, so a non-owner
// member adding an assigned item does NOT create a task in their own folder.
// This is the exact shape a PI-assigned task carries (owner = space owner,
// assignee = member, shared_with = the member at "edit"). Each op then calls
// `propagateCheckinTaskShares` so the share reaches the assignee's
// `_shared_with_me.json` manifest and the to-do actually surfaces in their
// Lists view (the raw store write alone does not do this).
const checkinTaskSyncOps: TaskSyncOps = {
  createTask: async (owner: string, draft: SyncedTaskDraft): Promise<Task> => {
    const durationDays = 1;
    const record: Omit<Task, "id"> = {
      project_id: 0, // STANDALONE — the proven falsy-project path in WorkbenchListsPanel.
      name: draft.name,
      start_date: draft.start_date,
      duration_days: durationDays,
      end_date: canonicalEndDate({
        start_date: draft.start_date,
        duration_days: durationDays,
      }),
      is_high_level: false,
      is_complete: draft.is_complete,
      task_type: "list",
      weekend_override: null,
      method_ids: [],
      deviation_log: null,
      tags: null,
      sort_order: 0,
      experiment_color: null,
      sub_tasks: null,
      method_attachments: [],
      comments: [],
      owner,
      shared_with: draft.shared_with,
      assignee: draft.assignee,
      source: draft.source,
    };
    const created = await tasksStore.createForUser(record, owner);
    await propagateCheckinTaskShares({
      owner,
      taskId: created.id,
      name: created.name,
      prevShared: [],
      nextShared: draft.shared_with,
    });
    return created;
  },
  updateTask: async (
    owner: string,
    id: number,
    patch: Partial<Task>,
  ): Promise<Task | null> => {
    // Read the current record once: needed both to recompute end_date and to
    // reconcile the share manifests (a reassign drops the old recipient).
    const existing = await tasksStore.getForUser(id, owner);
    // Recompute the derived end_date when the date inputs change, mirroring
    // tasksApi.update, so the synced task's timeline stays correct.
    const next: Partial<Task> = { ...patch };
    if (patch.start_date !== undefined || patch.duration_days !== undefined) {
      if (existing) {
        next.end_date = canonicalEndDate({
          start_date: patch.start_date ?? existing.start_date,
          duration_days: patch.duration_days ?? existing.duration_days,
        });
      }
    }
    const updated = await tasksStore.updateForUser(id, next, owner);
    if (updated) {
      await propagateCheckinTaskShares({
        owner,
        taskId: id,
        name: updated.name,
        prevShared: (existing?.shared_with ?? []) as SharedUser[],
        nextShared: (patch.shared_with ?? existing?.shared_with ?? []) as SharedUser[],
      });
    }
    return updated;
  },
  deleteTask: async (owner: string, id: number): Promise<void> => {
    // Prune the assignee's manifest entry before removing the task, so a
    // detach / clear-assignee / delete does not leave a dangling Lists row.
    const existing = await tasksStore.getForUser(id, owner);
    if (existing) {
      await propagateCheckinTaskShares({
        owner,
        taskId: id,
        name: existing.name,
        prevShared: (existing.shared_with ?? []) as SharedUser[],
        nextShared: [],
      });
    }
    await tasksStore.deleteForUser(id, owner);
  },
  getTask: async (owner: string, id: number): Promise<Task | null> => {
    return tasksStore.getForUser(id, owner);
  },
};

export const oneOnOnesApi = {
  /**
   * Create a check-in space. Any account can create one (the lab-head gate is
   * retired in Phase 1). The CURRENT user is forced into `members[0]` (the
   * creator + owner). `shared_with = membersSharedWith(members)` (every member
   * at "edit"). `mentor` must be one of `members` or null.
   *
   * Back-compat: for a 2-person space WITH a mentor we ALSO write the legacy
   * `labHead`/`member` fields (`labHead = mentor`, `member` = the other) so a
   * pre-revamp reader still works; peer + group spaces leave them undefined.
   * The new `members`/`mentor`/`kind` fields are always written.
   *
   * Phase 1 callers pass exactly two members, but the API accepts N.
   */
  create: async (params: {
    members: string[];
    mentor?: string | null;
    title?: string | null;
    /** Check-ins Phase 3b: an optional recurring cadence, applied from a picked
     *  template's `suggested_cadence`. Null / absent leaves the space cadence-
     *  free (the prior default). */
    cadence?: { every: "week" | "2weeks" | "month"; weekday?: number } | null;
  }): Promise<OneOnOne> => {
    const creator = await getCurrentUserCached();
    // Force the creator into members[0], de-duped, preserving order.
    const rest = params.members.filter((m) => m && m !== creator);
    const members = [creator, ...Array.from(new Set(rest))];

    const mentor = params.mentor ?? null;
    if (mentor !== null && !members.includes(mentor)) {
      throw new Error(`mentor ${mentor} is not a member of the space`);
    }

    const kind: "pair" | "group" = members.length > 2 ? "group" : "pair";
    const now = new Date().toISOString();

    const data: Omit<OneOnOne, "id"> = {
      members,
      mentor,
      kind,
      title: params.title ?? null,
      cadence: params.cadence ?? null,
      created_by: creator,
      created_at: now,
      owner: creator,
      shared_with: membersSharedWith(members),
    };

    // Legacy back-compat: only a 2-person space WITH a mentor maps cleanly onto
    // the old labHead/member binary. Write it so pre-revamp readers keep working.
    if (kind === "pair" && mentor !== null) {
      const other = members.find((m) => m !== mentor);
      data.labHead = mentor;
      if (other) data.member = other;
    }

    return oneOnOnesStore.create(data);
  },

  /** Read a check-in space by id, across the lab (it lives in the creator's
   *  folder). Normalized so callers see `members`/`mentor`/`kind`. */
  get: async (id: string): Promise<OneOnOne | null> => {
    return findOneOnOne(id);
  },

  /** Every space the current viewer participates in (as any member). */
  list: async (): Promise<OneOnOne[]> => {
    return labApi.getOneOnOnes();
  },

  /** Delete a check-in space. The owner / creator may delete (not just a lab
   *  head). Removes the record from the owner's folder. Scoped items are left in
   *  place; a follow-up step can sweep them. */
  delete: async (id: string): Promise<void> => {
    const actor = await getCurrentUserCached();
    const oneOnOne = await findOneOnOne(id);
    if (!oneOnOne) return;
    if (oneOnOne.owner !== actor && oneOnOne.created_by !== actor) {
      throw new Error("Only the space owner can delete it.");
    }
    const home = oneOnOne.owner || actor;
    await oneOnOneActionItemsStore.deleteForUser(id, home);
    await oneOnOnesStore.deleteForUser(id, home);
  },

  /**
   * Check-ins Phase 4 (committee support). Set or clear the space's next
   * scheduled meeting date (YYYY-MM-DD, or null to clear). Any member may set it
   * (the permissive shared-space model). Writes the single canonical record in
   * the space owner's folder. Returns the normalized space or null if missing.
   */
  setNextMeetingDate: async (
    id: string,
    date: string | null,
  ): Promise<OneOnOne | null> => {
    const oneOnOne = await findOneOnOne(id);
    if (!oneOnOne) return null;
    const actor = await getCurrentUserCached();
    assertMember(oneOnOne, actor);
    const home = oneOnOne.owner || actor;
    const updated = await oneOnOnesStore.updateForUser(
      id,
      { next_meeting_date: date } as Partial<OneOnOne>,
      home,
    );
    return updated ? normalizeOneOnOne({ ...updated, owner: updated.owner || home }) : null;
  },

  /**
   * Add a WEEKLY GOAL to a 1:1. Reuses the `WeeklyGoal` record: `text` is the
   * goal, `is_complete` the done toggle, `week_of` the grouping. Lands in the
   * current user's weekly_goals folder, stamped with `one_on_one_id` +
   * `shared_with` = both members at "edit", so either can add and either can
   * check off. Throws if the 1:1 is missing or the user is not a member.
   */
  addWeeklyGoal: async (params: {
    oneOnOneId: string;
    text: string;
    week_of?: string;
    /** Check-ins Phase 2: optional single assignee for the group goal board. */
    assignee?: string | null;
  }): Promise<WeeklyGoal> => {
    const oneOnOne = await findOneOnOne(params.oneOnOneId);
    if (!oneOnOne) {
      throw new Error(`1:1 ${params.oneOnOneId} not found`);
    }
    const author = await getCurrentUserCached();
    assertMember(oneOnOne, author);
    const assignee = params.assignee ?? null;
    if (assignee !== null) assertMember(oneOnOne, assignee);
    const now = new Date().toISOString();
    return weeklyGoalsStore.create({
      owner: author,
      text: params.text,
      week_of: params.week_of ?? mondayOf(),
      is_complete: false,
      created_at: now,
      created_by: author,
      is_shared: true,
      shared_with: oneOnOneShareList(oneOnOne),
      one_on_one_id: params.oneOnOneId,
      assignee,
    });
  },

  /**
   * Set a 1:1 weekly goal's complete state. A goal lives in the folder of
   * whichever member CREATED it (its `owner`), so this MUST route to that owner
   * (the goals returned by `labApi.getOneOnOneWeeklyGoals` are decorated with
   * `owner` for exactly this call). Without owner-routing the other member's
   * `weeklyGoalsApi.update` would silently miss the record, so both-member
   * check-off (the locked design) would not work. Returns null if not found.
   */
  setWeeklyGoalComplete: async (
    id: number,
    owner: string,
    isComplete: boolean,
  ): Promise<WeeklyGoal | null> => {
    return weeklyGoalsStore.updateForUser(
      id,
      { is_complete: isComplete },
      owner,
    );
  },

  /**
   * Delete a 1:1 weekly goal from its creator's folder (its `owner`, decorated
   * by `getOneOnOneWeeklyGoals`). Either member may delete. Returns false if
   * not found.
   */
  deleteWeeklyGoal: async (id: number, owner: string): Promise<boolean> => {
    return weeklyGoalsStore.deleteForUser(id, owner);
  },

  /**
   * Add a weekly MEETING NOTE to a 1:1 (`note_kind: "meeting"`). One entry per
   * meeting, keyed by `date`. Lands in the current user's notes folder with
   * `one_on_one_id` + both-at-edit sharing. Throws if the 1:1 is missing or the
   * user is not a member.
   */
  addMeetingNote: async (params: {
    oneOnOneId: string;
    title: string;
    date: string;
  }): Promise<Note> => {
    return createOneOnOneNote(params.oneOnOneId, {
      title: params.title,
      note_kind: "meeting",
      entries: [{ title: params.title, date: params.date }],
    });
  },

  /**
   * Add a freeform SHARED NOTE to a 1:1 (`note_kind: "note"`), for anything that
   * is not a goal or a meeting note. Throws if the 1:1 is missing or the user is
   * not a member.
   */
  addSharedNote: async (params: {
    oneOnOneId: string;
    title: string;
    description?: string;
  }): Promise<Note> => {
    return createOneOnOneNote(params.oneOnOneId, {
      title: params.title,
      note_kind: "note",
      ...(params.description !== undefined
        ? { description: params.description }
        : {}),
    });
  },

  /**
   * Add an ACTION ITEM to a 1:1. Lands in the LAB HEAD's folder (the canonical
   * home for the dedicated store) with both-at-edit sharing, so either member
   * adds / toggles / deletes. Throws if the 1:1 is missing or the user is not a
   * member.
   */
  addActionItem: async (params: {
    oneOnOneId: string;
    text: string;
    /** Check-ins Phase 2 (D3): optional single assignee + due date. When BOTH
     *  are set the item materializes a real Task (D4). */
    assignee?: string | null;
    due_date?: string | null;
  }): Promise<OneOnOneActionItem> => {
    const oneOnOne = await findOneOnOne(params.oneOnOneId);
    if (!oneOnOne) {
      throw new Error(`1:1 ${params.oneOnOneId} not found`);
    }
    const author = await getCurrentUserCached();
    assertMember(oneOnOne, author);
    const assignee = params.assignee ?? null;
    if (assignee !== null) assertMember(oneOnOne, assignee);
    const now = new Date().toISOString();
    const data: Omit<OneOnOneActionItem, "id"> = {
      one_on_one_id: params.oneOnOneId,
      text: params.text,
      is_done: false,
      created_by: author,
      created_at: now,
      // Canonical home is the space owner's (creator's) folder.
      owner: oneOnOne.owner,
      shared_with: oneOnOneShareList(oneOnOne),
      assignee,
      due_date: params.due_date ?? null,
      synced_task_id: null,
    };
    const created = await oneOnOneActionItemsStore.create(data);
    // D4: materialize a synced Task when the item already has both fields.
    const { synced_task_id } = await reconcileSyncedTask(
      checkinTaskSyncOps,
      oneOnOne.owner,
      { synced_task_id: null, one_on_one_id: created.one_on_one_id, id: created.id },
      created,
    );
    if (synced_task_id !== (created.synced_task_id ?? null)) {
      return (
        (await oneOnOneActionItemsStore.updateForUser(
          created.id,
          { synced_task_id },
          oneOnOne.owner,
        )) ?? { ...created, synced_task_id }
      );
    }
    return created;
  },

  /**
   * Edit an action item's text / assignee / due_date, then reconcile its synced
   * Task (D4): create it the moment the item first has both an assignee and a
   * due date, update name/date/assignee while it has both, or detach + delete
   * the task when either field is cleared. Returns the updated item or null.
   */
  updateActionItem: async (
    id: string,
    patch: { text?: string; assignee?: string | null; due_date?: string | null },
    owner?: string,
  ): Promise<OneOnOneActionItem | null> => {
    const home = owner ?? (await resolveActionItemOwner(id));
    if (!home) return null;
    const existingRaw = await oneOnOneActionItemsStore.getForUser(id, home);
    if (!existingRaw) return null;
    const existing = normalizeOneOnOneActionItem(existingRaw);
    if (patch.assignee !== undefined && patch.assignee !== null) {
      const oneOnOne = await findOneOnOne(existing.one_on_one_id);
      if (oneOnOne) assertMember(oneOnOne, patch.assignee);
    }
    const next = normalizeOneOnOneActionItem({
      ...existing,
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
      ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
    });
    const { synced_task_id } = await reconcileSyncedTask(
      checkinTaskSyncOps,
      home,
      existing,
      next,
    );
    return oneOnOneActionItemsStore.updateForUser(
      id,
      {
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
        ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
        synced_task_id,
      },
      home,
    );
  },

  /**
   * Toggle (or set) an action item's done state. Action items live in the lab
   * head's folder; pass `owner` for explicitness (defaults to a discovery walk
   * via `findOneOnOne` of the item's parent). Returns null if not found.
   *
   * D4: completing the item ALSO completes its synced Task (and vice versa, via
   * the read-time reconcile in `getOneOnOneActionItems`).
   */
  toggleActionItem: async (
    id: string,
    owner?: string,
  ): Promise<OneOnOneActionItem | null> => {
    const labHead = owner ?? (await resolveActionItemOwner(id));
    if (!labHead) return null;
    const existing = await oneOnOneActionItemsStore.getForUser(id, labHead);
    if (!existing) return null;
    const updated = await oneOnOneActionItemsStore.updateForUser(
      id,
      { is_done: !existing.is_done },
      labHead,
    );
    if (updated) {
      await pushCompletionToTask(
        checkinTaskSyncOps,
        labHead,
        normalizeOneOnOneActionItem(updated),
      );
    }
    return updated;
  },

  /** Delete an action item from the lab head's folder. Pass `owner` for
   *  explicitness (defaults to a discovery walk). D4: also deletes the synced
   *  Task so a member's to-do never outlives the action item that spawned it. */
  deleteActionItem: async (id: string, owner?: string): Promise<boolean> => {
    const labHead = owner ?? (await resolveActionItemOwner(id));
    if (!labHead) return false;
    const existing = await oneOnOneActionItemsStore.getForUser(id, labHead);
    if (existing && typeof existing.synced_task_id === "number") {
      await checkinTaskSyncOps.deleteTask(labHead, existing.synced_task_id);
    }
    return oneOnOneActionItemsStore.deleteForUser(id, labHead);
  },
};

// ── Mentoring compact + onboarding checklist (Check-ins Phase 3b) ─────────────
//
// checkins-phase3b bot, 2026-06-12. See docs/proposals/checkins-revamp.md
// "Part 3, the academic layer". Both records hang off a check-in space, live in
// the SPACE OWNER's folder, and carry `shared_with` = every member at "edit", so
// every member reads, edits, and (for the compact) acknowledges. There is at
// most one compact and one onboarding checklist per space; the api looks them up
// by `space_id` over the owner's records.

/** Normalize a compact read off disk so callers never see undefined fields. */
function normalizeCompact(raw: CheckinCompact): CheckinCompact {
  return {
    ...raw,
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    acknowledged: Array.isArray(raw.acknowledged) ? raw.acknowledged : [],
    shared_with: Array.isArray(raw.shared_with) ? raw.shared_with : [],
  };
}

/** Find the single compact for a space (lives in the space owner's folder).
 *  Returns the normalized record or null. */
async function findCompactForSpace(
  spaceId: string,
): Promise<CheckinCompact | null> {
  const space = await findOneOnOne(spaceId);
  if (!space) return null;
  const all = await checkinCompactsStore.listAllForUser(space.owner);
  const match = all
    .filter((c) => c.space_id === spaceId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
  return match ? normalizeCompact({ ...match, owner: match.owner || space.owner }) : null;
}

export const checkinCompactsApi = {
  /** The space's compact, or null if none has been started yet. Any member may
   *  read it (they are in `shared_with`). */
  getForSpace: async (spaceId: string): Promise<CheckinCompact | null> => {
    return findCompactForSpace(spaceId);
  },

  /**
   * Start the space's compact, seeding the standard AAMC-style topic rows with
   * empty values. Idempotent: if one already exists it is returned unchanged
   * (so two members opening the tab at once do not create two). Lives in the
   * space owner's folder; `shared_with` = every member at "edit".
   */
  createForSpace: async (spaceId: string): Promise<CheckinCompact> => {
    const existing = await findCompactForSpace(spaceId);
    if (existing) return existing;
    const space = await findOneOnOne(spaceId);
    if (!space) throw new Error(`check-in space ${spaceId} not found`);
    const author = await getCurrentUserCached();
    assertMember(space, author);
    const now = new Date().toISOString();
    const rows: CheckinCompactRow[] = COMPACT_SEED_LABELS.map((label) => ({
      id: crypto.randomUUID(),
      label,
      value: "",
    }));
    return checkinCompactsStore.create({
      space_id: spaceId,
      owner: space.owner,
      rows,
      acknowledged: [],
      shared_with: oneOnOneShareList(space),
      created_at: now,
      updated_at: now,
    });
  },

  /**
   * Replace the compact's rows (the UI manages add/edit client-side then
   * persists the whole list). Editing the agreement CLEARS every prior
   * acknowledgement, since the thing they agreed to has changed, so both must
   * re-acknowledge the revision. Returns the updated record or null.
   */
  updateRows: async (
    id: string,
    rows: CheckinCompactRow[],
    owner: string,
  ): Promise<CheckinCompact | null> => {
    const updated = await checkinCompactsStore.updateForUser(
      id,
      { rows, acknowledged: [], updated_at: new Date().toISOString() },
      owner,
    );
    return updated ? normalizeCompact(updated) : null;
  },

  /**
   * Record the current user's acknowledgement. Idempotent: a member already in
   * `acknowledged` is left as-is (no duplicate entry, the original timestamp
   * stands). Returns the updated record or null.
   */
  acknowledge: async (
    id: string,
    owner: string,
  ): Promise<CheckinCompact | null> => {
    const existing = await checkinCompactsStore.getForUser(id, owner);
    if (!existing) return null;
    const actor = await getCurrentUserCached();
    const acks = Array.isArray(existing.acknowledged)
      ? existing.acknowledged
      : [];
    if (acks.some((a) => a.username === actor)) {
      return normalizeCompact(existing);
    }
    const updated = await checkinCompactsStore.updateForUser(
      id,
      {
        acknowledged: [...acks, { username: actor, at: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
      },
      owner,
    );
    return updated ? normalizeCompact(updated) : null;
  },
};

/** Normalize an onboarding checklist read off disk. */
function normalizeOnboarding(raw: CheckinOnboarding): CheckinOnboarding {
  return {
    ...raw,
    items: Array.isArray(raw.items)
      ? raw.items.map((i) => ({
          ...i,
          done: Boolean(i.done),
          done_by: i.done_by ?? null,
          done_at: i.done_at ?? null,
        }))
      : [],
    shared_with: Array.isArray(raw.shared_with) ? raw.shared_with : [],
  };
}

/** Find the single onboarding checklist for a space. */
async function findOnboardingForSpace(
  spaceId: string,
): Promise<CheckinOnboarding | null> {
  const space = await findOneOnOne(spaceId);
  if (!space) return null;
  const all = await checkinOnboardingStore.listAllForUser(space.owner);
  const match = all
    .filter((o) => o.space_id === spaceId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
  return match
    ? normalizeOnboarding({ ...match, owner: match.owner || space.owner })
    : null;
}

export const checkinOnboardingApi = {
  /** The space's onboarding checklist, or null if none has been started. */
  getForSpace: async (spaceId: string): Promise<CheckinOnboarding | null> => {
    return findOnboardingForSpace(spaceId);
  },

  /**
   * Start the space's onboarding checklist, seeding the standard items (access
   * and keys, safety training, data-management, the lab norms doc, set the
   * cadence). Idempotent: returns the existing checklist if one is already
   * there. Lives in the space owner's folder; every member at "edit".
   */
  createForSpace: async (spaceId: string): Promise<CheckinOnboarding> => {
    const existing = await findOnboardingForSpace(spaceId);
    if (existing) return existing;
    const space = await findOneOnOne(spaceId);
    if (!space) throw new Error(`check-in space ${spaceId} not found`);
    const author = await getCurrentUserCached();
    assertMember(space, author);
    const now = new Date().toISOString();
    const items: CheckinOnboardingItem[] = ONBOARDING_SEED_LABELS.map(
      (label) => ({
        id: crypto.randomUUID(),
        label,
        done: false,
        done_by: null,
        done_at: null,
      }),
    );
    return checkinOnboardingStore.create({
      space_id: spaceId,
      owner: space.owner,
      items,
      shared_with: oneOnOneShareList(space),
      created_at: now,
      updated_at: now,
    });
  },

  /**
   * Toggle one checklist item's done state (any member may, the permissive D2
   * model). Sets / clears `done_by` + `done_at` to the actor + now. Returns the
   * updated record or null.
   */
  toggleItem: async (
    id: string,
    itemId: string,
    owner: string,
  ): Promise<CheckinOnboarding | null> => {
    const existing = await checkinOnboardingStore.getForUser(id, owner);
    if (!existing) return null;
    const actor = await getCurrentUserCached();
    const now = new Date().toISOString();
    const items = (Array.isArray(existing.items) ? existing.items : []).map(
      (item) => {
        if (item.id !== itemId) return item;
        const nextDone = !item.done;
        return {
          ...item,
          done: nextDone,
          done_by: nextDone ? actor : null,
          done_at: nextDone ? now : null,
        };
      },
    );
    const updated = await checkinOnboardingStore.updateForUser(
      id,
      { items, updated_at: now },
      owner,
    );
    return updated ? normalizeOnboarding(updated) : null;
  },
};

// ── Check-ins Phase 4: presenter / journal-club rotation ─────────────────────
//
// checkins-phase4 bot, 2026-06-12. A GROUP space can carry an auto-rotating
// schedule of who presents data and who leads journal club. One rotation per
// space, lives in the space owner's folder, every member at "edit". Seeded with
// two tracks ("Data presentation" and "Journal club"), each ordered by the space
// members with `current_index` 0.

/** The two seed track names for a fresh rotation, in display order. */
const ROTATION_SEED_TRACK_NAMES = ["Data presentation", "Journal club"];

/** Normalize a rotation read off disk so callers never branch on a missing
 *  array or an out-of-range `current_index`. */
function normalizeRotation(raw: CheckinRotation): CheckinRotation {
  const tracks: CheckinRotationTrack[] = (
    Array.isArray(raw.tracks) ? raw.tracks : []
  ).map((t) => {
    const order = Array.isArray(t.order) ? t.order : [];
    const idx = order.length > 0 ? ((t.current_index ?? 0) % order.length + order.length) % order.length : 0;
    return { ...t, order, current_index: idx };
  });
  return {
    ...raw,
    tracks,
    shared_with: Array.isArray(raw.shared_with) ? raw.shared_with : [],
  };
}

/** Find the single rotation for a space (lives in the space owner's folder). */
async function findRotationForSpace(
  spaceId: string,
): Promise<CheckinRotation | null> {
  const space = await findOneOnOne(spaceId);
  if (!space) return null;
  const all = await checkinRotationsStore.listAllForUser(space.owner);
  const match = all
    .filter((r) => r.space_id === spaceId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
  return match
    ? normalizeRotation({ ...match, owner: match.owner || space.owner })
    : null;
}

export const checkinRotationsApi = {
  /** The space's rotation, or null if none has been started. Any member may
   *  read it (they are in `shared_with`). */
  getForSpace: async (spaceId: string): Promise<CheckinRotation | null> => {
    return findRotationForSpace(spaceId);
  },

  /**
   * Start the space's rotation, seeding two tracks ("Data presentation" and
   * "Journal club") whose `order` is the space members and `current_index` 0.
   * Idempotent: if one already exists it is returned unchanged. Lives in the
   * space owner's folder; `shared_with` = every member at "edit". The space must
   * be a GROUP space (3+ members); a pair has no rotation.
   */
  createForSpace: async (spaceId: string): Promise<CheckinRotation> => {
    const existing = await findRotationForSpace(spaceId);
    if (existing) return existing;
    const space = await findOneOnOne(spaceId);
    if (!space) throw new Error(`check-in space ${spaceId} not found`);
    const norm = normalizeOneOnOne(space);
    if (norm.kind !== "group") {
      throw new Error("a rotation only exists on a group check-in space");
    }
    const author = await getCurrentUserCached();
    assertMember(space, author);
    const now = new Date().toISOString();
    const tracks: CheckinRotationTrack[] = ROTATION_SEED_TRACK_NAMES.map(
      (name) => ({
        id: crypto.randomUUID(),
        name,
        order: [...norm.members],
        current_index: 0,
      }),
    );
    return checkinRotationsStore.create({
      space_id: spaceId,
      owner: space.owner,
      tracks,
      shared_with: oneOnOneShareList(space),
      created_at: now,
      updated_at: now,
    });
  },

  /**
   * Advance one track to the next presenter, wrapping modulo `order.length`.
   * A no-op (returns the record unchanged) for an empty order. Returns the
   * updated record or null.
   */
  advance: async (
    id: string,
    trackId: string,
    owner: string,
  ): Promise<CheckinRotation | null> => {
    const existing = await checkinRotationsStore.getForUser(id, owner);
    if (!existing) return null;
    const tracks = (Array.isArray(existing.tracks) ? existing.tracks : []).map(
      (t) => {
        if (t.id !== trackId) return t;
        const len = t.order.length;
        if (len === 0) return t;
        return { ...t, current_index: (t.current_index + 1) % len };
      },
    );
    const updated = await checkinRotationsStore.updateForUser(
      id,
      { tracks, updated_at: new Date().toISOString() },
      owner,
    );
    return updated ? normalizeRotation(updated) : null;
  },

  /**
   * Replace one track's rotation order (the reorder / skip affordance). The
   * caller hands the whole new order; `current_index` is clamped to a valid
   * index for the new length. Returns the updated record or null.
   */
  setOrder: async (
    id: string,
    trackId: string,
    order: string[],
    owner: string,
  ): Promise<CheckinRotation | null> => {
    const existing = await checkinRotationsStore.getForUser(id, owner);
    if (!existing) return null;
    const tracks = (Array.isArray(existing.tracks) ? existing.tracks : []).map(
      (t) => {
        if (t.id !== trackId) return t;
        const len = order.length;
        const idx = len > 0 ? Math.min(t.current_index, len - 1) : 0;
        return { ...t, order, current_index: idx };
      },
    );
    const updated = await checkinRotationsStore.updateForUser(
      id,
      { tracks, updated_at: new Date().toISOString() },
      owner,
    );
    return updated ? normalizeRotation(updated) : null;
  },
};

// ── Individual Development Plan (Check-ins Phase 3) ───────────────────────────
//
// checkins-phase3 bot, 2026-06-12. See docs/proposals/checkins-revamp.md "IDP
// structure". An IDP is owned by the TRAINEE and lives in their folder. The
// trainee edits; the mentor reviews (comment + sign-off) gated to the sections
// the trainee shared, via `normalizeIdpForViewer`. The lab head gets a STATUS
// LINE only (`getStatusForMember`), never contents.

/** The owner-scoped task ops backing the IDP action-row -> Task sync (D4-style,
 *  but trainee-owned, so every write lands in the trainee's namespace). The task
 *  shape mirrors the check-in synced task: standalone Lists task, project_id 0,
 *  duration 1, `source` back-linking to the IDP row. */
const idpTaskSyncOps: IdpTaskSyncOps = {
  createTask: async (owner: string, draft: IdpSyncedTaskDraft): Promise<Task> => {
    const durationDays = 1;
    const record: Omit<Task, "id"> = {
      project_id: 0, // STANDALONE — the proven falsy-project path in WorkbenchListsPanel.
      name: draft.name,
      start_date: draft.start_date,
      duration_days: durationDays,
      end_date: canonicalEndDate({
        start_date: draft.start_date,
        duration_days: durationDays,
      }),
      is_high_level: false,
      is_complete: draft.is_complete,
      task_type: "list",
      weekend_override: null,
      method_ids: [],
      deviation_log: null,
      tags: null,
      sort_order: 0,
      experiment_color: null,
      sub_tasks: null,
      method_attachments: [],
      comments: [],
      owner,
      shared_with: draft.shared_with,
      assignee: null,
      source: draft.source,
    };
    return tasksStore.createForUser(record, owner);
  },
  updateTask: async (
    owner: string,
    id: number,
    patch: Partial<Task>,
  ): Promise<Task | null> => {
    const next: Partial<Task> = { ...patch };
    if (patch.start_date !== undefined || patch.duration_days !== undefined) {
      const existing = await tasksStore.getForUser(id, owner);
      if (existing) {
        next.end_date = canonicalEndDate({
          start_date: patch.start_date ?? existing.start_date,
          duration_days: patch.duration_days ?? existing.duration_days,
        });
      }
    }
    return tasksStore.updateForUser(id, next, owner);
  },
  deleteTask: async (owner: string, id: number): Promise<void> => {
    await tasksStore.deleteForUser(id, owner);
  },
  getTask: async (owner: string, id: number): Promise<Task | null> => {
    return tasksStore.getForUser(id, owner);
  },
};

/** Seed an empty ratings map: every competency skill keyed with a null self +
 *  null importance, so the form renders every row unrated. */
function seedIdpRatings(): IDP["self_assessment"]["ratings"] {
  const ratings: IDP["self_assessment"]["ratings"] = {};
  for (const id of allSkillIds()) ratings[id] = { self: null, importance: null };
  return ratings;
}

/** YYYY-MM-DD one year from now (the default annual revisit date). */
function oneYearFromNowDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** Resolve an IDP by id across the lab (it lives in the trainee's folder). */
async function findIdp(id: string): Promise<IDP | null> {
  const usernames = await discoverUsers();
  for (const username of usernames) {
    const rec = await idpsStore.getForUser(id, username);
    if (rec) return { ...rec, owner: rec.owner || username };
  }
  return null;
}

/** Reconcile every dated, synced action row's status from its task (the trainee
 *  may have checked the to-do off in Lists), writing the IDP back if anything
 *  changed. Returns the reconciled IDP. Owner-only path (the trainee owns the
 *  tasks). */
async function reconcileIdpActionStatuses(idp: IDP): Promise<IDP> {
  let changed = false;
  const rows = await Promise.all(
    idp.action_plan.map(async (row) => {
      const { status, changed: rowChanged } = await reconcileRowStatusFromTask(
        idpTaskSyncOps,
        idp.owner,
        row,
      );
      if (rowChanged) {
        changed = true;
        return { ...row, status };
      }
      return row;
    }),
  );
  if (!changed) return idp;
  const updated = { ...idp, action_plan: rows };
  await idpsStore.writeForUser(updated, idp.owner);
  return updated;
}

export const idpsApi = {
  /**
   * The member's current IDP, or null. Returns the most-recently-updated record
   * if several exist in their folder. For the OWNER (current user === member)
   * the full record is returned (with action-row statuses reconciled from their
   * tasks). For a NON-owner (a mentor) the record passes through
   * `normalizeIdpForViewer`, which blanks unshared sections and always strips
   * the values reflection, and returns null if the viewer cannot read it.
   */
  getForMember: async (username: string): Promise<IDP | null> => {
    const all = await idpsStore.listAllForUser(username);
    if (all.length === 0) return null;
    all.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    const idp = { ...all[0], owner: all[0].owner || username };
    const viewer = await buildCurrentViewer();
    if (idp.owner === viewer.username) {
      // Owner: reconcile action-row completion from their tasks, return full.
      return reconcileIdpActionStatuses(idp);
    }
    return normalizeIdpForViewer(idp, viewer);
  },

  /**
   * Status-only compliance read for the lab head / PI view. Returns whether an
   * IDP exists for the member and when it was last updated. NEVER returns
   * contents (NSF compliance: the PI sees only that a plan exists).
   */
  getStatusForMember: async (
    username: string,
  ): Promise<{ exists: boolean; updated_at: string | null }> => {
    const all = await idpsStore.listAllForUser(username);
    if (all.length === 0) return { exists: false, updated_at: null };
    all.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return { exists: true, updated_at: all[0].updated_at };
  },

  /**
   * Create the current user's IDP. They are the owner (the trainee). Seeds an
   * empty ratings map (every competency skill, unrated), empty sections, an
   * annual revisit date, and no shared sections. `mentor` (optional) is recorded
   * and added to `shared_with` so the review surface can load it; per-section
   * sharing still gates the contents.
   */
  create: async (params: {
    career_stage: CareerStage;
    mentor?: string | null;
  }): Promise<IDP> => {
    const owner = await getCurrentUserCached();
    const now = new Date().toISOString();
    const mentor = params.mentor ?? null;
    const data: Omit<IDP, "id"> = {
      owner,
      career_stage: params.career_stage,
      self_assessment: { ratings: seedIdpRatings(), responsibilities: "" },
      career_exploration: { aspirations: "", target_path: "" },
      goals: [],
      action_plan: [],
      mentor_review: {
        comment: "",
        reviewed_by: null,
        reviewed_at: null,
        revisit_date: oneYearFromNowDate(),
      },
      values_reflection: null,
      shared_sections: {
        self_assessment: false,
        career_exploration: false,
        goals: false,
        action_plan: false,
      },
      mentor,
      // A mentor is added at "view" so the review surface can read the IDP;
      // per-section sharing still blanks the contents until the trainee shares.
      shared_with: mentor ? [{ username: mentor, level: "read" }] : [],
      created_at: now,
      updated_at: now,
      last_edited_by: owner,
    };
    return idpsStore.create(data);
  },

  /**
   * Patch an IDP. Stamps `updated_at` + `last_edited_by`. The caller (the
   * owner, or the mentor on a review/sign-off) routes through here so the stamps
   * stay consistent. Writes to the IDP's owner folder.
   */
  update: async (id: string, patch: Partial<IDP>): Promise<IDP | null> => {
    const existing = await findIdp(id);
    if (!existing) return null;
    const actor = (await getCurrentUserCached()) ?? existing.owner;
    return idpsStore.updateForUser(
      id,
      { ...patch, updated_at: new Date().toISOString(), last_edited_by: actor },
      existing.owner,
    );
  },

  /** Set the career stage (drives the preset filter). Owner-only edit. */
  setCareerStage: async (
    id: string,
    career_stage: CareerStage,
  ): Promise<IDP | null> => {
    return idpsApi.update(id, { career_stage });
  },

  /** Set a single competency skill's dual rating (self and/or importance). */
  setRating: async (
    id: string,
    skillId: string,
    rating: { self: number | null; importance: number | null },
  ): Promise<IDP | null> => {
    const existing = await findIdp(id);
    if (!existing) return null;
    const ratings = {
      ...existing.self_assessment.ratings,
      [skillId]: rating,
    };
    return idpsApi.update(id, {
      self_assessment: { ...existing.self_assessment, ratings },
    });
  },

  /** Set the self-assessment responsibilities free-text box. */
  setResponsibilities: async (
    id: string,
    responsibilities: string,
  ): Promise<IDP | null> => {
    const existing = await findIdp(id);
    if (!existing) return null;
    return idpsApi.update(id, {
      self_assessment: { ...existing.self_assessment, responsibilities },
    });
  },

  /** Set the career-exploration aspirations + target-path fields. */
  setCareerExploration: async (
    id: string,
    career_exploration: { aspirations: string; target_path: string },
  ): Promise<IDP | null> => {
    return idpsApi.update(id, { career_exploration });
  },

  /** Replace the goals list (the form manages add/edit/remove client-side then
   *  persists the whole list). */
  setGoals: async (id: string, goals: IdpGoal[]): Promise<IDP | null> => {
    return idpsApi.update(id, { goals });
  },

  /** Set a per-section share toggle. When ANY section is shared the mentor stays
   *  in `shared_with` (added at create); turning everything off leaves the
   *  share row in place but blanks every section on the mentor's read. */
  setSectionShared: async (
    id: string,
    section: IdpSectionKey,
    shared: boolean,
  ): Promise<IDP | null> => {
    const existing = await findIdp(id);
    if (!existing) return null;
    const shared_sections = { ...existing.shared_sections, [section]: shared };
    // Keep shared_with consistent: a mentor present => at least a read row so
    // the review surface can load the (section-filtered) record.
    let shared_with = existing.shared_with;
    if (existing.mentor) {
      const hasRow = shared_with.some((s) => s.username === existing.mentor);
      if (!hasRow) {
        shared_with = [
          ...shared_with,
          { username: existing.mentor, level: "read" },
        ];
      }
    }
    return idpsApi.update(id, { shared_sections, shared_with });
  },

  /** Set the optional, ALWAYS-private values reflection. Owner-only; never
   *  shared. Pass null to clear it. */
  setValuesReflection: async (
    id: string,
    values_reflection: { note: string } | null,
  ): Promise<IDP | null> => {
    return idpsApi.update(id, { values_reflection });
  },

  /** The mentor's review: comment + sign-off. Sets `reviewed_by` /
   *  `reviewed_at` to the current user + now, and optionally a new revisit
   *  date. The mentor is in `shared_with`, so `canWrite`-style routing is the
   *  IDP owner's folder (the mentor writes a comment into the trainee's record,
   *  exactly like a PI comment). */
  submitReview: async (
    id: string,
    params: { comment: string; revisit_date?: string | null },
  ): Promise<IDP | null> => {
    const existing = await findIdp(id);
    if (!existing) return null;
    const reviewer = (await getCurrentUserCached()) ?? "";
    const mentor_review: IDP["mentor_review"] = {
      comment: params.comment,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      revisit_date:
        params.revisit_date ?? existing.mentor_review.revisit_date,
    };
    return idpsApi.update(id, { mentor_review });
  },

  // ── Action-plan rows + the D4-style task sync ──────────────────────────────

  /** Append a blank action-plan row. */
  addActionRow: async (id: string): Promise<IDP | null> => {
    const existing = await findIdp(id);
    if (!existing) return null;
    const row: IdpActionRow = {
      id: crypto.randomUUID(),
      objective: "",
      approach: "",
      target_date: null,
      outcome: "",
      status: "not_started",
      synced_task_id: null,
    };
    return idpsApi.update(id, { action_plan: [...existing.action_plan, row] });
  },

  /**
   * Update an action-plan row's editable fields. Reconciles its synced task
   * (renames / re-dates / completes, or detaches + deletes the task when the
   * date is cleared). Owner-only (the trainee owns both the IDP and the task).
   */
  updateActionRow: async (
    id: string,
    rowId: string,
    patch: Partial<
      Pick<
        IdpActionRow,
        "objective" | "approach" | "target_date" | "outcome" | "status"
      >
    >,
  ): Promise<IDP | null> => {
    const existing = await findIdp(id);
    if (!existing) return null;
    const idx = existing.action_plan.findIndex((r) => r.id === rowId);
    if (idx === -1) return existing;
    const next: IdpActionRow = { ...existing.action_plan[idx], ...patch };
    const { synced_task_id } = await reconcileRowTask(
      idpTaskSyncOps,
      existing.owner,
      next,
    );
    next.synced_task_id = synced_task_id;
    const action_plan = [...existing.action_plan];
    action_plan[idx] = next;
    return idpsApi.update(id, { action_plan });
  },

  /**
   * The "Add to tasks" affordance: materialize a real standalone Lists task for
   * a DATED row, in the trainee's namespace. Stamps `synced_task_id` back.
   */
  addActionRowToTasks: async (
    id: string,
    rowId: string,
  ): Promise<IDP | null> => {
    const existing = await findIdp(id);
    if (!existing) return null;
    const idx = existing.action_plan.findIndex((r) => r.id === rowId);
    if (idx === -1) return existing;
    const row = existing.action_plan[idx];
    const { synced_task_id } = await addRowToTasks(
      idpTaskSyncOps,
      existing.owner,
      existing.id,
      row,
    );
    const action_plan = [...existing.action_plan];
    action_plan[idx] = { ...row, synced_task_id };
    return idpsApi.update(id, { action_plan });
  },

  /** Delete an action-plan row, deleting its synced task too. */
  deleteActionRow: async (id: string, rowId: string): Promise<IDP | null> => {
    const existing = await findIdp(id);
    if (!existing) return null;
    const row = existing.action_plan.find((r) => r.id === rowId);
    if (row) await deleteRowTask(idpTaskSyncOps, existing.owner, row);
    const action_plan = existing.action_plan.filter((r) => r.id !== rowId);
    return idpsApi.update(id, { action_plan });
  },

  /** Delete the whole IDP (owner-only), sweeping any synced tasks first. */
  delete: async (id: string): Promise<boolean> => {
    const existing = await findIdp(id);
    if (!existing) return false;
    const actor = await getCurrentUserCached();
    if (existing.owner !== actor) {
      throw new Error("Only the trainee can delete their IDP.");
    }
    for (const row of existing.action_plan) {
      await deleteRowTask(idpTaskSyncOps, existing.owner, row);
    }
    return idpsStore.deleteForUser(id, existing.owner);
  },
};

/**
 * Shared create path for a 1:1 note (meeting note OR freeform shared note). The
 * note lands in the current user's notes folder, stamped with `one_on_one_id`,
 * `note_kind`, and `shared_with` = both members at "edit". Throws if the 1:1 is
 * missing or the current user is not a member.
 */
async function createOneOnOneNote(
  oneOnOneId: string,
  opts: {
    title: string;
    note_kind: "meeting" | "note";
    description?: string;
    entries?: Array<{ title: string; date: string; content?: string }>;
  },
): Promise<Note> {
  const oneOnOne = await findOneOnOne(oneOnOneId);
  if (!oneOnOne) {
    throw new Error(`1:1 ${oneOnOneId} not found`);
  }
  const author = (await getCurrentUserCached()) ?? "";
  assertMember(oneOnOne, author);
  const now = new Date().toISOString();
  const entries: NoteEntry[] = (opts.entries ?? []).map((e) => ({
    id: crypto.randomUUID(),
    title: e.title,
    date: e.date,
    content: e.content ?? "",
    created_at: now,
    updated_at: now,
  }));
  return notesStore.create({
    title: opts.title,
    description: opts.description ?? "",
    is_running_log: false,
    is_shared: true,
    entries,
    comments: [],
    created_at: now,
    updated_at: now,
    username: author,
    one_on_one_id: oneOnOneId,
    note_kind: opts.note_kind,
    shared_with: oneOnOneShareList(oneOnOne),
    // Phase 6a portable identity: mint once at create time.
    source_uuid: (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  });
}

/** Resolve the lab-head owner folder for an action item id by walking the lab.
 *  Action items live only in the lab head's folder, so the first hit is it. */
async function resolveActionItemOwner(id: string): Promise<string | null> {
  const usernames = await discoverUsers();
  for (const username of usernames) {
    const rec = await oneOnOneActionItemsStore.getForUser(id, username);
    if (rec) return rec.owner || username;
  }
  return null;
}

export const attachmentsApi = {
  /**
   * Search the data folder for image files whose name contains the given
   * substring. Walks the actual filesystem so it finds files in every place
   * an image might live — canonical task/method dirs, the legacy per-user
   * tree, and any `users_backup_*` snapshot. Results are ranked so canonical
   * destinations surface first, which is what users almost always want.
   *
   * Used by the broken-image popup in LiveMarkdownEditor when a markdown
   * image reference can't be resolved.
   */
  searchImageByFilename: async (filename: string) => {
    const needle = (filename.split("/").pop() ?? filename).toLowerCase();
    if (!needle) return { search_term: filename, matches: [], count: 0 };

    type Hit = { path: string; filename: string; match_type: string; rank: number };
    const hits: Hit[] = [];

    const scanDir = async (dirPath: string, rank: number): Promise<void> => {
      let names: string[] = [];
      try {
        names = await fileService.listFiles(dirPath);
      } catch {
        return;
      }
      for (const name of names) {
        if (name.startsWith(".") || name === "_metadata.json") continue;
        if (!name.toLowerCase().includes(needle)) continue;
        hits.push({
          path: `${dirPath}/${name}`,
          filename: name,
          match_type: name.toLowerCase() === needle ? "exact" : "filename",
          rank,
        });
      }
    };

    // Recurse, capped, since legacy `users/{user}/Images/` and the backup
    // snapshots can have arbitrary date-named subfolders.
    const scanRecursive = async (dirPath: string, rank: number, depthRemaining = 5): Promise<void> => {
      if (depthRemaining < 0) return;
      await scanDir(dirPath, rank);
      let subdirs: string[] = [];
      try {
        subdirs = await fileService.listDirectories(dirPath);
      } catch {
        return;
      }
      for (const sub of subdirs) {
        await scanRecursive(`${dirPath}/${sub}`, rank, depthRemaining - 1);
      }
    };

    try {
      const tasks = await fileService.listDirectories("results");
      for (const t of tasks) await scanDir(`results/${t}/Images`, 0);
    } catch { /* results/ may not exist yet */ }

    try {
      const methods = await fileService.listDirectories("methods");
      for (const m of methods) await scanDir(`methods/${m}/Images`, 0);
    } catch { /* methods/ may not exist yet */ }

    try {
      const users = await fileService.listDirectories("users");
      for (const u of users) await scanRecursive(`users/${u}/Images`, 1);
    } catch { /* users/ may not exist */ }

    try {
      const rootDirs = await fileService.listDirectories("");
      for (const r of rootDirs) {
        if (!r.startsWith("users_backup_")) continue;
        let backupUsers: string[] = [];
        try {
          backupUsers = await fileService.listDirectories(r);
        } catch { continue; }
        for (const u of backupUsers) await scanRecursive(`${r}/${u}/Images`, 2);
      }
    } catch { /* root listing may fail in some environments */ }

    const seen = new Set<string>();
    const unique = hits.filter((h) => {
      if (seen.has(h.path)) return false;
      seen.add(h.path);
      return true;
    });
    unique.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.match_type !== b.match_type) return a.match_type === "exact" ? -1 : 1;
      return a.filename.localeCompare(b.filename);
    });
    const top = unique.slice(0, 20);

    return {
      search_term: filename,
      matches: top.map(({ path, filename: fn, match_type }) => ({ path, filename: fn, match_type })),
      count: top.length,
    };
  },
};

// ── Sharing helpers ──────────────────────────────────────────────────────────

type ItemType = "task" | "method" | "project";

interface SharedManifest {
  version: number;
  projects: SharedItemEntry[];
  tasks: SharedItemEntry[];
  methods: SharedItemEntry[];
}

interface NotificationFile {
  version: number;
  notifications: Notification[];
}

const PERMISSION_DEFAULT = "edit";

async function readSharedWithMe(username: string): Promise<SharedManifest> {
  const path = `users/${username}/_shared_with_me.json`;
  const data = await fileService.readJson<Partial<SharedManifest>>(path);
  return {
    version: data?.version ?? 1,
    projects: data?.projects ?? [],
    tasks: data?.tasks ?? [],
    methods: data?.methods ?? [],
  };
}

async function writeSharedWithMe(username: string, data: SharedManifest): Promise<void> {
  await fileService.writeJson(`users/${username}/_shared_with_me.json`, data);
}

// ── Shift-alert sidecars ────────────────────────────────────────────────────
//
// Cross-user shift propagation is "notify-on-receive" (Option C). When alex
// shifts a task that's been shared with morgan, the cascade STAYS in alex's
// namespace (the ownership invariant we don't want to break); morgan instead
// learns at her next load that the task moved and can decide whether to
// realign her own dependents.
//
// Two sidecars cooperate to keep that loop local-first and cycle-safe:
//   - `users/<owner>/_shifted-alerts.json` is append-only on the writer
//     (owner) side. Every `tasksApi.move` that mutates a task with
//     `shared_with.length > 0` appends one entry.
//   - `users/<receiver>/_seen-shift-alerts.json` is the receiver's
//     dedup ledger — UUIDs of alerts she has already acted on or dismissed.
//
// The receiver-side scan (`sharingApi.scanShiftAlerts`) reads each owner's
// alert sidecar based on the receiver's `_shared_with_me.json`, filters out
// already-seen IDs, and synthesizes `ShiftAlertNotification` entries into
// the receiver's own `_notifications.json`. The receiver never writes back
// to the owner's sidecar; nothing the owner writes is mutated cross-user.
//
// See AGENTS.md §6 "Cross-user dependency cascade is namespace-bounded" for
// why the cascade itself remains intra-namespace and this sidecar exists.

const SHIFTED_ALERTS_FILENAME = "_shifted-alerts.json";
const SEEN_SHIFT_ALERTS_FILENAME = "_seen-shift-alerts.json";

async function readShiftedAlerts(owner: string): Promise<ShiftedAlertsFile> {
  const path = `users/${owner}/${SHIFTED_ALERTS_FILENAME}`;
  const data = await fileService.readJson<Partial<ShiftedAlertsFile>>(path);
  return {
    version: 1,
    alerts: data?.alerts ?? [],
  };
}

async function writeShiftedAlerts(owner: string, data: ShiftedAlertsFile): Promise<void> {
  await fileService.writeJson(`users/${owner}/${SHIFTED_ALERTS_FILENAME}`, data);
}

async function readSeenShiftAlerts(username: string): Promise<SeenShiftAlertsFile> {
  const path = `users/${username}/${SEEN_SHIFT_ALERTS_FILENAME}`;
  const data = await fileService.readJson<Partial<SeenShiftAlertsFile>>(path);
  return {
    version: 1,
    seen_ids: data?.seen_ids ?? [],
  };
}

async function writeSeenShiftAlerts(username: string, data: SeenShiftAlertsFile): Promise<void> {
  await fileService.writeJson(`users/${username}/${SEEN_SHIFT_ALERTS_FILENAME}`, data);
}

function newAlertId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  // Both inputs are YYYY-MM-DD; treat as local-noon to avoid TZ drift in the
  // delta computation. Returns whole-day delta (toIso - fromIso).
  const from = new Date(`${fromIso}T12:00:00`);
  const to = new Date(`${toIso}T12:00:00`);
  const diffMs = to.getTime() - from.getTime();
  return Math.round(diffMs / 86400000);
}

/**
 * Append `_shifted-alerts.json` entries for every affected task that has
 * recipients in `shared_with`. Called from `tasksApi.move` after `shiftTask`
 * returns. Silent on no-op (zero shared affected tasks); never throws —
 * sidecar failure must not break the shift itself.
 *
 * `namespaceOwner` is whose directory we write into:
 *   - `undefined` → current user's namespace (owner is shifting their own task)
 *   - `<username>` → that user's namespace (receiver shifting a shared task
 *     via edit permission; the cascade ran in `<username>`'s data and the
 *     alerts belong to that namespace too)
 *
 * Note: this writes ONE sidecar update per shift call, regardless of how
 * many tasks in the cascade are shared. The append-only file grows by
 * `affected_tasks_with_shares` entries per shift. Pruning is receiver-side
 * via `_seen-shift-alerts.json`; owners may occasionally compact stale
 * entries but it isn't required for correctness.
 */
/**
 * Owner-side retention window for `_shifted-alerts.json` entries. Anything
 * older than this gets pruned on the next `recordShiftAlerts` call ("lazy
 * normalize on write"). 30 days matches the typical task-scheduling window
 * — receivers who haven't loaded the app in over a month will miss those
 * alerts, which is the right trade-off: the sidecar must stay bounded for
 * long-lived owners with many shared tasks, and the receiver-side dedup
 * ledger (`_seen-shift-alerts.json`) is keyed by UUIDs and doesn't need
 * matching pruning.
 *
 * Behavior on the FIRST `recordShiftAlerts` call after a long absence:
 * pruning is unconditional — the cutoff is computed from `Date.now()`
 * at call time, so entries with `shifted_at` older than 30 days from now
 * are dropped regardless of how long it's been since the last write. The
 * file shrinks immediately on that first write.
 */
const SHIFTED_ALERTS_RETENTION_DAYS = 30;
const SHIFTED_ALERTS_RETENTION_MS = SHIFTED_ALERTS_RETENTION_DAYS * 86400 * 1000;

async function recordShiftAlerts(
  shiftResult: ShiftResult,
  namespaceOwner: string | undefined
): Promise<void> {
  try {
    if (shiftResult.affected_tasks.length === 0) return;

    const owner = namespaceOwner ?? (await getCurrentUserCached());
    if (!owner) return;
    const shiftedByUser = await getCurrentUserCached();

    const entries: ShiftedAlertEntry[] = [];
    const shiftedAtIso = new Date().toISOString();
    // Phone push P3a: the users this shift actually alerts (everyone a shifted
    // task is shared with). Collected here so an offline recipient can be buzzed
    // about it; the shifter is online now and drives the relay (sender-triggered,
    // same path as P2). Excludes the shifter themselves below.
    const recipientUsernames = new Set<string>();

    for (const affected of shiftResult.affected_tasks) {
      const onDisk = await tasksStore.getForUser(affected.task_id, owner);
      if (!onDisk) continue;
      if (!onDisk.shared_with || onDisk.shared_with.length === 0) continue;
      if (affected.old_start === affected.new_start && affected.old_end === affected.new_end) {
        // No-op dates (e.g. a shift that resolved to the same weekday after
        // weekend-skip). Don't surface as an alert.
        continue;
      }
      for (const u of onDisk.shared_with) recipientUsernames.add(u.username);
      entries.push({
        id: newAlertId(),
        task_id: affected.task_id,
        task_key: `${owner}:${affected.task_id}`,
        task_name: affected.name,
        start_delta_days: daysBetween(affected.old_start, affected.new_start),
        end_delta_days: daysBetween(affected.old_end, affected.new_end),
        old_start: affected.old_start,
        old_end: affected.old_end,
        new_start: affected.new_start,
        new_end: affected.new_end,
        shifted_at: shiftedAtIso,
        shifted_by_user: shiftedByUser ?? owner,
      });
    }

    if (entries.length === 0) return;

    const file = await readShiftedAlerts(owner);
    // Lazy retention pass: drop entries older than the retention window
    // BEFORE appending the new ones, so the file size stays bounded even
    // for owners with many shared tasks over long periods. Best-effort:
    // unparseable `shifted_at` values are KEPT (don't lose data over a
    // bad date string).
    const cutoffMs = Date.now() - SHIFTED_ALERTS_RETENTION_MS;
    const beforePrune = file.alerts.length;
    file.alerts = file.alerts.filter((a) => {
      const ts = Date.parse(a.shifted_at);
      if (!isFinite(ts)) return true;
      return ts >= cutoffMs;
    });
    const prunedCount = beforePrune - file.alerts.length;
    if (prunedCount > 0) {
      console.log(
        `[shift-alerts] pruned ${prunedCount} entries older than ${SHIFTED_ALERTS_RETENTION_DAYS}d from ${owner}/_shifted-alerts.json`
      );
    }
    file.alerts.push(...entries);
    await writeShiftedAlerts(owner, file);

    // Phone push P3a (sender-triggered): buzz the offline recipients of this
    // shift. Fire-and-forget; never blocks or fails the shift. The relay gates on
    // each recipient's OWN reminders-category toggle + quiet hours.
    void notifyShiftRecipients(recipientUsernames, shiftedByUser ?? owner);
  } catch (err) {
    // Sidecar writes are best-effort. Surfacing the error here would
    // mask a successful shift behind a notification-system bug, which
    // is worse than the missed alert.
    console.warn("[shift-alerts] failed to record alerts:", err);
  }
}

/**
 * Phone push P3a helper: ask the relay to buzz each user a shift alerted (their
 * shared task moved), so they hear about it even with their laptop closed. The
 * shifter is the sender; we skip notifying the shifter themselves. Resolves each
 * recipient's Ed25519 identity from their `_sharing_identity.json` sidecar and
 * fires the P2 notify-recipient route with category "reminders" (which is where
 * shift_alert routes). Fully best-effort; a recipient with no account/sidecar or
 * no paired phone simply never buzzes, and any failure is swallowed.
 */
async function notifyShiftRecipients(
  recipientUsernames: Set<string>,
  actor: string,
): Promise<void> {
  try {
    const targets = [...recipientUsernames].filter((u) => u !== actor);
    if (targets.length === 0) return;
    const senderKeys = await loadUserCaptureKeys();
    if (!senderKeys) return;
    await Promise.all(
      targets.map(async (username) => {
        try {
          const sidecar = await readSharingIdentity(username);
          if (!sidecar?.ed25519PublicKey) return;
          await notifyRecipient(senderKeys, sidecar.ed25519PublicKey, "reminders");
        } catch {
          // Best-effort per recipient.
        }
      }),
    );
  } catch {
    // Best-effort.
  }
}

async function readNotificationsFile(username: string): Promise<NotificationFile> {
  const path = `users/${username}/_notifications.json`;
  const data = await fileService.readJson<Partial<NotificationFile>>(path);
  return {
    version: data?.version ?? 1,
    notifications: data?.notifications ?? [],
  };
}

async function writeNotificationsFile(username: string, data: NotificationFile): Promise<void> {
  await fileService.writeJson(`users/${username}/_notifications.json`, data);
}

/**
 * Lab-manager ordering workflow (purchases-assignee fix, 2026-05-29):
 * append a single purchase notification to the receiver's
 * `_notifications.json`. Best-effort, mirroring the comment / shift-alert
 * dispatchers — one failed write must never block the underlying purchase
 * write. Cross-user membership guard: the receiver must be a discovered
 * lab member (someone with a data folder), so a stray / typo'd username
 * never spawns an orphan notification file outside the lab. The caller is
 * responsible for skipping self-notify (requester === receiver).
 */
async function appendPurchaseNotification(
  receiver: string,
  notif: PurchaseAssignmentNotification | PurchaseOrderedNotification,
): Promise<void> {
  if (!receiver) return;
  try {
    const members = await discoverUsers();
    if (!members.includes(receiver)) {
      // Not a lab-folder member — do not over-expose by minting a
      // notification in a folder outside the lab.
      return;
    }
    const file = await readNotificationsFile(receiver);
    file.notifications.push(notif);
    await writeNotificationsFile(receiver, file);
  } catch (err) {
    console.warn(
      `[purchase-notify] failed to write notification for ${receiver}:`,
      err,
    );
  }
}

function notificationTypeFor(itemType: ItemType): SharedItemNotification["type"] {
  if (itemType === "task") return "task_shared";
  if (itemType === "method") return "method_shared";
  return "project_shared";
}

function sharedListKey(itemType: ItemType): "tasks" | "methods" | "projects" {
  if (itemType === "task") return "tasks";
  if (itemType === "method") return "methods";
  return "projects";
}

async function addReceiverShare(
  receiver: string,
  itemType: ItemType,
  entry: SharedItemEntry,
  notificationName: string
): Promise<void> {
  const manifest = await readSharedWithMe(receiver);
  const list = manifest[sharedListKey(itemType)];
  const idx = list.findIndex((e) => e.id === entry.id && e.owner === entry.owner);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await writeSharedWithMe(receiver, manifest);

  // Notification write: idempotent on (type, item_type, item_id,
  // from_user). Without dedup, re-running the same share (e.g. the
  // user back-steps out of `lab-spawn-beakerbot` then re-enters the
  // step, or any other re-spawn flow) appends a SECOND notification
  // for the same task share, inflating the bell badge. The shared-
  // with-me manifest already dedupes (upsert by id+owner), so the
  // notification file is the only stale-data source here.
  //
  // Strategy (HR P0-3 fix 2026-05-22): find a pre-existing matching
  // notification and REPLACE it in place (refresh permission +
  // created_at + reset read=false). Preserves the existing "permission
  // flip refreshes the notification" idempotence flavor while
  // preventing badge-count drift. The `idx` lookup keeps the
  // notification's position stable so the bell ordering is preserved.
  const notifs = await readNotificationsFile(receiver);
  const matchType = notificationTypeFor(itemType);
  const existingIdx = notifs.notifications.findIndex(
    (n) =>
      n.type === matchType &&
      "item_type" in n &&
      n.item_type === itemType &&
      n.item_id === entry.id &&
      "from_user" in n &&
      n.from_user === entry.owner,
  );
  const fresh: SharedItemNotification = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: matchType,
    from_user: entry.owner,
    item_type: itemType,
    item_id: entry.id,
    item_name: notificationName,
    permission: entry.permission,
    created_at: entry.shared_at,
    read: false,
  };
  if (existingIdx >= 0) {
    // Reuse the prior notification's id so any UI that bound to it
    // (e.g. an open inbox row) doesn't blow away its hover state.
    const prior = notifs.notifications[existingIdx];
    notifs.notifications[existingIdx] = { ...fresh, id: prior.id };
  } else {
    notifs.notifications.push(fresh);
  }
  await writeNotificationsFile(receiver, notifs);
}

/**
 * Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23): dispatch
 * comment-related bell notifications to every interested user when a new
 * comment is added.
 *
 * Recipients (the union, dedupe at the end):
 *   - the parent record's owner (`comment_on_owned`), unless they ARE the
 *     commenter
 *   - every @-mentioned username (`comment_mention`), unless they're
 *     already in the owner bucket
 *   - every lab_head user in the lab (`comment_lab_head_feed`), unless
 *     they're already in one of the above buckets — Phase 2 brief: "lab
 *     heads get notifications for ALL new comments in the lab"
 *
 * The commenter never gets a self-notification. Failures are best-effort —
 * a write to one recipient's notification file failing must not block the
 * comment write itself, otherwise a single broken file wedges the whole
 * commenting flow. Mirror of the `addReceiverShare` failure model.
 */
async function dispatchCommentNotifications(params: {
  commentId: string;
  author: string;
  text: string;
  ownerUsername: string;
  recordType: "task" | "note";
  recordId: number;
  recordName: string;
  mentions: string[];
}): Promise<void> {
  const {
    commentId,
    author,
    text,
    ownerUsername,
    recordType,
    recordId,
    recordName,
    mentions,
  } = params;

  // Lazy import to avoid a circular dep with the comments util module.
  const { commentPreview } = await import("./comments/mentions");
  const preview = commentPreview(text);
  const now = new Date().toISOString();

  // Build the dispatch plan: map<receiver, type>. Owner wins over mention
  // wins over lab-head-feed.
  const plan = new Map<string, LabCommentNotification["type"]>();
  if (ownerUsername && ownerUsername !== author) {
    plan.set(ownerUsername, "comment_on_owned");
  }
  for (const mention of mentions) {
    if (mention === author) continue;
    if (plan.has(mention)) continue;
    plan.set(mention, "comment_mention");
  }

  // Discover lab heads — read every user's settings.json and pick out
  // `account_type === "lab_head"`. This is a fan-out read at comment-write
  // time, which is cheap (a single small file per user); cache TTL on the
  // React Query side (LAB_USER_PROFILES_QUERY_KEY) keeps the renderer
  // path warm separately.
  try {
    const users = await discoverUsers();
    const labHeads = (
      await Promise.all(
        users.map(async (u) => {
          try {
            // Direct read; we don't pull readUserSettings here to avoid
            // the dep cycle with the settings module.
            const s = await fileService.readJson<{ account_type?: string }>(
              `users/${u}/settings.json`,
            );
            return s?.account_type === "lab_head" ? u : null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((u): u is string => u !== null);
    for (const head of labHeads) {
      if (head === author) continue;
      if (plan.has(head)) continue;
      plan.set(head, "comment_lab_head_feed");
    }
  } catch {
    // Lab-head discovery failure is non-fatal — the owner + mention
    // notifications still go through.
  }

  // Write each notification. Best-effort, isolated per receiver.
  await Promise.all(
    Array.from(plan.entries()).map(async ([receiver, type]) => {
      try {
        const notif: LabCommentNotification = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type,
          from_user: author,
          owner_username: ownerUsername,
          record_type: recordType,
          record_id: recordId,
          record_name: recordName,
          comment_id: commentId,
          preview,
          created_at: now,
          read: false,
        };
        const file = await readNotificationsFile(receiver);
        file.notifications.push(notif);
        await writeNotificationsFile(receiver, file);
      } catch (err) {
        // One bad write must not poison the others.
        console.warn(
          `[comment-notify] failed to write notification for ${receiver}:`,
          err,
        );
      }
    }),
  );
}

async function removeReceiverShare(
  receiver: string,
  itemType: ItemType,
  itemId: number,
  owner: string
): Promise<void> {
  const manifest = await readSharedWithMe(receiver);
  const key = sharedListKey(itemType);
  const before = manifest[key].length;
  manifest[key] = manifest[key].filter((e) => !(e.id === itemId && e.owner === owner));
  if (manifest[key].length !== before) {
    await writeSharedWithMe(receiver, manifest);
  }
}

// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): the
// shared-entry shape accepts either the legacy `permission` or the new
// `level` field (or both). Reads normalize via `normalizeSharedWith`.
interface ShareableEntity {
  shared_with?: Array<{ username: string; permission?: string; level?: string }> | null;
  name?: string;
}

function upsertSharedWith<T extends ShareableEntity>(
  entity: T,
  username: string,
  permission: string
): T {
  const list: Array<{ username: string; permission?: string; level?: string }> = (entity.shared_with ?? []) as Array<{ username: string; permission?: string; level?: string }>;
  const idx = list.findIndex((s) => s.username === username);
  if (idx >= 0) list[idx] = { username, permission };
  else list.push({ username, permission });
  return { ...entity, shared_with: list } as T;
}

function removeSharedWith<T extends ShareableEntity>(entity: T, username: string): T {
  const list = (entity.shared_with ?? []).filter((s) => s.username !== username);
  return { ...entity, shared_with: list } as T;
}

/**
 * Walk the dependency graph upstream from `taskId` (parents/ancestors).
 * Sharing a task with `include_chain` shares everything it depends on too,
 * so the receiver sees a self-contained subgraph.
 */
async function getTaskAncestors(taskId: number): Promise<number[]> {
  const deps = await dependenciesStore.listAll();
  const parentsByChild = new Map<number, number[]>();
  for (const d of deps) {
    const arr = parentsByChild.get(d.child_id) ?? [];
    arr.push(d.parent_id);
    parentsByChild.set(d.child_id, arr);
  }
  const visited = new Set<number>([taskId]);
  const order: number[] = [taskId];
  const queue = [taskId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const parent of parentsByChild.get(id) ?? []) {
      if (!visited.has(parent)) {
        visited.add(parent);
        order.push(parent);
        queue.push(parent);
      }
    }
  }
  return order;
}

// ── Sharing API ──────────────────────────────────────────────────────────────

// Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23): map a
// caller-provided `level: "read" | "edit"` OR legacy `permission: "view"
// | "edit"` to the canonical storage representation. The sharing API
// accepts either field so the unified ShareDialog can pass `level` while
// older callers (and tests) keep passing `permission`. On-disk the
// migration eventually rewrites everything to `level`; sharingApi here
// is one of the bridges.
function resolveShareLevel(input: {
  level?: "read" | "edit";
  permission?: "view" | "edit";
}): "read" | "edit" {
  if (input.level === "edit" || input.level === "read") return input.level;
  if (input.permission === "edit") return "edit";
  if (input.permission === "view") return "read";
  return PERMISSION_DEFAULT === "edit" ? "edit" : "read";
}

/**
 * ACL hardening (2026-06-08): only a record's OWNER may change who it is shared
 * with. The `sharingApi.share*` functions read the record from the current
 * user's own folder and then stamp `shared_with`, but none of them asserted
 * the record actually belongs to the caller — a malformed / malicious call site
 * could thus mutate the sharing list of a record it does not own. This guard
 * makes the ownership requirement explicit at the library layer, independent of
 * any UI gating.
 *
 * Legacy records predate the `owner` field (single-user era). A record read
 * from the current user's own folder with no `owner` stamp is treated as owned
 * by the current user (it lives in their namespace), so legitimate sharing of
 * un-migrated records still works. Only a record whose stamped `owner` names a
 * DIFFERENT user is refused.
 */
function assertShareOwnership(
  recordOwner: string | null | undefined,
  currentUser: string | null,
  apiTag: string,
): void {
  const owner = recordOwner ?? currentUser ?? "";
  if (owner !== (currentUser ?? "")) {
    throw new Error(
      `[${apiTag}] refused: ${currentUser ?? "anonymous"} cannot change sharing on a record owned by ${recordOwner}`,
    );
  }
}

export const sharingApi = {
  shareTask: async (
    taskId: number,
    data: { username: string; permission?: "view" | "edit"; level?: "read" | "edit"; include_chain?: boolean }
  ): Promise<{
    status: string;
    item_id: number;
    shared_with: string;
    permission: string;
    level: "read" | "edit";
    chain_shared_count?: number;
  }> => {
    const currentUser = await getCurrentUserCached();
    const level = resolveShareLevel(data);
    // Legacy `permission` field is preserved on the receiver-side
    // SharedItemEntry for backwards compat; new code reads `level`.
    const permission = level === "edit" ? "edit" : "view";
    if (data.username === currentUser) {
      throw new Error("Cannot share a task with yourself");
    }
    const ids = data.include_chain ? await getTaskAncestors(taskId) : [taskId];
    const sharedAt = new Date().toISOString();
    let count = 0;
    for (const id of ids) {
      const task = await tasksStore.get(id);
      if (!task) continue;
      assertShareOwnership(task.owner, currentUser, "sharingApi.shareTask");
      // Persist BOTH `level` (the new canonical field) and `permission`
      // (legacy) so old readers + new readers both work during the
      // migration window. upsertSharedWith only sets `permission`; we
      // overlay `level` here.
      const sharedListWithLevel = (upsertSharedWith(task, data.username, permission).shared_with ?? [])
        .map((s) => (s.username === data.username ? { ...s, level } : s));
      const updated = { ...task, shared_with: sharedListWithLevel };
      await tasksStore.save(id, updated);
      await addReceiverShare(
        data.username,
        "task",
        { id, owner: currentUser, permission, shared_at: sharedAt },
        task.name
      );
      count += 1;
    }
    return {
      status: "ok",
      item_id: taskId,
      shared_with: data.username,
      permission,
      level,
      chain_shared_count: data.include_chain ? count : undefined,
    };
  },

  unshareTask: async (
    taskId: number,
    username: string
  ): Promise<{ status: string; item_id: number; shared_with: string }> => {
    const currentUser = await getCurrentUserCached();
    const task = await tasksStore.get(taskId);
    if (task) {
      const updated = removeSharedWith(task, username);
      await tasksStore.save(taskId, updated);
    }
    await removeReceiverShare(username, "task", taskId, currentUser);
    return { status: "ok", item_id: taskId, shared_with: username };
  },

  /**
   * Admin-mode share: same semantics as `shareTask` but the sender is an
   * explicit `actorId` instead of the current user. Used by the v4 Lab Mode
   * tour (P7) so the wizard can make a fake BeakerBot user share placeholder
   * tasks with the real user — a direction the user-as-sender contract of
   * `shareTask` can't express.
   *
   * Sidecar writes:
   *   - mutates the task at `users/<actorId>/tasks/<taskId>.json`
   *   - appends to recipient's `users/<recipient>/_shared_with_me.json` with
   *     `owner: actorId`
   *   - appends a `task_shared` notification to recipient's
   *     `users/<recipient>/_notifications.json` with `from_user: actorId`
   *
   * Differences vs `shareTask`:
   *   - No `include_chain` option. The lab-tour scope (L19) shares standalone
   *     placeholder tasks; chained shares from a non-current actor would need
   *     `getTaskAncestors` to also be actor-scoped (not currently the case),
   *     so we skip the feature rather than ship a half-correct impl.
   *   - Self-share guard is `actorId === recipient` (not against currentUser).
   *     An admin caller might invoke this with currentUser==recipient (that's
   *     the whole point), so the guard against sharing-with-yourself shifts
   *     to the actor↔recipient axis.
   */
  shareTaskAs: async (
    actorId: string,
    taskId: number,
    recipient: string,
    permission: "view" | "edit"
  ): Promise<{
    status: string;
    item_id: number;
    shared_with: string;
    permission: string;
    actor: string;
  }> => {
    if (!actorId) throw new Error("actorId is required");
    if (!recipient) throw new Error("recipient is required");
    if (actorId === recipient) {
      throw new Error("Cannot share a task with the actor themselves");
    }
    const task = await tasksStore.getForUser(taskId, actorId);
    if (!task) {
      throw new Error(`Task ${taskId} not found in user ${actorId}'s workspace`);
    }
    const sharedAt = new Date().toISOString();
    const updated = upsertSharedWith(task, recipient, permission);
    await tasksStore.saveForUser(taskId, updated, actorId);
    await addReceiverShare(
      recipient,
      "task",
      { id: taskId, owner: actorId, permission, shared_at: sharedAt },
      task.name ?? `Task ${taskId}`
    );
    return {
      status: "ok",
      item_id: taskId,
      shared_with: recipient,
      permission,
      actor: actorId,
    };
  },

  /**
   * Admin-mode revoke: paired with `shareTaskAs`. Removes `recipient` from
   * the task's `shared_with` list inside the actor's namespace and prunes the
   * matching entry from the recipient's `_shared_with_me.json`.
   *
   * Mirrors `unshareTask` exactly, except the source-of-truth task lives in
   * `users/<actorId>/...` instead of the current user's namespace.
   */
  unshareTaskAs: async (
    actorId: string,
    taskId: number,
    recipient: string
  ): Promise<{
    status: string;
    item_id: number;
    shared_with: string;
    actor: string;
  }> => {
    if (!actorId) throw new Error("actorId is required");
    if (!recipient) throw new Error("recipient is required");
    const task = await tasksStore.getForUser(taskId, actorId);
    if (task) {
      const updated = removeSharedWith(task, recipient);
      await tasksStore.saveForUser(taskId, updated, actorId);
    }
    await removeReceiverShare(recipient, "task", taskId, actorId);
    return {
      status: "ok",
      item_id: taskId,
      shared_with: recipient,
      actor: actorId,
    };
  },

  getTaskDependencyChain: async (
    taskId: number
  ): Promise<{ task_id: number; chain_task_ids: number[]; chain_count: number }> => {
    const chain = await getTaskAncestors(taskId);
    return { task_id: taskId, chain_task_ids: chain, chain_count: chain.length };
  },

  shareMethod: async (
    methodId: number,
    data: { username: string; permission?: "view" | "edit"; level?: "read" | "edit" }
  ): Promise<{ status: string; item_id: number; shared_with: string; permission: string; level: "read" | "edit" }> => {
    const currentUser = await getCurrentUserCached();
    const level = resolveShareLevel(data);
    const permission = level === "edit" ? "edit" : "view";
    if (data.username === currentUser) {
      throw new Error("Cannot share a method with yourself");
    }
    const method = await methodsStore.get(methodId);
    if (!method) throw new Error(`Method ${methodId} not found in current user's library`);
    assertShareOwnership(method.owner, currentUser, "sharingApi.shareMethod");
    const sharedListWithLevel = (upsertSharedWith(method, data.username, permission).shared_with ?? [])
      .map((s) => (s.username === data.username ? { ...s, level } : s));
    const updated = { ...method, shared_with: sharedListWithLevel };
    await methodsStore.save(methodId, updated);
    await addReceiverShare(
      data.username,
      "method",
      { id: methodId, owner: currentUser, permission, shared_at: new Date().toISOString() },
      method.name
    );
    return { status: "ok", item_id: methodId, shared_with: data.username, permission, level };
  },

  unshareMethod: async (
    methodId: number,
    username: string
  ): Promise<{ status: string; item_id: number; shared_with: string }> => {
    const currentUser = await getCurrentUserCached();
    const method = await methodsStore.get(methodId);
    if (method) {
      const updated = removeSharedWith(method, username);
      await methodsStore.save(methodId, updated);
    }
    await removeReceiverShare(username, "method", methodId, currentUser);
    return { status: "ok", item_id: methodId, shared_with: username };
  },

  shareProject: async (
    projectId: number,
    data: { username: string; permission?: "view" | "edit"; level?: "read" | "edit" }
  ): Promise<{ status: string; item_id: number; shared_with: string; permission: string; level: "read" | "edit" }> => {
    const currentUser = await getCurrentUserCached();
    const level = resolveShareLevel(data);
    const permission = level === "edit" ? "edit" : "view";
    if (data.username === currentUser) {
      throw new Error("Cannot share a project with yourself");
    }
    const project = await projectsStore.get(projectId);
    if (!project) throw new Error(`Project ${projectId} not found in current user's workspace`);
    assertShareOwnership(project.owner, currentUser, "sharingApi.shareProject");
    const sharedListWithLevel = (upsertSharedWith(project, data.username, permission).shared_with ?? [])
      .map((s) => (s.username === data.username ? { ...s, level } : s));
    const updated = { ...project, shared_with: sharedListWithLevel };
    await projectsStore.save(projectId, updated);
    await addReceiverShare(
      data.username,
      "project",
      { id: projectId, owner: currentUser, permission, shared_at: new Date().toISOString() },
      project.name
    );
    void recordProjectActivity(currentUser, projectId, {
      type: "project_shared",
      recipient: data.username,
      permission: permission as "view" | "edit",
    });
    return { status: "ok", item_id: projectId, shared_with: data.username, permission, level };
  },

  unshareProject: async (
    projectId: number,
    username: string
  ): Promise<{ status: string; item_id: number; shared_with: string }> => {
    const currentUser = await getCurrentUserCached();
    const project = await projectsStore.get(projectId);
    if (project) {
      const updated = removeSharedWith(project, username);
      await projectsStore.save(projectId, updated);
    }
    await removeReceiverShare(username, "project", projectId, currentUser);
    return { status: "ok", item_id: projectId, shared_with: username };
  },

  // Lab Mode retirement R1b (R1b sharing completion manager, 2026-05-23):
  // share Note / LabLink / HighLevelGoal records via the unified shape.
  //
  // Unlike `shareTask`/`shareMethod`/`shareProject` which take a single
  // recipient + permission and ALSO maintain the receiver-side manifest
  // (`_shared_with_me.json`) + bell notification, these three are
  // simpler: they replace the entire `shared_with` array on the record
  // in one disk write. No receiver-side manifest update (R1b scope:
  // record-side only — the unified `canRead` already drives discovery
  // from the source record itself; no manifest needed for these types).
  //
  // Callers (`ShareDialogAdapter`) compute the full desired list and
  // pass it in. The dialog UI is the only writer; UI-only nature means
  // batched replacement is the right shape.
  shareNote: async (
    noteId: number,
    recipients: { username: string; level: "read" | "edit" }[]
  ): Promise<{ status: string; item_id: number; shared_with: SharedUser[] }> => {
    const currentUser = await getCurrentUserCached();
    const note = await notesStore.get(noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);
    assertShareOwnership((note as { owner?: string }).owner, currentUser, "sharingApi.shareNote");
    const sharedWith: SharedUser[] = recipients.map((r) => ({
      username: r.username,
      level: r.level,
      // Legacy `permission` mirror so any pre-R1 reader still resolves.
      permission: r.level === "edit" ? "edit" : "view",
    }));
    // Note: legacy `is_shared` boolean stays in sync with whether the
    // "*" sentinel is present. One release of dual-write keeps old
    // readers (e.g. Lab Notes feed) working until they migrate to
    // `canRead`.
    const wholeLab = sharedWith.some((s) => s.username === "*");
    await notesStore.update(noteId, {
      shared_with: sharedWith,
      is_shared: wholeLab,
    } as Partial<Note>);
    return { status: "ok", item_id: noteId, shared_with: sharedWith };
  },

  shareLink: async (
    linkId: number,
    recipients: { username: string; level: "read" | "edit" }[]
  ): Promise<{ status: string; item_id: number; shared_with: SharedUser[] }> => {
    const currentUser = await getCurrentUserCached();
    const link = await labLinksStore.get(linkId);
    if (!link) throw new Error(`LabLink ${linkId} not found`);
    assertShareOwnership(link.owner, currentUser, "sharingApi.shareLink");
    const sharedWith: SharedUser[] = recipients.map((r) => ({
      username: r.username,
      level: r.level,
      permission: r.level === "edit" ? "edit" : "view",
    }));
    await labLinksStore.update(linkId, {
      shared_with: sharedWith,
    } as Partial<LabLink>);
    return { status: "ok", item_id: linkId, shared_with: sharedWith };
  },

  shareGoal: async (
    goalId: number,
    recipients: { username: string; level: "read" | "edit" }[]
  ): Promise<{ status: string; item_id: number; shared_with: SharedUser[] }> => {
    const currentUser = await getCurrentUserCached();
    const goal = await goalsStore.get(goalId);
    if (!goal) throw new Error(`HighLevelGoal ${goalId} not found`);
    assertShareOwnership(goal.owner, currentUser, "sharingApi.shareGoal");
    const sharedWith: SharedUser[] = recipients.map((r) => ({
      username: r.username,
      level: r.level,
      permission: r.level === "edit" ? "edit" : "view",
    }));
    await goalsStore.update(goalId, {
      shared_with: sharedWith,
    } as Partial<HighLevelGoal>);
    return { status: "ok", item_id: goalId, shared_with: sharedWith };
  },

  getSharedWithMe: async (): Promise<{
    projects: SharedItemEntry[];
    tasks: SharedItemEntry[];
    methods: SharedItemEntry[];
  }> => {
    const currentUser = await getCurrentUserCached();
    const manifest = await readSharedWithMe(currentUser);
    return { projects: manifest.projects, tasks: manifest.tasks, methods: manifest.methods };
  },

  getNotifications: async (
    unreadOnly: boolean = false
  ): Promise<{ notifications: Notification[]; unread_count: number }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const all = file.notifications;
    const notifications = unreadOnly ? all.filter((n) => !n.read) : all;
    const unread_count = all.filter((n) => !n.read).length;
    return { notifications, unread_count };
  },

  markNotificationRead: async (
    notificationId: string
  ): Promise<{ status: string; notification_id: string }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const idx = file.notifications.findIndex((n) => n.id === notificationId);
    if (idx >= 0) {
      file.notifications[idx] = { ...file.notifications[idx], read: true };
      await writeNotificationsFile(currentUser, file);
    }
    return { status: "ok", notification_id: notificationId };
  },

  // Symmetric to markNotificationRead. Used by onboarding v4 §6.3 to
  // re-light an existing welcome-test notification when the tour
  // re-enters the bell step (instead of spawning a duplicate row).
  markNotificationUnread: async (
    notificationId: string,
  ): Promise<{ status: string; notification_id: string }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const idx = file.notifications.findIndex((n) => n.id === notificationId);
    if (idx >= 0) {
      file.notifications[idx] = { ...file.notifications[idx], read: false };
      await writeNotificationsFile(currentUser, file);
    }
    return { status: "ok", notification_id: notificationId };
  },

  markAllNotificationsRead: async (): Promise<{ status: string; dismissed_count: number }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    let count = 0;
    file.notifications = file.notifications.map((n) => {
      if (!n.read) {
        count += 1;
        return { ...n, read: true };
      }
      return n;
    });
    if (count > 0) {
      await writeNotificationsFile(currentUser, file);
    }
    return { status: "ok", dismissed_count: count };
  },

  /**
   * Remove a single notification from the user's notifications file.
   * Unlike markNotificationRead this fully deletes the entry — callers want
   * the inbox empty, not just acknowledged.
   */
  dismissNotification: async (
    notificationId: string
  ): Promise<{ status: string; notification_id: string }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    file.notifications = file.notifications.filter((n) => n.id !== notificationId);
    await writeNotificationsFile(currentUser, file);
    return { status: "ok", notification_id: notificationId };
  },

  /**
   * Clear every notification in the inbox. Returns how many were cleared.
   *
   * For `shift_alert` notifications we also append their `source_alert_id`
   * into `_seen-shift-alerts.json` BEFORE dropping the row — otherwise the
   * next `scanShiftAlerts` (mount-time) would re-mint a fresh notification
   * for the same owner-side alert UUID and the user would see "cleared"
   * shift alerts come back from the dead.
   */
  dismissAllNotifications: async (): Promise<{ status: string; dismissed_count: number }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const count = file.notifications.length;
    if (count > 0) {
      // Mark every shift-alert's source UUID as seen so it doesn't re-mint
      // on the next scan. Only writes the seen-list when there's something
      // new to add — keeps the file untouched in the no-shift-alerts case.
      const shiftAlertSourceIds = file.notifications
        .filter(
          (n): n is ShiftAlertNotification => n.type === "shift_alert"
        )
        .map((n) => n.source_alert_id);
      if (shiftAlertSourceIds.length > 0) {
        const seenFile = await readSeenShiftAlerts(currentUser);
        const seenSet = new Set(seenFile.seen_ids);
        let added = 0;
        for (const id of shiftAlertSourceIds) {
          if (!seenSet.has(id)) {
            seenSet.add(id);
            added += 1;
          }
        }
        if (added > 0) {
          await writeSeenShiftAlerts(currentUser, {
            version: 1,
            seen_ids: Array.from(seenSet),
          });
        }
      }
      file.notifications = [];
      await writeNotificationsFile(currentUser, file);
    }
    return { status: "ok", dismissed_count: count };
  },

  /**
   * Clear notifications already marked read; leave unread ones in place.
   *
   * Same shift-alert "seen" sync as `dismissAllNotifications`, but only for
   * read shift-alerts — unread ones stay in the inbox and stay in the
   * not-yet-seen set so the dedup contract still holds.
   */
  dismissReadNotifications: async (): Promise<{ status: string; dismissed_count: number }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const before = file.notifications.length;
    // Capture the shift-alerts we're about to drop so we can seed the
    // seen-list (same rationale as dismissAllNotifications).
    const droppedShiftAlertSourceIds = file.notifications
      .filter(
        (n): n is ShiftAlertNotification =>
          n.type === "shift_alert" && n.read
      )
      .map((n) => n.source_alert_id);
    file.notifications = file.notifications.filter((n) => !n.read);
    const removed = before - file.notifications.length;
    if (removed > 0) {
      if (droppedShiftAlertSourceIds.length > 0) {
        const seenFile = await readSeenShiftAlerts(currentUser);
        const seenSet = new Set(seenFile.seen_ids);
        let added = 0;
        for (const id of droppedShiftAlertSourceIds) {
          if (!seenSet.has(id)) {
            seenSet.add(id);
            added += 1;
          }
        }
        if (added > 0) {
          await writeSeenShiftAlerts(currentUser, {
            version: 1,
            seen_ids: Array.from(seenSet),
          });
        }
      }
      await writeNotificationsFile(currentUser, file);
    }
    return { status: "ok", dismissed_count: removed };
  },

  /**
   * Append a calendar event reminder to the user's notifications file. Used
   * by the ReminderRunner when a scheduled timeout fires. Returns the new
   * notification so callers can also surface an OS-level Notification API
   * popup if the user has granted permission.
   */
  createEventReminder: async (
    input: Omit<EventReminderNotification, "id" | "type" | "created_at" | "read">
  ): Promise<EventReminderNotification> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const notification: EventReminderNotification = {
      ...input,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: "event_reminder",
      created_at: new Date().toISOString(),
      read: false,
    };
    file.notifications.push(notification);
    await writeNotificationsFile(currentUser, file);
    return notification;
  },

  /**
   * Receiver-side: scan owners' `_shifted-alerts.json` sidecars for shifts
   * to tasks shared *with* the current user (via `_shared_with_me.json`),
   * dedup against the current user's `_seen-shift-alerts.json`, and
   * synthesize a `ShiftAlertNotification` in the current user's
   * `_notifications.json` for each new alert.
   *
   * Idempotent: calling repeatedly without new owner-side alerts is a no-op
   * (the seen-list grows by every alert the receiver has acknowledged into
   * a notification — even if she hasn't yet dismissed the notification — so
   * we don't re-mint duplicates on every load).
   *
   * Best-effort: errors are swallowed and logged. A failure in one owner's
   * sidecar shouldn't block the rest.
   *
   * Returns the count of newly minted notifications so callers (e.g.
   * AppShell) can show a "+N" toast or simply refresh their unread count.
   */
  scanShiftAlerts: async (): Promise<{ new_notification_count: number }> => {
    const currentUser = await getCurrentUserCached();
    if (!currentUser) return { new_notification_count: 0 };

    // Build the set of (owner, taskId) pairs the current user is receiving
    // shares for. The alert.task_key is "<owner>:<id>"; the receiver only
    // cares about alerts whose key is in this set.
    const manifest = await readSharedWithMe(currentUser);
    const receiverShareKeys = new Set<string>();
    const ownersToScan = new Set<string>();
    for (const entry of manifest.tasks) {
      receiverShareKeys.add(`${entry.owner}:${entry.id}`);
      ownersToScan.add(entry.owner);
    }
    // Also include the current user's OWN namespace — alex still wants to
    // know if morgan (with edit permission) shifted alex's task. The
    // `shifted_by_user !== currentUser` filter below avoids self-noise.
    ownersToScan.add(currentUser);

    if (ownersToScan.size === 0) {
      return { new_notification_count: 0 };
    }

    // Load seen-list once; we'll write back at the end if anything changed.
    const seenFile = await readSeenShiftAlerts(currentUser);
    const seenIds = new Set(seenFile.seen_ids);
    const initialSeenCount = seenIds.size;

    // Aggregate new notifications across owners, then write once.
    const notificationsFile = await readNotificationsFile(currentUser);
    let minted = 0;

    for (const owner of ownersToScan) {
      try {
        const alertsFile = await readShiftedAlerts(owner);
        for (const alert of alertsFile.alerts) {
          if (seenIds.has(alert.id)) continue;
          // Skip self-authored shifts — alex doesn't need to notify herself
          // that she just moved her own task.
          if (alert.shifted_by_user === currentUser) {
            seenIds.add(alert.id);
            continue;
          }
          // For owner === currentUser, accept all alerts in that namespace
          // (someone else with edit permission shifted alex's task).
          // For other owners, gate on the receiver's `_shared_with_me`
          // entry: morgan should only see alerts for tasks actually shared
          // with her, not every shift alex ever made.
          if (owner !== currentUser && !receiverShareKeys.has(alert.task_key)) {
            continue;
          }
          const notification: ShiftAlertNotification = {
            id: newAlertId(),
            type: "shift_alert",
            from_user: alert.shifted_by_user,
            item_id: alert.task_id,
            task_key: alert.task_key,
            item_name: alert.task_name,
            source_alert_id: alert.id,
            start_delta_days: alert.start_delta_days,
            end_delta_days: alert.end_delta_days,
            old_start: alert.old_start,
            old_end: alert.old_end,
            new_start: alert.new_start,
            new_end: alert.new_end,
            created_at: new Date().toISOString(),
            read: false,
          };
          notificationsFile.notifications.push(notification);
          seenIds.add(alert.id);
          minted += 1;
        }
      } catch (err) {
        console.warn(`[shift-alerts] scan failed for owner=${owner}:`, err);
      }
    }

    if (minted > 0) {
      await writeNotificationsFile(currentUser, notificationsFile);
    }
    if (seenIds.size !== initialSeenCount) {
      await writeSeenShiftAlerts(currentUser, {
        version: 1,
        seen_ids: Array.from(seenIds),
      });
    }

    return { new_notification_count: minted };
  },

  /**
   * Receiver-side: mark a synthesized `ShiftAlertNotification` as
   * "handled" (acted on or ignored). Removes it from the inbox AND ensures
   * the underlying `source_alert_id` won't re-mint on the next
   * `scanShiftAlerts`. Idempotent.
   */
  dismissShiftAlert: async (
    notificationId: string
  ): Promise<{ status: string; notification_id: string }> => {
    const currentUser = await getCurrentUserCached();
    const file = await readNotificationsFile(currentUser);
    const target = file.notifications.find(
      (n) => n.id === notificationId && n.type === "shift_alert"
    );
    file.notifications = file.notifications.filter((n) => n.id !== notificationId);
    await writeNotificationsFile(currentUser, file);

    if (target && target.type === "shift_alert") {
      const seenFile = await readSeenShiftAlerts(currentUser);
      if (!seenFile.seen_ids.includes(target.source_alert_id)) {
        seenFile.seen_ids.push(target.source_alert_id);
        await writeSeenShiftAlerts(currentUser, seenFile);
      }
    }
    return { status: "ok", notification_id: notificationId };
  },
};

function labTaskFrom(
  t: Task,
  username: string,
  userColor: string,
  userColorSecondary: string | null = null,
): LabTask {
  const task = computeTaskEndDate(t);
  return {
    id: task.id,
    name: task.name,
    project_id: task.project_id,
    start_date: task.start_date,
    duration_days: task.duration_days,
    end_date: task.end_date,
    is_complete: task.is_complete,
    task_type: task.task_type,
    username: task.owner || username,
    user_color: userColor,
    user_color_secondary: userColorSecondary,
    experiment_color: task.experiment_color,
    method_ids: task.method_ids || [],
    notes: task.deviation_log,
  };
}

export const labApi = {
  getUsers: async (): Promise<{ users: LabUser[] }> => {
    const { usernames, metadata } = await loadLabUsers();
    const users: LabUser[] = usernames.map((username) => ({
      username,
      color: colorFor(metadata, username),
      color_secondary: colorSecondaryFor(metadata, username),
      created_at: metadata[username]?.created_at ?? null,
    }));
    return { users };
  },

  getTasks: async (_params?: { exclude_goals?: boolean; usernames?: string }): Promise<LabTask[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const tasks: LabTask[] = [];

    for (const username of usernames) {
      const userTasks = await tasksStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      const userColorSecondary = colorSecondaryFor(metadata, username);
      for (const t of userTasks) {
        tasks.push(labTaskFrom(t, username, userColor, userColorSecondary));
      }
    }

    return tasks;
  },

  getProjects: async (_params?: { usernames?: string }): Promise<LabProject[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const projects: LabProject[] = [];

    for (const username of usernames) {
      const userProjects = await projectsStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      for (const p of userProjects) {
        projects.push({
          id: p.id,
          name: p.name,
          color: p.color || "#3b82f6",
          username: p.owner || username,
          user_color: userColor,
          is_archived: p.is_archived || false,
        });
      }
    }

    return projects;
  },

  /**
   * Lab-wide FULL tasks (RS-2, the PI-Mode Gantt rollup). UNLIKE getTasks (which
   * slims each record to LabTask), this returns every member's complete Task
   * objects so the GanttChart can render them with its existing lab-mode path.
   * Each task is stamped with `owner` (so taskKey is unique across members) and
   * `username` (which the GanttChart lab-mode color lookup reads). Read-only by
   * use: the Gantt's lab mode disables every drag/resize handler.
   */
  getTasksFull: async (): Promise<Array<Task & { username: string }>> => {
    const { usernames } = await loadLabUsers();
    const out: Array<Task & { username: string }> = [];
    for (const username of usernames) {
      const userTasks = await tasksStore.listAllForUser(username);
      for (const t of userTasks) {
        const owner = t.owner || username;
        out.push({ ...t, owner, username: owner });
      }
    }
    return out;
  },

  /** Lab-wide FULL projects (RS-2), owner-stamped, for the Gantt rollup. */
  getProjectsFull: async (): Promise<Project[]> => {
    const { usernames } = await loadLabUsers();
    const out: Project[] = [];
    for (const username of usernames) {
      const userProjects = await projectsStore.listAllForUser(username);
      for (const p of userProjects) out.push({ ...p, owner: p.owner || username });
    }
    return out;
  },

  /**
   * Lab-wide inventory items (RS-4, the PI-Mode lab inventory browse). Every
   * member's InventoryItem records, owner-stamped, so the PI can see the whole
   * lab's reagents/supplies grouped by owner. Read-only browse; per-item editing
   * stays on each owner's own inventory surface.
   */
  getInventoryItemsFull: async (): Promise<
    Array<InventoryItem & { owner: string }>
  > => {
    const { usernames } = await loadLabUsers();
    const out: Array<InventoryItem & { owner: string }> = [];
    for (const username of usernames) {
      const userItems = await inventoryItemsStore.listAllForUser(username);
      for (const it of userItems) {
        out.push({ ...it, owner: (it as { owner?: string }).owner || username });
      }
    }
    return out;
  },

  /**
   * Project-widgets family (project-widgets, 2026-05-29): a
   * sharing-aware cross-member projects read for the Projects Overview
   * (lab mode) + Single-Project pin-picker widgets.
   *
   * UNLIKE `getProjects` above (which flattens every member's projects
   * with NO sharing filter; it backs the lab search index, which has its
   * own downstream canRead pass), this accessor carries the per-record
   * sharing primitive fields (`owner` + `shared_with`) straight through
   * so the WIDGET can run the unified `canRead(record, viewer)` gate, the
   * SAME way `TraineeNotesWidget` does over `getNotes`. We deliberately do
   * NOT pre-filter here: the precise per-viewer gate lives in the widget
   * (it needs the live `Viewer` shape, username + account_type, which
   * the API layer doesn't have). Returning the raw `shared_with` + owner
   * is what makes the gate enforceable client-side.
   *
   * Each record is also annotated with task-derived progress
   * (`taskTotal` / `taskCompleted` / `taskIncomplete`) computed from that
   * owner's OWN tasks for the project (project ids are namespaced
   * per-owner, so `t.project_id === p.id` within one owner's task list is
   * unambiguous). Hidden + archived projects are dropped to match every
   * other project surface (Home grid, Workbench, pickers).
   *
   * PRIVACY: this returns every member's project records to the client,
   * exactly like `getNotes`. It is NOT a viewer-scoped read on its own;
   * the caller MUST apply `canRead`. The Projects Overview + Single-
   * Project widgets do; see their privacy contracts + tests.
   */
  getProjectsWithProgress: async (): Promise<ViewerVisibleProject[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const out: ViewerVisibleProject[] = [];

    // LOCAL today as YYYY-MM-DD. Task start/end dates are stored as local
    // date strings, so the open/overdue/upcoming buckets must compare
    // against the viewer's LOCAL calendar day, not a UTC instant (a late
    // evening in a behind-UTC zone would otherwise read tomorrow's date and
    // misclassify same-day tasks). Mirrors the streak tracker's local-day
    // derivation.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(now.getDate()).padStart(2, "0")}`;

    for (const username of usernames) {
      const userProjects = await projectsStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      // One task read per owner; reused across all of that owner's
      // projects so we don't re-read the file per project.
      const ownerTasks = await tasksStore.listAllForUser(username);
      for (const p of userProjects) {
        if (p.is_hidden) continue;
        if (p.is_archived) continue;
        const owner = p.owner || username;
        const projectTasks = ownerTasks.filter((t) => t.project_id === p.id);
        const taskTotal = projectTasks.length;
        const taskCompleted = projectTasks.filter((t) => t.is_complete).length;
        // Per-project task breakdown, logic lifted verbatim from the
        // pre-unification Home project cards (start_date >= today =
        // upcoming; end_date < today = overdue; spanning today = active).
        // An incomplete task can land in more than one bucket only at the
        // boundaries, exactly as the old cards counted it.
        const incompleteTasks = projectTasks.filter((t) => !t.is_complete);
        const taskUpcoming = incompleteTasks.filter(
          (t) => t.start_date >= today,
        ).length;
        const taskOverdue = incompleteTasks.filter(
          (t) => t.end_date < today,
        ).length;
        const taskActive = incompleteTasks.filter(
          (t) => t.start_date <= today && t.end_date >= today,
        ).length;
        out.push({
          id: p.id,
          name: p.name,
          color: p.color || "#3b82f6",
          owner,
          shared_with: p.shared_with ?? [],
          user_color: userColor,
          taskTotal,
          taskCompleted,
          taskIncomplete: taskTotal - taskCompleted,
          taskUpcoming,
          taskOverdue,
          taskActive,
        });
      }
    }

    return out;
  },

  getMethods: async (): Promise<LabMethod[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const methods: LabMethod[] = [];

    // loadLabUsers() (via discoverUsers) already excludes tombstoned users,
    // so we never read a deleted user's own folder. This extra guard
    // (delete-affordances bot, 2026-05-29) covers the rarer case of a method
    // physically stored in a LIVE user's folder but stamped with an explicit
    // `owner` that is itself a tombstoned (deleted) user — that method's
    // owner no longer exists, so it must not render in the lab-wide list.
    for (const username of usernames) {
      const userMethods = await methodsStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      for (const m of userMethods) {
        if (m.owner && metadata[m.owner]?.deleted_at) continue;
        methods.push({
          id: m.id,
          name: m.name,
          username: m.owner || username,
          user_color: userColor,
          is_public: false,
        });
      }
    }

    const publicMethods = await publicMethodsStore.listAll();
    for (const m of publicMethods) {
      methods.push({
        id: m.id,
        name: m.name,
        username: m.owner || "public",
        user_color: "#6b7280",
        is_public: true,
      });
    }

    return methods;
  },

  getMethodFolders: async (): Promise<string[]> => {
    return [];
  },

  // #14: lab-wide goals view. Returns each user's HighLevelGoals annotated
  // with username + color, skipping any user who opted out via
  // _user_metadata.json (hide_goals_from_lab). Used by the Roadmaps tab.
  //
  // Privacy contract: personal goals (project_id === null) are NEVER
  // exposed to lab mode. Only project-scoped goals propagate. The
  // hide_goals_from_lab flag is the additional opt-out for project goals.
  getGoals: async (): Promise<LabGoal[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const out: LabGoal[] = [];
    for (const username of usernames) {
      if (metadata[username]?.hide_goals_from_lab) continue;
      const userGoals = await goalsStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      for (const g of userGoals) {
        if (g.project_id === null) continue; // personal goal, never shared
        out.push({
          id: g.id,
          name: g.name,
          project_id: g.project_id,
          start_date: g.start_date,
          end_date: g.end_date,
          is_complete: g.is_complete,
          color: g.color,
          smart_goals: g.smart_goals || [],
          username,
          user_color: userColor,
        });
      }
    }
    return out;
  },

  getExperiments: async (_params?: { usernames?: string }): Promise<LabTask[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const tasks: LabTask[] = [];

    for (const username of usernames) {
      const userTasks = await tasksStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      const userColorSecondary = colorSecondaryFor(metadata, username);
      for (const t of userTasks) {
        if (t.task_type !== "experiment") continue;
        tasks.push(labTaskFrom(t, username, userColor, userColorSecondary));
      }
    }

    return tasks;
  },

  getPurchases: async (_params?: { usernames?: string }): Promise<LabTask[]> => {
    const { usernames, metadata } = await loadLabUsers();
    const tasks: LabTask[] = [];

    for (const username of usernames) {
      const userTasks = await tasksStore.listAllForUser(username);
      const userColor = colorFor(metadata, username);
      const userColorSecondary = colorSecondaryFor(metadata, username);
      for (const t of userTasks) {
        if (t.task_type !== "purchase") continue;
        tasks.push(labTaskFrom(t, username, userColor, userColorSecondary));
      }
    }

    return tasks;
  },

  search: async (params: {
    q?: string;
    usernames?: string;
    task_types?: string;
    date_from?: string;
    date_to?: string;
    project_id?: number;
    method_id?: number;
    method_folder?: string;
    completion_status?: "all" | "complete" | "incomplete";
  }): Promise<{ results: LabSearchResult[]; total_count: number }> => {
    const q = (params.q ?? "").trim().toLowerCase();
    const usernamesFilter = params.usernames
      ? new Set(params.usernames.split(",").map((s) => s.trim()).filter(Boolean))
      : null;
    const taskTypes = params.task_types
      ? new Set(params.task_types.split(",").map((s) => s.trim()).filter(Boolean))
      : null;
    const dateFrom = params.date_from || null;
    const dateTo = params.date_to || null;
    const projectId = typeof params.project_id === "number" ? params.project_id : null;
    const methodId = typeof params.method_id === "number" ? params.method_id : null;
    const completion = params.completion_status ?? "all";

    const { usernames: allUsernames, metadata } = await loadLabUsers();
    const targetUsernames = usernamesFilter
      ? allUsernames.filter((u) => usernamesFilter.has(u))
      : allUsernames;

    const results: LabSearchResult[] = [];

    const previewFrom = (text: string): string => {
      if (!q) return text.slice(0, 160);
      const idx = text.toLowerCase().indexOf(q);
      if (idx === -1) return text.slice(0, 160);
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + q.length + 80);
      return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    };

    // Tasks
    for (const username of targetUsernames) {
      const userColor = colorFor(metadata, username);
      const userColorSecondary = colorSecondaryFor(metadata, username);
      const userTasks = await tasksStore.listAllForUser(username);
      for (const raw of userTasks) {
        if (raw.is_high_level) continue; // lab mode never surfaces goals
        if (taskTypes && !taskTypes.has(raw.task_type)) continue;
        if (projectId !== null && raw.project_id !== projectId) continue;
        if (methodId !== null && !(raw.method_ids || []).includes(methodId)) continue;
        if (completion === "complete" && !raw.is_complete) continue;
        if (completion === "incomplete" && raw.is_complete) continue;

        const task = computeTaskEndDate(raw);
        if (dateFrom && task.end_date < dateFrom) continue;
        if (dateTo && task.start_date > dateTo) continue;

        let matchField: string = "filter";
        let matchPreview = "";

        if (q) {
          const name = task.name?.toLowerCase() ?? "";
          const tags = (task.tags ?? []).join(" ").toLowerCase();
          const deviation = (task.deviation_log ?? "").toLowerCase();
          if (name.includes(q)) {
            matchField = "name";
          } else if (tags.includes(q)) {
            matchField = "tags";
            matchPreview = previewFrom((task.tags ?? []).join(", "));
          } else if (deviation.includes(q)) {
            matchField = "deviation_log";
            matchPreview = previewFrom(task.deviation_log ?? "");
          } else {
            continue; // no text match
          }
        }

        results.push({
          type: "task",
          id: task.id,
          name: task.name,
          username: task.owner || username,
          user_color: userColor,
          user_color_secondary: userColorSecondary,
          match_field: matchField,
          match_preview: matchPreview,
        });
      }
    }

    // Projects & methods only matter when not filtering to a specific task type.
    if (!taskTypes) {
      for (const username of targetUsernames) {
        const userColor = colorFor(metadata, username);
        const userColorSecondary = colorSecondaryFor(metadata, username);

        const userProjects = await projectsStore.listAllForUser(username);
        for (const p of userProjects) {
          if (projectId !== null && p.id !== projectId) continue;
          if (q && !p.name.toLowerCase().includes(q)) continue;
          results.push({
            type: "project",
            id: p.id,
            name: p.name,
            username: p.owner || username,
            user_color: userColor,
            user_color_secondary: userColorSecondary,
            match_field: q ? "name" : "filter",
            match_preview: "",
          });
        }

        if (projectId === null) {
          const userMethods = await methodsStore.listAllForUser(username);
          for (const m of userMethods) {
            if (methodId !== null && m.id !== methodId) continue;
            if (q && !m.name.toLowerCase().includes(q)) continue;
            results.push({
              type: "method",
              id: m.id,
              name: m.name,
              username: m.owner || username,
              user_color: userColor,
              user_color_secondary: userColorSecondary,
              match_field: q ? "name" : "filter",
              match_preview: "",
            });
          }
        }
      }
    }

    return { results, total_count: results.length };
  },

  getUserTasks: async (username: string): Promise<LabTask[]> => {
    const metadata = await ensureLabUserMetadata([username]);
    const userColor = colorFor(metadata, username);
    const userColorSecondary = colorSecondaryFor(metadata, username);
    const tasks = await tasksStore.listAllForUser(username);
    return tasks.map((t) => labTaskFrom(t, username, userColor, userColorSecondary));
  },

  getUserProjects: async (username: string): Promise<LabProject[]> => {
    const metadata = await ensureLabUserMetadata([username]);
    const userColor = colorFor(metadata, username);
    const projects = await projectsStore.listAllForUser(username);
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color || "#3b82f6",
      username: p.owner || username,
      user_color: userColor,
      is_archived: p.is_archived || false,
    }));
  },

  getUserPurchaseItems: async (username: string, taskId: number): Promise<PurchaseItem[]> => {
    const items = await purchaseItemsStore.listAllForUser(username);
    return items.filter((item) => item.task_id === taskId).map((item) => ({
      ...item,
      total_price: item.total_price ?? (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
      vendor: item.vendor ?? null,
      category: item.category ?? null,
    }));
  },

  getAllPurchaseItems: async (
    _params?: { shared_only?: boolean },
  ): Promise<Array<PurchaseItem & { username: string }>> => {
    const usernames = await discoverUsers();
    const items: Array<PurchaseItem & { username: string }> = [];
    for (const username of usernames) {
      const userItems = await purchaseItemsStore.listAllForUser(username);
      for (const item of userItems) {
        items.push({
          ...item,
          username,
          total_price:
            item.total_price ??
            (item.price_per_unit ?? 0) * item.quantity + (item.shipping_fees ?? 0),
          vendor: item.vendor ?? null,
          category: item.category ?? null,
        });
      }
    }
    return items;
  },

  getNotes: async (params?: { usernames?: string; shared_only?: boolean }): Promise<Note[]> => {
    const usernames = await discoverUsers();
    const notes: Note[] = [];

    for (const username of usernames) {
      const userNotes = await notesStore.listAllForUser(username);
      for (const note of userNotes) {
        notes.push(
          healLegacyNoteShare({ ...note, username: note.username || username }),
        );
      }
    }

    if (params?.shared_only) {
      return notes.filter((n) => n.is_shared);
    }
    return notes;
  },

  getUserNotes: async (username: string): Promise<Note[]> => {
    const notes = await notesStore.listAllForUser(username);
    return notes.map((n) =>
      healLegacyNoteShare({ ...n, username: n.username || username }),
    );
  },

  // Weekly goals widget (PI beta feedback, weekly-goals widget,
  // 2026-05-29). The sharing-respecting cross-lab aggregation. MIRRORS
  // `getNotes` EXACTLY: walk every user's `weekly_goals` dir, stamp the
  // `owner` defensively, then (when `shared_only`) keep only goals whose
  // `is_shared` flag is set. This is GATE 1 — the coarse filter that keeps
  // owner-only goals out of the dataset entirely. The PI widget then
  // applies GATE 2 (`canRead(record, viewer)`) per record, identical to
  // the Trainee notes widget. The PI surface MUST consume this aggregation,
  // never a raw per-user read.
  getWeeklyGoals: async (
    params?: { usernames?: string; shared_only?: boolean },
  ): Promise<WeeklyGoal[]> => {
    const usernames = await discoverUsers();
    const goals: WeeklyGoal[] = [];

    for (const username of usernames) {
      const userGoals = await weeklyGoalsStore.listAllForUser(username);
      for (const goal of userGoals) {
        goals.push({ ...goal, owner: goal.owner || username });
      }
    }

    if (params?.shared_only) {
      return goals.filter((g) => g.is_shared);
    }
    return goals;
  },

  getUserWeeklyGoals: async (username: string): Promise<WeeklyGoal[]> => {
    const goals = await weeklyGoalsStore.listAllForUser(username);
    return goals.map((g) => ({ ...g, owner: g.owner || username }));
  },

  // ── Shared 1:1 Notebooks (notebooks-data bot, 2026-06-02) ──────────────────
  //
  // The cross-lab, sharing-respecting reads for shared notebooks. They MIRROR
  // `getNotes` / `getWeeklyGoals`: walk every user's folder, stamp `owner`
  // defensively, then gate per record. Items created by EITHER member live in
  // that member's own folder, so each of these must aggregate across the whole
  // lab to surface what the other member added.

  /**
   * Every shared notebook the CURRENT viewer participates in (a PI gets one
   * per student; a student gets the one(s) they are in). Membership is the
   * hard gate: a notebook is returned only if the viewer is one of its two
   * `members`. We also pass it through `canRead` (belt-and-suspenders; a
   * member is always in `shared_with` at "edit"). A lab_head who is NOT a
   * member does NOT get the notebook here even though canRead would allow it,
   * because "my notebooks" means the ones I am IN.
   */
  getSharedNotebooks: async (): Promise<SharedNotebook[]> => {
    const viewer = await buildCurrentViewer();
    const usernames = await discoverUsers();
    // The record is mirrored into BOTH members' folders under the same UUID, so
    // a naive walk would surface each notebook twice. DEDUPE by `id`. The
    // notebook survives as long as EITHER member's folder still holds a copy,
    // so a member whose partner was removed still finds it via their own copy.
    const byId = new Map<string, SharedNotebook>();
    const viewerHasOwnCopy = new Set<string>();
    for (const username of usernames) {
      const records = await sharedNotebooksStore.listAllForUser(username);
      for (const nb of records) {
        const rec: SharedNotebook = { ...nb, owner: nb.owner || username };
        if (
          !Array.isArray(rec.members) ||
          !rec.members.includes(viewer.username) ||
          !canRead(rec, viewer)
        ) {
          continue;
        }
        if (username === viewer.username) viewerHasOwnCopy.add(rec.id);
        if (!byId.has(rec.id)) {
          // Stamp the surfaced copy's `owner` to the viewer so the per-user
          // routing the UI expects (owner === viewer) holds regardless of
          // which member folder we read it from.
          byId.set(rec.id, { ...rec, owner: viewer.username });
        }
      }
    }
    // LAZY BACKFILL: heal existing single-copy notebooks (and any drift) by
    // writing the viewer's missing mirror copy. The viewer is the logged-in
    // user (never tombstoned), so this only ever ADDS a copy for a live member.
    // Best-effort and idempotent: a write failure must never break the read.
    for (const [id, rec] of byId) {
      if (viewerHasOwnCopy.has(id)) continue;
      try {
        await sharedNotebooksStore.writeMirror(rec, viewer.username);
      } catch {
        // Backfill is best-effort; the notebook is already surfaced above.
      }
    }
    return Array.from(byId.values());
  },

  /**
   * Every NOTE in a given notebook, across BOTH members' folders, that the
   * viewer can read. Gated by `notebook_id` match + the unified `canRead`
   * (owner = the note's `username` creator, same mapping the lab note widgets
   * use). A non-member, non-lab_head third user reads nothing here; a lab_head
   * non-member still reads via implicit view-all (expected, documented).
   */
  getNotebookNotes: async (notebookId: string): Promise<Note[]> => {
    const viewer = await buildCurrentViewer();
    const usernames = await discoverUsers();
    const out: Note[] = [];
    for (const username of usernames) {
      const userNotes = await notesStore.listAllForUser(username);
      for (const note of userNotes) {
        if (note.notebook_id !== notebookId) continue;
        const stamped = { ...note, username: note.username || username };
        const shareable = {
          owner: stamped.username,
          shared_with: stamped.shared_with ?? [],
        };
        if (canRead(shareable, viewer)) out.push(stamped);
      }
    }
    return out;
  },

  // ── Lab-head <-> member 1:1 cross-user aggregation ───────────────────────
  // 1:1 revamp (oneonone data+strip bot, 2026-06-07). See
  // docs/proposals/NOTEBOOKS_AND_ONE_ON_ONE_REVAMP.md. A 1:1 record lives only
  // in the lab head's folder; the member discovers it by walking every user's
  // folder, exactly like getSharedNotebooks. Items (weekly goals / notes /
  // action items) scoped to a 1:1 live in their author's own folder, so the
  // item aggregations walk every folder and gate on `canRead` (the
  // membersSharedWith share list both members carry).

  /**
   * Every 1:1 the viewer participates in (as the lab head OR the member), across
   * all users' folders, that the viewer can read. The lab head's folder is the
   * canonical home, so a 1:1 is found once (no dedupe needed). The `owner` is
   * stamped from the folder for any pre-stamp record.
   */
  getOneOnOnes: async (): Promise<OneOnOne[]> => {
    const viewer = await buildCurrentViewer();
    const usernames = await discoverUsers();
    const out: OneOnOne[] = [];
    for (const username of usernames) {
      const records = await oneOnOnesStore.listAllForUser(username);
      for (const oo of records) {
        const rec = normalizeOneOnOne({ ...oo, owner: oo.owner || username });
        const isParticipant = rec.members.includes(viewer.username);
        if (!isParticipant || !canRead(rec, viewer)) continue;
        out.push(rec);
      }
    }
    return out;
  },

  /**
   * Every NOTE scoped to a 1:1 (`one_on_one_id` match), across all folders, that
   * the viewer can read. Owner = the note's `username` creator, same mapping the
   * notebook-note aggregation uses.
   */
  getOneOnOneNotes: async (oneOnOneId: string): Promise<Note[]> => {
    const viewer = await buildCurrentViewer();
    const usernames = await discoverUsers();
    const out: Note[] = [];
    for (const username of usernames) {
      const userNotes = await notesStore.listAllForUser(username);
      for (const note of userNotes) {
        if (note.one_on_one_id !== oneOnOneId) continue;
        const stamped = { ...note, username: note.username || username };
        const shareable = {
          owner: stamped.username,
          shared_with: stamped.shared_with ?? [],
        };
        if (canRead(shareable, viewer)) out.push(stamped);
      }
    }
    return out;
  },

  /**
   * Every WEEKLY GOAL scoped to a 1:1 (`one_on_one_id` match), across all
   * folders, that the viewer can read. WeeklyGoal carries a real `owner`, so
   * `canRead` consumes the record directly.
   */
  getOneOnOneWeeklyGoals: async (
    oneOnOneId: string,
  ): Promise<WeeklyGoal[]> => {
    const viewer = await buildCurrentViewer();
    const usernames = await discoverUsers();
    const out: WeeklyGoal[] = [];
    for (const username of usernames) {
      const userGoals = await weeklyGoalsStore.listAllForUser(username);
      for (const goal of userGoals) {
        if (goal.one_on_one_id !== oneOnOneId) continue;
        const stamped = normalizeWeeklyGoal({ ...goal, owner: goal.owner || username });
        const shareable = {
          owner: stamped.owner,
          shared_with: stamped.shared_with ?? [],
        };
        if (canRead(shareable, viewer)) out.push(stamped);
      }
    }
    return out;
  },

  /**
   * Every ACTION ITEM scoped to a 1:1, across all folders, that the viewer can
   * read. Action items live in the lab head's folder (their `owner`), so this
   * finds them once. Gated on `canRead` (both members carry the share list).
   */
  getOneOnOneActionItems: async (
    oneOnOneId: string,
  ): Promise<OneOnOneActionItem[]> => {
    const viewer = await buildCurrentViewer();
    const usernames = await discoverUsers();
    const out: OneOnOneActionItem[] = [];
    for (const username of usernames) {
      const items = await oneOnOneActionItemsStore.listAllForUser(username);
      for (const item of items) {
        if (item.one_on_one_id !== oneOnOneId) continue;
        const stamped = normalizeOneOnOneActionItem({
          ...item,
          owner: item.owner || username,
        });
        if (!canRead(stamped, viewer)) continue;
        // D4 TASK -> ITEM completion: if the member completed the synced to-do
        // in their Lists view, the task's is_complete wins. Reconcile on read
        // and write the corrected is_done back into the owner's folder so the
        // check-in space and the Lists view converge. No cross-owner write —
        // the item lives in `stamped.owner`'s folder, which is where we write.
        const reconciled = await reconcileCompletionFromTask(
          checkinTaskSyncOps,
          stamped.owner,
          stamped,
        );
        if (reconciled.changed) {
          stamped.is_done = reconciled.is_done;
          await oneOnOneActionItemsStore.updateForUser(
            stamped.id,
            { is_done: reconciled.is_done },
            stamped.owner,
          );
        }
        out.push(stamped);
      }
    }
    return out;
  },
};

export const usersApi = {
  list: async (): Promise<{ users: string[]; current_user: string }> => {
    if (!fileService.isConnected()) {
      return { users: [], current_user: "" };
    }

    // Route through `fileService.listDirectories` instead of iterating
    // `getDirectory("users").values()` directly. The wiki-capture / /demo
    // mock patches `listDirectories` to enumerate seeded user dirs but
    // can't expose an FSA-shaped `values()` on its fake handle — calling
    // `.values()` on the stub throws and surfaces as
    // "Failed to load users. Please check your connection." in the
    // UserLoginScreen. Same fix `user-discovery.ts:discoverUsers` already
    // applied; this brings `usersApi.list` in line with it.
    const skipDirs = new Set([
      "public",
      "lab",
      "_no_user_",
      "_global_counters.json",
      "_user_metadata.json",
    ]);
    // Tombstone join: a name with `deleted_at` set in _user_metadata.json is a
    // soft-deleted user. Filter it even if cloud sync (OneDrive Files
    // On-Demand) re-spawned a placeholder folder for the directory entry.
    // INVESTIGATION_USER_LEAKS.md covers the root cause.
    const [allDirs, meta] = await Promise.all([
      fileService.listDirectories("users"),
      readAllUserMetadata(),
    ]);
    const users = allDirs
      .filter((name) => !skipDirs.has(name))
      .filter((name) => !meta[name]?.deleted_at)
      .sort();

    const currentUser = await getCurrentUser();
    return { users, current_user: currentUser || "" };
  },
  
  login: async (username: string): Promise<{ status: string; current_user: string }> => {
    clearCurrentUserCache();
    await storeCurrentUser(username);
    // Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23):
    // run the unified-sharing migration lazily on login. Idempotent: the
    // marker file in users/<u>/_sharing_migration.json short-circuits
    // subsequent runs. Best-effort: failures are swallowed by the helper.
    try {
      const { ensureSharingMigrated } = await import("./sharing/migrate-unified");
      await ensureSharingMigrated(username);
    } catch {
      // Migration helper handles its own errors internally; this catch
      // only fires if the dynamic import itself fails (which would
      // indicate a bundling problem, not data corruption).
    }
    return { status: "ok", current_user: username };
  },

  create: async (username: string): Promise<{ status: string; current_user: string; created: boolean }> => {
    clearCurrentUserCache();
    await storeCurrentUser(username);

    // Curated-default method types (u2-curated-default bot, 2026-05-29).
    // A BRAND-NEW account starts with the short curated picker set
    // (Markdown + PDF + PCR); the rest stay discoverable-but-off in the
    // Extension Store and the user enables them on demand. We stamp the set
    // ONLY here, at genuine account creation (this API is never hit on
    // login — see `usersApi.login`), so EXISTING accounts (whose settings
    // have no `enabledMethodTypes`) keep resolving to all-types-enabled.
    // `CURATED_DEFAULT_METHOD_TYPES` is NOT in DEFAULT_SETTINGS precisely so
    // it cannot retroactively curate existing users.
    //
    // Best-effort: a failed settings write must not block creation. If the
    // patch fails (or the file service isn't connected), the account still
    // resolves to all-enabled, which is a strictly safer fallback than no
    // account at all.
    try {
      const { patchUserSettings } = await import("./settings/user-settings");
      const { CURATED_DEFAULT_METHOD_TYPES } = await import(
        "./methods/method-type-enablement"
      );
      await patchUserSettings(username, {
        enabledMethodTypes: [...CURATED_DEFAULT_METHOD_TYPES],
      });
    } catch (err) {
      console.warn(
        "[usersApi.create] failed to stamp curated method types",
        err,
      );
    }

    return { status: "ok", current_user: username, created: true };
  },
  
  validate: async (): Promise<{ valid: boolean; current_user: string }> => {
    const currentUser = await getCurrentUser();
    if (currentUser) {
      return { valid: true, current_user: currentUser };
    }
    return { valid: false, current_user: "" };
  },
  
  rename: async (oldUsername: string, newUsername: string): Promise<{ status: string; old_username: string; new_username: string }> => {
    // Allow underscores AND hyphens (matches what `usersApi.create` /
    // ensureFolderStructure accept). The UserLoginScreen surface validates
    // letters/digits/underscores only, but archive imports may have created
    // hyphenated names — keep the rename character class a superset of those.
    const sanitized = newUsername.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!sanitized) throw new Error("New username is empty or contains only invalid characters");
    if (sanitized === oldUsername) {
      return { status: "ok", old_username: oldUsername, new_username: sanitized };
    }

    const root = fileService.getDirectoryHandle();
    if (!root) throw new Error("File system not connected");
    const usersDir = await fileService.getDirectory("users");
    if (!usersDir) throw new Error("users/ directory not found");

    const usersHandle = usersDir as unknown as {
      getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>;
      removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
      values: () => AsyncIterable<FileSystemHandle>;
    };

    // Collision check (case-insensitive + tombstone-aware). FSA's
    // `getDirectoryHandle(name)` alone does not catch:
    //   1. `Alice` vs `alice` collisions on case-insensitive filesystems
    //      (macOS APFS default, NTFS) — the OS would happily keep both as
    //      the same on-disk folder, corrupting both users.
    //   2. Tombstoned users (`deleted_at` set in _user_metadata.json) whose
    //      folder bytes may have been removed but whose metadata entry is
    //      still occupying the name slot. Renaming over a tombstone would
    //      silently un-tombstone and merge the deleted user's history.
    // discoverUsers() filters out tombstones, listDirectories() returns the
    // raw on-disk names — we combine both to detect every collision class.
    const [siblingDirs, metaSnapshot] = await Promise.all([
      fileService.listDirectories("users"),
      readAllUserMetadata(),
    ]);
    const sanitizedLower = sanitized.toLowerCase();
    const collidingDir = siblingDirs.find(
      (name) => name.toLowerCase() === sanitizedLower && name !== oldUsername,
    );
    if (collidingDir) {
      throw new Error(
        `Username '${sanitized}' is already in use (matches existing folder '${collidingDir}'). Pick another.`,
      );
    }
    const collidingMetaKey = Object.keys(metaSnapshot).find(
      (key) => key.toLowerCase() === sanitizedLower && key !== oldUsername,
    );
    if (collidingMetaKey) {
      const meta = metaSnapshot[collidingMetaKey];
      if (meta?.deleted_at) {
        throw new Error(
          `Username '${sanitized}' was previously deleted and is still tombstoned. Pick a different name.`,
        );
      }
      throw new Error(
        `Username '${sanitized}' is already in use. Pick another.`,
      );
    }

    const sourceDir = await usersHandle.getDirectoryHandle(oldUsername);
    const targetDir = await usersHandle.getDirectoryHandle(sanitized, { create: true });

    const copyTree = async (
      from: FileSystemDirectoryHandle,
      to: FileSystemDirectoryHandle
    ): Promise<void> => {
      const fromIterable = from as unknown as { values: () => AsyncIterable<FileSystemHandle> };
      const toHandle = to as unknown as {
        getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemFileHandle>;
        getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>;
      };
      for await (const entry of fromIterable.values()) {
        if (entry.kind === "file") {
          const srcFile = await (entry as FileSystemFileHandle).getFile();
          const dest = await toHandle.getFileHandle(entry.name, { create: true });
          const writable = await dest.createWritable();
          await writable.write(await srcFile.arrayBuffer());
          await writable.close();
        } else if (entry.kind === "directory") {
          const subDest = await toHandle.getDirectoryHandle(entry.name, { create: true });
          await copyTree(entry as FileSystemDirectoryHandle, subDest);
        }
      }
    };

    await copyTree(sourceDir, targetDir);
    await usersHandle.removeEntry(oldUsername, { recursive: true });

    // Migrate the _user_metadata.json entry so the user's color / hide-flag
    // / created_at / tutorial-marker travels with the rename. Without this
    // step, the renamed user's color "disappears" — every metadata read
    // would miss the old key, and the next setUserMetadataColors call would
    // create a brand-new entry under the new key (next-available palette
    // slot, not the color the user actually chose). Routed through the same
    // serial queue as setUserMetadataField so a concurrent
    // ensureLabUserMetadata call can't interleave.
    try {
      await renameUserMetadataEntry(oldUsername, sanitized);
    } catch (err) {
      // Best-effort: the folder move already succeeded above. Logging is
      // enough; the user can re-pick their color in Settings if the entry
      // didn't migrate cleanly.
      console.warn(
        `usersApi.rename: metadata entry migration failed for '${oldUsername}' → '${sanitized}'`,
        err,
      );
    }

    // Propagate the rename into every entity JSON's user-bearing fields
    // (orchestrator manager, 2026-05-27). Without this step, `task.owner`
    // stays stamped with the OLD username and the experiment popup's
    // file-read goes to users/<oldName>/results/task-N/notes.md (which no
    // longer exists), surfacing an empty editor while the real file sits
    // at users/<newName>/results/task-N/notes.md. Same drift hits
    // shared_with arrays in OTHER users' records and created_by stamps in
    // users/public/. See lib/users/propagate-rename.ts for the per-field
    // contract. Best-effort: per-file errors are logged inside the helper
    // and never abort the rename transaction.
    try {
      const { propagateOwnerRename } = await import("./users/propagate-rename");
      await propagateOwnerRename(oldUsername, sanitized);
    } catch (err) {
      console.warn(
        `usersApi.rename: owner-field propagation failed for '${oldUsername}' → '${sanitized}' (folder rename already succeeded)`,
        err,
      );
    }

    // If renaming the current user, keep them logged in under the new name.
    const current = await getCurrentUser();
    if (current === oldUsername) {
      clearCurrentUserCache();
      await storeCurrentUser(sanitized);
    }
    // Rename the per-folder Main pin alongside the directory. Also
    // refresh the IDB mirror so the migration shim sees the new name
    // if it runs before the next file read. (The file-write is the
    // authoritative one; the IDB write is purely belt-and-suspenders
    // for the deprecation window — see usersApi.getMainUser above.)
    const fileMain = await readMainUser();
    const idbMain = await getMainUser();
    if (fileMain === oldUsername) {
      await writeMainUser(sanitized);
    }
    if (idbMain === oldUsername) {
      await storeMainUser(sanitized);
    }

    return { status: "ok", old_username: oldUsername, new_username: sanitized };
  },

  logout: async (): Promise<{ status: string; message: string }> => {
    clearCurrentUserCache();
    await clearCurrentUser();
    return { status: "ok", message: "Logged out" };
  },
  
  getMainUser: async (): Promise<{ main_user: string; current_user: string }> => {
    // Per-folder Main: read from users/_user_metadata.json first.
    // The IndexedDB key (`research-os-main-user`) is consulted only as
    // a migration fallback for folders that pre-date this change — once
    // a folder has its main_user field written, the IDB key is no
    // longer authoritative.
    //
    // Bug 2 fix (2026-05-23): the previous impl read Main from
    // IndexedDB only, which is per-machine rather than per-folder. That
    // leaked Main across folder switches: disconnect from folder A
    // (Main=Grant) → connect to folder B (no Main set) → folder B's
    // same-named user got badged (Main) because the IDB key still held
    // "Grant". Now Main lives on disk inside the folder, so switching
    // folders shows that folder's pin or no pin at all.
    const [fileMain, idbMain, currentUser] = await Promise.all([
      readMainUser(),
      getMainUser(),
      getCurrentUser(),
    ]);

    // Migration shim. If the file has no main_user pin but the IDB
    // does, AND the IDB candidate actually exists in this folder's
    // user list, promote it to the file. This is a one-time migration
    // per (folder × IDB candidate) tuple; after the write, the file
    // is authoritative.
    //
    // We DO NOT auto-promote if the IDB candidate is missing from this
    // folder (the bug-2 leak case). The IDB key is per-machine so it
    // routinely holds a username from a different folder; promoting it
    // blindly is what caused the original cross-folder leak.
    let main = fileMain;
    if (!main && idbMain) {
      let validUsers: string[] = [];
      try {
        validUsers = await discoverUsers();
      } catch {
        // discoverUsers swallows + returns []; an explicit throw here
        // means something deeper is wrong. Bail without migrating.
      }
      if (validUsers.includes(idbMain)) {
        // The IDB candidate is genuinely a user in THIS folder. Treat
        // it as an honest legacy pin (set before per-folder storage
        // existed) and migrate. Best-effort; a failed write just
        // leaves the IDB key in place for the next read to retry.
        try {
          await writeMainUser(idbMain);
          main = idbMain;
        } catch {
          // Best-effort migration. Fall back to surfacing the IDB
          // value without promoting it on disk.
          main = idbMain;
        }
      }
      // else: IDB candidate isn't in this folder. That's the leaked
      // cross-folder pin Bug 2 was about. Ignore it and let the file's
      // null win. The picker renders without a (Main) badge.
    }

    // Tombstone-stale guard: if the persisted main_user no longer
    // exists in the folder (manually deleted directory, OneDrive
    // resurrection, etc.), clear it on disk and return empty. Mirrors
    // the validation the old IDB impl had — kept here so the picker
    // doesn't surface a vanished user as Main.
    if (main) {
      let validUsers: string[];
      try {
        validUsers = await discoverUsers();
      } catch {
        return { main_user: main, current_user: currentUser || "" };
      }
      if (validUsers.length > 0 && !validUsers.includes(main)) {
        await writeMainUser(null);
        return { main_user: "", current_user: currentUser || "" };
      }
    }

    return { main_user: main || "", current_user: currentUser || "" };
  },

  setMainUser: async (username: string): Promise<{ status: string; main_user: string }> => {
    // Persist to the per-folder file. Also write to IndexedDB so any
    // legacy code still reading the IDB key sees a consistent value
    // for this session; the IDB key is no longer authoritative but
    // keeping it in sync avoids surprises during the migration
    // window. Empty string clears both surfaces (delete-user path
    // passes "" via `setMainUserPersisted`).
    const normalized = username && username.length > 0 ? username : null;
    await writeMainUser(normalized);
    if (normalized) {
      await storeMainUser(normalized);
    } else {
      await clearMainUser();
    }
    return { status: "ok", main_user: username };
  },
  
  archive: async (username: string): Promise<Blob> => {
    if (!fileService.isConnected()) {
      throw new Error("File system not connected");
    }
    
    const usersDir = await fileService.getDirectory("users");
    if (!usersDir) {
      throw new Error("Users directory not found");
    }
    
    const userDir = await usersDir.getDirectoryHandle(username, { create: false });
    if (!userDir) {
      throw new Error(`User '${username}' not found`);
    }
    
    const zip = new JSZip();
    
    const addFolderToZip = async (dirHandle: FileSystemDirectoryHandle, zipFolder: JSZip) => {
      for await (const entry of dirHandle.values()) {
        // FSA's FileSystemHandle isn't a discriminated union in lib.dom,
        // so TypeScript can't narrow to FileHandle/DirHandle on `kind`.
        // Narrow manually with a single cast per branch.
        if (entry.kind === "file") {
          const file = await (entry as FileSystemFileHandle).getFile();
          const content = await file.arrayBuffer();
          zipFolder.file(entry.name, content);
        } else if (entry.kind === "directory") {
          const subFolder = zipFolder.folder(entry.name);
          if (subFolder) {
            await addFolderToZip(entry as FileSystemDirectoryHandle, subFolder);
          }
        }
      }
    };
    
    await addFolderToZip(userDir, zip);
    
    return await zip.generateAsync({ type: "blob" });
  },
  
  delete: async (username: string, confirmationStep: number, acknowledgedWarning: boolean): Promise<{ status: string; deleted_username: string; message: string }> => {
    if (!fileService.isConnected()) {
      return { status: "error", deleted_username: "", message: "File system not connected" };
    }
    
    if (!acknowledgedWarning) {
      return { status: "error", deleted_username: "", message: "Warning must be acknowledged" };
    }
    
    if (confirmationStep === 1) {
      return { 
        status: "warning", 
        deleted_username: "", 
        message: `This will remove all data for user '${username}'. Please acknowledge and proceed to step 2.` 
      };
    }
    
    if (confirmationStep === 2) {
      try {
        const usersDir = await fileService.getDirectory("users");
        if (!usersDir) {
          return { status: "error", deleted_username: "", message: "Users directory not found" };
        }

        // Tombstone FIRST. This is the authoritative delete record: it
        // survives cloud-sync (OneDrive Files On-Demand can re-spawn the
        // directory as a placeholder after a hard-delete, defeating the
        // recursive removeEntry below). Once tombstoned, discoverUsers and
        // usersApi.list filter the user out regardless of whether the
        // folder bytes still exist on disk. See INVESTIGATION_USER_LEAKS.md.
        await setUserMetadataField(username, "deleted_at", new Date().toISOString());

        // Hard-delete the folder bytes as a best-effort cleanup. On
        // cloud-synced folders this may fail (locked stub, permissions),
        // but the tombstone above is the source of truth; we don't want a
        // cloud-locked folder to abort the delete flow.
        try {
          await usersDir.removeEntry(username, { recursive: true });
        } catch (err) {
          console.warn(
            `usersApi.delete: tombstone written for '${username}' but recursive removeEntry failed (likely cloud-sync stub); user is hidden from pickers regardless`,
            err,
          );
        }

        return {
          status: "ok",
          deleted_username: username,
          message: `User '${username}' has been deleted successfully`
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to delete user";
        return { status: "error", deleted_username: "", message: errorMessage };
      }
    }
    
    return { status: "error", deleted_username: "", message: "Invalid confirmation step" };
  },

  // #14: lab visibility preference. When true, this user's goals are hidden
  // from the lab-mode Roadmaps tab (and the lab GANTT once goals land
  // there). Stored in users/_user_metadata.json.
  getHideGoalsFromLab: async (username: string): Promise<boolean> => {
    const md = await getUserMetadata(username);
    return Boolean(md?.hide_goals_from_lab);
  },
  setHideGoalsFromLab: async (username: string, hide: boolean): Promise<boolean> => {
    const updated = await setUserMetadataField(username, "hide_goals_from_lab", hide);
    return Boolean(updated?.hide_goals_from_lab);
  },
};

async function readBlobAsText(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
}

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const filesApi = {
  readFile: async (path: string): Promise<{ path: string; content: string; sha: string; html_url: string }> => {
    const blob = await fileService.readFileAsBlob(path);
    if (!blob) throw new Error(`File not found: ${path}`);
    const content = await readBlobAsText(blob);
    const sha = await sha1Hex(content);
    return { path, content, sha, html_url: "" };
  },
  writeFile: async (path: string, content: string, _message?: string): Promise<{ path: string; sha: string }> => {
    const blob = new Blob([content], { type: "text/plain" });
    await fileService.writeFileFromBlob(path, blob);
    const sha = await sha1Hex(content);
    return { path, sha };
  },
  uploadImage: async (path: string, base64Content: string, _message?: string): Promise<ImageUploadResponse> => {
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    await fileService.writeFileFromBlob(path, new Blob([bytes]));
    const sha = await sha1Hex(base64Content);
    const parts = path.split("/");
    const filename = parts[parts.length - 1] ?? "";
    const folder = parts.length >= 2 ? parts[parts.length - 2] : "";
    const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "";
    return {
      id: 0,
      path,
      sha,
      download_url: "",
      file_size: bytes.length,
      warning: "",
      added_to_gitignore: false,
      filename,
      original_filename: filename,
      folder,
      file_type: ext,
    };
  },
  listDirectory: async (path?: string): Promise<Array<{ name: string; path: string; type: "file" | "dir"; size: number }>> => {
    if (!path) return [];
    const files = await fileService.listFiles(path);
    return files.map((name) => ({ name, path: `${path}/${name}`, type: "file" as const, size: 0 }));
  },
  deleteDirectory: async (path: string): Promise<{ status: string }> => {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return { status: "not_found" };
    const parentPath = parts.slice(0, -1).join("/");
    const parent = parentPath
      ? await fileService.getDirectory(parentPath)
      : fileService.getDirectoryHandle();
    if (!parent) return { status: "not_found" };
    try {
      await (parent as unknown as { removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void> }).removeEntry(parts[parts.length - 1], { recursive: true });
      return { status: "deleted" };
    } catch {
      return { status: "not_found" };
    }
  },
};

// Fire-and-forget heal pass: when on-disk end_date doesn't match the canonical
// derived value, rewrite the file. Runs after the read so the caller isn't
// blocked. Failures are logged but never propagated — a heal-write that fails
// just means the same fix runs again on the next read.
async function persistEndDateHealForOwn(stale: Task[]): Promise<void> {
  for (const fixed of stale) {
    try {
      await tasksStore.save(fixed.id, fixed);
    } catch (err) {
      console.warn(`[end_date heal] failed to persist task ${fixed.id}:`, err);
    }
  }
}

async function persistEndDateHealForOwner(stale: Array<{ task: Task; owner: string }>): Promise<void> {
  for (const { task, owner } of stale) {
    try {
      await tasksStore.saveForUser(task.id, task, owner);
    } catch (err) {
      console.warn(`[end_date heal] failed to persist shared task ${owner}/${task.id}:`, err);
    }
  }
}

export const fetchAllTasks = async () => {
  const tasks = await tasksStore.listAll();
  const currentUser = await getCurrentUserCached();
  const stale: Task[] = [];
  const out = tasks.map((raw) => {
    const fixed = computeTaskEndDate(raw);
    if (fixed !== raw) stale.push(fixed);
    return normalizeTaskRecord(withOwnerFallback(fixed, currentUser));
  });
  if (stale.length > 0) {
    void persistEndDateHealForOwn(stale);
  }
  return out;
};

// Older tasks were written with `owner: ""`. Reading from
// `users/{currentUser}/tasks/{id}.json` is unambiguous about who owns them,
// so we backfill the field in memory. The on-disk file is left alone (a
// migration script can fix it later). Without this, anything keying off
// `task.owner` — like the per-user results path — would compute `users//...`.
function withOwnerFallback(task: Task, currentUser: string | null): Task {
  if (task.owner) return task;
  return { ...task, owner: currentUser ?? "" };
}

interface SharedWithMeManifest {
  version?: number;
  tasks?: Array<{ id: number; owner: string; permission?: string; shared_at?: string }>;
  projects?: Array<{ id: number; owner: string; permission?: string; shared_at?: string }>;
}

// ── ACL hardening (2026-06-08): source-of-truth permission cross-validation ──
//
// The receiver-side `_shared_with_me.json` manifest is RECEIVER-WRITABLE and can
// drift or be forged. The fetch-all-including-shared loaders used to overlay
// `shared_permission` straight from the manifest entry, so:
//   - after an owner downgrades edit->view (or revokes), the receiver kept
//     editing until a manual reconcile, and
//   - a receiver could hand-edit their own manifest to grant themselves edit
//     on any record they can name.
// The fix: after reading the SOURCE record from the owner's folder, re-derive
// the viewer's effective level from the source's own `shared_with` (the
// owner-controlled source of truth) via the same pure predicates the rest of
// the app uses, and surface THAT level. When the manifest and the source
// disagree, a best-effort manifest repair is queued so the on-disk drift
// converges over time.

type ManifestRepair = {
  itemType: ItemType;
  owner: string;
  id: number;
  /** "remove" drops a revoked/forged entry; "view"/"edit" corrects a stale
   *  permission in place. */
  action: "remove" | "view" | "edit";
};

/**
 * Re-derive the viewer's effective permission on a shared-in record from the
 * SOURCE record's `shared_with`, ignoring whatever the receiver's manifest
 * claimed. Returns "edit" / "view", or null when the viewer has NO access per
 * the source (revoked or forged) and the record must not be surfaced.
 *
 * The lab-head implicit edit-all is intentionally NOT folded in here:
 * `shared_permission === "edit"` drives the silent receiver-edit routing
 * (`effectiveOwnerOf`), whereas a lab head's cross-owner edit goes through the
 * explicit PI-confirm path. So a lab head who is not ALSO an explicit edit-
 * recipient resolves to "view" here (read via the implicit view-all), which is
 * the correct, conservative result.
 */
function deriveSourcePermission(
  source: { owner?: string | null; shared_with?: SharedUser[] | null },
  viewer: Viewer,
  ownerFromManifest: string,
): "edit" | "view" | null {
  const record: ShareableRecord = {
    owner: source.owner ?? ownerFromManifest,
    shared_with: (source.shared_with ?? []) as SharedUser[],
  };
  if (canWriteIgnoringPiRole(record, viewer)) return "edit";
  if (canRead(record, viewer)) return "view";
  return null;
}

/** Best-effort: apply queued `_shared_with_me.json` repairs for `receiver`.
 *  Removes revoked/forged entries and corrects stale permissions. Failures are
 *  logged and swallowed — a repair must never break a read path. */
async function applyManifestRepairs(
  receiver: string | null,
  repairs: ManifestRepair[],
): Promise<void> {
  if (!receiver || repairs.length === 0) return;
  try {
    const manifest = await readSharedWithMe(receiver);
    let changed = false;
    for (const r of repairs) {
      const list = manifest[sharedListKey(r.itemType)];
      const idx = list.findIndex((e) => e.id === r.id && e.owner === r.owner);
      if (idx < 0) continue;
      if (r.action === "remove") {
        list.splice(idx, 1);
        changed = true;
      } else {
        const desired = r.action === "edit" ? "edit" : "view";
        if (list[idx].permission !== desired) {
          list[idx] = { ...list[idx], permission: desired };
          changed = true;
        }
      }
    }
    if (changed) await writeSharedWithMe(receiver, manifest);
  } catch (err) {
    console.warn(`[applyManifestRepairs] failed for ${receiver}:`, err);
  }
}

export const fetchAllTasksIncludingShared = async () => {
  const ownTasks = await tasksStore.listAll();
  const currentUserForOwn = await getCurrentUserCached();
  const ownTasksWithOwner = ownTasks.map((t) => withOwnerFallback(t, currentUserForOwn));

  const sharedTasks: Task[] = [];
  // Track shared tasks whose end_date needs healing, keyed by owner so the
  // write-back lands in the right user directory.
  const sharedToHeal: Array<{ task: Task; owner: string }> = [];
  // De-dup across the two surfacing paths below: a task can be both
  // individually shared AND a member of a shared project. Composite key —
  // numeric ids are namespaced per-owner.
  const seenComposite = new Set<string>();
  // ACL hardening: viewer + queued manifest repairs for source cross-validation.
  const viewer = await buildCurrentViewer();
  const manifestRepairs: ManifestRepair[] = [];
  try {
    const currentUser = currentUserForOwn;
    const manifest = await fileService.readJson<SharedWithMeManifest>(
      `users/${currentUser}/_shared_with_me.json`
    );
    const taskEntries = manifest?.tasks ?? [];
    for (const entry of taskEntries) {
      // Per-user ID spaces mean a shared task's numeric id can collide with one
      // of the viewer's own tasks. Both are surfaced; downstream code keys off
      // `taskKey(task)` (in `frontend/src/lib/types.ts`) to disambiguate.
      const task = await fileService.readJson<Task>(
        `users/${entry.owner}/tasks/${entry.id}.json`
      );
      if (!task) continue;
      // ACL: derive the real permission from the SOURCE task's shared_with, not
      // the receiver-writable manifest. null = revoked/forged → drop + repair.
      const permission = deriveSourcePermission(task, viewer, entry.owner);
      if (permission === null) {
        manifestRepairs.push({ itemType: "task", owner: entry.owner, id: entry.id, action: "remove" });
        continue;
      }
      const manifestPerm = entry.permission === "view" ? "view" : entry.permission === "edit" ? "edit" : undefined;
      if (manifestPerm !== permission) {
        manifestRepairs.push({ itemType: "task", owner: entry.owner, id: entry.id, action: permission });
      }
      const withOwner = {
        ...task,
        owner: entry.owner,
        is_shared_with_me: true,
        shared_permission: permission,
      } as Task;
      sharedTasks.push(withOwner);
      seenComposite.add(`${entry.owner}:${task.id}`);
      // Only attempt heal-write for shared tasks the viewer is allowed to edit.
      // The raw on-disk task (sans the is_shared_with_me / shared_permission
      // overlays) is what gets persisted.
      if (permission === "edit") {
        const expected = canonicalEndDate(task);
        if (task.end_date !== expected) {
          sharedToHeal.push({ task: { ...task, end_date: expected }, owner: entry.owner });
        }
      }
    }

    // Also surface tasks belonging to shared PROJECTS. Sharing a project is
    // meant to share its tasks too — without this loop, the receiver sees the
    // project shell with zero tasks (or, worse, their own tasks whose numeric
    // project_id collides with the shared project's id). The receiver inherits
    // the project's permission for each pulled task.
    const projectEntries = manifest?.projects ?? [];
    for (const projEntry of projectEntries) {
      // ACL: a forged projects[] entry would otherwise hand the receiver edit
      // on EVERY task in the owner's project. Validate the project share
      // against the SOURCE project record before inheriting its permission.
      const srcProject = await fileService.readJson<Project>(
        `users/${projEntry.owner}/projects/${projEntry.id}.json`
      );
      const projPermission = srcProject
        ? deriveSourcePermission(srcProject, viewer, projEntry.owner)
        : null;
      if (projPermission === null) {
        // Drop the manifest entry only when we positively confirmed the source
        // exists but no longer grants access (revoked/forged). A missing source
        // file (deleted project / read race) is left for delete propagation.
        if (srcProject) {
          manifestRepairs.push({ itemType: "project", owner: projEntry.owner, id: projEntry.id, action: "remove" });
        }
        continue;
      }
      let ownerTasks: Task[] = [];
      try {
        ownerTasks = await tasksStore.listAllForUser(projEntry.owner);
      } catch (err) {
        console.warn(
          `[fetchAllTasksIncludingShared] failed to load tasks for shared project ${projEntry.owner}/${projEntry.id}:`,
          err
        );
        continue;
      }
      for (const task of ownerTasks) {
        if (task.project_id !== projEntry.id) continue;
        const composite = `${projEntry.owner}:${task.id}`;
        if (seenComposite.has(composite)) continue;
        seenComposite.add(composite);
        sharedTasks.push({
          ...task,
          owner: projEntry.owner,
          is_shared_with_me: true,
          shared_permission: projPermission,
        } as Task);
        if (projPermission === "edit") {
          const expected = canonicalEndDate(task);
          if (task.end_date !== expected) {
            sharedToHeal.push({ task: { ...task, end_date: expected }, owner: projEntry.owner });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[fetchAllTasksIncludingShared] failed to load shared tasks:", err);
  }
  if (manifestRepairs.length > 0) void applyManifestRepairs(currentUserForOwn, manifestRepairs);

  // Cross-owner host (Option C). For every project owned by the CURRENT
  // user, read the `<projectId>-hosted.json` manifest and pull each foreign
  // task that's been shared INTO it. The task file itself lives in its
  // owner's namespace; surfacing it here means Gantt / project views /
  // search all see it without each callsite re-implementing the join.
  //
  // We also surface hosted tasks belonging to projects the viewer has been
  // SHARED into (shared-project receivers see hosted-from-others entries
  // too, since the project's Gantt is meant to be the shared canonical view).
  //
  // Read-time normalize repairs drift in each manifest as it's read.
  try {
    const { readHostedManifestNormalized } = await import(
      "./sharing/project-hosting"
    );
    const currentUser = currentUserForOwn;

    // Set of (projectOwner, projectId) the viewer should consult for hosted
    // entries: their own projects + shared-into projects.
    const projectsToScan: Array<{ owner: string; id: number }> = [];
    if (currentUser) {
      for (const p of await projectsStore.listAll()) {
        projectsToScan.push({ owner: currentUser, id: p.id });
      }
      try {
        const manifest = await fileService.readJson<SharedWithMeManifest>(
          `users/${currentUser}/_shared_with_me.json`
        );
        for (const projEntry of manifest?.projects ?? []) {
          projectsToScan.push({ owner: projEntry.owner, id: projEntry.id });
        }
      } catch (err) {
        console.warn(
          "[fetchAllTasksIncludingShared] failed to list shared-project hosts:",
          err
        );
      }
    }

    for (const { owner: projectOwner, id: projectId } of projectsToScan) {
      let entries;
      try {
        entries = await readHostedManifestNormalized(
          projectOwner,
          projectId,
          async (owner, id) => tasksStore.getForUser(id, owner)
        );
      } catch (err) {
        console.warn(
          `[fetchAllTasksIncludingShared] failed to read hosted manifest ${projectOwner}/${projectId}:`,
          err
        );
        continue;
      }
      for (const entry of entries) {
        const composite = `${entry.owner}:${entry.taskId}`;
        if (seenComposite.has(composite)) continue;
        const raw = await tasksStore.getForUser(entry.taskId, entry.owner);
        if (!raw) continue;
        seenComposite.add(composite);
        sharedTasks.push({
          ...raw,
          owner: entry.owner,
          is_shared_with_me: true,
          // Hosted tasks are display-only for the destination side. v1
          // doesn't grant edit rights to the destination project owner.
          shared_permission: "view",
        } as Task);
      }
    }
  } catch (err) {
    console.warn(
      "[fetchAllTasksIncludingShared] failed to load hosted-from-others tasks:",
      err
    );
  }

  const ownStale: Task[] = [];
  const merged = [...ownTasksWithOwner, ...sharedTasks].map((raw) => {
    const fixed = computeTaskEndDate(raw);
    // Only heal own (non-shared) entries here. Shared-task heals were captured
    // separately above so they get routed to the owner's directory.
    if (fixed !== raw && !raw.is_shared_with_me) ownStale.push(fixed);
    return normalizeTaskRecord(fixed);
  });

  if (ownStale.length > 0) void persistEndDateHealForOwn(ownStale);
  if (sharedToHeal.length > 0) void persistEndDateHealForOwner(sharedToHeal);

  // Guardrail: composite keys must be unique across the merged list. Hitting
  // this means the keying scheme is inconsistent somewhere upstream.
  if (process.env.NODE_ENV !== "production") {
    const seen = new Set<string>();
    for (const t of merged) {
      const ns = t.is_shared_with_me ? (t.owner || "shared") : "self";
      const key = `${ns}:${t.id}`;
      if (seen.has(key)) {
        console.error(`[fetchAllTasksIncludingShared] duplicate composite key: ${key}`);
      }
      seen.add(key);
    }
  }

  return merged;
};

// Mirror of `fetchAllTasksIncludingShared` for methods. Reads the receiver's
// `_shared_with_me.json` manifest and pulls each shared method from the
// owner's private dir, overlaying `is_shared_with_me` / `shared_permission` /
// `owner` at read time. Public methods are already surfaced by
// `methodsApi.list`; this only adds the receiver-shared private ones.
export const fetchAllMethodsIncludingShared = async (): Promise<Method[]> => {
  const currentUser = await getCurrentUserCached();
  // Provenance ownership: methodsApi.list() reads the CURRENT user's own
  // methods folder, so every method it returns belongs to the current user.
  // Methods created before the owner / created_by attribution fields existed
  // carry neither, and without backfilling owner from provenance here
  // isOwnMethod() wrongly files the user's OWN methods under "Shared with
  // Lab" and makes them look un-editable (Grant 2026-05-29). Backfill owner
  // when absent, and mark own-folder methods as not shared-in.
  const ownMethods: Method[] = (await methodsApi.list()).map((m) => ({
    ...m,
    owner: m.owner ?? currentUser ?? undefined,
    is_shared_with_me: false,
  }));

  // Tombstone gate (delete-affordances bot, 2026-05-29): a shared-in
  // manifest entry can point at an owner who was since deleted (their
  // `_user_metadata.json` row carries `deleted_at`). discoverUsers() already
  // hides those users everywhere else, but the shared-in path below reads
  // `users/<owner>/methods/...` straight from the manifest without that
  // filter, so a method owned by a tombstoned user used to slip into the
  // list with no way to remove it. Skip any entry whose owner is tombstoned.
  const allUserMeta = await readAllUserMetadata();
  const isTombstonedOwner = (owner: string | undefined | null): boolean =>
    !!owner && !!allUserMeta[owner]?.deleted_at;

  const sharedMethods: Method[] = [];
  // ACL hardening: cross-validate each shared method against the SOURCE record.
  const viewer = await buildCurrentViewer();
  const manifestRepairs: ManifestRepair[] = [];
  try {
    const manifest = await fileService.readJson<SharedManifest>(
      `users/${currentUser}/_shared_with_me.json`
    );
    const entries = manifest?.methods ?? [];
    for (const entry of entries) {
      if (isTombstonedOwner(entry.owner)) continue;
      const method = await fileService.readJson<Method>(
        `users/${entry.owner}/methods/${entry.id}.json`
      );
      if (!method) continue;
      // ACL: derive the real permission from the SOURCE method's shared_with,
      // not the receiver-writable manifest. null = revoked/forged → drop.
      const permission = deriveSourcePermission(method, viewer, entry.owner);
      if (permission === null) {
        manifestRepairs.push({ itemType: "method", owner: entry.owner, id: entry.id, action: "remove" });
        continue;
      }
      const manifestPerm = entry.permission === "view" ? "view" : entry.permission === "edit" ? "edit" : undefined;
      if (manifestPerm !== permission) {
        manifestRepairs.push({ itemType: "method", owner: entry.owner, id: entry.id, action: permission });
      }
      const withOverlay = {
        ...method,
        owner: entry.owner,
        is_public: false,
        is_shared_with_me: true,
        shared_permission: permission,
      } as Method;
      sharedMethods.push(withOverlay);
    }
  } catch (err) {
    console.warn("[fetchAllMethodsIncludingShared] failed to load shared methods:", err);
  }
  if (manifestRepairs.length > 0) void applyManifestRepairs(currentUser, manifestRepairs);

  return [...ownMethods, ...sharedMethods];
};

// Mirror of `fetchAllTasksIncludingShared` for projects.
/**
 * Options for `fetchAllProjectsIncludingShared`.
 *
 * `includeHidden` controls whether hidden projects (currently only the
 * per-user `_misc_purchases` project backing the Miscellaneous purchases
 * category) are returned. Default `false` so every surface — Home grid,
 * Workbench, Gantt, project pickers, search, settings, daily sidebar — sees
 * a clean list. Only `/purchases` opts in. See lib/purchases/misc-project.ts
 * for the canonical predicate and bootstrap.
 *
 * The argument is typed `unknown` so direct use as a React Query
 * `queryFn` keeps working — RQ passes a context object as the first
 * argument, which we narrow at runtime and treat as "no options" if it
 * isn't shaped like FetchAllProjectsOptions. Surfaces that want the
 * misc bucket call `fetchAllProjectsIncludingShared({ includeHidden: true })`
 * explicitly (e.g. /purchases) instead of binding the bare function.
 */
export interface FetchAllProjectsOptions {
  includeHidden?: boolean;
}

function pickHiddenOption(arg: unknown): boolean {
  if (
    arg &&
    typeof arg === "object" &&
    "includeHidden" in arg &&
    typeof (arg as { includeHidden?: unknown }).includeHidden === "boolean"
  ) {
    return (arg as { includeHidden: boolean }).includeHidden;
  }
  return false;
}

export const fetchAllProjectsIncludingShared = async (
  options?: FetchAllProjectsOptions | unknown,
): Promise<Project[]> => {
  const includeHidden = pickHiddenOption(options);
  const currentUser = await getCurrentUserCached();
  const ownProjects = await projectsStore.listAll();
  // Older projects on disk predate the `owner` field — they shipped without
  // it because the original schema was single-user. The receiver-side merge
  // gives each shared project an `owner` overlay (see below), but own
  // projects with no on-disk `owner` field stayed as `undefined`. Downstream
  // consumers that pair projects to tasks via `(id, owner)` strict equality
  // — e.g. /experiments `groupedChains`, /search, /results, /purchases —
  // then silently drop chains whose root task got an owner backfilled by
  // `fetchAllTasksIncludingShared` because no project matched `(id, undefined)`.
  // Backfill here, mirroring `withOwnerFallback` for tasks. The file on disk
  // stays untouched until the next write through `projectsApi.update`; this
  // is a read-time overlay only, same as task `withOwnerFallback`.
  const ownProjectsWithOwner = ownProjects.map((p) =>
    p.owner ? p : ({ ...p, owner: currentUser ?? "" } as Project),
  );
  // Default ordering: newest first within sort_order ties so freshly-created
  // projects land at the top of the home + workbench grids. The onboarding
  // walkthrough relies on this: §6.2 opens the just-created project by
  // clicking the first card, so the new project must be deterministically
  // first. Manually-reordered projects keep their sort_order (which the
  // reorder API assigns as 0..N); the created_at tie-break only kicks in
  // for the default sort_order=0 case (every project pre-reorder, plus any
  // new project after a reorder).
  ownProjectsWithOwner.sort((a, b) => {
    const aSort = a.sort_order ?? 0;
    const bSort = b.sort_order ?? 0;
    if (aSort !== bSort) return aSort - bSort;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

  const sharedProjects: Project[] = [];
  // ACL hardening: cross-validate each shared project against the SOURCE record.
  const viewer = await buildCurrentViewer();
  const manifestRepairs: ManifestRepair[] = [];
  try {
    const manifest = await fileService.readJson<SharedManifest>(
      `users/${currentUser}/_shared_with_me.json`
    );
    const entries = manifest?.projects ?? [];
    for (const entry of entries) {
      const project = await fileService.readJson<Project>(
        `users/${entry.owner}/projects/${entry.id}.json`
      );
      if (!project) continue;
      // ACL: derive the real permission from the SOURCE project's shared_with,
      // not the receiver-writable manifest. null = revoked/forged → drop.
      const permission = deriveSourcePermission(project, viewer, entry.owner);
      if (permission === null) {
        manifestRepairs.push({ itemType: "project", owner: entry.owner, id: entry.id, action: "remove" });
        continue;
      }
      const manifestPerm = entry.permission === "view" ? "view" : entry.permission === "edit" ? "edit" : undefined;
      if (manifestPerm !== permission) {
        manifestRepairs.push({ itemType: "project", owner: entry.owner, id: entry.id, action: permission });
      }
      const withOverlay = {
        ...project,
        owner: entry.owner,
        is_shared_with_me: true,
        shared_permission: permission,
      } as Project;
      sharedProjects.push(withOverlay);
    }
  } catch (err) {
    console.warn("[fetchAllProjectsIncludingShared] failed to load shared projects:", err);
  }
  if (manifestRepairs.length > 0) void applyManifestRepairs(currentUser, manifestRepairs);

  const combined = [...ownProjectsWithOwner, ...sharedProjects];
  // Defense-in-depth filter (tour orphan project R1, 2026-05-26): drop
  // any record without a usable `id`. The upstream `JsonStore.listAll`
  // now skips `<id>-hosted.json` sidecars (the root cause for the
  // "(unnamed project)" orphan card), but this read-time guard catches
  // ANY shape where the on-disk file lacks a numeric id — including
  // partial-write races on hot reload, schema-drift records from prior
  // app versions, and any future sidecar that lands in `projects/`.
  // Records without an id can't be deleted via the kebab menu (the
  // delete API takes an integer id), so surfacing them as orphan cards
  // is a dead-end UX. Better to drop silently and rely on the
  // `OrphanProjectSweep` cleanup to handle name-empty-but-id-valid
  // records via the kebab path.
  const idValid = combined.filter(
    (p) => Number.isInteger(p.id) && (p.id as number) > 0,
  );
  // Default: filter out hidden projects (e.g. the per-user `_misc_purchases`
  // bootstrap that backs the Miscellaneous purchases category). Every surface
  // EXCEPT /purchases relies on this default; /purchases passes
  // `{ includeHidden: true }` so the misc bucket can be grouped on screen.
  // Shared projects with `is_hidden` are also filtered: the field travels on
  // disk, so a recipient of a misshared hidden project would otherwise see a
  // ghost card on Home.
  if (!includeHidden) {
    return idValid.filter((p) => !p.is_hidden);
  }
  return idValid;
};

export type {
  Project,
  ProjectCreate,
  ProjectUpdate,
  Task,
  TaskCreate,
  TaskUpdate,
  TaskMoveRequest,
  Dependency,
  DependencyCreate,
  Method,
  MethodCreate,
  MethodUpdate,
  Event,
  EventCreate,
  EventUpdate,
  HighLevelGoal,
  HighLevelGoalCreate,
  HighLevelGoalUpdate,
  SmartGoal,
  PCRProtocol,
  PCRProtocolCreate,
  PCRProtocolUpdate,
  LCGradientProtocol,
  LCGradientProtocolCreate,
  LCGradientProtocolUpdate,
  PlateProtocol,
  PlateProtocolCreate,
  PlateProtocolUpdate,
  MassSpecProtocol,
  MassSpecProtocolCreate,
  MassSpecProtocolUpdate,
  CodingWorkflowProtocol,
  CodingWorkflowProtocolCreate,
  CodingWorkflowProtocolUpdate,
  PurchaseItem,
  PurchaseItemCreate,
  PurchaseItemUpdate,
  FundingAccount,
  FundingAccountCreate,
  FundingAccountUpdate,
  FunderIdType,
  LabLink,
  LabLinkCreate,
  LabLinkUpdate,
  Note,
  NoteCreate,
  NoteUpdate,
  NoteComment,
  TaskComment,
  ImageMetadata,
  FileMetadata,
  CatalogItem,
  ShiftResult,
  SharedUser,
  ShareRequest,
  SharedItemEntry,
  Notification,
};

export interface LabUser {
  username: string;
  color: string;
  /** Optional gradient stop 2. `null` when the user has only picked a solid
   *  primary color. Lab Mode surfaces should render
   *  `linear-gradient(135deg, color, color_secondary)` when present and fall
   *  back to a solid `color` otherwise. */
  color_secondary: string | null;
  created_at: string | null;
}

export interface LabTask {
  id: number;
  name: string;
  project_id: number;
  start_date: string;
  duration_days: number;
  end_date: string;
  is_complete: boolean;
  task_type: string;
  username: string;
  user_color: string;
  /** Mirrors LabUser.color_secondary — denormalized onto each task so the
   *  Lab Gantt can render a gradient bar without a separate user lookup. */
  user_color_secondary: string | null;
  experiment_color: string | null;
  method_ids: number[];
  notes: string | null;
}

export interface LabProject {
  id: number;
  name: string;
  color: string;
  username: string;
  user_color: string;
  is_archived: boolean;
}

/**
 * Project-widgets family (project-widgets, 2026-05-29): the shape
 * returned by `labApi.getProjectsWithProgress`. UNLIKE `LabProject` it
 * carries the unified-sharing primitive fields (`owner` + `shared_with`)
 * so the consuming widget can run `canRead(record, viewer)` itself:
 * the project records double as `ShareableRecord`s. Adds task-derived
 * progress so the widget can render a progress bar + incomplete-task
 * count without a second cross-lab tasks fetch.
 */
export interface ViewerVisibleProject {
  id: number;
  name: string;
  color: string;
  /** Project owner username. Used by the `canRead` gate + as the
   *  per-owner namespace key when opening the project route. */
  owner: string;
  /** Raw sharing list straight off the on-disk record. Feeds the
   *  `canRead` gate in the widget. */
  shared_with: SharedUser[];
  /** The owner's avatar/display color. */
  user_color: string;
  taskTotal: number;
  taskCompleted: number;
  taskIncomplete: number;
  /**
   * Per-project incomplete-task breakdown (additive, single-project-widget
   * bot, 2026-05-29), mirroring the old Home project cards. `today` is the
   * viewer's LOCAL YYYY-MM-DD.
   *   - `taskUpcoming` = incomplete tasks whose `start_date >= today`
   *   - `taskOverdue`  = incomplete tasks whose `end_date < today`
   *   - `taskActive`   = incomplete tasks spanning today
   *     (`start_date <= today && end_date >= today`)
   * Lets the Single-Project widget render an at-a-glance Active / Overdue /
   * Upcoming counts row without a second cross-lab tasks fetch.
   *
   * Marked OPTIONAL so the addition stays purely additive: existing
   * `ViewerVisibleProject` literals elsewhere (e.g. the Projects Overview
   * widget's test fixtures) keep type-checking without edits.
   * `getProjectsWithProgress` ALWAYS populates these, so a live record never
   * omits them; the consuming widget defaults to 0 for the (test-only)
   * absent case.
   */
  taskUpcoming?: number;
  taskOverdue?: number;
  taskActive?: number;
}

export interface LabMethod {
  id: number;
  name: string;
  username: string;
  user_color: string;
  is_public: boolean;
}

export interface LabGoal {
  id: number;
  name: string;
  project_id: number | null;
  start_date: string;
  end_date: string;
  is_complete: boolean;
  color: string | null;
  smart_goals: SmartGoal[];
  username: string;
  user_color: string;
}

export interface LabSearchResult {
  type: string;
  id: number;
  name: string;
  username: string;
  user_color: string;
  /** Optional gradient stop 2 mirrored from the user's metadata. `null` for
   *  users who only have a solid primary color. */
  user_color_secondary: string | null;
  match_field: string;
  match_preview: string;
}

export interface DuplicateCheckResult {
  has_duplicate: boolean;
  matching_tasks: Array<{
    id: number;
    name: string;
    task_type: string;
    start_date: string;
    is_complete: boolean;
  }>;
}

export interface ImageUploadResponse {
  id: number;
  path: string;
  sha: string;
  download_url: string;
  file_size: number;
  warning?: string;
  added_to_gitignore: boolean;
  filename: string;
  original_filename: string;
  folder: string;
  file_type: string;
}

export interface MethodExperiment {
  id: number;
  name: string;
  project_id: number;
  start_date: string;
  duration_days: number;
  end_date: string;
  is_complete: boolean;
  task_type: string;
  experiment_color: string | null;
  variation_notes: string | null;
}
