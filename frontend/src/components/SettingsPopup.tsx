"use client";

import { useState, useEffect, useCallback } from "react";
import { settingsApi, migrationApi, usersApi, type SettingsResponse, type SettingsVerifyResponse, type MigrationPreview, type MigrationProgress, type MigrationRequest, type UserMigrationPreviewRequest, type UserMigrationPreviewResponse, type UserMigrationProgress, type UsersAtPathResponse } from "@/lib/api";

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
  const [storageMode, setStorageMode] = useState("");

  // Migration state
  const [showMigration, setShowMigration] = useState(false);
  const [migrationDestination, setMigrationDestination] = useState("");
  const [migrationType, setMigrationType] = useState<"copy" | "move">("copy");
  const [targetMode, setTargetMode] = useState<"github" | "local">("local");
  const [removeGitFolder, setRemoveGitFolder] = useState(true);
  const [newGithubRepo, setNewGithubRepo] = useState("");
  const [newGithubToken, setNewGithubToken] = useState("");
  const [migrationPreview, setMigrationPreview] = useState<MigrationPreview | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [migrationSuccess, setMigrationSuccess] = useState<string | null>(null);

  // User account migration state
  const [showUserMigration, setShowUserMigration] = useState(false);
  const [userMigrationSourcePath, setUserMigrationSourcePath] = useState("");
  const [userMigrationTargetPath, setUserMigrationTargetPath] = useState("");
  const [userMigrationSourceUsername, setUserMigrationSourceUsername] = useState("");
  const [userMigrationTargetUsername, setUserMigrationTargetUsername] = useState("");
  const [userMigrationDeleteSource, setUserMigrationDeleteSource] = useState(false);
  const [sourceUsers, setSourceUsers] = useState<string[]>([]);
  const [targetUsers, setTargetUsers] = useState<string[]>([]);
  const [userMigrationPreview, setUserMigrationPreview] = useState<UserMigrationPreviewResponse | null>(null);
  const [userMigrationProgress, setUserMigrationProgress] = useState<UserMigrationProgress | null>(null);
  const [isUserMigrationPreviewing, setIsUserMigrationPreviewing] = useState(false);
  const [isUserMigrating, setIsUserMigrating] = useState(false);
  const [userMigrationError, setUserMigrationError] = useState<string | null>(null);
  const [userMigrationSuccess, setUserMigrationSuccess] = useState<string | null>(null);

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
      setStorageMode(settings.storage_mode);
      // Don't populate token - user must re-enter if they want to change it
      setGithubToken("");
    } catch (err) {
      setError("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  // Migration handlers
  const handlePreviewMigration = async () => {
    if (!migrationDestination.trim()) {
      setMigrationError("Please enter a destination path");
      return;
    }

    setIsPreviewing(true);
    setMigrationError(null);
    setMigrationPreview(null);

    try {
      const request: MigrationRequest = {
        destination_path: migrationDestination.trim(),
        migration_type: migrationType,
        target_mode: targetMode,
        remove_git_folder: removeGitFolder,
        new_github_repo: newGithubRepo.trim() || undefined,
        new_github_token: newGithubToken.trim() || undefined,
      };
      const preview = await migrationApi.preview(request);
      setMigrationPreview(preview);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to preview migration";
      setMigrationError(errorMessage);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleExecuteMigration = async () => {
    if (!migrationPreview?.can_proceed) {
      setMigrationError("Please preview the migration first");
      return;
    }

    setIsMigrating(true);
    setMigrationError(null);
    setMigrationSuccess(null);

    try {
      const request: MigrationRequest = {
        destination_path: migrationDestination.trim(),
        migration_type: migrationType,
        target_mode: targetMode,
        remove_git_folder: removeGitFolder,
        new_github_repo: newGithubRepo.trim() || undefined,
        new_github_token: newGithubToken.trim() || undefined,
      };
      const result = await migrationApi.execute(request);

      // If migration is in progress (large data), poll for progress
      if (result.status === "in_progress") {
        pollMigrationProgress();
      } else {
        // Small migration completed synchronously
        setMigrationSuccess(`Migration completed! ${result.files_copied} files copied to ${result.destination_path}`);
        // Update local state with new path
        setGithubLocalpath(result.destination_path);
        setStorageMode(result.new_storage_mode);
        setIsMigrating(false);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to execute migration";
      setMigrationError(errorMessage);
      setIsMigrating(false);
    }
  };

  const pollMigrationProgress = useCallback(async () => {
    const poll = async () => {
      try {
        const progress = await migrationApi.getProgress();
        setMigrationProgress(progress);

        if (progress.status === "in_progress") {
          setTimeout(poll, 500);
        } else if (progress.status === "complete") {
          setMigrationSuccess("Migration completed successfully!");
          setIsMigrating(false);
          // Reload settings to get new path
          const settings = await settingsApi.get();
          setGithubLocalpath(settings.github_localpath);
          setStorageMode(settings.storage_mode);
        } else if (progress.status === "error") {
          setMigrationError(progress.error_message || "Migration failed");
          setIsMigrating(false);
        }
      } catch {
        setMigrationError("Failed to get migration progress");
        setIsMigrating(false);
      }
    };
    poll();
  }, []);

  const handleCancelMigration = async () => {
    try {
      await migrationApi.cancel();
      setIsMigrating(false);
      setMigrationProgress(null);
      setMigrationError("Migration cancelled");
    } catch {
      setMigrationError("Failed to cancel migration");
    }
  };

  // User account migration handlers
  const handleLoadSourceUsers = async () => {
    if (!userMigrationSourcePath.trim()) return;
    try {
      const result = await usersApi.listAtPath(userMigrationSourcePath.trim());
      setSourceUsers(result.users);
      if (result.users.length > 0 && !userMigrationSourceUsername) {
        setUserMigrationSourceUsername(result.users[0]);
      }
    } catch {
      setSourceUsers([]);
    }
  };

  const handleLoadTargetUsers = async () => {
    if (!userMigrationTargetPath.trim()) return;
    try {
      const result = await usersApi.listAtPath(userMigrationTargetPath.trim());
      setTargetUsers(result.users);
    } catch {
      setTargetUsers([]);
    }
  };

  const handlePreviewUserMigration = async () => {
    if (!userMigrationSourcePath.trim() || !userMigrationTargetPath.trim() || !userMigrationSourceUsername.trim() || !userMigrationTargetUsername.trim()) {
      setUserMigrationError("Please fill in all fields");
      return;
    }

    setIsUserMigrationPreviewing(true);
    setUserMigrationError(null);
    setUserMigrationPreview(null);

    try {
      const request: UserMigrationPreviewRequest = {
        source_path: userMigrationSourcePath.trim(),
        source_username: userMigrationSourceUsername.trim(),
        target_path: userMigrationTargetPath.trim(),
        target_username: userMigrationTargetUsername.trim(),
      };
      const preview = await usersApi.previewMigration(request);
      setUserMigrationPreview(preview);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to preview migration";
      setUserMigrationError(errorMessage);
    } finally {
      setIsUserMigrationPreviewing(false);
    }
  };

  const handleExecuteUserMigration = async () => {
    if (!userMigrationPreview?.can_proceed) {
      setUserMigrationError("Please preview the migration first");
      return;
    }

    setIsUserMigrating(true);
    setUserMigrationError(null);
    setUserMigrationSuccess(null);

    try {
      const result = await usersApi.migrateUser({
        source_path: userMigrationSourcePath.trim(),
        source_username: userMigrationSourceUsername.trim(),
        target_path: userMigrationTargetPath.trim(),
        target_username: userMigrationTargetUsername.trim(),
        delete_source: userMigrationDeleteSource,
      });

      setUserMigrationSuccess(`Successfully migrated ${result.items_migrated} items (${formatBytes(result.bytes_copied)})`);
      
      // Refresh target users list
      handleLoadTargetUsers();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to execute migration";
      setUserMigrationError(errorMessage);
    } finally {
      setIsUserMigrating(false);
    }
  };

  const pollUserMigrationProgress = useCallback(async () => {
    const poll = async () => {
      try {
        const progress = await usersApi.getMigrationProgress();
        setUserMigrationProgress(progress);

        if (progress.status === "in_progress") {
          setTimeout(poll, 500);
        } else if (progress.status === "complete") {
          setUserMigrationSuccess("Migration completed successfully!");
          setIsUserMigrating(false);
        } else if (progress.status === "error") {
          setUserMigrationError(progress.error_message || "Migration failed");
          setIsUserMigrating(false);
        }
      } catch {
        setUserMigrationError("Failed to get migration progress");
        setIsUserMigrating(false);
      }
    };
    poll();
  }, []);

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
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

              {/* Migration Section */}
              <div className="mt-6 border-t border-gray-200 pt-6">
                <button
                  onClick={() => setShowMigration(!showMigration)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <span className="text-sm font-medium text-gray-700">Migrate Data</span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${showMigration ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showMigration && (
                  <div className="mt-4 space-y-4">
                    {/* Current location info */}
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-xs text-blue-600 font-medium mb-1">Current Location</p>
                      <p className="text-sm text-blue-800 font-mono break-all">{githubLocalpath || "Not configured"}</p>
                      <p className="text-xs text-blue-600 mt-1">Mode: {storageMode || "unknown"}</p>
                    </div>

                    {/* Destination path */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Destination Path
                      </label>
                      <input
                        type="text"
                        value={migrationDestination}
                        onChange={(e) => setMigrationDestination(e.target.value)}
                        placeholder="/path/to/new/location"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={isMigrating}
                      />
                      <p className="text-xs text-gray-400 mt-1.5">
                        The folder where your data will be copied/moved
                      </p>
                    </div>

                    {/* Migration type */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Migration Type
                      </label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="migrationType"
                            checked={migrationType === "copy"}
                            onChange={() => setMigrationType("copy")}
                            className="text-blue-600 focus:ring-blue-500"
                            disabled={isMigrating}
                          />
                          <span className="text-sm text-gray-700">Copy</span>
                          <span className="text-xs text-gray-400">(keep original)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="migrationType"
                            checked={migrationType === "move"}
                            onChange={() => setMigrationType("move")}
                            className="text-blue-600 focus:ring-blue-500"
                            disabled={isMigrating}
                          />
                          <span className="text-sm text-gray-700">Move</span>
                          <span className="text-xs text-gray-400">(delete original)</span>
                        </label>
                      </div>
                    </div>

                    {/* Target mode */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Target Mode
                      </label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="targetMode"
                            checked={targetMode === "local"}
                            onChange={() => setTargetMode("local")}
                            className="text-blue-600 focus:ring-blue-500"
                            disabled={isMigrating}
                          />
                          <span className="text-sm text-gray-700">Local-only</span>
                          <span className="text-xs text-gray-400">(no GitHub sync)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="targetMode"
                            checked={targetMode === "github"}
                            onChange={() => setTargetMode("github")}
                            className="text-blue-600 focus:ring-blue-500"
                            disabled={isMigrating}
                          />
                          <span className="text-sm text-gray-700">GitHub</span>
                          <span className="text-xs text-gray-400">(sync to repo)</span>
                        </label>
                      </div>
                    </div>

                    {/* Remove .git folder option */}
                    {targetMode === "local" && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={removeGitFolder}
                          onChange={(e) => setRemoveGitFolder(e.target.checked)}
                          className="rounded text-blue-600 focus:ring-blue-500"
                          disabled={isMigrating}
                        />
                        <span className="text-sm text-gray-700">Remove .git folder (recommended for local mode)</span>
                      </label>
                    )}

                    {/* New GitHub credentials (if switching to GitHub mode) */}
                    {targetMode === "github" && (
                      <div className="space-y-3 p-3 bg-amber-50 rounded-lg">
                        <p className="text-xs text-amber-700 font-medium">GitHub Credentials for New Location</p>
                        <input
                          type="text"
                          value={newGithubRepo}
                          onChange={(e) => setNewGithubRepo(e.target.value)}
                          placeholder="username/new-repo"
                          className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                          disabled={isMigrating}
                        />
                        <input
                          type="password"
                          value={newGithubToken}
                          onChange={(e) => setNewGithubToken(e.target.value)}
                          placeholder="New GitHub token (if changing)"
                          className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                          disabled={isMigrating}
                        />
                      </div>
                    )}

                    {/* Migration error */}
                    {migrationError && (
                      <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                        <p className="text-sm text-red-600">{migrationError}</p>
                      </div>
                    )}

                    {/* Migration success */}
                    {migrationSuccess && (
                      <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
                        <p className="text-sm text-green-600">{migrationSuccess}</p>
                      </div>
                    )}

                    {/* Preview results */}
                    {migrationPreview && (
                      <div className={`p-4 rounded-lg ${migrationPreview.can_proceed ? "bg-gray-50" : "bg-red-50"}`}>
                        <h4 className="text-sm font-medium text-gray-700 mb-3">Migration Preview</h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-gray-500">Total Size:</span>
                            <span className="ml-2 font-medium">{formatBytes(migrationPreview.total_size_bytes)}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Files:</span>
                            <span className="ml-2 font-medium">{migrationPreview.file_count.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Folders:</span>
                            <span className="ml-2 font-medium">{migrationPreview.folder_count.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Has .git:</span>
                            <span className="ml-2 font-medium">{migrationPreview.has_git_folder ? "Yes" : "No"}</span>
                          </div>
                        </div>
                        {migrationPreview.users_found.length > 0 && (
                          <div className="mt-3">
                            <span className="text-gray-500 text-sm">Users:</span>
                            <span className="ml-2 text-sm font-medium">{migrationPreview.users_found.join(", ")}</span>
                          </div>
                        )}
                        {migrationPreview.warnings.length > 0 && (
                          <div className="mt-3">
                            <p className="text-sm font-medium text-amber-700 mb-1">Warnings:</p>
                            <ul className="text-xs text-amber-600 list-disc list-inside space-y-0.5">
                              {migrationPreview.warnings.map((warning, i) => (
                                <li key={i}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Progress bar */}
                    {isMigrating && migrationProgress && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Progress</span>
                          <span className="font-medium">{migrationProgress.progress_percent.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${migrationProgress.progress_percent}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 truncate">
                          {migrationProgress.current_file}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatBytes(migrationProgress.bytes_copied)} / {formatBytes(migrationProgress.total_bytes)}
                        </p>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={handlePreviewMigration}
                        disabled={isPreviewing || isMigrating || !migrationDestination.trim()}
                        className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isPreviewing && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />}
                        Preview
                      </button>
                      {isMigrating ? (
                        <button
                          onClick={handleCancelMigration}
                          className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={handleExecuteMigration}
                          disabled={!migrationPreview?.can_proceed || isPreviewing}
                          className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {isMigrating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                          Start Migration
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* User Account Migration Section */}
              <div className="mt-6 border-t border-gray-200 pt-6">
                <button
                  onClick={() => setShowUserMigration(!showUserMigration)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-700">Migrate User Account</span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${showUserMigration ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showUserMigration && (
                  <div className="mt-4 space-y-4">
                    <p className="text-xs text-gray-500">
                      Migrate a user account from one ResearchOS data folder to another. Useful for moving a local account to a shared lab folder.
                    </p>

                    {/* Source Section */}
                    <div className="p-3 bg-blue-50 rounded-lg space-y-3">
                      <p className="text-xs text-blue-600 font-medium">Source (Where the user account is now)</p>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Source Folder Path</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={userMigrationSourcePath}
                            onChange={(e) => setUserMigrationSourcePath(e.target.value)}
                            placeholder="/path/to/source/folder"
                            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            disabled={isUserMigrating}
                          />
                          <button
                            onClick={handleLoadSourceUsers}
                            disabled={!userMigrationSourcePath.trim() || isUserMigrating}
                            className="px-3 py-2 text-sm text-blue-600 bg-blue-100 hover:bg-blue-200 rounded-lg disabled:opacity-50"
                          >
                            Load
                          </button>
                        </div>
                      </div>
                      {sourceUsers.length > 0 && (
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Select User to Migrate</label>
                          <select
                            value={userMigrationSourceUsername}
                            onChange={(e) => setUserMigrationSourceUsername(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            disabled={isUserMigrating}
                          >
                            {sourceUsers.map((user) => (
                              <option key={user} value={user}>{user}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Target Section */}
                    <div className="p-3 bg-green-50 rounded-lg space-y-3">
                      <p className="text-xs text-green-600 font-medium">Target (Where to migrate the account)</p>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Target Folder Path</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={userMigrationTargetPath}
                            onChange={(e) => setUserMigrationTargetPath(e.target.value)}
                            placeholder="/path/to/target/folder (e.g., OneDrive lab folder)"
                            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            disabled={isUserMigrating}
                          />
                          <button
                            onClick={handleLoadTargetUsers}
                            disabled={!userMigrationTargetPath.trim() || isUserMigrating}
                            className="px-3 py-2 text-sm text-green-600 bg-green-100 hover:bg-green-200 rounded-lg disabled:opacity-50"
                          >
                            Load
                          </button>
                        </div>
                      </div>
                      {targetUsers.length > 0 && (
                        <div className="text-xs text-gray-500">
                          <span className="font-medium">Existing users in target:</span> {targetUsers.join(", ")}
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Username in Target</label>
                        <input
                          type="text"
                          value={userMigrationTargetUsername}
                          onChange={(e) => setUserMigrationTargetUsername(e.target.value)}
                          placeholder={userMigrationSourceUsername || "username"}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                          disabled={isUserMigrating}
                        />
                        <p className="text-xs text-gray-400 mt-1">Can be different from source username</p>
                      </div>
                    </div>

                    {/* Options */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={userMigrationDeleteSource}
                        onChange={(e) => setUserMigrationDeleteSource(e.target.checked)}
                        className="rounded text-red-600 focus:ring-red-500"
                        disabled={isUserMigrating}
                      />
                      <span className="text-sm text-gray-700">Delete source user after migration</span>
                    </label>

                    {/* Error */}
                    {userMigrationError && (
                      <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                        <p className="text-sm text-red-600">{userMigrationError}</p>
                      </div>
                    )}

                    {/* Success */}
                    {userMigrationSuccess && (
                      <div className="p-3 bg-green-50 border border-green-100 rounded-lg">
                        <p className="text-sm text-green-600">{userMigrationSuccess}</p>
                      </div>
                    )}

                    {/* Preview results */}
                    {userMigrationPreview && (
                      <div className={`p-4 rounded-lg ${userMigrationPreview.can_proceed ? "bg-gray-50" : "bg-red-50"}`}>
                        <h4 className="text-sm font-medium text-gray-700 mb-3">Migration Preview</h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-gray-500">Projects:</span>
                            <span className="ml-2 font-medium">{userMigrationPreview.stats.projects_count}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Tasks:</span>
                            <span className="ml-2 font-medium">{userMigrationPreview.stats.tasks_count}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Methods:</span>
                            <span className="ml-2 font-medium">{userMigrationPreview.stats.methods_count}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Dependencies:</span>
                            <span className="ml-2 font-medium">{userMigrationPreview.stats.dependencies_count}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Notes:</span>
                            <span className="ml-2 font-medium">{userMigrationPreview.stats.notes_count}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Images:</span>
                            <span className="ml-2 font-medium">{userMigrationPreview.stats.images_count}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Files:</span>
                            <span className="ml-2 font-medium">{userMigrationPreview.stats.files_count}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Total Size:</span>
                            <span className="ml-2 font-medium">{formatBytes(userMigrationPreview.stats.total_size_bytes)}</span>
                          </div>
                        </div>
                        {userMigrationPreview.warnings.length > 0 && (
                          <div className="mt-3">
                            <p className="text-sm font-medium text-amber-700 mb-1">Warnings:</p>
                            <ul className="text-xs text-amber-600 list-disc list-inside space-y-0.5">
                              {userMigrationPreview.warnings.map((warning, i) => (
                                <li key={i}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Progress */}
                    {isUserMigrating && userMigrationProgress && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">{userMigrationProgress.current_step}</span>
                          <span className="font-medium">{userMigrationProgress.items_processed} items</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-green-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${userMigrationProgress.total_items > 0 ? (userMigrationProgress.items_processed / userMigrationProgress.total_items) * 100 : 0}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-400">
                          {formatBytes(userMigrationProgress.bytes_copied)} copied
                        </p>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={handlePreviewUserMigration}
                        disabled={isUserMigrationPreviewing || isUserMigrating || !userMigrationSourcePath.trim() || !userMigrationTargetPath.trim() || !userMigrationSourceUsername.trim() || !userMigrationTargetUsername.trim()}
                        className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isUserMigrationPreviewing && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />}
                        Preview
                      </button>
                      <button
                        onClick={handleExecuteUserMigration}
                        disabled={!userMigrationPreview?.can_proceed || isUserMigrationPreviewing || isUserMigrating}
                        className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isUserMigrating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                        Migrate User
                      </button>
                    </div>
                  </div>
                )}
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
