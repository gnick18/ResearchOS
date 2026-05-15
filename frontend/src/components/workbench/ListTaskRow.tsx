"use client";

import type { ReactNode } from "react";
import type { Task } from "@/lib/types";
import Tooltip from "@/components/Tooltip";
import SubTaskProgressDots from "@/components/workbench/SubTaskProgressDots";

export type DateSignalKind = "overdue" | "doing" | "upcoming" | "done";

export interface ListTaskRowProps {
  task: Task;
  projectName: string;
  projectColor: string;
  /** Pre-formatted date signal (e.g. "Due 3d ago", "Starts in 5d", "Done yesterday"). */
  dateSignal: string;
  dateKind: DateSignalKind;
  /** Optional pill rendered on the right (e.g. SharedFromPill). */
  sharedIndicator?: ReactNode;
  onOpen: () => void;
  onToggleComplete: () => void;
  /** Whether the parent-completion checkbox is interactive. False for shared
   *  view-only tasks. */
  canToggleComplete?: boolean;
}

const DATE_CHIP_CLASSES: Record<DateSignalKind, string> = {
  overdue: "text-red-700 bg-red-50 border border-red-200",
  doing: "text-blue-700 bg-blue-50 border border-blue-200",
  upcoming: "text-gray-600 bg-gray-50 border border-gray-200",
  done: "text-gray-500 bg-gray-50 border border-gray-200",
};

export default function ListTaskRow({
  task,
  projectName,
  projectColor,
  dateSignal,
  dateKind,
  sharedIndicator,
  onOpen,
  onToggleComplete,
  canToggleComplete = true,
}: ListTaskRowProps) {
  const totalSubTasks = task.sub_tasks?.length ?? 0;
  const completedSubTasks =
    task.sub_tasks?.filter((s) => s.is_complete).length ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex items-start gap-3 px-3 py-2.5 bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer text-left"
    >
      {/* Parent completion checkbox */}
      <Tooltip
        label={
          task.is_complete ? "Mark as incomplete" : "Mark as complete"
        }
        placement="top"
      >
        <button
          type="button"
          aria-label={
            task.is_complete ? "Mark as incomplete" : "Mark as complete"
          }
          disabled={!canToggleComplete}
          onClick={(e) => {
            e.stopPropagation();
            if (canToggleComplete) onToggleComplete();
          }}
          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
            task.is_complete
              ? "bg-emerald-500 border border-emerald-500 text-white hover:bg-emerald-600"
              : "border border-gray-300 hover:border-emerald-500 hover:bg-emerald-50"
          } ${canToggleComplete ? "" : "opacity-50 cursor-not-allowed"}`}
        >
          {task.is_complete && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </button>
      </Tooltip>

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span
            className={`text-sm flex-1 min-w-0 truncate ${
              task.is_complete
                ? "text-gray-500 line-through"
                : "text-gray-900 font-medium"
            }`}
          >
            {task.name}
          </span>

          {totalSubTasks > 0 && (
            <SubTaskProgressDots
              completed={completedSubTasks}
              total={totalSubTasks}
            />
          )}
        </div>

        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs">
          <span className="inline-flex items-center gap-1.5 text-gray-500">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: projectColor }}
              aria-hidden
            />
            <span className="truncate max-w-[16rem]">{projectName}</span>
          </span>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] tabular-nums ${DATE_CHIP_CLASSES[dateKind]}`}
          >
            {dateKind === "overdue" && (
              <svg
                aria-hidden
                className="w-3 h-3 mr-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
                />
              </svg>
            )}
            {dateSignal}
          </span>
        </div>
      </div>

      {sharedIndicator && (
        <div className="flex-shrink-0 ml-2 self-center">{sharedIndicator}</div>
      )}
    </div>
  );
}
