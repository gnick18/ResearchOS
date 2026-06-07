"use client";

import { useCallback, useState } from "react";
import { methodsApi, filesApi } from "@/lib/local-api";
import { useQueryClient } from "@tanstack/react-query";
import type { Method, Task } from "@/lib/types";
import LivingPopup from "@/components/ui/LivingPopup";

interface DeviationModalProps {
  open: boolean;
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
  open,
  task,
  method,
  onClose,
}: DeviationModalProps) {
  const [deviations, setDeviations] = useState("");
  const [forkName, setForkName] = useState("");
  const [mode, setMode] = useState<"choose" | "save" | "fork">("choose");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  // Retain the last task/method so the body stays rendered through
  // LivingPopup's close animation after the parent clears them. Synced
  // during render (no ref read in render), the ExportFormatDialog idiom.
  const [shownTask, setShownTask] = useState<Task>(task);
  const [shownMethod, setShownMethod] = useState<Method | null>(method);
  if (open && (task !== shownTask || method !== shownMethod)) {
    setShownTask(task);
    setShownMethod(method);
  }

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
        new_source_path: `methods/${forkName.trim().replace(/\s+/g, "-").toLowerCase()}.md`,
        deviations: deviations.trim(),
      });

      // Read the parent method content from disk
      let parentContent = "";
      try {
        if (method.source_path) {
          const file = await filesApi.readFile(method.source_path);
          parentContent = file.content;
        }
      } catch {
        parentContent = `# ${forkName}\n\n*Forked from: ${method.name}*\n`;
      }

      // Write the new method file with deviations appended
      const newContent = `${parentContent}\n\n---\n\n## Deviations from ${method.name}\n\n${deviations.trim()}`;
      if (newMethod.source_path) {
        await filesApi.writeFile(
          newMethod.source_path,
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
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Note Deviations"
      widthClassName="max-w-lg"
      card={false}
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl w-full p-6">
        <h3 className="text-heading font-semibold text-foreground mb-1">
          Note Deviations
        </h3>
        <p className="text-meta text-foreground-muted mb-4">
          Task: {shownTask.name}
          {shownMethod && ` · Method: ${shownMethod.name}`}
        </p>

        {/* Deviation text */}
        <div className="mb-4">
          <label className="block text-meta font-medium text-foreground-muted mb-1">
            What was different during this run?
          </label>
          <textarea
            value={deviations}
            onChange={(e) => setDeviations(e.target.value)}
            placeholder="Describe any protocol deviations, altered steps, or unexpected changes..."
            rows={5}
            className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Choice: save to task or fork */}
        {mode === "choose" && deviations.trim() && (
          <div className="space-y-2 mb-4">
            <button
              onClick={() => setMode("save")}
              className="w-full text-left px-4 py-3 border border-border rounded-lg hover:bg-surface-sunken transition-colors"
            >
              <p className="text-body font-medium text-foreground">
                Save to task results only
              </p>
              <p className="text-meta text-foreground-muted mt-0.5">
                Deviations are recorded in this task&apos;s log but the method
                stays unchanged.
              </p>
            </button>
            {shownMethod && (
              <button
                onClick={() => setMode("fork")}
                className="w-full text-left px-4 py-3 border border-border rounded-lg hover:bg-surface-sunken transition-colors"
              >
                <p className="text-body font-medium text-foreground">
                  Fork as new method
                </p>
                <p className="text-meta text-foreground-muted mt-0.5">
                  Create a new method file with these deviations baked in.
                  Becomes a child of &ldquo;{shownMethod.name}&rdquo;.
                </p>
              </button>
            )}
          </div>
        )}

        {/* Fork name input */}
        {mode === "fork" && (
          <div className="mb-4">
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              New method name
            </label>
            <input
              type="text"
              value={forkName}
              onChange={(e) => setForkName(e.target.value)}
              placeholder={`${shownMethod?.name} v2`}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-body text-foreground-muted hover:text-foreground rounded-lg hover:bg-surface-sunken transition-colors"
          >
            Cancel
          </button>
          {mode === "save" && (
            <button
              onClick={handleSaveToTask}
              disabled={saving || !deviations.trim()}
              className="px-4 py-2 text-body text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save to Task"}
            </button>
          )}
          {mode === "fork" && (
            <button
              onClick={handleForkMethod}
              disabled={saving || !deviations.trim() || !forkName.trim()}
              className="px-4 py-2 text-body text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Forking..." : "Fork Method"}
            </button>
          )}
          {mode === "choose" && !deviations.trim() && (
            <button
              disabled
              className="px-4 py-2 text-body text-white bg-gray-300 rounded-lg cursor-not-allowed"
            >
              Enter deviations first
            </button>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}
