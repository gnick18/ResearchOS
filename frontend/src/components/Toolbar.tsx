"use client";

import { useState, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import type { Project, ViewMode } from "@/lib/types";
import AnimationSettingsPopup from "@/components/AnimationSettingsPopup";
import { ANIMATION_METADATA } from "@/components/animations";

const VIEW_MODES: { label: string; value: ViewMode }[] = [
  { label: "1W", value: "1week" },
  { label: "2W", value: "2week" },
  { label: "3W", value: "3week" },
  { label: "1M", value: "1month" },
  { label: "3M", value: "3month" },
  { label: "6M", value: "6month" },
  { label: "1Y", value: "1year" },
  { label: "All", value: "all" },
];

// Helper to format date as YYYY-MM-DD
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper to format date for display
function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Helper to get the Monday of a week
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

interface ToolbarProps {
  projects: Project[];
  allTags: string[];
  onCreateTask: () => void;
  onCreateGoal: () => void;
  projectColors?: Record<number, string>;
}

export default function Toolbar({
  projects,
  allTags,
  onCreateTask,
  onCreateGoal,
  projectColors,
}: ToolbarProps) {
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const toggleProject = useAppStore((s) => s.toggleProject);
  const selectedTags = useAppStore((s) => s.selectedTags);
  const toggleTag = useAppStore((s) => s.toggleTag);
  const animationType = useAppStore((s) => s.animationType);
  const ganttStartDate = useAppStore((s) => s.ganttStartDate);
  const setGanttStartDate = useAppStore((s) => s.setGanttStartDate);
  const ganttNavigateWeeks = useAppStore((s) => s.ganttNavigateWeeks);
  
  const [showAnimationSettings, setShowAnimationSettings] = useState(false);

  // Calculate weeks to show based on view mode
  const weeksToShow = useMemo(() => {
    switch (viewMode) {
      case "1week": return 1;
      case "2week": return 2;
      case "3week": return 3;
      case "1month": return 4;
      case "3month": return 13;
      case "6month": return 26;
      case "1year": return 52;
      case "all": return 8;
      default: return 2;
    }
  }, [viewMode]);

  // Calculate display date range
  const displayDateRange = useMemo(() => {
    const start = ganttStartDate 
      ? new Date(ganttStartDate + 'T00:00:00')
      : getMonday(new Date());
    
    const end = new Date(start);
    end.setDate(end.getDate() + weeksToShow * 7 - 1);
    
    return { start, end };
  }, [ganttStartDate, weeksToShow]);

  // Handle calendar date change
  const handleCalendarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedDate = e.target.value;
    if (!selectedDate) {
      setGanttStartDate(null);
      return;
    }
    
    const date = new Date(selectedDate + 'T00:00:00');
    const monday = getMonday(date);
    setGanttStartDate(formatDate(monday));
  };

  // Reset to current week
  const handleResetToToday = () => {
    setGanttStartDate(null);
  };

  // Get the current display start date for the calendar
  const displayStartDate = ganttStartDate || formatDate(getMonday(new Date()));

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-3 flex items-center gap-4 flex-wrap">
      {/* Project filter pills */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 font-medium mr-1">
          Projects:
        </span>
        {projects.map((p) => {
          const isSelected =
            selectedProjectIds.length === 0 ||
            selectedProjectIds.includes(p.id);
          const projectColor = projectColors?.[p.id] || "#3b82f6";
          return (
            <button
              key={p.id}
              onClick={() => toggleProject(p.id)}
              className={`
                px-2.5 py-1 text-xs rounded-full transition-colors
                ${
                  isSelected
                    ? "text-white font-medium"
                    : "bg-gray-100 text-gray-400"
                }
              `}
              style={
                isSelected
                  ? { backgroundColor: projectColor }
                  : undefined
              }
            >
              {p.name}
            </button>
          );
        })}
      </div>

      {/* Tag filter pills */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 font-medium mr-1">Tags:</span>
          {allTags.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`
                  px-2.5 py-1 text-xs rounded-full transition-colors
                  ${
                    isSelected
                      ? "bg-emerald-100 text-emerald-700 font-medium"
                      : "bg-gray-100 text-gray-400"
                  }
                `}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* View mode buttons */}
      <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
        {VIEW_MODES.map((vm) => (
          <button
            key={vm.value}
            onClick={() => setViewMode(vm.value)}
            className={`
              px-2.5 py-1 text-xs rounded-md transition-colors
              ${
                viewMode === vm.value
                  ? "bg-white text-gray-900 shadow-sm font-medium"
                  : "text-gray-500 hover:text-gray-700"
              }
            `}
          >
            {vm.label}
          </button>
        ))}
      </div>

      {/* Add goal button */}
      <button
        onClick={onCreateGoal}
        className="px-3 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="6"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
        Goal
      </button>

      {/* Add task button */}
      <button
        onClick={onCreateTask}
        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        + Task
      </button>

      {/* Animation settings button */}
      <button
        onClick={() => setShowAnimationSettings(true)}
        className="px-2.5 py-1.5 text-sm bg-white border border-gray-200 text-gray-700 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all flex items-center gap-1.5 hover:animate-jiggle"
        title="Animation Settings"
      >
        <span className="text-base">{ANIMATION_METADATA[animationType].icon}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </button>

      {/* Week navigation controls */}
      <div className="flex items-center gap-1.5 border-l border-gray-200 pl-4">
        {/* Previous week button */}
        <button
          onClick={() => ganttNavigateWeeks(-1)}
          className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center"
          title="Go back 1 week"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        {/* Date picker */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={displayStartDate}
            onChange={handleCalendarChange}
            className="px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
            title="Select a Monday to start from (will be adjusted to nearest Monday)"
          />
        </div>

        {/* Next week button */}
        <button
          onClick={() => ganttNavigateWeeks(1)}
          className="px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center"
          title="Go forward 1 week"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Reset button - only show when viewing a custom date */}
        {ganttStartDate && (
          <button
            onClick={handleResetToToday}
            className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
            title="Reset to current week"
          >
            Today
          </button>
        )}

        {/* Date range display */}
        <span className="text-xs text-gray-500 ml-1">
          {formatMonthLabel(displayDateRange.start)} – {formatMonthLabel(displayDateRange.end)}
        </span>
      </div>

      {/* Animation Settings Popup */}
      <AnimationSettingsPopup
        isOpen={showAnimationSettings}
        onClose={() => setShowAnimationSettings(false)}
      />
    </div>
  );
}
