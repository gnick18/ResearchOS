"use client";

import { useState, useMemo } from "react";
import { LabTask, LabUser, LabProject } from "@/lib/api";

interface LabExperimentsPanelProps {
  experiments: LabTask[];
  users: LabUser[];
  projects: LabProject[];
  selectedUsernames: Set<string>;
  onExperimentClick: (experiment: LabTask) => void;
}

export default function LabExperimentsPanel({
  experiments,
  users,
  projects,
  selectedUsernames,
  onExperimentClick,
}: LabExperimentsPanelProps) {
  const [sortBy, setSortBy] = useState<"username" | "project" | "date" | "name">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"grouped" | "table">("grouped");

  // Get user color by username
  const getUserColor = (username: string) => {
    const user = users.find(u => u.username === username);
    return user?.color || "#6b7280";
  };

  // Get project name by ID
  const getProjectName = (projectId: number, username: string) => {
    const project = projects.find(p => p.id === projectId && p.username === username);
    return project?.name || "Unknown Project";
  };

  // Filter experiments by selected users
  const filteredExperiments = useMemo(() => {
    return experiments.filter(e => selectedUsernames.has(e.username));
  }, [experiments, selectedUsernames]);

  // Sort experiments
  const sortedExperiments = useMemo(() => {
    const sorted = [...filteredExperiments];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "username":
          comparison = a.username.localeCompare(b.username);
          break;
        case "project":
          comparison = getProjectName(a.project_id, a.username).localeCompare(getProjectName(b.project_id, b.username));
          break;
        case "date":
          comparison = a.start_date.localeCompare(b.start_date);
          break;
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });
    return sorted;
  }, [filteredExperiments, sortBy, sortOrder]);

  // Toggle sort
  const toggleSort = (column: "username" | "project" | "date" | "name") => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
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

  // Group experiments by username and project
  const groupedExperiments = useMemo(() => {
    const groups = new Map<string, { user: string; project: string; experiments: LabTask[] }>();
    
    sortedExperiments.forEach(exp => {
      const projectName = getProjectName(exp.project_id, exp.username);
      const key = `${exp.username}::${projectName}`;
      
      if (!groups.has(key)) {
        groups.set(key, {
          user: exp.username,
          project: projectName,
          experiments: [],
        });
      }
      groups.get(key)!.experiments.push(exp);
    });

    // Sort experiments within each group by date
    groups.forEach(group => {
      group.experiments.sort((a, b) => a.start_date.localeCompare(b.start_date));
    });

    return Array.from(groups.values());
  }, [sortedExperiments, getProjectName]);

  if (filteredExperiments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-white rounded-xl p-8 border border-gray-200">
        No experiments found for selected users.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Total Experiments</p>
          <p className="text-2xl font-bold text-gray-900">{filteredExperiments.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Completed</p>
          <p className="text-2xl font-bold text-emerald-600">
            {filteredExperiments.filter(e => e.is_complete).length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">In Progress</p>
          <p className="text-2xl font-bold text-blue-600">
            {filteredExperiments.filter(e => !e.is_complete).length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Users</p>
          <p className="text-2xl font-bold text-purple-600">
            {new Set(filteredExperiments.map(e => e.username)).size}
          </p>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setViewMode("grouped")}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            viewMode === "grouped"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-gray-100 text-gray-500 hover:text-gray-900"
          }`}
        >
          Grouped View
        </button>
        <button
          onClick={() => setViewMode("table")}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            viewMode === "table"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-gray-100 text-gray-500 hover:text-gray-900"
          }`}
        >
          Table View
        </button>
      </div>

      {viewMode === "grouped" ? (
        /* Grouped View - organized by username AND project name */
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Experiments by User & Project</h3>
            <p className="text-sm text-gray-500">Organized by username and project name</p>
          </div>

          {groupedExperiments.map((group, idx) => (
            <div key={`${group.user}::${group.project}::${idx}`} className="border-b border-gray-200 last:border-b-0">
              {/* Group Header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
                  style={{ backgroundColor: getUserColor(group.user) }}
                >
                  {group.user.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <span className="text-gray-900 font-medium">{group.user}</span>
                  <span className="text-gray-400 mx-2">•</span>
                  <span className="text-gray-700">{group.project}</span>
                </div>
                <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">
                  {group.experiments.length} experiment{group.experiments.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Experiments in this group */}
              <div className="divide-y divide-gray-100">
                {group.experiments.map((exp) => (
                  <div
                    key={exp.id}
                    onClick={() => onExperimentClick(exp)}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    {/* Experiment color indicator */}
                    {exp.experiment_color && (
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: exp.experiment_color }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-900 font-medium truncate">{exp.name}</p>
                      <p className="text-sm text-gray-500">
                        {formatDate(exp.start_date)} → {formatDate(exp.end_date)} • {exp.duration_days} day{exp.duration_days !== 1 ? "s" : ""}
                      </p>
                    </div>
                    {/* Methods indicator */}
                    {exp.method_ids && exp.method_ids.length > 0 && (
                      <span className="text-xs text-purple-600 bg-purple-100 px-2 py-1 rounded">
                        {exp.method_ids.length} method{exp.method_ids.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      {exp.is_complete ? (
                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full">
                          Complete
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                          In Progress
                        </span>
                      )}
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">All Experiments</h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th 
                    onClick={() => toggleSort("username")}
                    className="text-left px-4 py-3 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  >
                    User {sortBy === "username" && (sortOrder === "asc" ? "↑" : "↓")}
                  </th>
                  <th 
                    onClick={() => toggleSort("project")}
                    className="text-left px-4 py-3 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  >
                    Project {sortBy === "project" && (sortOrder === "asc" ? "↑" : "↓")}
                  </th>
                  <th 
                    onClick={() => toggleSort("name")}
                    className="text-left px-4 py-3 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  >
                    Experiment {sortBy === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                  </th>
                  <th 
                    onClick={() => toggleSort("date")}
                    className="text-left px-4 py-3 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                  >
                    Start Date {sortBy === "date" && (sortOrder === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Duration</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Methods</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedExperiments.map((exp) => (
                  <tr
                    key={`${exp.username}-${exp.id}`}
                    onClick={() => onExperimentClick(exp)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                          style={{ backgroundColor: getUserColor(exp.username) }}
                        >
                          {exp.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-gray-700">{exp.username}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {getProjectName(exp.project_id, exp.username)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {exp.experiment_color && (
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: exp.experiment_color }}
                          />
                        )}
                        <span className="text-gray-900 font-medium">{exp.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(exp.start_date)}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {exp.duration_days} day{exp.duration_days !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-3">
                      {exp.method_ids && exp.method_ids.length > 0 ? (
                        <span className="text-purple-600">{exp.method_ids.length}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {exp.is_complete ? (
                        <span className="text-emerald-600">Complete</span>
                      ) : (
                        <span className="text-blue-600">In Progress</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
