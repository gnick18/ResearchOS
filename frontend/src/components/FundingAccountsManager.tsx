"use client";

/**
 * FundingAccountsManager — extracted from `app/purchases/page.tsx`
 * (LabPurchases popup expansion manager, 2026-05-23).
 *
 * Why the extract: the lab-head LabPurchases popup needs the same
 * funding-accounts editor surface the regular `/purchases` page exposes.
 * Inlining the component twice would duplicate the create / edit / delete
 * mutations; lifting it to a standalone file lets both surfaces import
 * the canonical version.
 *
 * Behaviour is byte-for-byte identical to the original inline component:
 * the create / edit-budget / delete flows all route through
 * `purchasesApi.{createFundingAccount,updateFundingAccount,deleteFundingAccount}`
 * and invalidate the `["funding-accounts"]` query key on each write.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { purchasesApi } from "@/lib/local-api";
import type { FundingAccount } from "@/lib/types";

interface FundingAccountsManagerProps {
  fundingAccounts: FundingAccount[];
}

export default function FundingAccountsManager({
  fundingAccounts,
}: FundingAccountsManagerProps) {
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
