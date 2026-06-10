/**
 * datahub-sidecar-store.ts
 *
 * Disk persistence for a Data Hub document's Loro doc, the grid analogue of
 * purchase-sidecar-store.ts.
 *
 * Layout (per owner):
 *   users/<owner>/datahub/<id>.loro   the authoritative CRDT snapshot
 *   users/<owner>/datahub/<id>.json   a readable mirror, re-derivable from the
 *                                     projection (so the catalog / list path can
 *                                     read metadata without opening every Loro
 *                                     snapshot, and so the doc round-trips by
 *                                     re-seeding if the snapshot is ever lost).
 *
 * persist writes the `.loro` sidecar FIRST then the `.json` mirror (same ordering
 * as persistPurchaseDoc / persistTaskDoc: a crash mid-write leaves the
 * authoritative CRDT on disk and the mirror is always re-derivable). loadOrRebuild
 * tries the sidecar, then falls back to seeding deterministically from the `.json`
 * mirror so two devices rebuilding from the same JSON converge rather than fork.
 *
 * The mirror is a full DataHubDocContent object (meta block plus columns / rows /
 * analyses / plots), so the catalog reads `.meta` off it directly and a rebuild
 * re-seeds from the same content. The doc's projection only knows the in-doc meta
 * fields (title / table_type / created_at); the catalog fields (project_ids /
 * folder_path / last_edited_*) live ONLY in the mirror, so persist merges the
 * existing mirror's catalog fields with the freshly projected content.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { LoroDoc } from "loro-crdt";
import { fileService } from "../file-system/file-service";
import { seedDataHubDoc, getDataHubContent } from "./datahub-doc";
import type {
  DataHubDocContent,
  DataHubDocument,
} from "@/lib/datahub/model/types";

/** The per-owner datahub directory. */
export function dataHubDir(owner: string): string {
  return `users/${owner}/datahub`;
}
/** The authoritative `.loro` sidecar path. */
export function dataHubSidecarPath(owner: string, id: string): string {
  return `${dataHubDir(owner)}/${id}.loro`;
}
/** The readable JSON mirror path (a full DataHubDocContent). */
export function dataHubJsonPath(owner: string, id: string): string {
  return `${dataHubDir(owner)}/${id}.json`;
}

/** An empty content shell for a brand new / missing document. */
function emptyContent(id: string): DataHubDocContent {
  const meta: DataHubDocument = {
    id,
    name: "",
    project_ids: [],
    folder_path: null,
    table_type: "column",
    created_at: "",
  };
  return { meta, columns: [], rows: [], analyses: [], plots: [] };
}

/** Load a LoroDoc from the sidecar, or null if absent. Throws on corrupt bytes. */
async function loadSidecar(owner: string, id: string): Promise<LoroDoc | null> {
  const blob = await fileService.readFileAsBlob(dataHubSidecarPath(owner, id));
  if (blob === null) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = new LoroDoc();
  // Throws on a corrupt / invalid snapshot; loadOrRebuild catches it.
  doc.import(bytes);
  return doc;
}

/** Read the JSON mirror (null when absent). */
export async function readDataHubMirror(
  owner: string,
  id: string,
): Promise<DataHubDocContent | null> {
  return fileService.readJson<DataHubDocContent>(dataHubJsonPath(owner, id));
}

/**
 * Load or rebuild the Loro doc for a Data Hub document.
 *
 * Tries the `.loro` sidecar first; if it is missing OR corrupt, seeds a fresh doc
 * deterministically from the `.json` mirror (so two devices rebuilding from the
 * same content converge). When neither exists, seeds from an empty document so
 * callers always get a usable doc. Never surfaces an error.
 */
