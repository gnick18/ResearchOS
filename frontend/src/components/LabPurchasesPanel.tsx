"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LabTask, LabUser, LabProject, purchasesApi } from "@/lib/api";
import type { FundingAccount, PurchaseItem } from "@/lib/types";

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
  const [selectedFundingString, setSelectedFundingString] = useState<string | null>(null);

  // Fetch funding accounts
  const { data: fundingAccounts = [] } = useQuery({
    queryKey: ["funding-accounts"],
    queryFn: purchasesApi.listFundingAccounts,
  });

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

  // Group purchases by funding string
  const purchasesByFundingString = useMemo(() => {
    const groups = new Map<string, LabTask[]>();
    
    filteredPurchases.forEach(purchase => {
      // For now, we don't have funding string on LabTask, so we group by "Uncategorized"
      const key = "Uncategorized";
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(purchase);
    });

    return groups;
  }, [filteredPurchases]);

  // Calculate totals
  const totalPurchases = filteredPurchases.length;
  const completedPurchases = filteredPurchases.filter(p => p.is_complete).length;
  const pendingPurchases = totalPurchases - completedPurchases;

  if (filteredPurchases.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-white rounded-xl p-8 border border-gray-200">
        No purchases found for selected users.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Funding Accounts Summary */}
      {fundingAccounts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700">Funding Accounts Overview</h3>
            <p className="text-xs text-gray-500">Budget vs. spent across all users</p>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {fundingAccounts.map((acc) => (
                <div 
                  key={acc.id} 
                  className={`p-4 rounded-lg border-2 transition-colors cursor-pointer ${
                    selectedFundingString === acc.name 
                      ? "border-emerald-500 bg-emerald-50" 
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                  onClick={() => setSelectedFundingString(
                    selectedFundingString === acc.name ? null : acc.name
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-sm font-medium text-gray-900 truncate" title={acc.name}>
                      {acc.name}
                    </p>
                    {acc.remaining < 0 ? (
                      <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                        Over Budget
                      </span>
                    ) : acc.remaining < acc.total_budget * 0.1 ? (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        Low
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Spent</span>
                      <span className="font-medium text-gray-900">${acc.spent.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Budget</span>
                      <span className="font-medium text-gray-900">${acc.total_budget.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Remaining</span>
                      <span className={`font-medium ${acc.remaining < 0 ? "text-red-600" : "text-emerald-600"}`}>
                        ${acc.remaining.toFixed(2)}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          acc.spent > acc.total_budget 
                            ? "bg-red-500" 
                            : acc.spent > acc.total_budget * 0.8 
                            ? "bg-amber-500" 
                            : "bg-emerald-500"
                        }`}
                        style={{ 
                          width: `${Math.min(100, (acc.spent / acc.total_budget) * 100) || 0}%` 
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Total Purchases</p>
          <p className="text-2xl font-bold text-gray-900">{totalPurchases}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Completed</p>
          <p className="text-2xl font-bold text-emerald-600">{completedPurchases}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-gray-500 text-sm">Pending</p>
          <p className="text-2xl font-bold text-amber-600">{pendingPurchases}</p>
        </div>
      </div>

      {/* Purchases List - Simplified View */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Purchase Orders</h3>
              <p className="text-sm text-gray-500">
                {selectedFundingString 
                  ? `Filtered by: ${selectedFundingString}`
                  : "All purchase orders"
                }
              </p>
            </div>
            {selectedFundingString && (
              <button
                onClick={() => setSelectedFundingString(null)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear filter
              </button>
            )}
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {filteredPurchases
            .sort((a, b) => b.start_date.localeCompare(a.start_date))
            .map((purchase) => (
              <div
                key={`${purchase.username}-${purchase.id}`}
                onClick={() => onPurchaseClick(purchase)}
                className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                {/* User avatar */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0"
                  style={{ backgroundColor: getUserColor(purchase.username) }}
                >
                  {purchase.username.charAt(0).toUpperCase()}
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-gray-900 font-medium truncate">{purchase.name}</p>
                    {purchase.is_complete ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full flex-shrink-0">
                        Complete
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full flex-shrink-0">
                        Pending
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">
                    <span className="font-medium text-gray-700">{purchase.username}</span>
                    <span className="text-gray-300 mx-1.5">•</span>
                    <span>{getProjectName(purchase.project_id, purchase.username)}</span>
                    <span className="text-gray-300 mx-1.5">•</span>
                    <span>{formatDate(purchase.start_date)}</span>
                  </p>
                </div>

                {/* Arrow */}
                <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
