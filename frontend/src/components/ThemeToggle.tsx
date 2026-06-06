"use client";

// Dark-mode toggle button (POC). A quick light <-> dark flip for the app
// header; the full light / dark / system choice will live in Settings.
// Inline SVG icons (no emoji, per the UI convention). Styled to match the
// other header icon buttons (p-1.5 rounded-full, neutral until hover).

import Tooltip from "@/components/Tooltip";
import { useTheme } from "@/lib/theme/use-theme";

export default function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const isDark = resolved === "dark";
  const next = isDark ? "light" : "dark";

  return (
    <Tooltip label={isDark ? "Switch to light" : "Switch to dark"} placement="bottom">
      <button
        type="button"
        onClick={() => setTheme(next)}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        data-testid="theme-toggle"
        className="p-1.5 rounded-full text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
      >
        {isDark ? (
          // Sun
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        ) : (
          // Moon
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
        )}
      </button>
    </Tooltip>
  );
}
