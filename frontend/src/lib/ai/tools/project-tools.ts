// BeakerBot project coworker tools (ai project-tools bot, 2026-06-14).
//
// Two gated WRITE tools that let BeakerBot manage the user's projects the way they
// could by hand. Today BeakerBot can READ projects (get_my_projects, read_project)
// but cannot make or edit one, so when a user with no projects asks to add a task it
// hits a wall (a task needs a project). These close that gap.
//
//   - create_project: make a new project (name, optional tags).
//   - update_project: rename a project, set its tags, or archive / unarchive it.
//
// Both are ACTION tools (action: true, isDestructive false). Archiving is reversible
// (an is_archived flag, not a delete), so neither forces the destructive hard-stop.
// The user sees a one-line confirm before anything writes (step mode), or it runs
// once the plan is approved (plan mode), through the existing agent-loop gate.
//
// THE LANE RULE. The local-api owns every write. These tools only map the user's
// words (a project name, a tag) onto projectsApi.create / projectsApi.update, they
// never invent a field. v1 is OWN projects only (a project the user merely received
// a share of is skipped), mirroring task-tools / method-tools.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { projectsApi, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import { objectDeepLink } from "@/lib/references";
import { parseTags } from "./method-tools";
import type { Project, ProjectCreate, ProjectUpdate } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

export type ProjectToolsDeps = {
  /** The user's projects (own + shared) for resolving by name or id. */
  listProjects: () => Promise<Project[]>;
  /** Create a project. Returns the saved Project. */
  createProject: (data: ProjectCreate) => Promise<Project>;
  /** Update a project's fields. Returns null when the id is not found. */
  updateProject: (id: number, data: ProjectUpdate) => Promise<Project | null>;
  /** Navigate the user to an internal path after a successful write. */
  navigate: (path: string) => void;
};

export const projectToolsDeps: ProjectToolsDeps = {
  listProjects: () => fetchAllProjectsIncludingShared(),
  createProject: (data) => projectsApi.create(data),
  updateProject: (id, data) => projectsApi.update(id, data),
  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// Helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

/** Own projects only (v1). A project the user merely RECEIVED a share of carries
 *  is_shared_with_me === true and is excluded, so these tools never write into
 *  another owner's directory. Pure. */
export function ownProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.is_shared_with_me !== true);
}

/** Resolve a project reference (a numeric id, a numeric-looking string, or a name,
 *  case-insensitive) to one of the user's OWN projects, or null. Pure. */
export function resolveOwnProject(
  projects: Project[],
  ref: string | number | undefined,
): Project | null {
  if (ref === undefined || ref === null || ref === "") return null;
  const own = ownProjects(projects);
  const asNum =
    typeof ref === "number"
      ? ref
      : /^\d+$/.test(String(ref).trim())
        ? Number(ref)
        : NaN;
  if (Number.isFinite(asNum)) {
    const byId = own.find((p) => p.id === asNum);
    if (byId) return byId;
  }
  const name = String(ref).trim().toLowerCase();
  return own.find((p) => p.name.trim().toLowerCase() === name) ?? null;
}

/** The names of the user's own projects, for an error message when a ref misses. */
export function ownProjectNames(projects: Project[]): string[] {
  return ownProjects(projects).map((p) => p.name);
}

// ---------------------------------------------------------------------------
// create_project
// ---------------------------------------------------------------------------

export const createProjectTool: AiTool = {
  name: "create_project",
  description:
    "Create a new project for the user. Use this when the user asks to start or add a project, OR when they want to add a task / experiment but have no project yet to put it on (a project is the container for tasks on the Gantt). Pass a name, and optionally comma-separated tags. The app shows a one-line preview before anything writes. After it writes, confirm in one short sentence what was created, then you can go on to add tasks to it with create_task.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The project name, for example \"cyp51A knockout\" or \"Imaging\".",
      },
      tags: {
        type: "string",
        description:
          "Comma-separated tags for the project, for example \"fumigatus, resistance\". Optional.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const name = String(args.name ?? "Untitled project");
    const tags = parseTags(args.tags);
    const tagNote = tags.length ? `, tags ${tags.join(", ")}` : "";
    return { summary: `create project "${name}"${tagNote}` };
  },
  execute: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) {
      return { ok: false as const, error: "A project name is required." };
    }
    const tags = parseTags(args.tags);

    let project: Project;
    try {
      project = await projectToolsDeps.createProject({
        name,
        ...(tags.length ? { tags } : {}),
      });
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not create the project. ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    projectToolsDeps.navigate(objectDeepLink("project", project.id));

    return {
      ok: true as const,
      id: project.id,
      name: project.name,
      tags: project.tags ?? [],
    };
  },
};

