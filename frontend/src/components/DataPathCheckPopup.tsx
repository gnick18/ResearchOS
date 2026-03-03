"use client";

import { useState, useEffect } from "react";
import { settingsApi, type DataPathCheckResponse } from "@/lib/api";

interface DataPathCheckPopupProps {
  isOpen: boolean;
  onClose: () => void;
  errorData: DataPathCheckResponse | null;
}

export default function DataPathCheckPopup({ isOpen, onClose, errorData }: DataPathCheckPopupProps) {
  const [githubLocalpath, setGithubLocalpath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && errorData?.configured_path) {
      setGithubLocalpath(errorData.configured_path);
    }
  }, [isOpen, errorData]);

  const handleSave = async () => {
    if (!githubLocalpath.trim()) {
      setError("Please enter a valid path");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await settingsApi.update({ github_localpath: githubLocalpath.trim() });
      // Reload backend settings to pick up the change
      await settingsApi.reload();
      setSuccess("Path updated successfully! The page will refresh...");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message :
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to update path";
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !errorData) return null;

  const getErrorIcon = () => {
    switch (errorData.error_type) {
      case "not_configured":
        return (
          <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case "path_not_found":
        return (
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 20h.01" />
          </svg>
        );
      default:
        return (
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getErrorTitle = () => {
    switch (errorData.error_type) {
      case "not_configured":
        return "Data Path Not Configured";
      case "path_not_found":
        return "Data Path Not Found";
      case "not_git_repo":
        return "Not a Git Repository";
      case "permission_denied":
        return "Permission Denied";
      default:
        return "Data Path Error";
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-500 to-orange-500 p-6 text-white">
          <div className="flex items-center gap-4">
            {getErrorIcon()}
            <div>
              <h3 className="text-lg font-semibold">{getErrorTitle()}</h3>
              <p className="text-sm text-white/80 mt-1">
                Unable to access research data
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-gray-600 mb-4">
            {errorData.message}
          </p>

          {errorData.error_type !== "not_configured" && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Configured path:</p>
              <code className="text-sm text-gray-700 break-all">
                {errorData.configured_path}
              </code>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Update Local Repository Path
            </label>
            <input
              type="text"
              value={githubLocalpath}
              onChange={(e) => setGithubLocalpath(e.target.value)}
              placeholder="/Users/yourname/Desktop/ResearchOS_Data"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1.5">
              Enter the absolute path to your cloned data repository
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-100 rounded-lg">
              <p className="text-sm text-green-600">{success}</p>
            </div>
          )}

          {/* Help section */}
          <div className="mt-4 p-4 bg-blue-50 rounded-lg">
            <h4 className="text-sm font-medium text-blue-700 mb-2">Quick Setup Guide</h4>
            <ol className="text-xs text-blue-600 space-y-1.5 list-decimal list-inside">
              <li>Clone your data repository to your computer</li>
              <li>Copy the full path to the cloned folder</li>
              <li>Paste it in the field above and click Save</li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Dismiss
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
            Save & Reload
          </button>
        </div>
      </div>
    </div>
  );
}
