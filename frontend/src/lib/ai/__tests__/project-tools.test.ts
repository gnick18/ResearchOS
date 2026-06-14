// project-tools tests (ai project-tools bot, 2026-06-14).
//
// Tests cover:
//   - ownProjects / resolveOwnProject / ownProjectNames: pure resolution by name
//     + id, case-insensitivity, the own-projects-only filter.
//   - create_project: describeAction preview, execute calls createProject with the
//     name + parsed tags, navigate seam, the empty-name guard.
//   - update_project: describeAction preview, execute builds the ProjectUpdate
//     (rename / replace-tags / archive), the empty-string clears, the archive flag
//     sets archived_at, the nothing-to-update guard, the not-an-own-project path.
//
// All tests stub projectToolsDeps (the injectable seam), so no real folder or
// local-api is involved. These tools WRITE real data, so the actual create /
// update needs Grant's :3000 pass; here we pin the wiring + the args each api
// method receives.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  projectToolsDeps,
  ownProjects,
  resolveOwnProject,
  ownProjectNames,
  createProjectTool,
  updateProjectTool,
} from "../tools/project-tools";
import type { Project } from "@/lib/types";

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: "Cloning",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "2026-06-14T00:00:00.000Z",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: "testuser",
    shared_with: [],
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ownProjects / resolveOwnProject", () => {
  const projects = [
    makeProject({ id: 1, name: "Cloning" }),
    makeProject({ id: 2, name: "Shared one", is_shared_with_me: true }),
  ];
  it("filters out projects shared WITH the user", () => {
    expect(ownProjects(projects).map((p) => p.id)).toEqual([1]);
  });
  it("resolves an own project by id and name (case-insensitive)", () => {
    expect(resolveOwnProject(projects, 1)?.name).toBe("Cloning");
    expect(resolveOwnProject(projects, "cloning")?.id).toBe(1);
  });
  it("never resolves a shared-with-me project", () => {
    expect(resolveOwnProject(projects, 2)).toBeNull();
    expect(resolveOwnProject(projects, "Shared one")).toBeNull();
  });
  it("ownProjectNames lists only owned names", () => {
    expect(ownProjectNames(projects)).toEqual(["Cloning"]);
  });
});

describe("create_project tool", () => {
  it("is a gated action, not destructive", () => {
    expect(createProjectTool.action).toBe(true);
    expect(createProjectTool.isDestructive?.({})).toBe(false);
  });

  it("describeAction summarizes name and tags", () => {
    const { summary } = createProjectTool.describeAction!({
      name: "cyp51A knockout",
      tags: "fumigatus, resistance",
    });
    expect(summary).toContain('create project "cyp51A knockout"');
    expect(summary).toContain("fumigatus, resistance");
  });

  it("creates with the name + parsed tags and does NOT auto-open the project", async () => {
    const createProject = vi
      .spyOn(projectToolsDeps, "createProject")
      .mockResolvedValue(makeProject({ id: 7, name: "Imaging", tags: ["microscopy"] }));
    const navigate = vi.spyOn(projectToolsDeps, "navigate").mockImplementation(() => {});

    const result = (await createProjectTool.execute({
      name: "Imaging",
      tags: "microscopy",
    })) as { ok: boolean; id: number };

    expect(result.ok).toBe(true);
    expect(result.id).toBe(7);
    expect(createProject).toHaveBeenCalledWith({ name: "Imaging", tags: ["microscopy"] });
    // Create deliberately does NOT navigate (the chat card's Open button is enough).
    expect(navigate).not.toHaveBeenCalled();
  });

  it("omits tags when none are given", async () => {
    const createProject = vi
      .spyOn(projectToolsDeps, "createProject")
      .mockResolvedValue(makeProject({ id: 8, name: "Bare" }));
    vi.spyOn(projectToolsDeps, "navigate").mockImplementation(() => {});
    await createProjectTool.execute({ name: "Bare" });
    expect(createProject).toHaveBeenCalledWith({ name: "Bare" });
  });

  it("errors on an empty name", async () => {
    const createProject = vi.spyOn(projectToolsDeps, "createProject");
    const result = (await createProjectTool.execute({ name: "  " })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/name is required/i);
    expect(createProject).not.toHaveBeenCalled();
  });
});

describe("update_project tool", () => {
  it("describeAction summarizes rename, tags, and archive", () => {
    const { summary } = updateProjectTool.describeAction!({
      project: "Cloning",
      name: "Cloning v2",
      tags: "active",
      archived: true,
    });
    expect(summary).toContain('update project "Cloning"');
    expect(summary).toContain('rename to "Cloning v2"');
    expect(summary).toContain("set tags active");
    expect(summary).toContain("archive");
  });

  it("builds the ProjectUpdate (rename, replace tags) and navigates", async () => {
    vi.spyOn(projectToolsDeps, "listProjects").mockResolvedValue([
      makeProject({ id: 3, name: "Cloning" }),
    ]);
    const updateProject = vi
      .spyOn(projectToolsDeps, "updateProject")
      .mockResolvedValue(makeProject({ id: 3, name: "Cloning v2", tags: ["active"] }));
    const navigate = vi.spyOn(projectToolsDeps, "navigate").mockImplementation(() => {});

    const result = (await updateProjectTool.execute({
      project: "cloning",
      name: "Cloning v2",
      tags: "active",
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    const [id, data] = updateProject.mock.calls[0];
    expect(id).toBe(3);
    expect(data).toEqual({ name: "Cloning v2", tags: ["active"] });
    expect(navigate).toHaveBeenCalledWith("/workbench/projects/3");
  });

  it("sets archived_at when archiving, clears it when restoring", async () => {
    vi.spyOn(projectToolsDeps, "listProjects").mockResolvedValue([makeProject({ id: 3 })]);
    const updateProject = vi
      .spyOn(projectToolsDeps, "updateProject")
      .mockResolvedValue(makeProject({ id: 3, is_archived: false }));
    vi.spyOn(projectToolsDeps, "navigate").mockImplementation(() => {});

    await updateProjectTool.execute({ project: 3, archived: false });
    expect(updateProject.mock.calls[0][1]).toEqual({
      is_archived: false,
      archived_at: null,
    });
  });

  it("guards nothing-to-update", async () => {
    vi.spyOn(projectToolsDeps, "listProjects").mockResolvedValue([makeProject({ id: 3 })]);
    const updateProject = vi.spyOn(projectToolsDeps, "updateProject");
    const result = (await updateProjectTool.execute({ project: 3 })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing to update/i);
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("errors with the user's real project names when the ref misses", async () => {
    vi.spyOn(projectToolsDeps, "listProjects").mockResolvedValue([
      makeProject({ id: 3, name: "Cloning" }),
    ]);
    const result = (await updateProjectTool.execute({ project: "Nope", name: "x" })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cloning");
  });
});
