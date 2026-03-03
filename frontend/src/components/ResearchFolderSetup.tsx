"use client";

import { useState, useEffect } from "react";
import { settingsApi, type FolderSetupRequest, type DataPathCheckResponse } from "@/lib/api";

interface ResearchFolderSetupProps {
  onComplete: () => void;
  errorData?: DataPathCheckResponse | null;
}

type SetupMode = "choose" | "github" | "local";
type GithubOption = "existing" | "blank";

export default function ResearchFolderSetup({ onComplete, errorData }: ResearchFolderSetupProps) {
  const [mode, setMode] = useState<SetupMode>("choose");
  const [githubOption, setGithubOption] = useState<GithubOption>("existing");
  const [localPath, setLocalPath] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [createIfMissing, setCreateIfMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Pre-fill path from error data if available
  useEffect(() => {
    if (errorData?.configured_path) {
      setLocalPath(errorData.configured_path);
    }
  }, [errorData]);

  const handleSetup = async () => {
    if (!localPath.trim()) {
      setError("Please enter a valid folder path");
      return;
    }

    if (mode === "github" && !githubToken.trim()) {
      setError("GitHub token is required for GitHub mode");
      return;
    }

    if (mode === "github" && !githubRepo.trim()) {
      setError("GitHub repository is required for GitHub mode");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const request: FolderSetupRequest = {
        mode: mode as "github" | "local",
        local_path: localPath.trim(),
        github_token: mode === "github" ? githubToken.trim() : undefined,
        github_repo: mode === "github" ? githubRepo.trim() : undefined,
        create_if_missing: createIfMissing,
      };

      const response = await settingsApi.setupFolder(request);
      
      if (response.status === "ok") {
        setSuccess(response.message);
        // Reload the page to pick up new settings
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

  const renderChooseMode = () => (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Set Up Research Folder</h2>
        <p className="text-slate-400">Choose how you want to store your research data</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* GitHub Option */}
        <button
          onClick={() => setMode("github")}
          className="p-6 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-xl transition-all text-left group"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white group-hover:text-blue-400 transition-colors">
                GitHub Repository
              </h3>
              <p className="text-sm text-slate-400">Sync with GitHub for version control</p>
            </div>
          </div>
          <ul className="text-sm text-slate-500 space-y-1">
            <li>• Automatic version control and backup</li>
            <li>• Sync across multiple computers</li>
            <li>• Collaborate with team members</li>
          </ul>
        </button>

        {/* Local Folder Option */}
        <button
          onClick={() => setMode("local")}
          className="p-6 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-emerald-500/50 rounded-xl transition-all text-left group"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white group-hover:text-emerald-400 transition-colors">
                Local Folder
              </h3>
              <p className="text-sm text-slate-400">OneDrive, network drive, or any folder</p>
            </div>
          </div>
          <ul className="text-sm text-slate-500 space-y-1">
            <li>• No GitHub account needed</li>
            <li>• Works with OneDrive, iCloud, etc.</li>
            <li>• Simple local file storage</li>
          </ul>
        </button>
      </div>

      {errorData && errorData.status === "error" && (
        <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <p className="text-sm text-amber-300">
            <strong>Previous configuration issue:</strong> {errorData.message}
          </p>
        </div>
      )}
    </div>
  );

  const renderGithubForm = () => (
    <div className="space-y-6">
      <button
        onClick={() => setMode("choose")}
        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to options
      </button>

      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">GitHub Repository Setup</h2>
        <p className="text-slate-400">Connect to a GitHub repository for version control</p>
      </div>

      {/* GitHub Option Selection */}
      <div className="space-y-4 mb-6">
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Repository Type
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setGithubOption("existing")}
            className={`p-4 rounded-lg border transition-all ${
              githubOption === "existing"
                ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
            }`}
          >
            <div className="font-medium">Existing Repo</div>
            <div className="text-xs mt-1 opacity-70">Already cloned or created</div>
          </button>
          <button
            onClick={() => setGithubOption("blank")}
            className={`p-4 rounded-lg border transition-all ${
              githubOption === "blank"
                ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
            }`}
          >
            <div className="font-medium">Blank Repo</div>
            <div className="text-xs mt-1 opacity-70">Start fresh with new structure</div>
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Local Repository Path
          </label>
          <input
            type="text"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="/Users/username/research-data"
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-slate-500 mt-1.5">
            {githubOption === "existing"
              ? "Path to your existing cloned repository"
              : "Path where you want to store your research data"}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            GitHub Repository
          </label>
          <input
            type="text"
            value={githubRepo}
            onChange={(e) => setGithubRepo(e.target.value)}
            placeholder="username/research-eln"
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-slate-500 mt-1.5">
            Format: username/repository-name
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            GitHub Personal Access Token
          </label>
          <input
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxx"
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-slate-500 mt-1.5">
            Needs repo scope. Create one at GitHub Settings → Developer settings → Personal access tokens
          </p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={createIfMissing}
            onChange={(e) => setCreateIfMissing(e.target.checked)}
            className="rounded border-slate-500 bg-white/10 text-blue-500 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-300">
            Create folder structure if missing
          </span>
        </label>
      </div>
    </div>
  );

  const renderLocalForm = () => (
    <div className="space-y-6">
      <button
        onClick={() => setMode("choose")}
        className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to options
      </button>

      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">Local Folder Setup</h2>
        <p className="text-slate-400">Use any local folder for your research data</p>
      </div>

      <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg mb-6">
        <p className="text-sm text-emerald-300">
          <strong>Local mode:</strong> Data is stored in the specified folder without GitHub sync.
          Perfect for OneDrive, iCloud, network drives, or any local storage.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Local Folder Path
          </label>
          <input
            type="text"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="/Users/gnickles/Library/CloudStorage/OneDrive-UW-Madison/ResearchData"
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
          <p className="text-xs text-slate-500 mt-1.5">
            Enter the full path to your research data folder
          </p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={createIfMissing}
            onChange={(e) => setCreateIfMissing(e.target.checked)}
            className="rounded border-slate-500 bg-white/10 text-emerald-500 focus:ring-emerald-500"
          />
          <span className="text-sm text-slate-300">
            Create folder structure if missing
          </span>
        </label>

        <div className="p-4 bg-slate-500/10 border border-slate-500/30 rounded-lg">
          <h4 className="text-sm font-medium text-slate-300 mb-2">Required folder structure:</h4>
          <code className="text-xs text-slate-400 block">
            {localPath || "/your/folder"}/users/public/
          </code>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />
      </div>

      <div className="relative z-10 w-full max-w-lg mx-4">
        {/* Logo and title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white">ResearchOS</h1>
        </div>

        {/* Main card */}
        <div className="bg-white/10 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
          <div className="p-6">
            {mode === "choose" && renderChooseMode()}
            {mode === "github" && renderGithubForm()}
            {mode === "local" && renderLocalForm()}

            {/* Error message */}
            {error && (
              <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* Success message */}
            {success && (
              <div className="mt-4 p-3 bg-green-500/20 border border-green-500/30 rounded-lg">
                <p className="text-sm text-green-300">{success}</p>
              </div>
            )}

            {/* Submit button (only show when in a form mode) */}
            {mode !== "choose" && (
              <div className="mt-6">
                <button
                  onClick={handleSetup}
                  disabled={loading}
                  className={`w-full py-3 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 ${
                    mode === "github"
                      ? "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
                      : "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Save Configuration
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-500 text-sm mt-6">
          Your data is stored locally in the specified folder
        </p>
      </div>
    </div>
  );
}
