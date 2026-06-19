// Lab-tier Phase 3 chunk 2b-bind (enumeration half): local-api LabWorkSource adapter.
//
// PURPOSE: returns a LabWorkSource backed by the live local JsonStore layer so
// that a member's own folder can be enumerated by the sync engine.
//
// RAW RECORDS: each method returns the raw persisted record objects with NO
// runtime-derived or volatile fields. This satisfies the enumerator's volatile-
// field caveat (see lab-work-enumerate.ts): volatile fields (e.g. a freshly
// computed display string injected at read time) would cause the sha256 to
// change on every sync run, defeating the chunk-2a deduplication entirely. The
// records returned here are exactly what gets canonical-serialized, hashed, and
// pushed by the sync engine.
//
// FUTURE WIRING: the runtime push trigger, lab-key acquisition, and session
// binding are chunk 2b-bind / Phase 5. This module is the enumeration-side half
// only; it has no knowledge of the lab session or R2 destination.
//
// PATTERN PRECEDENT: instantiating JsonStore at module scope (or inside the
// factory) matches the pattern in frontend/src/lib/engine/shift.ts. Each
// JsonStore is a cheap stateless handle; creating one per call is fine too, but
// module-scope instances are marginally more efficient.
//
// DATAHUB PATTERN: listDatahub replicates the private listMirrorsForOwner
// function in src/lib/datahub/api.ts (lines 61-73). It uses dataHubDir +
// readDataHubMirror from datahub-sidecar-store and the shared fileService, then
// spreads the mirror content with mirror.meta.id as the top-level id field so
// the enumerator can use it as a stable, non-volatile record key.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { JsonStore } from "@/lib/storage/json-store";
import type {
  Task,
  Note,
  Method,
  PurchaseItem,
  InventoryItem,
  InventoryStock,
  Deposit,
  WeeklyGoal,
} from "@/lib/types";
import { sequencesApi } from "@/lib/local-api";
import { phyloApi } from "@/lib/phylo/api";
import { moleculeStore } from "@/lib/chemistry/molecule-store";
import {
  dataHubDir,
  readDataHubMirror,
} from "@/lib/loro/datahub-sidecar-store";
import { fileService } from "@/lib/file-system/file-service";
import {
  OneOnOneStore,
  OneOnOneActionItemStore,
} from "@/lib/one-on-one/store";
import { IdpStore } from "@/lib/idp/store";
import { stripIdpForMirror } from "@/lib/idp/visibility";
import type { IDP } from "@/lib/types";
import { LAB_AS_FOLDER_ENABLED } from "./lab-as-folder-config";
import { CheckinCompactStore } from "@/lib/checkins/compact-store";
import { CheckinOnboardingStore } from "@/lib/checkins/onboarding-store";
import { CheckinRotationStore } from "@/lib/checkins/rotation-store";
import { listAnnouncements } from "./announcements";
import type { LabWorkSource, OwnedRecord } from "./lab-work-enumerate";

// ---------------------------------------------------------------------------
// createLocalApiLabWorkSource
// ---------------------------------------------------------------------------

/**
 * Returns a LabWorkSource implementation backed by the live local JsonStore
 * layer. Each method calls `listAllForUser(owner)` on the appropriate
 * per-collection JsonStore instance, which reads the owner's persisted JSON
 * files from the data folder.
 *
 * The returned records are the raw persisted objects (no runtime-derived
 * fields). They satisfy the OwnedRecord constraint because every persisted
 * record has a numeric `id` field. They are cast to OwnedRecord[] so the
 * enumerator can treat them opaquely during canonical serialization.
 *
 * Collection names: tasks -> "tasks", notes -> "notes",
 *   methods -> "methods", purchases -> "purchase_items",
 *   inventory -> "inventory_items", inventory stock -> "inventory_stocks".
 * Sequences, phylo trees, molecules, and datahub documents each use their own
 * dedicated API/store rather than a raw JsonStore.
 *
 * P2 mentorship / check-in coverage: one-on-ones, action items, IDPs, weekly
 * goals, compacts, onboarding checklists, and rotations each route through their
 * dedicated per-user store (OneOnOneStore / IdpStore / Checkin*Store), all of
 * which expose listAllForUser(owner). These were OMITTED by the original mirror,
 * so the member pull could never serve the entire 1:1 domain until now.
 *
 * The member-push case always calls with owner === the current user, but the
 * same owner-scoped reads also support a future cross-owner read (PI pulling
 * a member's records).
 */
