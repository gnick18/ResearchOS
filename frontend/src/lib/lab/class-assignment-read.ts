// Class Mode CT-2: the STUDENT-side assignment reader.
//
// The instructor publishes one instructor-owned `class_assignment` record per
// assignment (class-assignment-store.ts), shared to the roster. On pull, the
// materializer (lab-view-materialize.ts) aggregates every assignment payload the
// student can see into the root _class_assignments.json. This module reads that
// cached file folder-locally, so the student assignment panel renders the list
// synchronously without a relay round-trip (the same pattern the class dashboard
// uses via readCachedClassDashboard).
//
// Defensive by construction: a missing file, a malformed file, or a malformed
// entry yields an empty list / drops that entry, never throws, so one bad write
// can never blank the whole panel.
//
// FLAG: behind CLASS_MODE_ENABLED. Flag off, returns an empty list with no I/O, so
// a non-class build never reads the file.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "../file-system/file-service";
import { CLASS_MODE_ENABLED } from "./class-mode-config";
import type {
  ClassAssignmentRecord,
  AssignmentVisibility,
} from "./class-assignment";

/** The root cache file the materializer writes the pulled assignments to. */
export const CLASS_ASSIGNMENTS_CACHE_PATH = "_class_assignments.json";

/**
 * A read assignment: the published ClassAssignmentRecord fields. shared_with rides
 * inline on the cached payload (the instructor's sharing intent) but the student
 * panel does not need it to render, so it is intentionally not surfaced here.
 */
export type StudentAssignment = ClassAssignmentRecord;

/** True iff a parsed value has the minimal required shape of an assignment. */
function isAssignmentRecord(v: Record<string, unknown>): boolean {
  return (
    typeof v.assignmentId === "string" &&
    v.assignmentId.length > 0 &&
    typeof v.title === "string" &&
    typeof v.instructor === "string"
  );
}

/** Normalize an unknown visibility to the two legal values (default private). */
function coerceVisibility(value: unknown): AssignmentVisibility {
  return value === "collaborative" ? "collaborative" : "private";
}

/**
 * Read the student's visible assignments from the root cache file. Returns the
 * assignments newest first (by assignedAt, falling back to insertion order for a
 * missing timestamp). Empty list when class mode is off, the file is absent, or
 * the file is unreadable / malformed.
 */
export async function listStudentAssignments(): Promise<StudentAssignment[]> {
  if (!CLASS_MODE_ENABLED) return [];

  let text: string | null;
  try {
    text = await fileService.readText(CLASS_ASSIGNMENTS_CACHE_PATH);
  } catch {
    return [];
  }
  if (text == null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const rawList = (parsed as { assignments?: unknown }).assignments;
  if (!Array.isArray(rawList)) return [];

  const out: StudentAssignment[] = [];
  for (const entry of rawList) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (!isAssignmentRecord(e)) continue;
    out.push({
      assignmentId: e.assignmentId as string,
      title: e.title as string,
      description: typeof e.description === "string" ? e.description : undefined,
      templateMethodId:
        typeof e.templateMethodId === "number" ? e.templateMethodId : undefined,
      checklist: Array.isArray(e.checklist)
        ? (e.checklist.filter(
            (c) =>
              typeof c === "object" &&
              c !== null &&
              typeof (c as Record<string, unknown>).id === "string" &&
              typeof (c as Record<string, unknown>).label === "string",
          ) as ClassAssignmentRecord["checklist"])
        : [],
      visibility: coerceVisibility(e.visibility),
      instructor: e.instructor as string,
      assignedAt: typeof e.assignedAt === "string" ? e.assignedAt : "",
    });
  }

  // Newest first; a missing timestamp sorts last (stable for equal keys).
  out.sort((a, b) => (b.assignedAt || "").localeCompare(a.assignedAt || ""));
  return out;
}
