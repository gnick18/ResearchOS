/**
 * purchase-sidecar-store.ts
 *
 * Disk persistence for a purchase item's Loro doc (docs/proposals/PURCHASE_LORO.md
 * chunk 1), the structured-record analogue of task-sidecar-store.ts.
 *
 * Layout: a purchase item keeps its existing readable mirror at
 * `users/<owner>/purchase_items/<id>.json` (the file lab-wide lists, the
 * approval queue, owner-scoped-api, local-api, and pi-actions already read). The
 * authoritative CRDT lives beside it as `users/<owner>/purchase_items/<id>.loro`.
 * The path is literal (no per-user resolver indirection like tasks, whose data
 * could live at a legacy global path); the purchase_items dir is already
 * per-owner-namespaced.
 *
 * persist writes the `.loro` sidecar FIRST then the `.json` mirror (same ordering
 * as persistTaskDoc / persistNote: a crash mid-write leaves the authoritative
 * CRDT on disk, and the mirror is always re-derivable from it). loadOrRebuild
 * tries the sidecar, then falls back to seeding deterministically from the
 * `.json` record so two devices rebuilding from the same JSON converge.
 *
 * The `.json` mirror is byte-compatible with what owner-scoped-api / local-api
 * already read (a plain PurchaseItem object via fileService.readJson), so every
 * legacy reader keeps working unchanged while Loro owns the live truth when on.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { LoroDoc } from "loro-crdt";
import type { PurchaseItem } from "@/lib/types";
import { fileService } from "../file-system/file-service";
import { seedPurchaseDoc, getPurchaseFields } from "./purchase-doc";

/** The per-owner purchase_items directory. */
function purchaseDir(owner: string): string {
  return `users/${owner}/purchase_items`;
}
/** The authoritative `.loro` sidecar path. */
function purchaseSidecarPath(owner: string, id: number): string {
  return `${purchaseDir(owner)}/${id}.loro`;
}
/** The existing readable JSON mirror path (the legacy record). */
function purchaseJsonPath(owner: string, id: number): string {
  return `${purchaseDir(owner)}/${id}.json`;
}

/** Load a LoroDoc from the sidecar, or null if absent. Throws on corrupt bytes. */
async function loadSidecar(owner: string, id: number): Promise<LoroDoc | null> {
  const blob = await fileService.readFileAsBlob(purchaseSidecarPath(owner, id));
  if (blob === null) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = new LoroDoc();
  // Throws on a corrupt/invalid snapshot; loadOrRebuild catches it.
  doc.import(bytes);
  return doc;
}

/** Read the JSON mirror (null when absent). */
async function readJsonMirror(
  owner: string,
  id: number,
): Promise<PurchaseItem | null> {
  return fileService.readJson<PurchaseItem>(purchaseJsonPath(owner, id));
}

/**
 * Load or rebuild the Loro doc for a purchase item.
 *
 * Tries the `.loro` sidecar first; if it is missing OR corrupt, seeds a fresh
 * doc deterministically from the `.json` record (so two devices rebuilding from
 * the same JSON converge rather than fork). When neither exists, seeds from an
 * empty record so callers always get a usable doc. Never surfaces an error.
 *
 * `currentUser` is accepted for shape-parity with the task store but is unused
 * here: the purchase_items path is already per-owner-namespaced, so there is no
 * legacy-global vs per-user divergence to resolve.
 */
export async function loadOrRebuildPurchaseDoc(
  owner: string,
  id: number,
  _currentUser?: string,
): Promise<LoroDoc> {
  try {
    const doc = await loadSidecar(owner, id);
    if (doc !== null) return doc;
  } catch {
    // Corrupt sidecar: fall through to rebuild from the JSON mirror.
  }
  const record = await readJsonMirror(owner, id);
  const seed: PurchaseItem = record ?? ({ id, task_id: 0 } as PurchaseItem);
  const doc = new LoroDoc();
  doc.import(seedPurchaseDoc(seed));
  return doc;
}

/** Concurrent-writer FS errors to swallow (same as persistTaskDoc / persistNote). */
function isConcurrentWriteError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "NotFoundError" || name === "NoModificationAllowedError";
}

/**
 * Persist the Loro doc: write the `.loro` sidecar, then sync the `.json` mirror
 * (the field projection) so every legacy reader sees the latest record. Swallows
 * the concurrent-writer race (the sidecar is authoritative and re-persists on
 * the next commit); rethrows anything else.
 *
 * `currentUser` is accepted for shape-parity with persistTaskDoc and unused.
 */
export async function persistPurchaseDoc(
  owner: string,
  id: number,
  doc: LoroDoc,
  _currentUser?: string,
): Promise<void> {
  try {
    await fileService.ensureDir(purchaseDir(owner));
    const bytes = doc.export({ mode: "snapshot" });
    await fileService.writeFileFromBlob(
      purchaseSidecarPath(owner, id),
      new Blob([bytes.buffer as ArrayBuffer]),
    );
    await fileService.writeJson(purchaseJsonPath(owner, id), getPurchaseFields(doc));
  } catch (err) {
    if (isConcurrentWriteError(err)) {
      console.warn(
        "[loro] purchase doc persist raced another writer; re-persists on the next commit",
        err,
      );
      return;
    }
    throw err;
  }
}
