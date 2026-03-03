"use client";

import { useState, useEffect } from "react";
import { settingsApi, type SettingsResponse, type SettingsVerifyResponse } from "@/lib/api";

interface SettingsPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsPopup({ isOpen, onClose }: SettingsPopupProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<SettingsVerifyResponse | null>(null);
  
  // Form state
  const [githubToken, setGithubToken] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubLocalpath, setGithubLocalpath] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [tokenMasked, setTokenMasked] = useState("");

  // Load current settings on open
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await settingsApi.get();
      setGithubRepo(settings.github_repo);
      setGithubLocalpath(settings.github_localpath);
      setCurrentUser(settings.current_user);
      setIsConfigured(settings.is_configured);
      setTokenMasked(settings.github_token_masked);
      // Don't populate token - user must re-enter if they want to change it
      setGithubToken("");
    } catch (err) {
      setError("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    setVerifyResult(null);

    try {
      // Only include fields that have values
      const updateData: { github_token?: string; github_repo?: string; github_localpath?: string; current_user?: string } = {};
      
      if (githubToken.trim()) {
        updateData.github_token = githubToken.trim();
      }
      if (githubRepo.trim()) {
        updateData.github_repo = githubRepo.trim();
      }
      if (githubLocalpath.trim()) {
        updateData.github_localpath = githubLocalpath.trim();
      }
      if (currentUser.trim()) {
        updateData.current_user = currentUser.trim();
      }

      if (Object.keys(updateData).length === 0) {
        setError("No changes to save");
        setSaving(false);
        return;
      }

      const result = await settingsApi.update(updateData);
      // Reload backend settings to pick up the change immediately
      await settingsApi.reload();
      setIsConfigured(result.is_configured);
      setTokenMasked(result.github_token_masked);
      setCurrentUser(result.current_user);
      setGithubToken(""); // Clear token field after save
      setSuccess("Settings saved successfully! Changes are now active.");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to save settings";
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    setVerifyResult(null);

    try {
      const result = await settingsApi.verify();
      setVerifyResult(result);
    } catch (err) {
      setError("Failed to verify settings");
    } finally {
      setVerifying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Environment Settings
              </h3>
              <p className="text-xs text-gray-500">
                Configure GitHub integration
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <>
              {/* Status indicator */}
              <div className={`flex items-center gap-2 p-3 rounded-lg mb-6 ${
                isConfigured 
                  ? "bg-green-50 text-green-700" 
                  : "bg-amber-50 text-amber-700"
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  isConfigured ? "bg-green-500" : "bg-amber-500"
                }`}></div>
                <span className="text-sm font-medium">
                  {isConfigured ? "Configured" : "Not configured"}
                </span>
              </div>

              {/* Form fields */}
              <div className="space-y-5">
                {/* GitHub Token */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    GitHub Personal Access Token
                  </label>
                  {tokenMasked && (
                    <p className="text-xs text-gray-400 mb-2">
                      Current: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{tokenMasked}</code>
                    </p>
                  )}
                  <input
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder={tokenMasked ? "Enter new token to update" : "ghp_xxxxxxxxxxxx"}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    Needs <code className="bg-gray-100 px-1 rounded">repo</code> scope.{" "}
                    <a 
                      href="https://github.com/settings/tokens" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      Create token
                    </a>
                  </p>
                </div>

                {/* GitHub Repository */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Data Repository
                  </label>
                  <input
                    type="text"
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="username/ResearchOS"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    Your private GitHub repo for storing research data
                  </p>
                </div>

                {/* Local Path */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Local Repository Path
                  </label>
                  <input
                    type="text"
                    value={githubLocalpath}
                    onChange={(e) => setGithubLocalpath(e.target.value)}
                    placeholder="/Users/yourname/Desktop/ResearchOS"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    Absolute path to your cloned data repository
                  </p>
                </div>

                {/* Current User */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Current User
                  </label>
                  <input
                    type="text"
                    value={currentUser}
                    onChange={(e) => setCurrentUser(e.target.value)}
                    placeholder="GrantNickles"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    Your username - data will be stored in the users/{`{username}`} folder
                  </p>
                </div>
              </div>

              {/* Error/Success messages */}
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
              
              {success && (
                <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-lg">
                  <p className="text-sm text-green-600">{success}</p>
                </div>
              )}

              {/* Verify result */}
              {verifyResult && (
                <div className={`mt-4 p-3 rounded-lg ${
                  verifyResult.status === "ok" 
                    ? "bg-green-50 border border-green-100" 
                    : "bg-amber-50 border border-amber-100"
                }`}>
                  {verifyResult.status === "ok" ? (
                    <p className="text-sm text-green-600">{verifyResult.message}</p>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-amber-700 mb-1">Issues found:</p>
                      <ul className="text-sm text-amber-600 list-disc list-inside">
                        {verifyResult.issues?.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Help section */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Setup Guide</h4>
                <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
                  <li>Create a private GitHub repo for your data</li>
                  <li>Clone it to your computer and note the path</li>
                  <li>Create a GitHub token with <code className="bg-gray-200 px-1 rounded">repo</code> scope</li>
                  <li>Fill in the fields above and save</li>
                </ol>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={handleVerify}
            disabled={verifying || !isConfigured}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {verifying ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            Verify
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
