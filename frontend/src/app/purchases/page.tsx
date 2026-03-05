"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi, tasksApi, purchasesApi } from "@/lib/api";
import AppShell from "@/components/AppShell";
import PurchaseEditor from "@/components/PurchaseEditor";
import type { Task, PurchaseItem, FundingAccount } from "@/lib/types";

export default function PurchasesPage() {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null);
  const [showFundingManager, setShowFundingManager] = useState(false);
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: projectsApi.list,
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const results = await Promise.all(
        projects.map((p) => tasksApi.listByProject(p.id))
      );
      return results.flat();
    },
    enabled: projects.length > 0,
  });

  const { data: allPurchases = [] } = useQuery({
    queryKey: ["purchases-all"],
    queryFn: purchasesApi.listAll,
  });

  const { data: fundingAccounts = [] } = useQuery({
    queryKey: ["funding-accounts"],
    queryFn: purchasesApi.listFundingAccounts,
  });

  // Filter to purchase tasks only
  const purchaseTasks = useMemo(
    () => allTasks.filter((t) => t.task_type === "purchase"),
    [allTasks]
  );

  // Group purchases by task
  const purchasesByTask = useMemo(() => {
    const map: Record<number, PurchaseItem[]> = {};
    for (const p of allPurchases) {
      if (!map[p.task_id]) map[p.task_id] = [];
      map[p.task_id].push(p);
    }
    return map;
  }, [allPurchases]);

  // Grand total
  const grandTotal = useMemo(
    () => allPurchases.reduce((sum, p) => sum + p.total_price, 0),
    [allPurchases]
  );

  // Group purchases by funding string
  const purchasesByFundingString = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    for (const p of allPurchases) {
      const key = p.funding_string || "Uncategorized";
      if (!map[key]) map[key] = { total: 0, count: 0 };
      map[key].total += p.total_price;
      map[key].count += 1;
    }
    return map;
  }, [allPurchases]);

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm("Are you sure you want to delete this purchase order and all its items?")) {
      return;
    }
    setDeletingTaskId(taskId);
    try {
      await tasksApi.delete(taskId);
      setSelectedTask(null);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
    } catch (error) {
      alert("Failed to delete purchase order");
    } finally {
      setDeletingTaskId(null);
    }
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Purchases</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {purchaseTasks.length} purchase order
              {purchaseTasks.length !== 1 ? "s" : ""} · ${grandTotal.toFixed(2)}{" "}
              total
            </p>
          </div>
          <button
            onClick={() => setShowFundingManager(!showFundingManager)}
            className="px-3 py-1.5 text-sm bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors"
          >
            {showFundingManager ? "Hide Funding Manager" : "Manage Funding Accounts"}
          </button>
        </div>

        {/* Funding Accounts Manager */}
        {showFundingManager && (
          <FundingAccountsManager
            fundingAccounts={fundingAccounts}
          />
        )}

        {/* Purchase tasks list */}
        {purchaseTasks.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-lg text-gray-400 mb-2">No purchases yet</p>
            <p className="text-sm text-gray-300">
              Create a task with type &ldquo;Purchase&rdquo; to start tracking
              orders
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {purchaseTasks
              .sort((a, b) => b.start_date.localeCompare(a.start_date))
              .map((task) => {
                const items = purchasesByTask[task.id] || [];
                const taskTotal = items.reduce(
                  (sum, i) => sum + i.total_price,
                  0
                );
                const project = projects.find(
                  (p) => p.id === task.project_id
                );

                return (
                  <div
                    key={task.id}
                    className="bg-white border border-gray-200 rounded-xl overflow-hidden"
                  >
                    {/* Task header */}
                    <div
                      className={`flex items-center justify-between px-5 py-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${task.is_complete ? "bg-green-50/50" : ""}`}
                      onClick={() =>
                        setSelectedTask(
                          selectedTask?.id === task.id ? null : task
                        )
                      }
                    >
                      <div className="flex items-center gap-3">
                        {/* Completion indicator */}
                        <div
                          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                            task.is_complete ? "bg-green-500" : "bg-gray-300"
                          }`}
                        />
                        <div>
                          <h3 className={`text-sm font-semibold ${task.is_complete ? "text-green-700" : "text-gray-900"}`}>
                            {task.name}
                          </h3>
                          <p className="text-xs text-gray-400">
                            {project?.name} · {task.start_date} ·{" "}
                            {items.length} item{items.length !== 1 ? "s" : ""}{task.is_complete && " · Complete"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-gray-700">
                          ${taskTotal.toFixed(2)}
                        </span>
                        <span className="text-gray-400">
                          {selectedTask?.id === task.id ? "▲" : "▼"}
                        </span>
                      </div>
                    </div>

                    {/* Expanded purchase editor */}
                    {selectedTask?.id === task.id && (
                      <div className="relative">
                        <PurchaseEditor taskId={task.id} />
                        {/* Action buttons */}
                        <div className="absolute bottom-3 right-4 flex items-center gap-2">
                          {/* Complete toggle button */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await tasksApi.update(task.id, { is_complete: !task.is_complete });
                                queryClient.invalidateQueries({ queryKey: ["tasks"] });
                              } catch {
                                alert("Failed to update task");
                              }
                            }}
                            className={`p-1.5 rounded-full transition-all ${
                              task.is_complete
                                ? "bg-green-500 text-white hover:bg-green-600"
                                : "text-gray-300 hover:text-green-500 hover:bg-green-50"
                            }`}
                            title={task.is_complete ? "Mark as incomplete" : "Mark as complete"}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6L9 17l-5-5"/>
                            </svg>
                          </button>
                          {/* Delete task button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTask(task.id);
                            }}
                            disabled={deletingTaskId === task.id}
                            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Delete purchase order"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              className="w-5 h-5"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// Funding Accounts Manager Component
function FundingAccountsManager({
  fundingAccounts,
}: {
  fundingAccounts: FundingAccount[];
}) {
  const [newName, setNewName] = useState("");
  const [newBudget, setNewBudget] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBudget, setEditBudget] = useState("");
  const queryClient = useQueryClient();

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await purchasesApi.createFundingAccount({
        name: newName.trim(),
        total_budget: parseFloat(newBudget) || 0,
        description: newDescription.trim() || undefined,
      });
      setNewName("");
      setNewBudget("");
      setNewDescription("");
      queryClient.invalidateQueries({ queryKey: ["funding-accounts"] });
    } catch {
      alert("Failed to create funding account");
    }
  };

  const handleUpdateBudget = async (id: number) => {
    try {
      await purchasesApi.updateFundingAccount(id, {
        total_budget: parseFloat(editBudget) || 0,
      });
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["funding-accounts"] });
    } catch {
      alert("Failed to update funding account");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete funding account "${name}"? This will not delete associated purchases.`)) return;
    try {
      await purchasesApi.deleteFundingAccount(id);
      queryClient.invalidateQueries({ queryKey: ["funding-accounts"] });
    } catch {
      alert("Failed to delete funding account");
    }
  };

  return (
    <div className="mb-6 bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">Funding Accounts</h3>
        <p className="text-xs text-gray-500">Manage funding strings and budgets</p>
      </div>
      
      <div className="p-4">
        {/* Existing accounts */}
        <div className="space-y-2 mb-4">
          {fundingAccounts.map((acc) => (
            <div key={acc.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{acc.name}</p>
                {acc.description && (
                  <p className="text-xs text-gray-500">{acc.description}</p>
                )}
              </div>
              {editingId === acc.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Budget: $</span>
                  <input
                    type="number"
                    value={editBudget}
                    onChange={(e) => setEditBudget(e.target.value)}
                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                    placeholder="0.00"
                  />
                  <button
                    onClick={() => handleUpdateBudget(acc.id)}
                    className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      ${acc.total_budget.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500">budget</p>
                  </div>
                  <button
                    onClick={() => {
                      setEditingId(acc.id);
                      setEditBudget(acc.total_budget.toString());
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(acc.id, acc.name)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* New account form */}
        <div className="flex items-end gap-3 pt-4 border-t border-gray-200">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="e.g., GRANT-123-ABC"
            />
          </div>
          <div className="w-32">
            <label className="block text-xs text-gray-500 mb-1">Budget</label>
            <input
              type="number"
              value={newBudget}
              onChange={(e) => setNewBudget(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="0.00"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Description (optional)</label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="e.g., NIH Grant for cancer research"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Account
          </button>
        </div>
      </div>
    </div>
  );
}
