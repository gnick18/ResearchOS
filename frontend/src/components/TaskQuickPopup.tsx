"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { tasksApi } from "@/lib/local-api";
import type { Task, Project } from "@/lib/types";
import DynamicAnimation from "./DynamicAnimation";
import Tooltip from "./Tooltip";
import { useAppStore } from "@/lib/store";

interface TaskQuickPopupProps {
  task: Task;
  project?: Project;
  position: { x: number; y: number };
  onClose: () => void;
  onExpand: () => void;
}

/**
 * A small popup that appears near the mouse when clicking a task card.
 * Shows a checkbox to mark as complete and an expand button.
 */
export default function TaskQuickPopup({
  task,
  position,
  onClose,
  onExpand,
}: TaskQuickPopupProps) {
  const queryClient = useQueryClient();
  const popupRef = useRef<HTMLDivElement>(null);
  const [animationPosition, setAnimationPosition] = useState<{ x: number; y: number } | null>(null);
  const animationType = useAppStore((s) => s.animationType);

  // Calculate popup position to ensure it stays within viewport
  const [adjustedPosition, setAdjustedPosition] = useState({ x: position.x, y: position.y });

  useEffect(() => {
    if (popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let x = position.x + 10; // Small offset from cursor
      let y = position.y + 10;

      // Adjust if popup would go off the right edge
      if (x + rect.width > viewportWidth - 20) {
        x = position.x - rect.width - 10;
      }

      // Adjust if popup would go off the bottom edge
      if (y + rect.height > viewportHeight - 20) {
        y = position.y - rect.height - 10;
      }

      // Ensure minimum distance from edges
      x = Math.max(10, x);
      y = Math.max(10, y);

      // eslint-disable-next-line react-hooks/set-state-in-effect -- adjust position based on measured popup DOM size; classic sync-to-DOM pattern
      setAdjustedPosition({ x, y });
    }
  }, [position]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const handleToggleComplete = useCallback(async (event: React.MouseEvent) => {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    
    try {
      await tasksApi.update(task.id, { is_complete: !task.is_complete });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      
      // Trigger celebration animation when marking as complete
      if (!task.is_complete) {
        setAnimationPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }
    } catch {
      alert("Failed to update task");
    }
  }, [task.id, task.is_complete, queryClient]);

  const handleExpand = useCallback(() => {
    onExpand();
    onClose();
  }, [onExpand, onClose]);

  const handleAnimationComplete = useCallback(() => {
    setAnimationPosition(null);
  }, []);

  const isExperiment = task.task_type === "experiment";

  return (
    <>
      <div
        ref={popupRef}
        className="fixed z-50 bg-surface-raised rounded-lg shadow-xl border border-border py-2 px-1 flex items-center gap-1 animate-in fade-in zoom-in duration-150"
        style={{
          left: `${adjustedPosition.x}px`,
          top: `${adjustedPosition.y}px`,
        }}
      >
        {/* Task name display */}
        <div className="flex items-center gap-2 px-2 max-w-[200px]">
          {isExperiment && (
            <div className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" />
          )}
          <span className="text-body text-foreground truncate" title={task.name}>
            {task.name}
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-surface-sunken" />

        {/* Complete checkbox */}
        <Tooltip label={task.is_complete ? "Mark as incomplete" : "Mark as complete"} placement="bottom">
          <button
            onClick={handleToggleComplete}
            className={`p-2 rounded-lg transition-all ${
              task.is_complete
                ? "bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-300 hover:bg-green-200"
                : "text-foreground-muted hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-500/20"
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </button>
        </Tooltip>

        {/* Expand button */}
        <Tooltip label="Open full details" placement="bottom">
          <button
            onClick={handleExpand}
            className="p-2 rounded-lg text-foreground-muted hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-brand-action/20 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
          </button>
        </Tooltip>
      </div>

      {/* Celebration animation */}
      {animationPosition && (
        <DynamicAnimation
          type={animationType}
          x={animationPosition.x}
          y={animationPosition.y}
          onComplete={handleAnimationComplete}
        />
      )}
    </>
  );
}
