"use client";

import { useState, useMemo } from "react";
import { LabTask, LabUser, LabProject } from "@/lib/api";

interface LabPurchasesPanelProps {
  purchases: LabTask[];
  users: LabUser[];
  projects: LabProject[];
  selectedUsernames: Set<string>;
  onPurchaseClick: (purchase: LabTask) => void;
}

export default function LabPurchasesPanel({
  purchases,
  users,
  projects,
  selectedUsernames,
  onPurchaseClick,
}: LabPurchasesPanelProps) {
  const [sortBy, setSortBy] = useState<"username" | "project" | "date" | "name">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

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

  // Filter purchases by selected users
  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => selectedUsernames.has(p.username));
  }, [purchases, selectedUsernames]);

  // Sort purchases
  const sortedPurchases = useMemo(() => {
    const sorted = [...filteredPurchases];
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
  }, [filteredPurchases, sortBy, sortOrder, getProjectName]);

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

  // Group purchases by username and project
  const groupedPurchases = useMemo(() => {
    const groups = new Map<string, { user: string; project: string; purchases: LabTask[] }>();
    
    sortedPurchases.forEach(purchase => {
      const projectName = getProjectName(purchase.project_id, purchase.username);
      const key = `${purchase.username}::${projectName}`;
      
      if (!groups.has(key)) {
        groups.set(key, {
          user: purchase.username,
          project: projectName,
          purchases: [],
        });
      }
      groups.get(key)!.purchases.push(purchase);
    });

    return Array.from(groups.values());
  }, [sortedPurchases, getProjectName]);

  if (filteredPurchases.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-white rounded-xl p-8 border border-gray-200">
        No purchases found for selected users.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Total Purchases</p>
          <p className="text-2xl font-bold text-gray-900">{filteredPurchases.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Completed</p>
          <p className="text-2xl font-bold text-emerald-600">
            {filteredPurchases.filter(p => p.is_complete).length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Pending</p>
          <p className="text-2xl font-bold text-amber-600">
            {filteredPurchases.filter(p => !p.is_complete).length}
          </p>
        </div>
      </div>

      {/* Grouped View */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Purchases by User & Project</h3>
          <p className="text-sm text-gray-500">Organized by username and project name</p>
        </div>

        {groupedPurchases.map((group, idx) => (
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
                {group.purchases.length} purchase{group.purchases.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Purchases in this group */}
            <div className="divide-y divide-gray-100">
              {group.purchases.map((purchase) => (
                <div
                  key={purchase.id}
                  onClick={() => onPurchaseClick(purchase)}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-900 font-medium truncate">{purchase.name}</p>
                    <p className="text-sm text-gray-500">
                      {formatDate(purchase.start_date)} • {purchase.duration_days} day{purchase.duration_days !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {purchase.is_complete ? (
                      <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full">
                        Complete
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full">
                        Pending
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

      {/* Table View */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">All Purchases</h3>
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
                  Purchase {sortBy === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                </th>
                <th 
                  onClick={() => toggleSort("date")}
                  className="text-left px-4 py-3 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900"
                >
                  Date {sortBy === "date" && (sortOrder === "asc" ? "↑" : "↓")}
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Duration</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedPurchases.map((purchase) => (
                <tr
                  key={`${purchase.username}-${purchase.id}`}
                  onClick={() => onPurchaseClick(purchase)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                        style={{ backgroundColor: getUserColor(purchase.username) }}
                      >
                        {purchase.username.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-gray-700">{purchase.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {getProjectName(purchase.project_id, purchase.username)}
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">{purchase.name}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDate(purchase.start_date)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {purchase.duration_days} day{purchase.duration_days !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-3">
                    {purchase.is_complete ? (
                      <span className="text-emerald-600">Complete</span>
                    ) : (
                      <span className="text-amber-600">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
