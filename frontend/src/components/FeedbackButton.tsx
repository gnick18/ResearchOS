"use client";

import Tooltip from "@/components/Tooltip";

interface FeedbackButtonProps {
  onClick: () => void;
}

export default function FeedbackButton({ onClick }: FeedbackButtonProps) {
  return (
    <Tooltip label="Send feedback" placement="top">
      <button
        onClick={onClick}
        aria-label="Send feedback"
        className="pointer-events-auto w-12 h-12 rounded-full bg-surface-raised border border-border shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-foreground-muted hover:text-blue-600"
      >
        {/* Chat-bubble (generic "send feedback") rather than a red
            warning triangle. The button covers all three feedback
            types — bug, feature, general — so a type-specific glyph
            on the entry point would mislead. The modal header
            switches glyph based on the chosen type. (feedback polish R1) */}
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    </Tooltip>
  );
}