export async function loadOrRebuildDataHubDoc(
  owner: string,
  id: string,
): Promise<LoroDoc> {
  try {
    const doc = await loadSidecar(owner, id);
    if (doc !== null) return doc;
  } catch {
    // Corrupt sidecar: fall through to rebuild from the JSON mirror.
  }
  const mirror = await readDataHubMirror(owner, id);
  const content = mirror ?? emptyContent(id);
  const doc = new LoroDoc();
  doc.import(seedDataHubDoc(content));
  return doc;
}

/** Concurrent-writer FS errors to swallow (same set as persistPurchaseDoc). */
function isConcurrentWriteError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "NotFoundError" || name === "NoModificationAllowedError";
}

/**
 * Build the mirror to write: the freshly projected doc content, with the catalog
 * fields (id / project_ids / folder_path / last_edited_*) carried over from the
 * existing mirror, since the doc itself does not store them.
 */
function buildMirror(
  id: string,
  doc: LoroDoc,
  prior: DataHubDocContent | null,
): DataHubDocContent {
  const projected = getDataHubContent(doc, id);
  const priorMeta = prior?.meta;
  projected.meta = {
    ...projected.meta,
    id,
    project_ids: priorMeta?.project_ids ?? projected.meta.project_ids,
    folder_path: priorMeta?.folder_path ?? projected.meta.folder_path,
    last_edited_by: priorMeta?.last_edited_by,
    last_edited_at: priorMeta?.last_edited_at,
    // created_at prefers the doc's own meta, falling back to the prior mirror.
    created_at: projected.meta.created_at || (priorMeta?.created_at ?? ""),
  };
  return projected;
}

/**
 * Persist the Loro doc: write the `.loro` sidecar, then sync the `.json` mirror
 * (the content projection merged with the prior mirror's catalog fields) so the
 * catalog / list path sees the latest metadata. Swallows the concurrent-writer
 * race (the sidecar is authoritative and re-persists on the next commit);
 * rethrows anything else.
 */
export async function persistDataHubDoc(
  owner: string,
  id: string,
  doc: LoroDoc,
): Promise<void> {
  try {
    await fileService.ensureDir(dataHubDir(owner));
    const prior = await readDataHubMirror(owner, id);
    const bytes = doc.export({ mode: "snapshot" });
    await fileService.writeFileFromBlob(
      dataHubSidecarPath(owner, id),
      new Blob([bytes.buffer as ArrayBuffer]),
    );
    await fileService.writeJson(
      dataHubJsonPath(owner, id),
      buildMirror(id, doc, prior),
    );
  } catch (err) {
    if (isConcurrentWriteError(err)) {
      console.warn(
        "[loro] datahub doc persist raced another writer; re-persists on the next commit",
        err,
      );
      return;
    }
    throw err;
  }
}

/**
 * Persist a mirror object directly (no Loro doc), used by the API for
 * metadata-only updates (rename, re-link projects, move folder) and for create.
 * Writes the `.loro` sidecar from the content too so the authoritative snapshot
 * stays in sync. Swallows the concurrent-writer race.
 */
export async function persistDataHubContent(
  owner: string,
  id: string,
  content: DataHubDocContent,
): Promise<void> {
  try {
    await fileService.ensureDir(dataHubDir(owner));
    const bytes = seedDataHubDoc(content);
    await fileService.writeFileFromBlob(
      dataHubSidecarPath(owner, id),
      new Blob([bytes.buffer as ArrayBuffer]),
    );
    await fileService.writeJson(dataHubJsonPath(owner, id), content);
  } catch (err) {
    if (isConcurrentWriteError(err)) {
      console.warn(
        "[loro] datahub content persist raced another writer; re-persists later",
        err,
      );
      return;
    }
    throw err;
  }
}

/** Delete both files of a Data Hub document. Returns true if the mirror existed. */
export async function deleteDataHubFiles(
  owner: string,
  id: string,
): Promise<boolean> {
  const hadMirror = await fileService.deleteFile(dataHubJsonPath(owner, id));
  await fileService.deleteFile(dataHubSidecarPath(owner, id));
  return hadMirror;
}
