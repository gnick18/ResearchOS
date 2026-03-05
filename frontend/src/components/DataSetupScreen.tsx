"use client";

import { useState, useEffect, useCallback } from "react";
import { settingsApi, migrationApi, type FolderSetupRequest, type MigrationPreview, type MigrationProgress, type MigrationRequest } from "@/lib/api";

interface DataSetupScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

type SetupMode = "choose" | "github" | "local" | "edit" | "migrate";
type GithubOption = "existing" | "blank";

export default function DataSetupScreen({ isOpen, onClose }: DataSetupScreenProps) {
  const [mode, setMode] = useState<SetupMode>("choose");
  const [githubOption, setGithubOption] = useState<GithubOption>("existing");
  const [localPath, setLocalPath] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [createIfMissing, setCreateIfMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [currentMode, setCurrentMode] = useState<"github" | "local" | null>(null);
  const [tokenMasked, setTokenMasked] = useState("");

  // Migration state
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

  // Load current settings when the screen opens
  useEffect(() => {
    if (isOpen) {
      loadCurrentSettings();
    }
  }, [isOpen]);

  const loadCurrentSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const settings = await settingsApi.get();
      setGithubRepo(settings.github_repo || "");
      setLocalPath(settings.github_localpath || "");
      setIsConfigured(settings.is_configured);
      setTokenMasked(settings.github_token_masked || "");
      // Determine if it's GitHub or local mode based on whether repo is set
      if (settings.github_repo) {
        setCurrentMode("github");
      } else if (settings.github_localpath) {
        setCurrentMode("local");
      } else {
        setCurrentMode(null);
      }
      setGithubToken("");
    } catch (err) {
      setError("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async () => {
    if (!localPath.trim()) {
      setError("Please enter a valid folder path");
      return;
    }

    // For github mode (not edit), token is required
    if (mode === "github" && !githubToken.trim()) {
      setError("GitHub token is required for GitHub mode");
      return;
    }

    if (mode === "github" && !githubRepo.trim()) {
      setError("GitHub repository is required for GitHub mode");
      return;
    }

    // For edit mode with github, repo is required but token is optional
    if (mode === "edit" && currentMode === "github" && !githubRepo.trim()) {
      setError("GitHub repository is required for GitHub mode");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Determine the actual mode to send to the API
      const apiMode = mode === "edit" ? currentMode : mode;
      
      const request: FolderSetupRequest = {
        mode: apiMode as "github" | "local",
        local_path: localPath.trim(),
        github_token: (mode === "github" || (mode === "edit" && currentMode === "github" && githubToken.trim())) 
          ? githubToken.trim() 
          : undefined,
        github_repo: (mode === "github" || mode === "edit") && currentMode === "github" 
          ? githubRepo.trim() 
          : undefined,
        create_if_missing: createIfMissing,
      };

      const response = await settingsApi.setupFolder(request);
      
      if (response.status === "ok") {
        setSuccess(response.message);
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        setError(response.message || "Failed to set up folder");
      }
    } catch (err: unknown) {
      const errorObj = err as { response?: { data?: { detail?: string } } };
      const detail = errorObj?.response?.data?.detail;
      setError(detail || "Failed to set up folder. Please check your inputs.");
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
        setLocalPath(result.destination_path);
        setCurrentMode(result.new_storage_mode as "github" | "local");
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
          setLocalPath(settings.github_localpath);
          setCurrentMode(settings.storage_mode as "github" | "local" | null);
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

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const renderCurrentConfig = () => (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Current Configuration
        </h3>
        {isConfigured && (
          <button
            onClick={() => setMode("edit")}
            className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-slate-300 hover:text-white transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </button>
        )}
      </div>
      
      {isConfigured ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Storage Mode:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              currentMode === "github" 
                ? "bg-blue-500/20 text-blue-300" 
                : "bg-emerald-500/20 text-emerald-300"
            }`}>
              {currentMode === "github" ? "GitHub" : "Local Folder"}
            </span>
          </div>
          
          <div className="text-sm">
            <span className="text-slate-400 block mb-1">Data Path:</span>
            <code className="text-xs text-slate-300 bg-white/5 px-2 py-1 rounded block overflow-x-auto">
              {localPath || "Not set"}
            </code>
          </div>
          
          {currentMode === "github" && (
            <>
              <div className="text-sm">
                <span className="text-slate-400 block mb-1">Repository:</span>
                <code className="text-xs text-slate-300 bg-white/5 px-2 py-1 rounded block">
                  {githubRepo || "Not set"}
                </code>
              </div>
              
              {tokenMasked && (
                <div className="text-sm">
                  <span className="text-slate-400 block mb-1">Token:</span>
                  <code className="text-xs text-slate-300 bg-white/5 px-2 py-1 rounded block">
                    {tokenMasked}
                  </code>
                </div>
              )}
            </>
          )}
          
          <div className="pt-2 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-xs text-green-300">Configured and ready</span>
          </div>
        </div>
      ) : (
        <div className="text-center py-4">
          <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-sm text-slate-400">No data path configured</p>
          <p className="text-xs text-slate-500 mt-1">Set up a storage location to get started</p>
        </div>
      )}
    </div>
  );

  const renderSetupOptions = () => (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white mb-4">Set Up New Path</h3>
      
      {/* GitHub Option */}
      <button
        onClick={() => setMode("github")}
        className="w-full p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-xl transition-all text-left group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors">
              GitHub Repository
            </h4>
            <p className="text-xs text-slate-400 truncate">Sync with GitHub for version control</p>
          </div>
          <svg className="w-4 h-4 text-slate-500 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {/* Local Folder Option */}
      <button
        onClick={() => setMode("local")}
        className="w-full p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-500/50 rounded-xl transition-all text-left group"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors">
              Local Folder
            </h4>
            <p className="text-xs text-slate-400 truncate">OneDrive, network drive, or any folder</p>
          </div>
          <svg className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>

      {/* Migrate Data Option - only show if configured */}
      {isConfigured && (
        <button
          onClick={() => setMode("migrate")}
          className="w-full p-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/50 rounded-xl transition-all text-left group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-white group-hover:text-purple-400 transition-colors">
                Migrate Data
              </h4>
              <p className="text-xs text-slate-400 truncate">Copy or move data to a new location</p>
            </div>
            <svg className="w-4 h-4 text-slate-500 group-hover:text-purple-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
      )}
    </div>
  );

  const renderGithubForm = () => (
    <div className="space-y-4">
      <button
        onClick={() => setMode("choose")}
        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to options
      </button>

      <h3 className="text-lg font-semibold text-white">GitHub Repository Setup</h3>

      {/* GitHub Option Selection */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setGithubOption("existing")}
          className={`p-3 rounded-lg border transition-all text-center ${
            githubOption === "existing"
              ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
              : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
          }`}
        >
          <div className="text-sm font-medium">Existing Repo</div>
          <div className="text-xs mt-0.5 opacity-70">Already cloned</div>
        </button>
        <button
          onClick={() => setGithubOption("blank")}
          className={`p-3 rounded-lg border transition-all text-center ${
            githubOption === "blank"
              ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
              : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
          }`}
        >
          <div className="text-sm font-medium">Blank Repo</div>
          <div className="text-xs mt-0.5 opacity-70">Start fresh</div>
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Local Repository Path
          </label>
          <input
            type="text"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="/Users/username/research-data"
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            GitHub Repository
          </label>
          <input
            type="text"
            value={githubRepo}
            onChange={(e) => setGithubRepo(e.target.value)}
            placeholder="username/research-eln"
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            GitHub Personal Access Token
          </label>
          <input
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxx"
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-slate-500 mt-1">
            Needs repo scope. Create at GitHub Settings → Developer settings → Personal access tokens
          </p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={createIfMissing}
            onChange={(e) => setCreateIfMissing(e.target.checked)}
            className="rounded border-slate-500 bg-white/10 text-blue-500 focus:ring-blue-500"
          />
          <span className="text-xs text-slate-300">
            Create folder structure if missing
          </span>
        </label>
      </div>
    </div>
  );

  const renderLocalForm = () => (
    <div className="space-y-4">
      <button
        onClick={() => setMode("choose")}
        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to options
      </button>

      <h3 className="text-lg font-semibold text-white">Local Folder Setup</h3>

      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
        <p className="text-xs text-emerald-300">
          <strong>Local mode:</strong> Data is stored in the specified folder without GitHub sync.
          Perfect for OneDrive, iCloud, network drives, or any local storage.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Local Folder Path
          </label>
          <input
            type="text"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="/Users/username/ResearchData"
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={createIfMissing}
            onChange={(e) => setCreateIfMissing(e.target.checked)}
            className="rounded border-slate-500 bg-white/10 text-emerald-500 focus:ring-emerald-500"
          />
          <span className="text-xs text-slate-300">
            Create folder structure if missing
          </span>
        </label>

        <div className="p-3 bg-slate-500/10 border border-slate-500/30 rounded-lg">
          <h4 className="text-xs font-medium text-slate-300 mb-1">Required folder structure:</h4>
          <code className="text-xs text-slate-400 block">
            {localPath || "/your/folder"}/users/public/
          </code>
        </div>
      </div>
    </div>
  );

  const renderEditForm = () => (
    <div className="space-y-4">
      <button
        onClick={() => setMode("choose")}
        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Cancel
      </button>

      <h3 className="text-lg font-semibold text-white">Edit Configuration</h3>

      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-xs text-blue-300">
          Edit your current configuration. Leave the token field empty to keep your existing token.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Storage Mode
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setCurrentMode("github")}
              className={`p-2 rounded-lg border transition-all text-center text-sm ${
                currentMode === "github"
                  ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                  : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
              }`}
            >
              GitHub
            </button>
            <button
              onClick={() => setCurrentMode("local")}
              className={`p-2 rounded-lg border transition-all text-center text-sm ${
                currentMode === "local"
                  ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                  : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
              }`}
            >
              Local Folder
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Data Path
          </label>
          <input
            type="text"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="/Users/username/research-data"
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {currentMode === "github" && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                GitHub Repository
              </label>
              <input
                type="text"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder="username/research-eln"
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                GitHub Personal Access Token
              </label>
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="Leave empty to keep existing token"
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {tokenMasked && (
                <p className="text-xs text-slate-500 mt-1">
                  Current: <code className="bg-white/5 px-1 rounded">{tokenMasked}</code>
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderMigrationForm = () => (
    <div className="space-y-4">
      <button
        onClick={() => {
          setMode("choose");
          setMigrationPreview(null);
          setMigrationError(null);
          setMigrationSuccess(null);
        }}
        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to options
      </button>

      <h3 className="text-lg font-semibold text-white">Migrate Data</h3>

      {/* Current location info */}
      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <p className="text-xs text-blue-300 font-medium mb-1">Current Location</p>
        <p className="text-sm text-blue-100 font-mono break-all">{localPath || "Not configured"}</p>
        <p className="text-xs text-blue-300 mt-1">Mode: {currentMode || "unknown"}</p>
      </div>

      {/* Destination path */}
      <div>
        <label className="block text-xs font-medium text-slate-300 mb-1">
          Destination Path
        </label>
        <input
          type="text"
          value={migrationDestination}
          onChange={(e) => setMigrationDestination(e.target.value)}
          placeholder="/path/to/new/location"
          className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          disabled={isMigrating}
        />
        <p className="text-xs text-slate-500 mt-1">
          The folder where your data will be copied/moved
        </p>
      </div>

      {/* Migration type */}
      <div>
        <label className="block text-xs font-medium text-slate-300 mb-2">
          Migration Type
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="migrationType"
              checked={migrationType === "copy"}
              onChange={() => setMigrationType("copy")}
              className="text-purple-500 focus:ring-purple-500"
              disabled={isMigrating}
            />
            <span className="text-sm text-slate-300">Copy</span>
            <span className="text-xs text-slate-500">(keep original)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="migrationType"
              checked={migrationType === "move"}
              onChange={() => setMigrationType("move")}
              className="text-purple-500 focus:ring-purple-500"
              disabled={isMigrating}
            />
            <span className="text-sm text-slate-300">Move</span>
            <span className="text-xs text-slate-500">(delete original)</span>
          </label>
        </div>
      </div>

      {/* Target mode */}
      <div>
        <label className="block text-xs font-medium text-slate-300 mb-2">
          Target Mode
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="targetMode"
              checked={targetMode === "local"}
              onChange={() => setTargetMode("local")}
              className="text-purple-500 focus:ring-purple-500"
              disabled={isMigrating}
            />
            <span className="text-sm text-slate-300">Local-only</span>
            <span className="text-xs text-slate-500">(no GitHub sync)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="targetMode"
              checked={targetMode === "github"}
              onChange={() => setTargetMode("github")}
              className="text-purple-500 focus:ring-purple-500"
              disabled={isMigrating}
            />
            <span className="text-sm text-slate-300">GitHub</span>
            <span className="text-xs text-slate-500">(sync to repo)</span>
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
            className="rounded border-slate-500 bg-white/10 text-purple-500 focus:ring-purple-500"
            disabled={isMigrating}
          />
          <span className="text-xs text-slate-300">Remove .git folder (recommended for local mode)</span>
        </label>
      )}

      {/* New GitHub credentials (if switching to GitHub mode) */}
      {targetMode === "github" && (
        <div className="space-y-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <p className="text-xs text-amber-300 font-medium">GitHub Credentials for New Location</p>
          <input
            type="text"
            value={newGithubRepo}
            onChange={(e) => setNewGithubRepo(e.target.value)}
            placeholder="username/new-repo"
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            disabled={isMigrating}
          />
          <input
            type="password"
            value={newGithubToken}
            onChange={(e) => setNewGithubToken(e.target.value)}
            placeholder="New GitHub token (if changing)"
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            disabled={isMigrating}
          />
        </div>
      )}

      {/* Migration error */}
      {migrationError && (
        <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
          <p className="text-sm text-red-300">{migrationError}</p>
        </div>
      )}

      {/* Migration success */}
      {migrationSuccess && (
        <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-lg">
          <p className="text-sm text-green-300">{migrationSuccess}</p>
        </div>
      )}

      {/* Preview results */}
      {migrationPreview && (
        <div className={`p-4 rounded-lg ${migrationPreview.can_proceed ? "bg-white/5 border border-white/10" : "bg-red-500/20 border border-red-500/30"}`}>
          <h4 className="text-sm font-medium text-white mb-3">Migration Preview</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-400">Total Size:</span>
              <span className="ml-2 font-medium text-white">{formatBytes(migrationPreview.total_size_bytes)}</span>
            </div>
            <div>
              <span className="text-slate-400">Files:</span>
              <span className="ml-2 font-medium text-white">{migrationPreview.file_count.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-400">Folders:</span>
              <span className="ml-2 font-medium text-white">{migrationPreview.folder_count.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-400">Has .git:</span>
              <span className="ml-2 font-medium text-white">{migrationPreview.has_git_folder ? "Yes" : "No"}</span>
            </div>
          </div>
          {migrationPreview.users_found.length > 0 && (
            <div className="mt-3">
              <span className="text-slate-400 text-sm">Users:</span>
              <span className="ml-2 text-sm font-medium text-white">{migrationPreview.users_found.join(", ")}</span>
            </div>
          )}
          {migrationPreview.warnings.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-amber-300 mb-1">Warnings:</p>
              <ul className="text-xs text-amber-300 list-disc list-inside space-y-0.5">
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
            <span className="text-slate-400">Progress</span>
            <span className="font-medium text-white">{migrationProgress.progress_percent.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${migrationProgress.progress_percent}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 truncate">
            {migrationProgress.current_file}
          </p>
          <p className="text-xs text-slate-500">
            {formatBytes(migrationProgress.bytes_copied)} / {formatBytes(migrationProgress.total_bytes)}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handlePreviewMigration}
          disabled={isPreviewing || isMigrating || !migrationDestination.trim()}
          className="px-4 py-2 text-sm text-slate-300 bg-white/10 hover:bg-white/20 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isPreviewing && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-300" />}
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
            className="px-4 py-2 text-sm text-white bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isMigrating && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            Start Migration
          </button>
        )}
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-y-auto">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <div className="absolute inset-0" style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }} />
      </div>

      <div className="relative z-10 w-full max-w-4xl mx-4 my-8">
        {/* Close button in top right */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-20 w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-slate-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Logo and title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white">ResearchOS</h1>
          <p className="text-slate-400 text-sm mt-2">Data Storage Configuration</p>
        </div>

        {/* Main card with two columns */}
        <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-white/10">
              {/* Left column - Current Configuration */}
              <div className="p-6">
                {renderCurrentConfig()}
              </div>

              {/* Right column - Setup Options */}
              <div className="p-6 max-h-[70vh] overflow-y-auto">
                {mode === "choose" && renderSetupOptions()}
                {mode === "github" && renderGithubForm()}
                {mode === "local" && renderLocalForm()}
                {mode === "edit" && renderEditForm()}
                {mode === "migrate" && renderMigrationForm()}

                {/* Error message */}
                {error && mode !== "migrate" && (
                  <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                    <p className="text-sm text-red-300">{error}</p>
                  </div>
                )}

                {/* Success message */}
                {success && mode !== "migrate" && (
                  <div className="mt-4 p-3 bg-green-500/20 border border-green-500/30 rounded-lg">
                    <p className="text-sm text-green-300">{success}</p>
                  </div>
                )}

                {/* Submit button (only show when in a form mode, but not for migrate which has its own buttons) */}
                {mode !== "choose" && mode !== "migrate" && (
                  <div className="mt-4">
                    <button
                      onClick={handleSetup}
                      disabled={loading}
                      className={`w-full py-2.5 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 text-sm ${
                        mode === "github" || (mode === "edit" && currentMode === "github")
                          ? "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
                          : mode === "edit"
                          ? "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
                          : "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {loading ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {mode === "edit" ? "Update Configuration" : "Save Configuration"}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          Your data is stored locally in the specified folder
        </p>
      </div>
    </div>
  );
}
