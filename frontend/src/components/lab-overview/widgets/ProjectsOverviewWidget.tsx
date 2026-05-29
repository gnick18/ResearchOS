"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { labApi, projectsApi } from "@/lib/local-api";
import type { ViewerVisibleProject } from "@/lib/local-api";
import UserAvatar from "@/components/UserAvatar";
import Tooltip from "@/components/Tooltip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { canRead } from "@/lib/sharing/unified";
import type { ExpandedViewProps, SnapshotTileProps, SidebarTileProps } from "./types";
import SidebarStatTile from "./snapshot/SidebarStatTile";

/**
 * Projects Overview widget (project-widgets family, project-widgets,
 * 2026-05-29). Restores the at-a-glance project grid + New Project button
 * the PIs lost when /home was hidden for lab heads, as a pinnable widget
 * on both the Lab Overview canvas and (for members) Home.
 *
 * TWO SCOPES (driven by the per-instance `config.projectScope`):
 *   - "my":  the VIEWER's own projects (compact cards: name, color,
 *            progress bar, incomplete-task count) + a New Project
 *            affordance. The member/Home default.
 *   - "lab": EVERY member's projects the viewer can see (name, owner,
 *            progress). The PI-dashboard default.
 *
 * DEFAULT BY SURFACE: when `config.projectScope` is unset, the scope
 * defaults to "lab" on the lab-overview canvas surface and "my" on the
 * /home surface. The viewer flips it with the in-widget My / Lab toggle,
 * which persists to the instance config via `onConfigChange` (wired on
 * both surfaces).
 *
 * PRIVACY CONTRACT (the lab-scope point):
 *   Lab scope reads `labApi.getProjectsWithProgress`, which returns every
 *   member's project records carrying their raw `{ owner, shared_with }`
 *   sharing fields. The widget then runs the SAME unified gate
 *   `LabNotesWidget` / `TraineeNotesWidget` use:
 *
 *     canRead(record, viewer) ⇒ a project surfaces ONLY if
 *       - the viewer owns it, OR
 *       - the viewer is a lab_head (implicit view-all), OR
 *       - it is shared with the viewer explicitly, OR
 *       - it is shared whole-lab via the "*" sentinel.
 *
 *   A project shared with a DIFFERENT user (and not the viewer, and the
 *   viewer is not a lab_head) NEVER appears. "My" scope is the same gate
 *   trivially narrowed to `owner === currentUser`.
 */

const FOLDER_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const PLUS_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/** Collapse the user-settings AccountType into the unified-sharing Viewer
 *  shape (identical to LabNotesWidget / TraineeNotesWidget). */
function useViewer(): {
  username: string;
  account_type: "lab" | "lab_head";
} | null {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  return useMemo(() => {
    if (!currentUser) return null;
    return {
      username: currentUser,
      account_type:
        accountType === "lab_head" ? ("lab_head" as const) : ("lab" as const),
    };
  }, [currentUser, accountType]);
}

/**
 * The viewer-visible project set, narrowed by scope. The `canRead` gate is
 * applied for EVERY scope; "lab" returns all visible projects, "my" keeps
 * only the viewer's own. Exported shape so the SnapshotTile + SidebarTile +
 * ExpandedView all compute the same set off one React Query read.
 */
