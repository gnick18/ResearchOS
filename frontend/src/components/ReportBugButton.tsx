"use client";

interface ReportBugButtonProps {
  onClick: () => void;
  position: "sidebar-edge" | "bottom-right";
}

const POSITION_CLASSES: Record<ReportBugButtonProps["position"], string> = {
  "sidebar-edge": "fixed bottom-20 left-[17rem] z-40",
  "bottom-right": "fixed bottom-20 right-6 z-40",
};

export default function ReportBugButton({ onClick, position }: ReportBugButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`${POSITION_CLASSES[position]} px-3 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center gap-2`}
      title="Report a bug"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span className="hidden sm:inline">Report Bug</span>
    </button>
  );
}
