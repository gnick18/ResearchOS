// Phase 6b-1 (2026-06-12). Sender-side embedded-object collection.
//
// collectEmbeddedObjects scans a note's markdown for block-embed links, loads
// each embedded object from the local stores, and serializes it into a
// BundleEmbeddedObject ready to be included in the note bundle. The result
// plugs into BuildBundleInput.embeddedObjects.
//
// Design decisions (from docs/proposals/2026-06-12-phase6-share-with-dependencies.md):
//   D1  All embeds are included by default. The caller passes an excludeHrefs
//       set to deselect specific embeds (future share-dialog UI).
//   D2  Each object is carried as a full recreatable copy with provenance.
//   D8  Data Hub objects default to a FROZEN SNAPSHOT (result text + summary).
//       Passing the href in fullDataHrefs opts that embed into the full dataset.
//
// File-serialized payloads (molfile, genbank, note markdown, method body, task
// JSON) are placed in the `inline` field as a Uint8Array. buildBundle sees
// serialization === "file" + inline instanceof Uint8Array and writes the bytes
// to data/objects/ in the bag. This keeps the interface simple without adding
// an extra field.
//
// Objects that fail to load are SKIPPED without throwing. The caller receives a
// count of skips via the returned metadata. The embed will render as a
// no-access placeholder on the recipient side (Phase 6d).
//
// DEFERRED object types (not built yet, reported back to caller):
//   file    The file bytes live at an arbitrary FSA path; loading requires
//           the FSA handle which is not safely accessible from this layer.
//           Deferred pending a clean file-byte reader that does not import
//           the full FSA stack.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import { scanNoteDependencies } from "@/lib/sharing/note-dependencies";
import { portableIdentityFor } from "@/lib/sharing/portable-identity";
import type { BundleEmbeddedObject } from "@/lib/sharing/bundle";
import type { ObjectRefType } from "@/lib/references";
import { moleculesApi } from "@/lib/chemistry/api";
import { dataHubApi } from "@/lib/datahub/api";
import { resultToText } from "@/lib/datahub/result-text";
import { plainLanguageSummary } from "@/lib/datahub/plain-language";
import type { NormalizedResult } from "@/lib/datahub/run-analysis";
import {
  sequencesApi,
  notesApi,
  methodsApi,
  projectsApi,
  tasksApi,
} from "@/lib/local-api";

/** utf-8 encoder (no dependency, matches bundle.ts). */
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface CollectEmbeddedObjectsOpts {
  /**
   * Hrefs to skip entirely (the share dialog's "deselect" list). When omitted
   * or empty, ALL block embeds are collected (D1 default).
   */
  excludeHrefs?: Set<string>;
  /**
   * Hrefs for Data Hub embeds that should carry the FULL dataset (the `.json`
   * mirror) instead of the default frozen snapshot (D8 opt-in).
   */
  fullDataHrefs?: Set<string>;
}

/** Summary returned alongside the BundleEmbeddedObject array. */
export interface CollectResult {
  objects: BundleEmbeddedObject[];
  /** Number of embeds that were skipped because loading failed. */
  skipCount: number;
  /**
   * Object types that were intentionally deferred (not implemented yet). Each
   * entry is a type string. The caller may report these to the user.
   */
  deferredTypes: ObjectRefType[];
}

// ── Per-type serializers ───────────────────────────────────────────────────────

/**
 * Serialize a split task key ("self:5" or "owner:5") into its numeric id and
 * optional owner string. Returns null when the key is malformed.
 */
function splitTaskKey(key: string): { id: number; owner?: string } | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const ns = key.slice(0, colon);
  const numStr = key.slice(colon + 1);
  const id = Number(numStr);
  if (!Number.isFinite(id) || id <= 0) return null;
  return ns === "self" ? { id } : { id, owner: ns };
}

