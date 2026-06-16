"use client";

// Data Hub segment error boundary (app-shell stability bot, 2026-06-12).
//
// Data Hub is the route BeakerBot drives hardest (it stores an analysis, then
// soft-navigates to /datahub?doc=...&analysis=... to land the user on the
// result). A throw while the Data Hub page renders is caught here, inside the
// intact app shell, so the rail and the rest of the workspace stay up and the
// user can retry the view rather than losing the whole surface. `reset()`
// re-renders the route in place.
//
// This sits below the root layout, so it does not catch a root-layout / provider
// throw (global-error.tsx owns that). It is the route-flavored sibling of the
// root error.tsx, kept here because Data Hub is the highest-traffic agent target.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useEffect } from "react";

export default function DataHubError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[datahub-error] Data Hub render failed:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="max-w-md text-center">
        <h1 className="text-heading font-semibold text-foreground">
          Data Hub hit an error
        </h1>
        <p className="mt-2 text-body text-foreground-muted">
          This analysis view could not render. Your tables and results live on
          your own disk and are untouched. Try again, and if it keeps happening
          reload the page.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="ros-btn-raise mt-6 rounded-lg bg-brand-action px-5 py-2.5 text-body font-semibold text-white transition-colors hover:bg-brand-action/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
