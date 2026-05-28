"use client";

import { useAppStore } from "@/lib/store";
import { encodeFilterKey, STANDALONE_FILTER_KEY } from "@/lib/search/filterKey";
import type { Project } from "@/lib/types";

const projectKey = (p: Pick<Project, "id" | "owner">) => `${p.owner}:${p.id}`;

interface Props {
  projects: Project[];
  projectColors: Record<string, string>;
}

export default function WorkbenchProjectFilterPills({
  projects,
  projectColors,
}: Props) {
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);

  return (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
      {projects.map((p) => {
        // Composite `${owner}:${id}` (same shape the store now stores).
        // Pre-fix bug: bare `.includes(p.id)` collapsed alex:1 and morgan:1.
        const pKey = encodeFilterKey(p);
        const isSelected =
          selectedProjectIds.length === 0 ||
          selectedProjectIds.includes(pKey);
        return (
          <button
            key={pKey}
            onClick={() => useAppStore.getState().toggleProject(pKey)}
            className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
              isSelected
                ? "text-white font-medium"
                : "bg-gray-100 text-gray-400"
            }`}
            style={
              isSelected
                ? { backgroundColor: projectColors[projectKey(p)] }
                : undefined
            }
          >
            {p.name}
          </button>
        );
      })}
      {/* Standalone pill (Grant 2026-05-27): orphan tasks (project_id
          null) don't match any project pill, so when a specific
          project is selected they vanish from the Workbench panel.
          This toggle brings them back, mirroring the Gantt toolbar's
          Standalone option. Routes through the same toggleProject +
          STANDALONE_FILTER_KEY sentinel that matchesAnyProjectFilter
          recognizes. Styled with a dashed border + neutral slate so it
          reads as "no folder" rather than a colored project. */}
      {(() => {
        const isSelected =
          selectedProjectIds.length === 0 ||
          selectedProjectIds.includes(STANDALONE_FILTER_KEY);
        return (
          <button
            onClick={() =>
              useAppStore.getState().toggleProject(STANDALONE_FILTER_KEY)
            }
            className={`px-2.5 py-1 text-xs rounded-full border border-dashed transition-colors ${
              isSelected
                ? "bg-slate-600 text-white font-medium border-slate-600"
                : "bg-gray-100 text-gray-400 border-gray-300"
            }`}
          >
            Standalone
          </button>
        );
      })()}
    </div>
  );
}
