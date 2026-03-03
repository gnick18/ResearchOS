"use client";

import { useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { tasksApi } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

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

  if (!bulkMoveData) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Confirm Bulk Move
        </h3>

        <p className="text-sm text-gray-600 mb-4">
          This move affects{" "}
          <span className="font-bold text-gray-900">
            {bulkMoveData.affectedCount}
          </span>{" "}
          dependent task{bulkMoveData.affectedCount !== 1 ? "s" : ""}. Shift
          all?
        </p>

        {bulkMoveData.warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            <p className="text-xs font-semibold text-amber-700 mb-1">
              ⚠ Warnings
            </p>
            {bulkMoveData.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-600">
                {w}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
