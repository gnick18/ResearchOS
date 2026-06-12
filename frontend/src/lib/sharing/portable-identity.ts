// Phase 6a (phase6a-foundation bot, 2026-06-12). Portable content identity.
//
// Cross-user content identity helpers for the Phase 6 share-with-dependencies
// flow. Each object type has a stable cross-user identifier:
//
//   molecule   -- InChIKey from the RDKit-computed sidecar (MoleculeMeta.inchikey)
//   sequence   -- content fingerprint of the bases (seqIdentity from sequences/find)
//   everything else -- source_uuid minted at create time + lazy-backfilled on read
//
// These identifiers survive round-trips across user accounts, so a received note
// bundle can resolve its embedded objects by identity even when the local numeric
// ids differ.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import type { ObjectRefType } from "@/lib/references";
import {
  sequencesApi,
  notesApi,
  methodsApi,
  projectsApi,
} from "@/lib/local-api";
import { seqIdentity } from "@/lib/sequences/find";
import { moleculeStore } from "@/lib/chemistry/molecule-store";

// ── portableIdentityFor ───────────────────────────────────────────────────────

/**
 * Return a stable cross-user identity string for the given record. The record
 * is typed as `unknown` because callers read from heterogeneous APIs; this
 * function casts safely after a type-guard.
 *
 * Returns null when the identity is unavailable (RDKit not loaded, sequence not
 * yet parsed, source_uuid not yet minted, or record is null/undefined).
 */
export function portableIdentityFor(
  type: ObjectRefType,
  record: unknown,
): string | null {
  if (!record || typeof record !== "object") return null;

  switch (type) {
    case "molecule": {
      // Molecules use InChIKey (a canonical chemical structure identifier that
      // is the same for the same structure across any user's library). RDKit
      // computes it once at save time and stores it in MoleculeMeta.inchikey.
      const m = record as { inchikey?: unknown };
      const ik = typeof m.inchikey === "string" ? m.inchikey.trim() : "";
      return ik.length > 0 ? ik : null;
    }

    case "sequence": {
      // Sequences use a djb2 content fingerprint of their bases (seqIdentity
      // from lib/sequences/find). The fingerprint is deterministic for the same
      // base string, so the same plasmid in two users' libraries yields the same
      // key. SequenceRecord carries `seq` only on SequenceDetail; SequenceRecord
      // (the summary form) does not include the bases. Accept whichever field
      // is present: `seq` (full detail) or `genbank` (raw file text).
      const s = record as { seq?: unknown; genbank?: unknown };
      let bases: string | null = null;
      if (typeof s.seq === "string" && s.seq.length > 0) {
        bases = s.seq;
      } else if (typeof s.genbank === "string" && s.genbank.length > 0) {
        // Extract the ORIGIN section bases when the full detail is not loaded.
        // seqIdentity operates on raw base string (case-insensitive); trim off
        // GenBank header lines by scanning past the ORIGIN keyword.
        const originIdx = s.genbank.indexOf("ORIGIN");
        if (originIdx >= 0) {
          const originBlock = s.genbank.slice(originIdx + 6);
          bases = originBlock.replace(/[^a-zA-Z]/g, "");
        }
      }
      if (!bases || bases.length === 0) return null;
      return seqIdentity(bases);
    }

    case "collection": {
      // A sequence collection is a Project used as a filter. Fall through to
      // source_uuid (a Project carries source_uuid).
      const c = record as { source_uuid?: unknown };
      const uid = typeof c.source_uuid === "string" ? c.source_uuid.trim() : "";
      return uid.length > 0 ? uid : null;
    }

    case "note":
    case "method":
    case "project":
    case "task":
    case "experiment":
    case "datahub":
    case "file": {
      // These types carry source_uuid minted at create time and lazy-backfilled
      // on read. Return it when present.
      const r = record as { source_uuid?: unknown };
      const uid = typeof r.source_uuid === "string" ? r.source_uuid.trim() : "";
      return uid.length > 0 ? uid : null;
    }

    default:
      return null;
  }
}

// ── resolveByPortableId ───────────────────────────────────────────────────────

/**
 * Scan the current user's local objects of the given type for one whose
 * portableIdentityFor matches portableId. Returns the local object id (as a
 * string) on a match, or null when nothing matches.
 *
 * Used by the Phase 6c recipient import dedup to check whether a received
 * object already exists locally before creating a new copy.
 *
 * This scans ALL objects of the given type; it is intended for the import
 * path (a one-time check per received bundle item), not for hot render paths.
 */
export async function resolveByPortableId(
  type: ObjectRefType,
  portableId: string,
  currentUser: string,
): Promise<{ id: string } | null> {
  if (!portableId || !currentUser) return null;

  switch (type) {
    case "molecule": {
      const metas = await moleculeStore.listMetaForUser(currentUser);
      for (const meta of metas) {
        if (portableIdentityFor("molecule", meta) === portableId) {
          return { id: String(meta.id) };
        }
      }
      return null;
    }

    case "sequence": {
      // sequencesApi.list returns SequenceRecord (summary, no bases), so we
      // need the full detail to compute the seqIdentity fingerprint.
      // This cost is acceptable on the one-time import dedup path.
      const records = await sequencesApi.list();
      for (const rec of records) {
        const detail = await sequencesApi.get(rec.id);
        if (!detail) continue;
        if (portableIdentityFor("sequence", detail) === portableId) {
          return { id: String(detail.id) };
        }
      }
      return null;
    }

    case "collection":
    case "project": {
      const projects = await projectsApi.list();
      for (const proj of projects) {
        if (portableIdentityFor(type, proj) === portableId) {
          return { id: String(proj.id) };
        }
      }
      return null;
    }

    case "note": {
      const notes = await notesApi.list();
      for (const note of notes) {
        if (portableIdentityFor("note", note) === portableId) {
          return { id: String(note.id) };
        }
      }
      return null;
    }

    case "method": {
      const methods = await methodsApi.list();
      for (const method of methods) {
        if (portableIdentityFor("method", method) === portableId) {
          return { id: String(method.id) };
        }
      }
      return null;
    }

    case "task":
    case "experiment": {
      // Tasks are per-project; use fetchAllTasksIncludingShared for a flat view
      // of all tasks the current user owns or can see.
      const { fetchAllTasksIncludingShared } = await import("@/lib/local-api");
      const tasks = await fetchAllTasksIncludingShared();
      for (const task of tasks) {
        if (portableIdentityFor(type, task) === portableId) {
          return { id: String(task.id) };
        }
      }
      return null;
    }

    case "datahub":
    case "file": {
      // Data Hub docs and files are not part of the Phase 6a scope.
      // Return null so the dedup path falls back to creating a new copy.
      return null;
    }

    default:
      return null;
  }
}