// ---------------------------------------------------------------------------
// update_project
// ---------------------------------------------------------------------------

export const updateProjectTool: AiTool = {
  name: "update_project",
  description:
    "Update one of the user's projects: rename it, set its tags, or archive / unarchive it. Use this when the user asks to rename a project, tag it, or archive (hide) or restore one. Call get_my_projects first to find the project, then call this with the project (a name or numeric id) and one or more of: a new name, tags, or an archived flag. Tags REPLACE the project's existing tags (pass the full set). Archiving is reversible (it hides the project, it does not delete it or its tasks). The app shows a one-line preview before anything writes. After it writes, confirm in one short sentence what changed. Own projects only.",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description:
          "The project to update, by its name (case-insensitive) or numeric id, from get_my_projects.",
      },
      name: {
        type: "string",
        description: "A new name for the project. Optional.",
      },
      tags: {
        type: "string",
        description:
          "Comma-separated tags that REPLACE the project's current tags. Pass an empty string to clear all tags. Optional.",
      },
      archived: {
        type: "boolean",
        description:
          "Set true to archive (hide) the project, false to restore it. Archiving is reversible. Optional.",
      },
    },
    required: ["project"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const ref =
      typeof args.project === "string" || typeof args.project === "number"
        ? String(args.project)
        : "?";
    const changes: string[] = [];
    if (typeof args.name === "string" && args.name.trim()) {
      changes.push(`rename to "${args.name.trim()}"`);
    }
    if (typeof args.tags === "string") {
      const tags = parseTags(args.tags);
      changes.push(tags.length ? `set tags ${tags.join(", ")}` : "clear tags");
    }
    if (typeof args.archived === "boolean") {
      changes.push(args.archived ? "archive" : "restore");
    }
    const changeText = changes.length > 0 ? changes.join(", ") : "no change";
    return { summary: `update project "${ref}": ${changeText}` };
  },
  execute: async (args) => {
    const ref =
      typeof args.project === "string" || typeof args.project === "number"
        ? (args.project as string | number)
        : undefined;

    const projects = await projectToolsDeps.listProjects();
    const project = resolveOwnProject(projects, ref);
    if (!project) {
      const names = ownProjectNames(projects);
      return {
        ok: false as const,
        error: `I could not find one of your projects called "${ref}". Your projects are: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(none yet)"}. Use one of those exact names or its id (you can only update projects you own).`,
      };
    }

    const data: ProjectUpdate = {};
    if (typeof args.name === "string" && args.name.trim()) {
      data.name = args.name.trim();
    }
    if (typeof args.tags === "string") {
      data.tags = parseTags(args.tags);
    }
    if (typeof args.archived === "boolean") {
      data.is_archived = args.archived;
      data.archived_at = args.archived ? new Date().toISOString() : null;
    }

    if (Object.keys(data).length === 0) {
      return {
        ok: false as const,
        error:
          "Nothing to update. Pass a new name, tags, or an archived flag.",
      };
    }

    let updated: Project | null;
    try {
      updated = await projectToolsDeps.updateProject(project.id, data);
    } catch (err) {
      return {
        ok: false as const,
        error: `Could not update the project. ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!updated) {
      return {
        ok: false as const,
        error: `Project ${project.id} disappeared during the update.`,
      };
    }

    projectToolsDeps.navigate(objectDeepLink("project", updated.id));

    return {
      ok: true as const,
      id: updated.id,
      name: updated.name,
      tags: updated.tags ?? [],
      isArchived: updated.is_archived,
    };
  },
};
