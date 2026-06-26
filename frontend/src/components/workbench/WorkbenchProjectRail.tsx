"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { encodeFilterKey, STANDALONE_FILTER_KEY } from "@/lib/search/filterKey";
import { Icon } from "@/components/icons";
import ProjectCreateModal from "@/components/lab-overview/ProjectCreateModal";
import type { Project } from "@/lib/types";

/**
 * Workbench left project rail (workbench IA redesign, 2026-06-25).
 *
 * Projects used to be a peer landing tab in the subtab row. The insight from
 * the code is that Projects is already a filter over the other tabs, so it
 * does not need to be a competing tab. This rail is that filter: a slim left
 * column that scopes the Experiments and Lists panels by project, plus a
 * footer that opens the full projects-management grid and the create-project
 * flow.
 *
 * It drives the SAME Zustand `selectedProjectIds` store the old horizontal
 * WorkbenchProjectFilterPills drove (toggleProject + the STANDALONE sentinel,
 * with an empty selection meaning "All projects"), so the rail and the
 * existing panel matching (matchesAnyProjectFilter) stay in lockstep.
 *
 * On Notes (project-agnostic) the filter section renders disabled with a
 * one-line hint; the Manage / New footer stays active. The page hides the rail
 * entirely on the projects-management tab (the grid IS the projects view).
 *
 * "Manage projects" carries the `workbench-projects-tab` tour anchor that the
 * removed Projects button used to host, so the generated AI anchor still
 * resolves. New project reuses the same ProjectCreateModal the projects panel
 * header opens, so there is no second create flow.
 */

const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

interface Props {
  projects: Project[];
  projectColors: Record<string, string>;
  /** The creating user, for the New project modal. Empty string hides New. */
  currentUser: string;
  /** When false (the Notes tab), grey out the project-filter section and show
   *  the "Notes are not filtered by project" hint. The footer stays active. */
  filterEnabled: boolean;
  /** Open the full WorkbenchProjectsPanel management grid (sets activeTab to
   *  "projects" on the page). */
  onManageProjects: () => void;
}

export default function WorkbenchProjectRail({
  projects,
  projectColors,
  currentUser,
  filterEnabled,
  onManageProjects,
}: Props) {
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const [createOpen, setCreateOpen] = useState(false);

  const allActive = selectedProjectIds.length === 0;

  const openCreate = () => {
    setCreateOpen(true);
    // Mirror NewProjectButton: advance the §6.1 TRIGGER walkthrough beat once
    // when the modal opens so the create flow stays identical to the header's.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tour:home-create-modal-opened"));
    }
  };

  return (
    <>
      <aside className="flex w-[170px] shrink-0 flex-col gap-0.5 overflow-auto border-r border-border bg-surface-raised px-2 py-3">
        <div className="px-2 pb-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-foreground-muted">
          Filter by project
        </div>

        {/* All projects: clears the selection (empty = all), matching the
            pills' length===0 short-circuit. */}
        <button
          type="button"
          disabled={!filterEnabled}
          onClick={() => useAppStore.getState().setSelectedProjects([])}
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta transition-colors ${
            !filterEnabled
              ? "cursor-default text-foreground-muted/50"
              : allActive
                ? "bg-surface-sunken font-semibold text-foreground"
                : "text-foreground hover:bg-surface-sunken"
          }`}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm bg-foreground-muted"
            aria-hidden
          />
          All projects
        </button>

        {projects.map((p) => {
          const pKey = encodeFilterKey(p);
          const isSelected = !allActive && selectedProjectIds.includes(pKey);
          return (
            <button
              key={pKey}
              type="button"
              disabled={!filterEnabled}
              onClick={() => useAppStore.getState().toggleProject(pKey)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta transition-colors ${
                !filterEnabled
                  ? "cursor-default text-foreground-muted/50"
                  : isSelected
                    ? "bg-surface-sunken font-semibold text-foreground"
                    : "text-foreground hover:bg-surface-sunken"
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: projectColors[projectKey(p)] }}
                aria-hidden
              />
              <span className="truncate">{p.name || "(unnamed project)"}</span>
            </button>
          );
        })}

        {/* Standalone (orphan tasks): same toggle + sentinel as the pills. */}
        <button
          type="button"
          disabled={!filterEnabled}
          onClick={() =>
            useAppStore.getState().toggleProject(STANDALONE_FILTER_KEY)
          }
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta transition-colors ${
            !filterEnabled
              ? "cursor-default text-foreground-muted/50"
              : !allActive && selectedProjectIds.includes(STANDALONE_FILTER_KEY)
                ? "bg-surface-sunken font-semibold text-foreground"
                : "text-foreground hover:bg-surface-sunken"
          }`}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm border border-dashed border-foreground-muted"
            aria-hidden
          />
          Standalone
        </button>

        {!filterEnabled && (
          <p className="px-2 pt-1.5 text-[0.7rem] italic text-foreground-muted">
            Notes are not filtered by project
          </p>
        )}

        {/* Footer: manage + create. Pinned to the bottom of the rail. */}
        <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-2">
          <button
            type="button"
            onClick={onManageProjects}
            data-tour-target="workbench-projects-tab"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            <Icon name="folder" className="h-3.5 w-3.5" />
            Manage projects
          </button>
          {currentUser && (
            <button
              type="button"
              onClick={openCreate}
              data-testid="rail-new-project-button"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta font-medium text-brand-action transition-colors hover:bg-surface-sunken"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              New project
            </button>
          )}
        </div>
      </aside>

      {createOpen && currentUser && (
        <ProjectCreateModal
          username={currentUser}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            // Match NewProjectButton.handleCreated: the modal invalidates the
            // ["projects"] query and closes itself, so the new project simply
            // appears in the rail. No navigation.
          }}
        />
      )}
    </>
  );
}
