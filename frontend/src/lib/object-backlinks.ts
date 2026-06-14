// Markdown embed hybrid, Phase 4. System-wide backlinks ("Referenced in").
//
// Scans the current user's notes, experiment docs (notes.md + results.md), and
// markdown method bodies for any reference to a given object (a mention chip or
// a block embed, both carry the object's deep-link path), and returns one entry
// per referencing document. This generalizes the chemistry molecule scan to
// every object type, keyed off objectDeepLink(type, id). On-demand, no
// persistent index, reads the current user's content only.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { objectDeepLink, type ObjectRefType } from "@/lib/references";
import { fileService } from "@/lib/file-system/file-service";
import { getCurrentUserCached } from "@/lib/storage/json-store";

export interface BacklinkEntry {
  /** The kind of document that references the object, for icon selection. */
  type: "note" | "experiment" | "method";
  id: string;
  title: string;
  /** In-app deep link to open the referencing document. */
  href: string;
}

/**
 * A regex matching the object's deep-link path followed by a non-id boundary, so
 * `seq=5` does not match `seq=50` and `molecule=14` does not match
 * `molecule=140`. Matches the path part of a `[name](/path#ros=...)` reference,
 * so it catches both mentions and embeds (they share the path, the fragment only
 * differs).
 */
function backlinkNeedleRegex(type: ObjectRefType, id: string): RegExp {
  const path = objectDeepLink(type, id);
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped + "(?![\\w%-])", "i");
}

/**
 * Scan the current user's notes, experiments, and methods for references to an
 * object by type + id. One entry per referencing document. Defensive, any single
 * read failure is swallowed so one unreadable file cannot break the scan.
 */
export async function scanBacklinks(
  type: ObjectRefType,
  id: string,
): Promise<BacklinkEntry[]> {
  const needleRe = backlinkNeedleRegex(type, id);
  const results: BacklinkEntry[] = [];
  const owner = await getCurrentUserCached();

  // ── Notes ──────────────────────────────────────────────────────────────────
  try {
    const { notesApi } = await import("@/lib/local-api");
    const notes = await notesApi.list();
    for (const note of notes) {
      const bodyText = (note.entries ?? []).map((e) => e.content ?? "").join("\n");
      if (bodyText.match(needleRe)) {
        results.push({
          type: "note",
          id: String(note.id),
          title: note.title || "Untitled note",
          href: `/notes/${note.id}`,
        });
      }
    }
  } catch {
    // Notes unavailable (not connected, etc.): skip silently.
  }

  // ── Experiments (tasks) ────────────────────────────────────────────────────
  // notes.md + results.md live at users/<owner>/results/task-<id>/.
  try {
    const { tasksApi, projectsApi } = await import("@/lib/local-api");
    const projects = await projectsApi.list();
    const seenIds = new Set<number>();
    for (const project of projects) {
      let tasks;
      try {
        tasks = await tasksApi.listByProject(project.id);
      } catch {
        continue;
      }
      for (const task of tasks) {
        if (seenIds.has(task.id)) continue;
        seenIds.add(task.id);
        const base = `users/${owner}/results/task-${task.id}`;
        let found = false;
        for (const filename of ["notes.md", "results.md"] as const) {
          if (found) break;
          try {
            const text = await fileService.readText(`${base}/${filename}`);
            if (text && text.match(needleRe)) {
              found = true;
              results.push({
                type: "experiment",
                id: String(task.id),
                title: task.name || `Experiment ${task.id}`,
                href: `/?openTask=${task.id}`,
              });
            }
          } catch {
            // File does not exist for this task/tab; skip.
          }
        }
      }
    }
  } catch {
    // Tasks or projects unavailable; skip.
  }

  // ── Methods ────────────────────────────────────────────────────────────────
  // Markdown methods have a free-text body at source_path. Structured types
  // (PCR, LC, plate, etc.) have no markdown body to scan.
  try {
    const { methodsApi } = await import("@/lib/local-api");
    const methods = await methodsApi.list();
    for (const method of methods) {
      if (method.method_type !== "markdown" && method.method_type !== null) continue;
      if (!method.source_path) continue;
      try {
        const text = await fileService.readText(method.source_path);
        if (text && text.match(needleRe)) {
          results.push({
            type: "method",
            id: String(method.id),
            title: method.name || `Method ${method.id}`,
            // Use the canonical builder, not a hardcoded /methods/<id> (a 404 dead
            // route). objectDeepLink resolves to /methods?openMethod=<id>.
            href: objectDeepLink("method", method.id),
          });
        }
      } catch {
        // Unreadable method file; skip.
      }
    }
  } catch {
    // Methods unavailable; skip.
  }

  return results;
}
