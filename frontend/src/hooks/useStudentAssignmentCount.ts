"use client";

import { useEffect, useState } from "react";
import { listStudentAssignments } from "@/lib/lab/class-assignment-read";

/**
 * Class Mode CT-2: the count of assignments visible to the current student, for
 * the badge on the workbench Assignments tab and the global nav entry. Reads the
 * folder-local _class_assignments.json via listStudentAssignments (which is itself
 * flag + defensiveness gated), refreshing when `enabled` flips on.
 *
 * @param enabled only read when the active folder is a class the user is a student
 *   in (the caller passes useIsClassStudent === true). When false, returns 0 with
 *   no file read, so a research-lab / solo / instructor / flag-off surface pays
 *   nothing.
 */
export function useStudentAssignmentCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listStudentAssignments();
        if (!cancelled) setCount(list.length);
      } catch {
        if (!cancelled) setCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return count;
}