async function collectMolecule(
  dep: { id: string; caption: string; href: string },
): Promise<BundleEmbeddedObject | null> {
  const detail = await moleculesApi.get(dep.id);
  if (!detail) return null;
  const portableId = portableIdentityFor("molecule", detail.meta);
  const molfileBytes = utf8(detail.molfile);
  // Inline carries the small JSON metadata; the molfile bytes travel as a file.
  // We stash the bytes in the inline field as a Uint8Array; buildBundle detects
  // this and writes the file. The JSON meta is attached to the embedded-object
  // entry stored in ro-crate-metadata.json via a separate "meta" key embedded
  // within the inline field stored as a raw JSON. Since inline is "unknown" and
  // buildBundle checks instanceof Uint8Array to decide whether to write as file,
  // we put the file bytes directly in inline.
  const payloadName = `molecule-${dep.id}.mol`;
  return {
    type: "molecule",
    portableId,
    name: dep.caption || detail.meta.name,
    href: dep.href,
    serialization: "file",
    payloadName,
    inline: molfileBytes,
    dataKind: "full",
  };
}

async function collectSequence(
  dep: { id: string; caption: string; href: string },
): Promise<BundleEmbeddedObject | null> {
  const id = Number(dep.id);
  if (!Number.isFinite(id)) return null;
  const detail = await sequencesApi.get(id);
  if (!detail) return null;
  const portableId = portableIdentityFor("sequence", detail);
  const genbankBytes = utf8(detail.genbank);
  const payloadName = `sequence-${dep.id}.gb`;
  return {
    type: "sequence",
    portableId,
    name: dep.caption || detail.display_name,
    href: dep.href,
    serialization: "file",
    payloadName,
    inline: genbankBytes,
    dataKind: "full",
  };
}

async function collectNote(
  dep: { id: string; caption: string; href: string },
): Promise<BundleEmbeddedObject | null> {
  const note = await notesApi.get(Number(dep.id));
  if (!note) return null;
  const portableId = portableIdentityFor("note", note);
  // Serialize the note's full entry content as a UTF-8 markdown-like text.
  // We write title + each entry body concatenated with a separator.
  const parts: string[] = [`# ${note.title}`];
  if (note.description) parts.push(note.description);
  for (const entry of note.entries ?? []) {
    if (entry.title) parts.push(`## ${entry.title}`);
    if (entry.content) parts.push(entry.content);
  }
  const markdownBytes = utf8(parts.join("\n\n"));
  const payloadName = `note-${dep.id}.md`;
  return {
    type: "note",
    portableId,
    name: dep.caption || note.title,
    href: dep.href,
    serialization: "file",
    payloadName,
    inline: markdownBytes,
    dataKind: "full",
  };
}

async function collectMethod(
  dep: { id: string; caption: string; href: string },
): Promise<BundleEmbeddedObject | null> {
  const method = await methodsApi.get(Number(dep.id));
  if (!method) return null;
  const portableId = portableIdentityFor("method", method);
  // Serialize the method record fields that survive a cross-user round-trip.
  // The Method type does not carry the markdown body (that lives in a separate
  // source_path file), so we carry metadata only. The recipient can display a
  // "method card" with name + type. Full method-body transfer is handled by
  // the existing method-transfer.ts (buildMethodSendPayload) which is used for
  // intentional method shares; here we carry the embedded-object provenance so
  // the recipient knows which method was embedded and can relink if they have it.
  const safeMethod = {
    name: method.name,
    method_type: method.method_type,
    tags: method.tags,
    source_uuid: method.source_uuid,
    excerpt: method.excerpt ?? null,
  };
  const methodBytes = utf8(JSON.stringify(safeMethod, null, 2));
  const payloadName = `method-${dep.id}.json`;
  return {
    type: "method",
    portableId,
    name: dep.caption || method.name,
    href: dep.href,
    serialization: "file",
    payloadName,
    inline: methodBytes,
    dataKind: "full",
  };
}

