"use client";

import Tooltip from "@/components/Tooltip";

interface ReportBugButtonProps {
  onClick: () => void;
}

export default function ReportBugButton({ onClick }: ReportBugButtonProps) {
  return (
    <Tooltip label="Report a bug" placement="top">
      <button
        onClick={onClick}
        aria-label="Report a bug"
        className="fixed bottom-6 right-20 w-12 h-12 rounded-full bg-white border border-gray-200 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-gray-600 hover:text-red-600 z-50"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </button>
    </Tooltip>
  );
}
