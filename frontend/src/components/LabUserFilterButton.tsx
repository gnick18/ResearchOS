"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { LabUser } from "@/lib/api";

interface LabUserFilterButtonProps {
  users: LabUser[];
  selectedUsernames: Set<string>;
  onToggleUser: (username: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

// Local storage key for button position
const POSITION_STORAGE_KEY = "lab-filter-button-position-v2"; // v2 to reset position

export default function LabUserFilterButton({
  users,
  selectedUsernames,
  onToggleUser,
  onSelectAll,
  onDeselectAll,
}: LabUserFilterButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  // Default position is bottom-right (will be calculated on first render)
  const [position, setPosition] = useState(() => {
    // Calculate default position immediately
    if (typeof window !== 'undefined') {
      return {
        x: window.innerWidth - 180,
        y: window.innerHeight - 100,
      };
    }
    return { x: 100, y: 100 }; // Fallback for SSR
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLDivElement>(null);
  const hasMoved = useRef(false);

  // Load position from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(POSITION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPosition(parsed);
      }
      // If no saved position, keep the default (bottom-right)
    } catch {
      // Keep default position if localStorage fails
    }
  }, []);

  // Save position to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
    } catch {
      // Ignore localStorage errors
    }
  }, [position]);

  // Handle mouse down for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isExpanded) return;
    
    e.preventDefault();
    setIsDragging(true);
    hasMoved.current = false;
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  }, [isExpanded, position]);

  // Handle mouse move for dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      hasMoved.current = true;
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      
      // Keep button within viewport bounds
      const buttonSize = 56; // Approximate button size
      const maxX = window.innerWidth - buttonSize;
      const maxY = window.innerHeight - buttonSize;
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Handle click to expand/collapse
  const handleClick = useCallback(() => {
    if (hasMoved.current) {
      hasMoved.current = false;
      return;
    }
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  // Close expanded panel when clicking outside
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };

    // Delay to avoid immediate close
    const timeoutId = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isExpanded]);

  const selectedCount = selectedUsernames.size;
  const allSelected = selectedCount === users.length;

  return (
    <div
      ref={buttonRef}
      className="fixed z-50"
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? "grabbing" : isExpanded ? "default" : "grab",
      }}
    >
      {/* Expanded panel */}
      {isExpanded && (
        <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl border border-gray-200 shadow-2xl p-4 min-w-[280px]">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Filter Users</h3>
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (allSelected) {
                    onDeselectAll();
                  } else {
                    onSelectAll();
                  }
                }}
                className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
              >
                {allSelected ? "Deselect All" : "Select All"}
              </button>
            </div>
          </div>

          {/* User list */}
          <div className="flex flex-wrap gap-2 max-h-[300px] overflow-y-auto">
            {users
              .sort((a, b) => {
                // Sort by created_at (oldest first)
                if (!a.created_at && !b.created_at) return 0;
                if (!a.created_at) return 1;
                if (!b.created_at) return -1;
                return a.created_at.localeCompare(b.created_at);
              })
              .map((user) => {
                const isSelected = selectedUsernames.has(user.username);
                return (
                  <button
                    key={user.username}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleUser(user.username);
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                      isSelected
                        ? "ring-2 ring-gray-300"
                        : "ring-1 ring-gray-200 opacity-50"
                    }`}
                    style={{
                      backgroundColor: isSelected ? user.color : `${user.color}33`,
                    }}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-sm font-medium"
                      style={{ backgroundColor: user.color }}
                    >
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <span
                      className={isSelected ? "text-white" : "text-gray-500"}
                    >
                      {user.username}
                    </span>
                  </button>
                );
              })}
          </div>

          {/* Footer */}
          <div className="mt-3 pt-3 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              {selectedCount} of {users.length} users selected
            </p>
          </div>
        </div>
      )}

      {/* Main button */}
      <div
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        className={`flex items-center gap-2 px-3 py-2 rounded-full shadow-lg transition-all ${
          isDragging ? "scale-105" : "hover:scale-102"
        } ${
          isExpanded
            ? "bg-gradient-to-r from-emerald-500 to-teal-600"
            : "bg-white border border-gray-200 hover:border-emerald-500"
        }`}
        title="Filter users to display"
      >
        {/* Filter icon */}
        <svg className={`w-4 h-4 ${isExpanded ? "text-white" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>

        {/* Label */}
        <span className={`text-sm font-medium ${isExpanded ? "text-white" : "text-gray-700"}`}>
          Users
        </span>

        {/* Selection count badge */}
        <div className={`flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold ${
          isExpanded 
            ? "bg-white/20 text-white" 
            : "bg-emerald-500 text-white"
        }`}>
          {selectedCount}
        </div>

        {/* Expand/collapse arrow */}
        <svg 
          className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180 text-white" : "text-gray-400"}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}
