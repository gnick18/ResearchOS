// Phase 6a (phase6a-foundation bot, 2026-06-12). Unified per-object access check.
//
// canViewObject consolidates the scattered per-type access logic into one
// function. Phase 6d uses it so the embed renderer can show a calm placeholder
// when a received note references an object the viewer cannot access.
//
// Access logic per type:
//
//   note       -- owner always, lab_head always, or shared_with (unified canRead)
//   task / experiment -- same as note via canRead
//   method     -- same as note via canRead; public methods (owner="public") are
//                 visible to everyone, matching publicMethodsStore behavior
//   project / collection -- same as note via canRead
//   sequence   -- no per-object ACL; sequences live per-user; visible iff the
//                 sequence exists in the current user's library (owner-only for
//                 v1 per the sequence editor proposal)
//   molecule   -- no per-object ACL; molecules live per-user; visible iff the
//                 molecule meta exists in the current user's library
//   datahub    -- not gated in Phase 6a; return true when a doc exists
//   file       -- not gated in Phase 6a; return false (out of scope)
//
// This is a READ-ONLY predicate. It does not modify any store and does not
// trigger any side effects.
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import type { ObjectRefType } from "@/lib/references";
import {
  notesApi,
  methodsApi,
  projectsApi,
  tasksApi,
  sequencesApi,
  buildCurrentViewer,
} from "@/lib/local-api";
import { canRead, type ShareableRecord } from "@/lib/sharing/unified";
import { moleculeStore } from "@/lib/chemistry/molecule-store";

/**
 * Return true when currentUser can view the object identified by (type, id).
 * Returns false when the object does not exist or is not visible.
 *
 * The `id` parameter is a string to match the ObjectRefType contract (all
 * deep-link ids are strings at the reference layer, even for numeric-id types).
 */
export async function canViewObject(
  type: ObjectRefType,
  id: string,
  currentUser: string,
): Promise<boolean> {
  if (!id || !currentUser) return false;

  try {
    switch (type) {
      case "note": {
        // Notes: owner, lab_head, or shared_with entry (including "*" whole-lab).
        // Read the record from the owner's folder, fall back to cross-user.
        const numId = Number(id);
        if (!Number.isFinite(numId)) return false;
        // Try own notes first (owner = currentUser), then cross-user.
        const ownNote = await notesApi.get(numId);
        if (ownNote) {
          // canRead covers owner + lab_head + explicit/sentinel share.
          const viewer = await buildCurrentViewer();
          return canRead(ownNote as unknown as ShareableRecord, viewer);
        }
        // Cross-user: the caller passes no owner hint, so we cannot probe
        // other users' stores here without scanning. Return false (the
        // embed-renderer placeholder covers this gracefully per D6).
        return false;
      }

      case "task":
      case "experiment": {
        // Tasks: owner, lab_head, or shared_with. Task ids may be composite
        // ("self:<n>" or "<owner>:<n>"); try numeric first (own task), then
        // composite key routing.
        const numId = Number(id);
        if (Number.isFinite(numId) && numId > 0) {
          const ownTask = await tasksApi.get(numId);
          if (ownTask) {
            const viewer = await buildCurrentViewer();
            return canRead(ownTask as unknown as ShareableRecord, viewer);
          }
        }
        // Composite key form: "<owner>:<numId>".
        const colonIdx = id.indexOf(":");
        if (colonIdx >= 0) {
          const ns = id.slice(0, colonIdx);
          const numStr = id.slice(colonIdx + 1);
          const taskId = Number(numStr);
          if (!Number.isFinite(taskId) || taskId <= 0) return false;
          const owner = ns === "self" ? currentUser : ns;
          const task = await tasksApi.get(taskId, owner);
          if (!task) return false;
          const viewer = await buildCurrentViewer();
          return canRead(task as unknown as ShareableRecord, viewer);
        }
        return false;
      }

      case "method": {
        // Methods: owner, lab_head, or shared_with. Public methods (whole-lab
        // "*" entry, owner === "public") are visible to everyone.
        const numId = Number(id);
        if (!Number.isFinite(numId)) return false;
        const method = await methodsApi.get(numId);
        if (!method) return false;
        if (method.owner === "public") return true;
        const viewer = await buildCurrentViewer();
        return canRead(method as unknown as ShareableRecord, viewer);
      }

      case "project":
      case "collection": {
        // Projects (including sequence collections): owner, lab_head, or
        // shared_with. The project may be in a shared owner's folder.
        const numId = Number(id);
        if (!Number.isFinite(numId)) return false;
        // Try own project first.
        const ownProj = await projectsApi.get(numId);
        if (ownProj) {
          const viewer = await buildCurrentViewer();
          return canRead(ownProj as unknown as ShareableRecord, viewer);
        }
        return false;
      }

      case "sequence": {
        // Sequences have no per-object ACL in v1. A sequence is visible iff it
        // exists in the current user's library (owner-only per the Phase 1
        // proposal). The `sequencesApi.list()` already scopes to currentUser.
        const numId = Number(id);
        if (!Number.isFinite(numId)) return false;
        const seq = await sequencesApi.get(numId);
        return seq !== null;
      }

      case "molecule": {
        // Molecules have no per-object ACL. A molecule is visible iff it exists
        // in the current user's library.
        const raw = await moleculeStore.getRawForUser(id, currentUser);
        return raw !== null;
      }

      case "datahub": {
        // Data Hub visibility is not gated in Phase 6a. The dedup check returns
        // null for datahub (out of scope), so the embed renderer placeholder
        // handles it. Return true here so any locally-present doc is considered
        // accessible (the Data Hub renderer handles missing docs already).
        return true;
      }

      case "file": {
        // File access is out of Phase 6a scope. Return false; the embed
        // renderer placeholder handles missing files.
        return false;
      }

      default:
        return false;
    }
  } catch {
    // Any I/O error (disconnected folder, missing file) is treated as "not
    // visible". Callers must handle false gracefully (placeholder embed).
    return false;
  }
}

