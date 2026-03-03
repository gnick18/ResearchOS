"use client";

import { useEffect, useRef } from "react";
import { LabTask } from "@/lib/api";

interface LabTaskDetailPopupProps {
  task: LabTask;
  onClose: () => void;
}

export default function LabTaskDetailPopup({ task, onClose }: LabTaskDetailPopupProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-2xl max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            {/* User avatar */}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
              style={{ backgroundColor: task.user_color }}
            >
              {task.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{task.name}</h2>
              <p className="text-sm text-gray-500">by {task.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View Only Badge */}
            <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-medium rounded-full">
              View Only
            </span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-900"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* Task Type Badge */}
          <div className="mb-4">
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                task.task_type === "experiment"
                  ? "bg-blue-100 text-blue-700"
                  : task.task_type === "purchase"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {task.task_type.charAt(0).toUpperCase() + task.task_type.slice(1)}
            </span>
          </div>

          {/* Task Details Grid */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Start Date</p>
              <p className="text-gray-900 font-medium">{formatDate(task.start_date)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">End Date</p>
              <p className="text-gray-900 font-medium">{formatDate(task.end_date)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Duration</p>
              <p className="text-gray-900 font-medium">
                {task.duration_days} day{task.duration_days !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <p className={`font-medium ${task.is_complete ? "text-emerald-600" : "text-gray-600"}`}>
                {task.is_complete ? "Complete" : "In Progress"}
              </p>
            </div>
          </div>

          {/* Methods */}
          {task.method_ids && task.method_ids.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Methods</h3>
              <div className="flex flex-wrap gap-2">
                {task.method_ids.map((methodId) => (
                  <span
                    key={methodId}
                    className="px-3 py-1 bg-purple-100 text-purple-700 rounded-lg text-sm"
                  >
                    Method #{methodId}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {task.notes && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Notes</h3>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-700 whitespace-pre-wrap">{task.notes}</p>
              </div>
            </div>
          )}

          {/* Experiment Color */}
          {task.experiment_color && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Experiment Color</h3>
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full border border-gray-200"
                  style={{ backgroundColor: task.experiment_color }}
                />
                <span className="text-gray-700">{task.experiment_color}</span>
              </div>
            </div>
          )}

          {/* User Attribution */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>
                Owned by <span className="text-gray-900 font-medium">{task.username}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
