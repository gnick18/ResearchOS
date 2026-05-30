/**
 * Create a project AND auto-pin it to a Single Project widget on the
 * creator's dashboard (dashboard-newproject-tour bot, 2026-05-29).
 *
 * Grant's decided model: a fresh dashboard with zero widgets can still create
 * a project (via the top-level "+ New Project" toolbar button), and every
 * project creation appends a `single-project` widget pinned to the new project
 * so the dashboard SHOWS it. This helper is the single chokepoint for the
 * dashboard-driven create flows (the top-level button AND the Projects
 * Overview widget's inline form) so the create + auto-widget pair stay
 * together.
 *
 * It is deliberately a UI-layer helper, NOT a hook inside `projectsApi.create`:
 * `projectsApi.create` lives in the data layer (`local-api`), and reaching the
 * layout mutator from there would pull the whole widget registry (and the
 * widget component tree, which imports `local-api`) into a cycle. Keeping the
 * auto-widget on the creation SITES avoids that and matches where the current
 * user / query client already live.
 *
 * De-dup + lifecycle are handled by `addSingleProjectWidgetForProject` (see
 * its doc): a project that already has its widget is a no-op, and a later
 * project delete leaves the widget showing its empty "pick a project" state.
 */
import { projectsApi } from "@/lib/local-api";
import type { Project } from "@/lib/types";
import { addSingleProjectWidgetForProject } from "./layout-persistence";

export interface CreateProjectWithWidgetInput {
  /** The dashboard owner (the current user) whose layout gets the widget. */
  username: string;
  /** Project name. Must be non-empty (projectsApi.create throws otherwise). */
  name: string;
  /** Project color (hex). Optional; projectsApi.create defaults it. */
  color?: string;
  /** Project tags. Optional; the full create modal collects these
   *  (comma-separated). Empty / omitted leaves the project untagged. */
  tags?: string[];
  /** Seven-day work week toggle (weekends count for scheduling). Optional;
   *  projectsApi.create defaults it to false (Gantt skips Sat/Sun). */
  weekend_active?: boolean;
}

/**
 * Create the project, then append its auto Single Project widget to the
 * dashboard. Returns the created project + the widget instance id (the value
 * the §6.1 tour uses to locate + click the new tile). The widget-add is
 * best-effort: a create succeeds even if the layout write fails (the project
 * still exists; the user can add a widget manually), so we never block the
 * creation on a layout-persistence hiccup.
 */
export async function createProjectWithDashboardWidget(
  input: CreateProjectWithWidgetInput,
): Promise<{ project: Project; widgetInstanceId: string | null }> {
  const project = await projectsApi.create({
    name: input.name,
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.weekend_active !== undefined
      ? { weekend_active: input.weekend_active }
      : {}),
  });
  let widgetInstanceId: string | null = null;
  try {
    widgetInstanceId = await addSingleProjectWidgetForProject(input.username, {
      id: project.id,
      owner: project.owner,
    });
  } catch (err) {
    // The project is already on disk; a failed layout write just means the
    // dashboard won't auto-show the widget. Surface it in dev, don't throw.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[create-project-with-widget] auto Single Project widget add failed",
        err,
      );
    }
  }
  return { project, widgetInstanceId };
}
