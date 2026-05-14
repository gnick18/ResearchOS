"use client";

import { useEffect, useMemo, useState } from "react";
import { projectsApi } from "@/lib/local-api";
import type {
  ELNProjectDecision,
  ELNProjectMapping,
} from "@/lib/import/eln/types";

interface ExistingProject {
  id: number;
  name: string;
}

interface ProjectMappingStepProps {
  mappings: ELNProjectMapping[];
  onChange: (next: ELNProjectMapping[]) => void;
  onValidityChange: (valid: boolean) => void;
}

interface MappingError {
  treePathKey: string;
  message: string;
}

function validateMappings(mappings: ELNProjectMapping[]): MappingError[] {
  const errors: MappingError[] = [];
  for (const m of mappings) {
    if (m.decision === "import-new") {
      const name = (m.newProjectName ?? m.defaultProjectName ?? "").trim();
      if (name.length === 0) {
        errors.push({ treePathKey: m.treePathKey, message: "Project name is required." });
      }
    } else if (m.decision === "use-existing") {
      if (m.existingProjectId == null) {
        errors.push({ treePathKey: m.treePathKey, message: "Pick an existing project." });
      }
    }
  }
  return errors;
}

export default function ProjectMappingStep({
  mappings,
  onChange,
  onValidityChange,
}: ProjectMappingStepProps) {
  const [existing, setExisting] = useState<ExistingProject[] | null>(null);
  const [existingErr, setExistingErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectsApi
      .list()
      .then((list) => {
        if (cancelled) return;
        const filtered = list
          .filter((p) => !p.is_archived)
          .map((p) => ({ id: p.id, name: p.name }));
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        setExisting(filtered);
      })
      .catch((err) => {
        if (cancelled) return;
        setExistingErr(err instanceof Error ? err.message : "Failed to load existing projects.");
        setExisting([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const errors = useMemo(() => validateMappings(mappings), [mappings]);
  const errorByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of errors) map.set(e.treePathKey, e.message);
    return map;
  }, [errors]);

  useEffect(() => {
    onValidityChange(errors.length === 0);
  }, [errors, onValidityChange]);

  const updateMapping = (idx: number, patch: Partial<ELNProjectMapping>) => {
    const next = mappings.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          Map notebook folders to projects.
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Each row is a parent folder in your notebook that contains imported
          pages. Decide whether to create a new project, link to an existing
          one, or leave its pages unassigned.
        </p>
      </div>

      {existingErr && (
        <p className="text-xs text-red-600">{existingErr}</p>
      )}

      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr className="text-left text-gray-600">
              <th className="px-3 py-2 font-medium">Tree path</th>
              <th className="px-3 py-2 font-medium">Decision</th>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">Affects</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {mappings.map((m, idx) => (
              <MappingRow
                key={m.treePathKey}
                mapping={m}
                existing={existing}
                error={errorByKey.get(m.treePathKey) ?? null}
                onChange={(patch) => updateMapping(idx, patch)}
              />
            ))}
            {mappings.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                  No mappings — every page is at the notebook root.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MappingRow({
  mapping,
  existing,
  error,
  onChange,
}: {
  mapping: ELNProjectMapping;
  existing: ExistingProject[] | null;
  error: string | null;
  onChange: (patch: Partial<ELNProjectMapping>) => void;
}) {
  const pageCount = mapping.pageIds.length;
  const setDecision = (next: ELNProjectDecision) => {
    if (next === "import-new") {
      onChange({
        decision: next,
        newProjectName: mapping.newProjectName ?? mapping.defaultProjectName ?? "",
        existingProjectId: undefined,
      });
      return;
    }
    if (next === "use-existing") {
      onChange({
        decision: next,
        existingProjectId: mapping.existingProjectId ?? existing?.[0]?.id,
      });
      return;
    }
    onChange({ decision: next, existingProjectId: undefined });
  };

  return (
    <tr className="align-top">
      <td className="px-3 py-2 text-gray-800 font-mono text-[11px] whitespace-nowrap">
        {mapping.treePathKey || <span className="text-gray-400">(root)</span>}
      </td>
      <td className="px-3 py-2">
        <select
          value={mapping.decision}
          onChange={(e) => setDecision(e.target.value as ELNProjectDecision)}
          className="border border-gray-200 rounded px-2 py-1 text-xs bg-white"
        >
          <option value="import-new">Create new project</option>
          <option value="use-existing">Use existing</option>
          <option value="no-project">No project</option>
        </select>
      </td>
      <td className="px-3 py-2">
        {mapping.decision === "import-new" && (
          <input
            type="text"
            value={mapping.newProjectName ?? ""}
            onChange={(e) => onChange({ newProjectName: e.target.value })}
            placeholder={mapping.defaultProjectName ?? "Project name"}
            className={`w-full border rounded px-2 py-1 text-xs ${
              error ? "border-red-300" : "border-gray-200"
            }`}
          />
        )}
        {mapping.decision === "use-existing" && (
          existing === null ? (
            <span className="text-[11px] text-gray-500">Loading projects…</span>
          ) : existing.length === 0 ? (
            <span className="text-[11px] text-gray-500">No existing projects to link.</span>
          ) : (
            <select
              value={mapping.existingProjectId ?? ""}
              onChange={(e) =>
                onChange({ existingProjectId: Number(e.target.value) })
              }
              className={`w-full border rounded px-2 py-1 text-xs bg-white ${
                error ? "border-red-300" : "border-gray-200"
              }`}
            >
              <option value="">— pick a project —</option>
              {existing.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )
        )}
        {mapping.decision === "no-project" && (
          <span className="text-[11px] text-gray-400">—</span>
        )}
        {error && (
          <p className="text-[11px] text-red-600 mt-1">{error}</p>
        )}
      </td>
      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
        {pageCount} page{pageCount === 1 ? "" : "s"}
      </td>
    </tr>
  );
}
