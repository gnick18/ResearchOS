"use client";

import { useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";

interface DataSetupScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DataSetupScreen({ isOpen, onClose }: DataSetupScreenProps) {
  const { currentUser, directoryName, lastConnectedFolder, disconnect } = useFileSystem();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  if (!isOpen) return null;

  const folderLabel = directoryName || lastConnectedFolder || "Not connected";

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnect();
      window.location.reload();
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">
              Current User
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-900">{currentUser || "—"}</span>
              <p className="text-xs text-gray-400">
                Use the user button (bottom-right) to switch
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">
              Connected Folder
            </p>
            <code className="block text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 break-all">
              {folderLabel}
            </code>
          </div>

          <div className="pt-3 border-t border-gray-100">
            {!confirmingDisconnect ? (
              <button
                onClick={() => setConfirmingDisconnect(true)}
                className="w-full py-2.5 text-sm text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Disconnect / Pick Different Folder
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-600">
                  Disconnect from <span className="font-medium">{folderLabel}</span>? You&apos;ll need to re-select a folder to continue.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmingDisconnect(false)}
                    disabled={disconnecting}
                    className="flex-1 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="flex-1 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                  >
                    {disconnecting ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
