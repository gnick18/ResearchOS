// Chemistry Phase 3 (2026-06-11). Molecule backlinks (reverse reference scan).
//
// Scans notes, experiment (task) bodies, and method bodies for any text that
// contains the molecule's deep link (/chemistry?molecule=<id>), then returns
// a list of {type, id, title, href} items for the "Used in" section of
// MoleculeDetail. This is an on-demand scan (no persistent index); it reads
// the current user's content only.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { objectDeepLink } from "@/lib/references";
import { fileService } from "@/lib/file-system/file-service";
import { getCurrentUserCached } from "@/lib/storage/json-store";

export interface BacklinkEntry {
  /** Object type for icon selection. */
  type: "note" | "experiment" | "method";
  id: string;
  title: string;
  /** In-app deep link to navigate to the item. */
  href: string;
}

/**
 * Build a regex that matches the molecule deep link followed by a non-digit /
 * end-of-string boundary. This prevents id=42 from matching id=420.
 * e.g. "/chemistry?molecule=14" followed by ")" or whitespace or end.
 */
function moleculeNeedleRegex(id: string): RegExp {
  const path = objectDeepLink("molecule", id);
  // Escape all regex special characters in the path string, then assert a
  // non-digit / non-alphanumeric boundary after the id so we don't match
  // /chemistry?molecule=14 inside /chemistry?molecule=140.
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped + "(?![\\w%-])", "i");
}

/**
 * Scan the current user's notes, experiments, and methods for references to
 * a molecule by id. Returns one entry per referencing item.
 *
 * Designed to be defensive: any individual read failure is silently swallowed
 * so a single unreadable file cannot break the whole scan.
 */
export async function scanMoleculeBacklinks(
  moleculeId: string,
): Promise<BacklinkEntry[]> {
  const needleRe = moleculeNeedleRegex(moleculeId);
  const results: BacklinkEntry[] = [];
  const owner = await getCurrentUserCached();

  // ── Notes ──────────────────────────────────────────────────────────────────
  // Notes are JSON records with entries[].content markdown bodies stored in
  // the JsonStore. We import notesApi lazily to avoid pulling the whole API
  // module at module evaluation time.
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
  // Each task has a notes.md and results.md file on disk at
  // users/<owner>/results/task-<id>/notes.md (and results.md).
  // We list all tasks and check both files.
  try {
    const { tasksApi, projectsApi } = await import("@/lib/local-api");
    // tasksApi.listByProject requires a project id; list ALL tasks by reading
    // every project's tasks.
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
            // File doesn't exist for this task/tab; skip.
          }
        }
      }
    }
  } catch {
    // Tasks or projects unavailable; skip.
  }

  // ── Methods ────────────────────────────────────────────────────────────────
  // Markdown methods have source_path pointing at a .md file. Structured types
  // (PCR, LC, plate, etc.) don't have free-text bodies and won't contain
  // molecule deep links. We read source_path for markdown-type methods only.
  try {
    const { methodsApi } = await import("@/lib/local-api");
    const methods = await methodsApi.list();
    for (const method of methods) {
      if (method.method_type !== "markdown" && method.method_type !== null) {
        // Structured types: skip (no markdown body to scan).
        // null = legacy methods that may have a markdown source_path.
        continue;
      }
      if (!method.source_path) continue;
      try {
        const text = await fileService.readText(method.source_path);
        if (text && text.match(needleRe)) {
          results.push({
            type: "method",
            id: String(method.id),
            title: method.name || `Method ${method.id}`,
            href: `/methods/${method.id}`,
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
