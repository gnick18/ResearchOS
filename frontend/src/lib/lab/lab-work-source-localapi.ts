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
// No emojis, no em-dashes, no mid-sentence colons.

import { JsonStore } from "@/lib/storage/json-store";
import type { Task, Note, Method, PurchaseItem } from "@/lib/types";
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
 *   methods -> "methods", purchases -> "purchase_items".
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
  };
}