function useViewerProjects(scope: "my" | "lab"): {
  isLoading: boolean;
  projects: ViewerVisibleProject[];
} {
  const viewer = useViewer();

  const { data: all = [], isLoading } = useQuery<ViewerVisibleProject[]>({
    queryKey: ["lab", "projects-with-progress"],
    queryFn: () => labApi.getProjectsWithProgress(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const projects = useMemo(() => {
    if (!viewer) return [];
    // PRIVACY GATE: canRead over the raw { owner, shared_with } each
    // record carries. A project shared with someone else never passes.
    const visible = all.filter((p) =>
      canRead({ owner: p.owner, shared_with: p.shared_with }, viewer),
    );
    const scoped =
      scope === "my"
        ? visible.filter((p) => p.owner === viewer.username)
        : visible;
    return scoped
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, viewer, scope]);

  return { isLoading, projects };
}

/**
 * Resolve the active scope. PI-gated (dashboard-unification build,
 * 2026-05-29): only a `lab_head` viewer can ever be in "lab" scope. For
 * solo and member accounts the scope is FORCED to "my" regardless of any
 * stored `projectScope` (a member who previously flipped a canvas
 * instance to "lab" does not retain lab scope), since the My/Lab toggle
 * is PI-only.
 *
 * For a lab_head: an explicit stored `projectScope` wins; otherwise the
 * surface default ("my" on home, "lab" on canvas).
 *
 * `isLabHead` is passed undefined while the account-type read is in
 * flight; treat that as "not yet lab_head" so a member never briefly
 * lands on lab scope.
 */
function resolveScope(
  config: ExpandedViewProps["config"],
  surface: "canvas" | "sidebar" | "home" | undefined,
  isLabHead: boolean | undefined,
): "my" | "lab" {
  if (isLabHead !== true) return "my";
  if (config?.projectScope) return config.projectScope;
  return surface === "home" ? "my" : "lab";
}

function progressPct(p: ViewerVisibleProject): number {
  if (p.taskTotal === 0) return 0;
  return Math.round((p.taskCompleted / p.taskTotal) * 100);
}

function projectHref(p: ViewerVisibleProject, currentUser: string | null): string {
  // Other members' projects open with an ?owner= suffix (project ids are
  // namespaced per owner). Own projects open bare. Mirrors app/page.tsx.
  if (currentUser && p.owner === currentUser) {
    return `/workbench/projects/${p.id}`;
  }
  return `/workbench/projects/${p.id}?owner=${encodeURIComponent(p.owner)}`;
}

/**
 * One labelled count in the Active / Overdue / Upcoming breakdown row
 * (projects-overview-richness bot, 2026-05-29). Mirrors the SingleProjectWidget
 * SnapshotTile CountStat so the multi-project cards read the same as the pinned
 * single-project tile + the old Home grid. `emphasizeWarn` renders red when the
 * value is > 0 (used for Overdue).
 */
function CardCountStat({
  label,
  value,
  emphasizeWarn,
}: {
  label: string;
  value: number;
  emphasizeWarn?: boolean;
}) {
  const warn = emphasizeWarn && value > 0;
  return (
    <div className="min-w-0">
      <div
        className={`text-sm font-semibold tabular-nums leading-tight ${
          warn ? "text-red-600" : "text-gray-900"
        }`}
      >
        {value}
      </div>
      <div
        className={`text-[9px] uppercase tracking-wide leading-tight ${
          warn ? "text-red-400" : "text-gray-400"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope toggle (My / Lab). Persists to the instance config on click.
// ─────────────────────────────────────────────────────────────────────────────

function ScopeToggle({
  scope,
  onConfigChange,
  config,
}: {
  scope: "my" | "lab";
  onConfigChange: ExpandedViewProps["onConfigChange"];
  config: ExpandedViewProps["config"];
}) {
  // The toggle ALWAYS renders so the active scope is legible. It only
  // persists when a config mutator is wired (every ExpandedView mount has
  // one now: both /home and /lab-overview); a read-only mount shows the
  // active scope without flipping it.
  const set = (next: "my" | "lab") => {
    if (!onConfigChange) return;
    onConfigChange({ ...(config ?? {}), projectScope: next });
  };
  return (
    <div
      className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium"
      role="group"
      aria-label="Project scope"
      data-testid="projects-overview-scope-toggle"
    >
      <button
        type="button"
        onClick={() => set("my")}
        data-testid="projects-overview-scope-my"
        aria-pressed={scope === "my"}
        className={`px-2.5 py-1 rounded-md transition-colors ${
          scope === "my"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-500 hover:text-gray-700"
        }`}
      >
        My projects
      </button>
      <button
        type="button"
        onClick={() => set("lab")}
        data-testid="projects-overview-scope-lab"
        aria-pressed={scope === "lab"}
        className={`px-2.5 py-1 rounded-md transition-colors ${
          scope === "lab"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-500 hover:text-gray-700"
        }`}
      >
        Lab projects
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExpandedView (popup body)
// ─────────────────────────────────────────────────────────────────────────────

export default function ProjectsOverviewWidget(props?: ExpandedViewProps) {
  const config = props?.config;
  const onConfigChange = props?.onConfigChange;
  const surface = props?.surface;

  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  // PI-gate (dashboard-unification build, 2026-05-29): the My/Lab scope
  // toggle is lab_head-only; solo + member viewers are forced to "my".
  const accountType = useAccountType(currentUser);
  const isLabHead = accountType === "lab_head";
  const scope = resolveScope(config, surface, isLabHead);
  const profileMap = useLabUserProfileMap();
  const { isLoading, projects } = useViewerProjects(scope);

  // Inline New Project flow, reusing the SAME `projectsApi.create` call the
  // Home grid form uses (name + color), then invalidates both the widget's
  // own read and the Home grid's `["projects"]` cache so a freshly created
  // project shows everywhere without a reload.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [saving, setSaving] = useState(false);

  const ownerLabel = (owner: string) =>
    profileMap[owner]?.displayName?.trim() || owner;

  const submitNewProject = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await projectsApi.create({ name, color: newColor });
      await queryClient.invalidateQueries({
        queryKey: ["lab", "projects-with-progress"],
      });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setNewName("");
      setCreating(false);
    } catch {
      // projectsApi.create throws on empty names; the guard above already
      // blocks that, so a throw here is an unexpected write failure.
      window.alert("Failed to create project");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* PI-gate (dashboard-unification build, 2026-05-29): the My/Lab
            toggle renders only for lab_head. Solo + member viewers are
            forced to "my" scope (see resolveScope) and see no toggle. */}
        {isLabHead ? (
          <ScopeToggle
            scope={scope}
            onConfigChange={onConfigChange}
            config={config}
          />
        ) : (
          <span />
        )}
        {scope === "my" && !creating && (
          <button
            type="button"
            data-testid="projects-overview-new-project"
            // Dashboard unification (dashboard-unification build,
            // 2026-05-29): the §6.1 walkthrough "create your first project"
            // step targets `home-new-project` and watches for the
            // `tour:home-create-modal-opened` event. The hardcoded Home
            // grid that previously owned those anchors is gone; the
            // Projects Overview widget is its 1:1 replacement, so the
            // anchor + event move here. NOTE: this widget's New Project
            // flow lives inside the tile popup, so the tour must open the
            // widget before this anchor resolves (see the build report's
            // FLAG on the §6.1/§6.2 tour-flow follow-up).
            data-tour-target="home-new-project"
            onClick={() => {
              setCreating(true);
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("tour:home-create-modal-opened"),
                );
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            <span aria-hidden="true">{PLUS_SVG}</span>
            New Project
          </button>
        )}
      </div>

      {scope === "my" && creating && (
        <div
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2"
          data-testid="projects-overview-new-project-form"
          // §6.1 walkthrough FILL step anchor (dashboard-unification
          // build, 2026-05-29): spotlights the create-project form, the
          // role the deleted Home grid form used to fill.
          data-tour-target="home-project-create-form"
        >
          <Tooltip label="Project color" placement="top">
            <input
              type="color"
              aria-label="Project color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-7 w-7 flex-shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
            />
          </Tooltip>
          <input
            type="text"
            autoFocus
            value={newName}
            placeholder="New project name"
            data-testid="projects-overview-new-project-name"
            data-tour-target="home-project-name-input"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewProject();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            className="flex-1 min-w-0 rounded border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800"
          />
          <button
            type="button"
            disabled={!newName.trim() || saving}
            onClick={submitNewProject}
            data-testid="projects-overview-new-project-save"
            data-tour-target="home-project-create-submit"
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
          Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <p className="text-sm text-gray-400 italic m-auto" data-testid="projects-overview-empty">
          {scope === "my"
            ? "No projects yet. Create one to get started."
            : "No lab projects shared with you yet."}
        </p>
      ) : (
        <ul
          className="flex-1 min-h-0 overflow-auto grid grid-cols-1 sm:grid-cols-2 gap-2"
          data-testid="projects-overview-list"
        >
          {projects.map((p) => {
            const pct = progressPct(p);
            const isOther = p.owner !== currentUser;
            return (
              <li key={`${p.owner}:${p.id}`}>
                <button
                  type="button"
                  data-testid={`projects-overview-card-${p.owner}-${p.id}`}
                  // §6.2 walkthrough NAV step anchor (dashboard-unification
                  // build, 2026-05-29): the step clicks
                  // `[data-tour-target^='home-project-card-']` to open the
                  // freshly created project. The deleted Home grid carried
                  // this prefix; the widget cards now do.
                  data-tour-target={`home-project-card-${p.owner}-${p.id}`}
                  onClick={() => router.push(projectHref(p, currentUser))}
                  className="w-full text-left rounded-lg border border-gray-200 p-3 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">
                      {p.name}
                    </span>
                    {scope === "lab" && isOther && (
                      <Tooltip label={`Owned by ${ownerLabel(p.owner)}`} placement="top">
                        <span className="flex-shrink-0">
                          <UserAvatar username={p.owner} size="sm" />
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold tabular-nums text-gray-900">
                      {pct}%
                    </span>
                    <span className="text-[11px] text-gray-500">complete</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: p.color }}
                    />
                  </div>
                  {/* Active / Overdue / Upcoming breakdown (projects-overview-
                      richness bot, 2026-05-29): mirrors the SingleProjectWidget
                      SnapshotTile + the old Home grid cards. Reads the
                      `taskActive` / `taskOverdue` / `taskUpcoming` fields
                      `getProjectsWithProgress` already populates; the `?? 0`
                      defaults the (test-only) absent case. Overdue goes red
                      when > 0. */}
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    <CardCountStat label="Active" value={p.taskActive ?? 0} />
                    <CardCountStat
                      label="Overdue"
                      value={p.taskOverdue ?? 0}
                      emphasizeWarn
                    />
                    <CardCountStat
                      label="Upcoming"
                      value={p.taskUpcoming ?? 0}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-gray-400 tabular-nums">
                    {p.taskIncomplete} task
                    {p.taskIncomplete === 1 ? "" : "s"} open
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const ExpandedView = ProjectsOverviewWidget;

export const HELP_TEXT =
  "An at-a-glance grid of your projects. Toggle between My projects (your own work, with a New Project button) and Lab projects (every member's projects you can see). Lab scope only ever shows projects shared with you; a PI sees them all. Click a card to open the project.";

// ─────────────────────────────────────────────────────────────────────────────
// SnapshotTile: compact top-projects list with mini progress bars.
// ─────────────────────────────────────────────────────────────────────────────

export function SnapshotTile(props: SnapshotTileProps) {
  // PI-gate (dashboard-unification build, 2026-05-29): mirror the
  // ExpandedView scope resolution so the compact tile shows the same
  // project set the popup would. Non-lab_head viewers are forced to "my".
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const isLabHead = accountType === "lab_head";
  const scope = resolveScope(props.config, props.surface, isLabHead);
  const { isLoading, projects } = useViewerProjects(scope);
  const top = projects.slice(0, 3);

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-blue-500 flex-shrink-0">
          {FOLDER_SVG}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          {scope === "my" ? "My projects" : "Lab projects"}
        </span>
      </div>
      {!isLoading && projects.length > 0 && (
        <span className="absolute top-0 right-0 text-[10px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full font-medium tabular-nums">
          {projects.length}
        </span>
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-1.5">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading…</p>
        ) : top.length === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">
            {scope === "my" ? "No projects yet" : "No lab projects"}
          </p>
        ) : (
          top.map((p) => {
            const pct = progressPct(p);
            return (
              <div key={`${p.owner}:${p.id}`} className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    aria-hidden="true"
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="flex-1 min-w-0 text-xs font-medium text-gray-800 truncate">
                    {p.name}
                  </span>
                  <span className="flex-shrink-0 text-[10px] text-gray-400 tabular-nums">
                    {p.taskIncomplete} open
                  </span>
                </div>
                <div className="mt-1 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: p.color }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile: slim "N projects" row.
// ─────────────────────────────────────────────────────────────────────────────

export function SidebarTile({ onClick }: SidebarTileProps) {
  // The sidebar surface has no per-instance config wired; default the
  // scope by treating the sidebar like the canvas (lab scope). The
  // sidebar is a lab_head rail, so lab scope is the natural read.
  const { isLoading, projects } = useViewerProjects("lab");
  return (
    <SidebarStatTile
      icon={FOLDER_SVG}
      iconClassName="text-blue-500"
      label="Lab projects"
      stat={isLoading ? "—" : projects.length}
      onClick={onClick}
    />
  );
}
