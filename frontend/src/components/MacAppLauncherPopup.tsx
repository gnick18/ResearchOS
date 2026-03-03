"use client";

import { useState, useEffect } from "react";

interface MacAppLauncherPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MacAppLauncherPopup({ isOpen, onClose }: MacAppLauncherPopupProps) {
  const [step, setStep] = useState<"detect" | "confirm" | "name" | "creating" | "success" | "error">("detect");
  const [isMac, setIsMac] = useState<boolean | null>(null);
  const [appName, setAppName] = useState("ResearchOS");
  const [error, setError] = useState<string | null>(null);
  const [appPath, setAppPath] = useState<string | null>(null);

  // Detect Mac on open
  useEffect(() => {
    if (isOpen) {
      // Detect if user is on Mac
      const userAgent = navigator.userAgent.toLowerCase();
      const isMacOS = userAgent.includes("mac") && !userAgent.includes("windows") && !userAgent.includes("linux");
      setIsMac(isMacOS);
      setStep(isMacOS ? "confirm" : "error");
      setError(isMacOS ? null : "This feature is only available on macOS.");
    }
  }, [isOpen]);

  const handleCreateApp = async () => {
    if (!appName.trim()) {
      setError("Please enter a name for your app");
      return;
    }

    setStep("creating");
    setError(null);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"}/settings/create-mac-app`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_name: appName.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to create app");
      }

      const data = await response.json();
      setAppPath(data.app_path);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create Mac app");
      setStep("error");
    }
  };

  const handleClose = () => {
    setStep("detect");
    setAppName("ResearchOS");
    setError(null);
    setAppPath(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-purple-50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Create Desktop Launcher
              </h3>
              <p className="text-xs text-gray-500">
                Quick access to ResearchOS
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Step: Confirm */}
          {step === "confirm" && (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h4 className="text-lg font-medium text-gray-900 mb-2">
                You're using a Mac!
              </h4>
              <p className="text-sm text-gray-600 mb-6">
                Would you like to create a desktop app that launches ResearchOS with one click?
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  No, thanks
                </button>
                <button
                  onClick={() => setStep("name")}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  Yes, create it!
                </button>
              </div>
            </div>
          )}

          {/* Step: Name */}
          {step === "name" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                What would you like to name your app?
              </label>
              <input
                type="text"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="ResearchOS"
                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
                autoFocus
              />
              <p className="text-xs text-gray-500 mb-6">
                The app will be created on your Desktop. You can drag it to your Dock for easy access.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setStep("confirm")}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Back
                </button>
                <button
                  onClick={handleCreateApp}
                  disabled={!appName.trim()}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create App
                </button>
              </div>
            </div>
          )}

          {/* Step: Creating */}
          {step === "creating" && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-sm text-gray-600">Creating your desktop app...</p>
            </div>
          )}

          {/* Step: Success */}
          {step === "success" && appPath && (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h4 className="text-lg font-medium text-gray-900 mb-2">
                App Created Successfully!
              </h4>
              <p className="text-sm text-gray-600 mb-4">
                <strong>{appName}</strong> is now on your Desktop.
              </p>
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <p className="text-xs text-gray-500 mb-2">App location:</p>
                <code className="text-xs text-gray-700 break-all">{appPath}</code>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 mb-6 text-left">
                <p className="text-xs font-medium text-blue-800 mb-2">Next steps:</p>
                <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
                  <li>Double-click the app to launch ResearchOS</li>
                  <li>First time: Right-click &gt; Open to bypass security</li>
                  <li>Drag to your Dock for one-click access</li>
                </ol>
              </div>
              <button
                onClick={handleClose}
                className="px-6 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg"
              >
                Done
              </button>
            </div>
          )}

          {/* Step: Error */}
          {step === "error" && (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h4 className="text-lg font-medium text-gray-900 mb-2">
                {isMac === false ? "Not Available" : "Error"}
              </h4>
              <p className="text-sm text-gray-600 mb-6">
                {error || "Something went wrong"}
              </p>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}