"use client";

import { useAppStore } from "@/lib/store";

interface LoadingOverlayProps {
  message?: string;
}

export default function LoadingOverlay({ message }: LoadingOverlayProps) {
  const ganttLoading = useAppStore((s) => s.ganttLoading);
  const ganttLoadingMessage = useAppStore((s) => s.ganttLoadingMessage);

  if (!ganttLoading) return null;

  const displayMessage = message || ganttLoadingMessage || "Please wait...";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center gap-4">
        {/* Spinner */}
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 border-4 border-blue-200 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
        </div>
        
        {/* Message */}
        <div className="text-center">
          <p className="text-sm font-medium text-gray-900">{displayMessage}</p>
          <p className="text-xs text-gray-500 mt-1">Please do not click any buttons</p>
        </div>
      </div>
    </div>
  );
}
