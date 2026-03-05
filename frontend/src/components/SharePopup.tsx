"use client";

import { useState, useEffect } from "react";
import { sharingApi, usersApi, methodsApi } from "@/lib/api";
import type { SharedUser, ShareRequest, DependencyChainResponse } from "@/lib/types";

interface SharePopupProps {
  isOpen: boolean;
  onClose: () => void;
  itemType: "task" | "method" | "project";
  itemId: number;
  itemName: string;
  currentOwner: string;
  currentSharedWith: SharedUser[];
  isPublic?: boolean;  // For methods - whether it's publicly visible
  onShared: () => void;
}

export default function SharePopup({
  isOpen,
  onClose,
  itemType,
  itemId,
  itemName,
  currentOwner,
  currentSharedWith,
  isPublic = false,
  onShared,
}: SharePopupProps) {
  const [users, setUsers] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("edit");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dependencyChain, setDependencyChain] = useState<DependencyChainResponse | null>(null);
  const [showChainConfirm, setShowChainConfirm] = useState(false);
  const [includeChain, setIncludeChain] = useState(false);
  const [isPubliclyVisible, setIsPubliclyVisible] = useState(isPublic);
  const [shareWithAll, setShareWithAll] = useState(false);

  // Load users on mount
  useEffect(() => {
    if (isOpen) {
      loadUsers();
      if (itemType === "task") {
        loadDependencyChain();
      }
    }
  }, [isOpen, itemType, itemId]);
  
  // Update isPubliclyVisible when prop changes
  useEffect(() => {
    setIsPubliclyVisible(isPublic);
  }, [isPublic]);

  const loadUsers = async () => {
    try {
      const response = await usersApi.list();
      // Filter out current user and owner
      const filteredUsers = response.users.filter(
        (u) => u !== currentOwner
      );
      setUsers(filteredUsers);
    } catch (err) {
      console.error("Failed to load users:", err);
    }
  };

  const loadDependencyChain = async () => {
    try {
      const chain = await sharingApi.getTaskDependencyChain(itemId);
      setDependencyChain(chain);
    } catch (err) {
      console.error("Failed to load dependency chain:", err);
    }
  };

  const handleShare = async () => {
    // For "All Lab Users" option, we toggle public visibility
    if (shareWithAll) {
      await handleTogglePublic();
      return;
    }
    
    if (!selectedUser) {
      setError("Please select a user to share with");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const data: ShareRequest = {
        username: selectedUser,
        permission,
        include_chain: includeChain,
      };

      if (itemType === "task") {
        const result = await sharingApi.shareTask(itemId, data);
        if (result.chain_shared_count && result.chain_shared_count > 1) {
          setSuccess(`Shared with ${selectedUser} (${result.chain_shared_count} tasks in chain)`);
        } else {
          setSuccess(`Shared with ${selectedUser}`);
        }
      } else if (itemType === "method") {
        await sharingApi.shareMethod(itemId, data);
        setSuccess(`Shared with ${selectedUser}`);
      } else if (itemType === "project") {
        const result = await sharingApi.shareProject(itemId, data);
        setSuccess(`Shared with ${selectedUser}`);
      }

      setSelectedUser("");
      onShared();
    } catch (err: unknown) {
      console.error("Failed to share:", err);
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to share");
    } finally {
      setLoading(false);
    }
  };
  
  const handleTogglePublic = async () => {
    setLoading(true);
    setError(null);
    
    try {
      if (itemType === "method") {
        await methodsApi.update(itemId, { is_public: !isPubliclyVisible });
        setIsPubliclyVisible(!isPubliclyVisible);
        setSuccess(isPubliclyVisible ? "Method is now private" : "Method is now visible to all lab users");
        onShared();
      }
    } catch (err: unknown) {
      console.error("Failed to update visibility:", err);
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to update visibility");
    } finally {
      setLoading(false);
    }
  };

  const handleUnshare = async (username: string) => {
    setLoading(true);
    setError(null);

    try {
      if (itemType === "task") {
        await sharingApi.unshareTask(itemId, username);
      } else if (itemType === "method") {
        await sharingApi.unshareMethod(itemId, username);
      } else if (itemType === "project") {
        await sharingApi.unshareProject(itemId, username);
      }

      setSuccess(`Removed access for ${username}`);
      onShared();
    } catch (err: unknown) {
      console.error("Failed to unshare:", err);
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to remove access");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Share {itemType}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1 truncate">{itemName}</p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {/* Current shared users */}
          {currentSharedWith.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Currently shared with</h3>
              <div className="space-y-2">
                {currentSharedWith.map((sharedUser) => (
                  <div
                    key={sharedUser.username}
                    className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <span className="text-sm font-medium text-blue-700">
                          {sharedUser.username.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{sharedUser.username}</p>
                        <p className="text-xs text-gray-500">
                          {sharedUser.permission === "edit" ? "Can edit" : "Can view"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnshare(sharedUser.username)}
                      disabled={loading}
                      className="text-red-500 hover:text-red-700 text-sm font-medium disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new share */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700">Share with someone new</h3>
            
            {/* User selector */}
            <div>
              <label className="block text-sm text-gray-600 mb-1">User</label>
              <select
                value={shareWithAll ? "__all_lab_users__" : selectedUser}
                onChange={(e) => {
                  if (e.target.value === "__all_lab_users__") {
                    setShareWithAll(true);
                    setSelectedUser("");
                  } else {
                    setShareWithAll(false);
                    setSelectedUser(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select a user...</option>
                {itemType === "method" && (
                  <option value="__all_lab_users__">🌐 All Lab Users</option>
                )}
                {users.map((user) => (
                  <option key={user} value={user}>
                    {user}
                  </option>
                ))}
              </select>
            </div>

            {/* Permission selector - only show when a specific user is selected */}
            {!shareWithAll && (
              <div>
                <label className="block text-sm text-gray-600 mb-1">Permission</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPermission("view")}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                      permission === "view"
                        ? "bg-blue-50 border-blue-500 text-blue-700"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="block font-medium">View</span>
                    <span className="block text-xs opacity-75">Can only view</span>
                  </button>
                  <button
                    onClick={() => setPermission("edit")}
                    className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                      permission === "edit"
                        ? "bg-blue-50 border-blue-500 text-blue-700"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="block font-medium">Edit</span>
                    <span className="block text-xs opacity-75">Can make changes</span>
                  </button>
                </div>
              </div>
            )}
            
            {/* All Lab Users info box */}
            {shareWithAll && itemType === "method" && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm font-medium text-green-800">
                  {isPubliclyVisible 
                    ? "🌐 This method is currently visible to all lab users"
                    : "🔒 This will make the method visible to all lab users"}
                </p>
                <p className="text-xs text-green-700 mt-1">
                  {isPubliclyVisible 
                    ? "Click 'Apply' to make it private (only visible to you)"
                    : "Anyone in your lab will be able to view and use this method"}
                </p>
              </div>
            )}

            {/* Dependency chain option for tasks */}
            {itemType === "task" && dependencyChain && dependencyChain.chain_count > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeChain}
                    onChange={(e) => setIncludeChain(e.target.checked)}
                    className="mt-1 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-amber-800">
                      Share entire dependency chain
                    </p>
                    <p className="text-xs text-amber-700">
                      This task has {dependencyChain.chain_count} connected task(s). 
                      Share them all with the same permission?
                    </p>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Error/Success messages */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          {success && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-700">{success}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Done
          </button>
          <button
            onClick={handleShare}
            disabled={loading || (!selectedUser && !shareWithAll)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Applying..." : shareWithAll ? "Apply" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
