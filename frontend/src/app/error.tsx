"use client";

// Root segment error boundary (app-shell stability bot, 2026-06-12).
//
// Catches an error thrown while a PAGE renders, below the root layout (the
// layout itself is covered by global-error.tsx). Once a folder is connected the
// page bodies render (AppShell and the route, e.g. /datahub or /workbench), so a
// throw there lands here, inside the intact root layout, rather than blanking the
// whole app. It renders inside the live layout so the app CSS and tokens are
// available; a `reset()` re-renders the failed segment in place.
//
// Defense in depth alongside global-error.tsx. The dev-server crash this lane
// fixed lived in the root-layout subtree (the loading screen + the BeakerBot
// bridges Suspense), so global-error.tsx is the one that contains it; this one
// keeps an ordinary page-render error from taking the surface down.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error] page render failed:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="max-w-md text-center">
        <h1 className="text-heading font-semibold text-foreground">
          This page hit an error
        </h1>
        <p className="mt-2 text-body text-foreground-muted">
          Something went wrong loading this view. Your data lives on your own
          disk and is untouched. Try again, and if it keeps happening reload the
          page.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 rounded-lg bg-brand-action px-5 py-2.5 text-body font-semibold text-white transition-colors hover:bg-brand-action/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