async function collectProject(
  dep: { id: string; caption: string; href: string },
  type: "project" | "collection",
): Promise<BundleEmbeddedObject | null> {
  const project = await projectsApi.get(Number(dep.id));
  if (!project) return null;
  const portableId = portableIdentityFor(type, project);
  // Projects and collections are small; inline metadata is sufficient.
  const projectAny = project as unknown as Record<string, unknown>;
  return {
    type,
    portableId,
    name: dep.caption || project.name,
    href: dep.href,
    serialization: "inline",
    inline: {
      name: project.name,
      color: typeof projectAny.color === "string" ? projectAny.color : null,
      source_uuid: project.source_uuid ?? null,
    },
    dataKind: "full",
  };
}

async function collectTask(
  dep: { id: string; caption: string; href: string },
  type: "task" | "experiment",
): Promise<BundleEmbeddedObject | null> {
  const parsed = splitTaskKey(dep.id);
  if (!parsed) return null;
  const task = await tasksApi.get(parsed.id, parsed.owner);
  if (!task) return null;
  const portableId = portableIdentityFor(type, task);
  // Serialize the task as compact inline JSON. Tasks can be large when they
  // carry step blobs; we carry only the task record fields a recipient needs.
  // The full blob serialization is deferred; we carry name + status + dates as
  // inline metadata. This is the "safe, bounded" path for tasks.
  const safeTask = {
    name: task.name,
    is_complete: task.is_complete,
    task_type: task.task_type,
    start_date: task.start_date ?? null,
    end_date: task.end_date ?? null,
    source_uuid: task.source_uuid ?? null,
    composite_key: dep.id,
  };
  return {
    type,
    portableId,
    name: dep.caption || task.name,
    href: dep.href,
    serialization: "inline",
    inline: safeTask,
    dataKind: "full",
  };
}

async function collectDataHub(
  dep: { id: string; caption: string; href: string },
  isFull: boolean,
): Promise<BundleEmbeddedObject | null> {
  const content = await dataHubApi.getContent(dep.id);
  if (!content) return null;
  const portableId = portableIdentityFor("datahub", content.meta);

  if (isFull) {
    // Full dataset: serialize the entire DataHubDocContent as JSON.
    const fullBytes = utf8(JSON.stringify(content, null, 2));
    const payloadName = `datahub-${dep.id}.json`;
    return {
      type: "datahub",
      portableId,
      name: dep.caption || content.meta.name,
      href: dep.href,
      serialization: "file",
      payloadName,
      inline: fullBytes,
      dataKind: "full",
    };
  }

  // Default: FROZEN SNAPSHOT. Collect the plain-language summary + result text
  // for each analysis, plus the raw data table as a TSV excerpt. This mirrors
  // what bake-embeds.ts does for the PDF export (the same data the result view
  // and table view show) and is a compact, read-only representation.
  const snapshotParts: string[] = [`# Data Hub: ${content.meta.name}`];

  for (const analysis of content.analyses ?? []) {
    const cache = analysis.resultCache as
      | (NormalizedResult & { ok?: boolean })
      | null
      | undefined;
    if (!cache || cache.ok === false || !cache.kind) continue;
    try {
      const verdict = plainLanguageSummary(cache as NormalizedResult);
      const table = resultToText(cache as NormalizedResult);
      snapshotParts.push(`\n## ${analysis.name}\n${verdict}\n\n${table}`);
    } catch {
      // Skip analyses that fail to serialize; the partial snapshot is still useful.
    }
  }

  // Also include a compact representation of the raw data table (first 20 rows).
  if (content.columns.length > 0 && content.rows.length > 0) {
    const cols = content.columns.slice(0, 8);
    const header = cols.map((c) => c.name).join("\t");
    const rowLines = content.rows.slice(0, 20).map((r) =>
      cols.map((c) => {
        const v = r.cells[c.id];
        return v == null ? "" : String(v);
      }).join("\t"),
    );
    snapshotParts.push(`\n## Raw data (first 20 rows)\n${header}\n${rowLines.join("\n")}`);
  }

  const snapshotText = snapshotParts.join("\n");

  // Keep the snapshot inline when small (under 8 KB), write a file for larger.
  if (snapshotText.length < 8192) {
    return {
      type: "datahub",
      portableId,
      name: dep.caption || content.meta.name,
      href: dep.href,
      serialization: "inline",
      inline: { snapshot: snapshotText, docName: content.meta.name },
      dataKind: "snapshot",
    };
  }

  const snapshotBytes = utf8(snapshotText);
  const payloadName = `datahub-snapshot-${dep.id}.txt`;
  return {
    type: "datahub",
    portableId,
    name: dep.caption || content.meta.name,
    href: dep.href,
    serialization: "file",
    payloadName,
    inline: snapshotBytes,
    dataKind: "snapshot",
  };
}

