"use client";

import { useAppStore } from "@/lib/store";
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
        const isSelected =
          selectedProjectIds.length === 0 ||
          selectedProjectIds.includes(p.id);
        return (
          <button
            key={`${p.owner}:${p.id}`}
            onClick={() => useAppStore.getState().toggleProject(p.id)}
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
    </div>
  );
}
