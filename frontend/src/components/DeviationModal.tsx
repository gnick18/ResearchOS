"use client";

import { useCallback, useState } from "react";
import { methodsApi, githubApi } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import type { Method, Task } from "@/lib/types";

interface DeviationModalProps {
  task: Task;
  method: Method | null;
  onClose: () => void;
}

/**
 * Deviation workflow modal:
 * 1. User describes what was different during this run
 * 2. Choose: save deviations to task result only, OR fork as new method
 */
export default function DeviationModal({
  task,
  method,
  onClose,
}: DeviationModalProps) {
  const [deviations, setDeviations] = useState("");
  const [forkName, setForkName] = useState("");
  const [mode, setMode] = useState<"choose" | "save" | "fork">("choose");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleSaveToTask = useCallback(async () => {
    if (!deviations.trim()) return;
    setSaving(true);
    try {
      await methodsApi.saveDeviation({
        task_id: task.id,
        deviations: deviations.trim(),
      });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      onClose();
    } catch {
      alert("Failed to save deviations");
    } finally {
      setSaving(false);
    }
  }, [deviations, task.id, queryClient, onClose]);

  const handleForkMethod = useCallback(async () => {
    if (!deviations.trim() || !forkName.trim() || !method) return;
    setSaving(true);
    try {
      // Create the forked method in the database
      const newMethod = await methodsApi.fork(method.id, {
        new_name: forkName.trim(),
        new_github_path: `methods/${forkName.trim().replace(/\s+/g, "-").toLowerCase()}.md`,
        deviations: deviations.trim(),
      });

      // Read the parent method content from GitHub
      let parentContent = "";
      try {
        if (method.github_path) {
          const file = await githubApi.readFile(method.github_path);
          parentContent = file.content;
        }
      } catch {
        parentContent = `# ${forkName}\n\n*Forked from: ${method.name}*\n`;
      }

      // Write the new method file with deviations appended
      const newContent = `${parentContent}\n\n---\n\n## Deviations from ${method.name}\n\n${deviations.trim()}`;
      if (newMethod.github_path) {
        await githubApi.writeFile(
          newMethod.github_path,
          newContent,
          `Fork method: ${forkName} from ${method.name}`
        );
      }

      await queryClient.refetchQueries({ queryKey: ["methods"] });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      onClose();
    } catch {
      alert("Failed to fork method");
    } finally {
      setSaving(false);
    }
  }, [deviations, forkName, method, queryClient, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">
          Note Deviations
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Task: {task.name}
          {method && ` · Method: ${method.name}`}
        </p>

        {/* Deviation text */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            What was different during this run?
          </label>
          <textarea
            value={deviations}
            onChange={(e) => setDeviations(e.target.value)}
            placeholder="Describe any protocol deviations, altered steps, or unexpected changes..."
            rows={5}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Choice: save to task or fork */}
        {mode === "choose" && deviations.trim() && (
          <div className="space-y-2 mb-4">
            <button
              onClick={() => setMode("save")}
              className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <p className="text-sm font-medium text-gray-900">
                Save to task results only
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Deviations are recorded in this task&apos;s log but the method
                stays unchanged.
              </p>
            </button>
            {method && (
              <button
                onClick={() => setMode("fork")}
                className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <p className="text-sm font-medium text-gray-900">
                  Fork as new method
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Create a new method file with these deviations baked in.
                  Becomes a child of &ldquo;{method.name}&rdquo;.
                </p>
              </button>
            )}
          </div>
        )}

        {/* Fork name input */}
        {mode === "fork" && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              New method name
            </label>
            <input
              type="text"
              value={forkName}
              onChange={(e) => setForkName(e.target.value)}
              placeholder={`${method?.name} v2`}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          {mode === "save" && (
            <button
              onClick={handleSaveToTask}
              disabled={saving || !deviations.trim()}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save to Task"}
            </button>
          )}
          {mode === "fork" && (
            <button
              onClick={handleForkMethod}
              disabled={saving || !deviations.trim() || !forkName.trim()}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Forking..." : "Fork Method"}
            </button>
          )}
          {mode === "choose" && !deviations.trim() && (
            <button
              disabled
              className="px-4 py-2 text-sm text-white bg-gray-300 rounded-lg cursor-not-allowed"
            >
              Enter deviations first
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