// ── Main API ──────────────────────────────────────────────────────────────────

/**
 * Scan a note's markdown for block-embed object references and serialize each
 * embedded object for inclusion in a share bundle.
 *
 * Never throws. A failing loader is silently skipped (the embed will appear as
 * a no-access placeholder on the recipient side). The returned skipCount tells
 * the caller how many were skipped.
 *
 * File-serialized objects place their payload bytes in the inline field as a
 * Uint8Array. buildBundle detects this (instanceof Uint8Array check) and writes
 * the bytes under data/objects/ in the bag, covered by the BagIt SHA manifest.
 */
export async function collectEmbeddedObjects(
  markdown: string,
  opts?: CollectEmbeddedObjectsOpts,
): Promise<CollectResult> {
  const excludeHrefs = opts?.excludeHrefs ?? new Set<string>();
  const fullDataHrefs = opts?.fullDataHrefs ?? new Set<string>();

  const deps = scanNoteDependencies(markdown);
  const objects: BundleEmbeddedObject[] = [];
  let skipCount = 0;
  const deferredTypeSet = new Set<ObjectRefType>();

  for (const dep of deps) {
    // D1: skip hrefs the caller excluded.
    if (excludeHrefs.has(dep.href)) continue;

    // "file" type is deferred (see module header comment).
    if (dep.type === "file") {
      deferredTypeSet.add("file");
      continue;
    }

    try {
      let obj: BundleEmbeddedObject | null = null;

      switch (dep.type) {
        case "molecule":
          obj = await collectMolecule(dep);
          break;
        case "sequence":
          obj = await collectSequence(dep);
          break;
        case "note":
          obj = await collectNote(dep);
          break;
        case "method":
          obj = await collectMethod(dep);
          break;
        case "project":
          obj = await collectProject(dep, "project");
          break;
        case "collection":
          obj = await collectProject(dep, "collection");
          break;
        case "task":
          obj = await collectTask(dep, "task");
          break;
        case "experiment":
          obj = await collectTask(dep, "experiment");
          break;
        case "datahub":
          obj = await collectDataHub(dep, fullDataHrefs.has(dep.href));
          break;
        case "phylo":
          // Phylo trees are not yet packaged into a cross-boundary share bundle.
          // The embed + deep link work in-library now; bundling the .tree + sidecar
          // is a later sharing pass. Skip rather than fail the whole collect.
          skipCount += 1;
          continue;
        default: {
          // TypeScript exhaustiveness guard. Treat unknown types as missing.
          const exhaustive: never = dep.type;
          void exhaustive;
          skipCount += 1;
          continue;
        }
      }

      if (obj !== null) {
        objects.push(obj);
      } else {
        // Load returned null (object not found in local store).
        skipCount += 1;
      }
    } catch {
      // Any unexpected error from a loader is swallowed here. The embed will
      // appear as a no-access placeholder on the recipient side (Phase 6d).
      skipCount += 1;
    }
  }

  return {
    objects,
    skipCount,
    deferredTypes: Array.from(deferredTypeSet),
  };
}
