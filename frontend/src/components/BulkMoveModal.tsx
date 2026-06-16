"use client";

import { useCallback, useState } from "react";
import { useAppStore } from "@/lib/store";
import { tasksApi } from "@/lib/local-api";
import { useQueryClient } from "@tanstack/react-query";
import LivingPopup from "@/components/ui/LivingPopup";

export default function BulkMoveModal() {
  const bulkMoveData = useAppStore((s) => s.bulkMoveData);
  const setBulkMoveData = useAppStore((s) => s.setBulkMoveData);
  const queryClient = useQueryClient();

  const handleConfirm = useCallback(async () => {
    if (!bulkMoveData) return;

    try {
      await tasksApi.move(bulkMoveData.taskId, {
        new_start_date: bulkMoveData.newStartDate,
        confirmed: true,
      });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch {
      alert("Failed to move task");
    } finally {
      setBulkMoveData(null);
    }
  }, [bulkMoveData, queryClient, setBulkMoveData]);

  const handleCancel = useCallback(async () => {
    setBulkMoveData(null);
    // Refresh to revert visual changes
    await queryClient.refetchQueries({ queryKey: ["tasks"] });
  }, [queryClient, setBulkMoveData]);

  // Retain the last non-null payload so the body stays rendered through
  // LivingPopup's close animation after the store clears bulkMoveData.
  // Synced during render (no ref read in render), mirroring the
  // ExportFormatDialog prevIsOpen pattern.
  const [data, setData] = useState(bulkMoveData);
  if (bulkMoveData && bulkMoveData !== data) setData(bulkMoveData);

  return (
    <LivingPopup
      open={!!bulkMoveData}
      onClose={handleCancel}
      label="Confirm Bulk Move"
      widthClassName="max-w-md"
      card={false}
    >
      {/* This confirm modal brings its own white card chrome (card=false). */}
      <div className="bg-surface-raised rounded-xl shadow-2xl w-full p-6">
        <h3 className="text-heading font-semibold text-foreground mb-2">
          Confirm Bulk Move
        </h3>

        <p className="text-body text-foreground-muted mb-4">
          This move affects{" "}
          <span className="font-bold text-foreground">
            {data?.affectedCount}
          </span>{" "}
          dependent task{data?.affectedCount !== 1 ? "s" : ""}. Shift
          all?
        </p>

        {data && data.warnings.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3 mb-4">
            <p className="text-meta font-semibold text-amber-700 dark:text-amber-300 mb-1">
              ⚠ Warnings
            </p>
            {data.warnings.map((w, i) => (
              <p key={i} className="text-meta text-amber-600 dark:text-amber-300">
                {w}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-body text-foreground-muted hover:text-foreground rounded-lg hover:bg-surface-sunken transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
