"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { goalsApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { HighLevelGoal } from "@/lib/types";
import DynamicAnimation from "./DynamicAnimation";
import { useState } from "react";

interface HighLevelGoalSidebarProps {
  goals: HighLevelGoal[];
  onEditGoal: (goal: HighLevelGoal) => void;
  onDeleteGoal?: (goal: HighLevelGoal) => void;
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getDaysLeft(endDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = parseLocalDate(endDate);
  const diffTime = end.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function HighLevelGoalSidebar({
  goals,
  onEditGoal,
  onDeleteGoal,
}: HighLevelGoalSidebarProps) {
  const queryClient = useQueryClient();
  const animationType = useAppStore((s) => s.animationType);
  const [celebrationPosition, setCelebrationPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  
  // Stable callback for animation completion to prevent re-triggering
  const handleAnimationComplete = useCallback(() => {
    setCelebrationPosition(null);
  }, []);

  const activeGoals = goals
    .filter((g) => getDaysLeft(g.end_date) >= 0)
    .sort((a, b) => getDaysLeft(a.end_date) - getDaysLeft(b.end_date));

  const handleToggleSmartGoal = useCallback(
    async (
      goal: HighLevelGoal,
      smartGoalId: string,
      event: React.ChangeEvent<HTMLInputElement>
    ) => {
      // Only trigger animation when marking as complete
      // event.target.checked is the NEW state after the user clicked
      const isBecomingComplete = event.target.checked;
      if (isBecomingComplete) {
        const rect = event.target.getBoundingClientRect();
        setCelebrationPosition({
          x: rect.left + rect.width / 2,
          y: rect.top,
        });
      }

      const updatedSmartGoals = goal.smart_goals.map((sg) =>
        sg.id === smartGoalId
          ? { ...sg, is_complete: !sg.is_complete }
          : sg
      );

      try {
        await goalsApi.update(goal.id, {
          smart_goals: updatedSmartGoals,
        });
        await queryClient.refetchQueries({ queryKey: ["goals"] });
      } catch (err) {
        console.error("Failed to update subgoal:", err);
      }
    },
    [queryClient]
  );

  const handleDeleteSmartGoal = useCallback(
    async (goal: HighLevelGoal, smartGoalId: string) => {
      const updatedSmartGoals = goal.smart_goals.filter(
        (sg) => sg.id !== smartGoalId
      );

      try {
        await goalsApi.update(goal.id, {
          smart_goals: updatedSmartGoals,
        });
        await queryClient.refetchQueries({ queryKey: ["goals"] });
      } catch (err) {
        console.error("Failed to delete subgoal:", err);
      }
    },
    [queryClient]
  );

  if (activeGoals.length === 0) {
    return (
      <div className="w-72 bg-white border-l border-gray-200 p-4 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">
            High Level Goals
          </h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          No active goals
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">
          High Level Goals
        </h3>
        <p className="text-xs text-gray-400 mt-1">
          {activeGoals.length} active
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeGoals.map((goal) => {
          const daysLeft = getDaysLeft(goal.end_date);
          const isOverdue = daysLeft < 0;
          const isUrgent = daysLeft >= 0 && daysLeft <= 3;
          const completedCount = goal.smart_goals.filter(
            (sg) => sg.is_complete
          ).length;
          const totalCount = goal.smart_goals.length;
          const progressPercent =
            totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

          return (
            <div
              key={goal.id}
              className="bg-white rounded-lg shadow-sm border-l-4 relative group"
              style={{ borderLeftColor: goal.color || "#f59e0b" }}
            >
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onEditGoal(goal)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                  title="Edit goal"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>
                {onDeleteGoal && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteGoal(goal);
                    }}
                    className="text-gray-400 hover:text-red-500 p-1"
                    title="Delete goal"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>

              <div className="p-3 pr-8">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium text-gray-900 truncate">
                    {goal.name}
                  </h4>
                  {goal.project_id === null && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded flex-shrink-0">
                      Personal
                    </span>
                  )}
                </div>

                <div
                  className={`text-xs font-medium mt-1 ${
                    isOverdue
                      ? "text-red-600"
                      : isUrgent
                        ? "text-orange-600"
                        : "text-green-600"
                  }`}
                >
                  {isOverdue
                    ? `${Math.abs(daysLeft)} days overdue`
                    : daysLeft === 0
                      ? "Due today!"
                      : `${daysLeft} days left`}
                </div>

                {totalCount > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Progress</span>
                      <span>
                        {completedCount}/{totalCount}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all duration-300"
                        style={{ 
                          width: `${progressPercent}%`,
                          backgroundColor: goal.color || "#f59e0b"
                        }}
                      />
                    </div>
                  </div>
                )}

                {goal.smart_goals.filter(sg => !sg.is_complete).length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {goal.smart_goals.filter(sg => !sg.is_complete).map((sg) => (
                      <div
                        key={sg.id}
                        className={`flex items-start gap-2 p-1.5 rounded hover:bg-gray-50 transition-colors group ${
                          sg.is_complete ? "opacity-60" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={sg.is_complete}
                          onChange={(e) =>
                            handleToggleSmartGoal(goal, sg.id, e)
                          }
                          className="mt-0.5 w-3.5 h-3.5 text-green-600 border-gray-300 rounded focus:ring-green-500 flex-shrink-0"
                        />
                        <span
                          className={`text-xs flex-1 ${
                            sg.is_complete
                              ? "text-gray-400 line-through"
                              : "text-gray-600"
                          }`}
                        >
                          {sg.text}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSmartGoal(goal, sg.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity flex-shrink-0"
                          title="Delete sub-goal"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs text-gray-400 mt-2">
                  {goal.start_date} &rarr; {goal.end_date}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {celebrationPosition && (
        <DynamicAnimation
          type={animationType}
          x={celebrationPosition.x}
          y={celebrationPosition.y}
          onComplete={handleAnimationComplete}
        />
      )}
    </div>
  );
}
