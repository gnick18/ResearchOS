// Headline counts for the home overview ("Research Project Overview" header).
// Pure predicates so they can be unit-tested without mounting the page.
//
// Design: shared-in projects/tasks (is_shared_with_me === true) appear as
// cards on the home page but DO NOT contribute to the viewer's headline
// numbers. Persona 06 reported a stranger's shared-in project inflating
// "5 active projects" for the receiver; counts are now own-only.

import type { Project, Task } from "@/lib/types";

export function countOwnActiveProjects(activeProjects: Project[]): number {
  return activeProjects.filter((p) => !p.is_shared_with_me).length;
}

export function countOwnArchivedProjects(archivedProjects: Project[]): number {
  return archivedProjects.filter((p) => !p.is_shared_with_me).length;
}

export function countOwnActiveTasks(allTasks: Task[]): number {
  return allTasks.filter((t) => !t.is_complete && !t.is_shared_with_me).length;
}