export function createLocalApiLabWorkSource(): LabWorkSource {
  const tasksStore = new JsonStore<Task>("tasks");
  const notesStore = new JsonStore<Note>("notes");
  const methodsStore = new JsonStore<Method>("methods");
  const purchasesStore = new JsonStore<PurchaseItem>("purchase_items");
  const inventoryItemsStore = new JsonStore<InventoryItem>("inventory_items");
  const inventoryStocksStore = new JsonStore<InventoryStock>("inventory_stocks");
  const depositsLocalStore = new JsonStore<Deposit>("deposits");
  // P2 multi-lab relay-pull: the mentorship / check-in stores. These are
  // string-keyed per-user stores (crypto.randomUUID ids), except weeklyGoals
  // which is a numeric JsonStore. Each record carries owner + shared_with so
  // pullLabView's per-record shared_with gate handles member visibility.
  const oneOnOnesStore = new OneOnOneStore();
  const oneOnOneActionItemsStore = new OneOnOneActionItemStore();
  const idpsStore = new IdpStore();
  const weeklyGoalsLocalStore = new JsonStore<WeeklyGoal>("weekly_goals");
  const checkinCompactsStore = new CheckinCompactStore();
  const checkinOnboardingStore = new CheckinOnboardingStore();
  const checkinRotationsStore = new CheckinRotationStore();

  return {
    listTasks(owner: string): Promise<OwnedRecord[]> {
      // Task also lacks an index signature; route through unknown.
      return tasksStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listNotes(owner: string): Promise<OwnedRecord[]> {
      // Route through unknown: Note lacks an index signature so a direct cast
      // to OwnedRecord[] (which has [k: string]: unknown) would be rejected by
      // tsc without the intermediate unknown assertion.
      return notesStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listMethods(owner: string): Promise<OwnedRecord[]> {
      return methodsStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listPurchases(owner: string): Promise<OwnedRecord[]> {
      return purchasesStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listInventory(owner: string): Promise<OwnedRecord[]> {
      return inventoryItemsStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listInventoryStock(owner: string): Promise<OwnedRecord[]> {
      return inventoryStocksStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listSequences(owner: string): Promise<OwnedRecord[]> {
      // SequenceRecord lacks an index signature; route through unknown.
      return sequencesApi.getForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listPhylo(owner: string): Promise<OwnedRecord[]> {
      // PhyloMeta lacks an index signature; route through unknown.
      return phyloApi.listForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listMolecules(owner: string): Promise<OwnedRecord[]> {
      // MoleculeMeta lacks an index signature; route through unknown.
      return moleculeStore.listMetaForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    async listDatahub(owner: string): Promise<OwnedRecord[]> {
      // Replicates the private listMirrorsForOwner pattern from datahub/api.ts.
      // Each mirror is spread with mirror.meta.id as the top-level id so the
      // enumerator has a stable, non-volatile key. mirror.meta.id is the persisted
      // DataHubDocument.id field; it is never runtime-derived.
      const files = await fileService.listFiles(dataHubDir(owner));
      const out: OwnedRecord[] = [];
      for (const name of files) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        const mirror = await readDataHubMirror(owner, id);
        if (mirror && mirror.meta.id) {
          out.push({ id: mirror.meta.id, ...mirror } as unknown as OwnedRecord);
        }
      }
      return out;
    },
    listResultSheets(owner: string): Promise<OwnedRecord[]> {
      return readTaskSheets(owner, "results");
    },
    listNotesSheets(owner: string): Promise<OwnedRecord[]> {
      return readTaskSheets(owner, "notes");
    },
    listDeposits(owner: string): Promise<OwnedRecord[]> {
      // Deposit lacks an index signature; route through unknown so tsc accepts
      // the cast to OwnedRecord[]. The raw persisted record has no volatile
      // fields, satisfying the canonical-bytes deduplication requirement.
      return depositsLocalStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    // P2 mentorship / check-in coverage. FLAG GATE (byte-identical-off): when
    // LAB_AS_FOLDER_ENABLED is off, every new type returns [] so the enumerator
    // produces the EXACT same LabWorkRecord[] it did before P2, and the mirror
    // pushes nothing new. The additions are completely inert with the flag off.
    listOneOnOnes(owner: string): Promise<OwnedRecord[]> {
      // OneOnOne lacks an index signature; route through unknown. id is a
      // crypto.randomUUID string, which the enumerator stringifies verbatim.
      if (!LAB_AS_FOLDER_ENABLED) return Promise.resolve([]);
      return oneOnOnesStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listOneOnOneActionItems(owner: string): Promise<OwnedRecord[]> {
      if (!LAB_AS_FOLDER_ENABLED) return Promise.resolve([]);
      return oneOnOneActionItemsStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    async listIdps(owner: string): Promise<OwnedRecord[]> {
      // IDP is trainee-owned. P3 PRIVACY FIX (must-fix): the RAW persisted record
      // carries the always-private values reflection AND any section the trainee
      // has NOT shared. Pushing it verbatim would mirror that private content to
      // R2 and, after a pull, land it on the mentor's disk; read-time blanking
      // (normalizeIdpForViewer) is INSUFFICIENT because the raw bytes are already
      // off-device. We strip at PUSH (stripIdpForMirror) so the never-shared
      // content NEVER leaves the trainee's device. The shared_with gate is
      // preserved, so pullLabView still surfaces it only to a named recipient and
      // the read-time normalize still narrows to that viewer's shared sections.
      if (!LAB_AS_FOLDER_ENABLED) return [];
      const raw = await idpsStore.listAllForUser(owner);
      return raw.map((idp) => stripIdpForMirror(idp as unknown as IDP)) as unknown as OwnedRecord[];
    },
    listWeeklyGoals(owner: string): Promise<OwnedRecord[]> {
      // WeeklyGoal carries owner + shared_with. Numeric JsonStore id.
      if (!LAB_AS_FOLDER_ENABLED) return Promise.resolve([]);
      return weeklyGoalsLocalStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listCheckinCompacts(owner: string): Promise<OwnedRecord[]> {
      if (!LAB_AS_FOLDER_ENABLED) return Promise.resolve([]);
      return checkinCompactsStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listCheckinOnboarding(owner: string): Promise<OwnedRecord[]> {
      if (!LAB_AS_FOLDER_ENABLED) return Promise.resolve([]);
      return checkinOnboardingStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    listCheckinRotations(owner: string): Promise<OwnedRecord[]> {
      if (!LAB_AS_FOLDER_ENABLED) return Promise.resolve([]);
      return checkinRotationsStore.listAllForUser(owner) as unknown as Promise<OwnedRecord[]>;
    },
    // ANNOUNCEMENTS (lab-wide-public exception). Announcements live in the
    // lab-ROOT _announcements.json file (NOT a per-user store), are PI-written,
    // and carry an `author` but NO `owner`/`shared_with`. We attribute each entry
    // to its author and yield it only for that author, so a single push under the
    // PI's owner prefix (labId/<pi-owner>/announcement/<id>) covers them. Any
    // non-author owner (every regular member) yields [], so members push none.
    // listAnnouncements() reads the single root file regardless of `owner`, so the
    // author filter is what scopes the result to the calling owner.
    async listAnnouncements(owner: string): Promise<OwnedRecord[]> {
      if (!LAB_AS_FOLDER_ENABLED) return [];
      const all = await listAnnouncements();
      return all.filter((a) => a.author === owner) as unknown as OwnedRecord[];
    },
  };
}

/**
 * Reads every task's persisted sheet markdown (results.md or notes.md) for
 * `owner`. The sheets live under `users/<owner>/results/task-<id>/<which>.md`
 * (the readable mirror the editor keeps alongside the Loro sidecar, see
 * lib/loro/task-sidecar-store.ts). We read the markdown directly rather than
 * opening a Loro doc, so the payload is the already-persisted, volatile-free
 * text. One sheet per task, so the task id is a stable record id.
 *
 * A task dir with no `<which>.md` (or an empty one) is skipped. The owner's
 * results directory may not exist at all (no experiments yet), which
 * listDirectories reports as an empty list.
 */
async function readTaskSheets(
  owner: string,
  which: "results" | "notes",
): Promise<OwnedRecord[]> {
  const baseDir = `users/${owner}/results`;
  const dirs = await fileService.listDirectories(baseDir);
  const out: OwnedRecord[] = [];
  for (const dir of dirs) {
    const match = /^task-(.+)$/.exec(dir);
    if (!match) continue;
    const taskId = match[1];
    const markdown = await fileService.readText(`${baseDir}/${dir}/${which}.md`);
    if (markdown && markdown.length > 0) {
      out.push({ id: taskId, owner, sheet: which, markdown });
    }
  }
  return out;
}
