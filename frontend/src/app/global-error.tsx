"use client";

// Root global-error boundary (app-shell stability bot, 2026-06-12).
//
// This is the ONLY boundary App Router lets you place around the root layout
// itself. Everything user-facing renders inside the root layout (layout.tsx ->
// Providers -> AppContent), so an error thrown while the root layout subtree
// renders (the loading screen, the BeakerBot bridges Suspense, any provider) has
// no other boundary above it. Without this file that error escaped to Next 16's
// own top-level handler, which then read `.digest` off a thrown `undefined`
// (rapid navigation aborts an in-flight server render and the abort surfaces as a
// thrown undefined) and crashed the dev server outright, turning the route into a
// 500 and eventually refusing connections. A global-error boundary catches the
// throw here first, so it never reaches that broken handler.
//
// global-error REPLACES the root layout when it renders, so it must ship its own
// <html> and <body>. It also cannot assume the app's CSS, fonts, providers, or
// the <Icon> set loaded (the failure may be exactly that they did not), so it is
// deliberately self-contained with inline styles and plain text, no shared
// components, no SVG (which would also trip the icon-guard hook anyway).
//
// In development Next still shows its error overlay on top of this; that is
// expected. This boundary is what makes the same error recoverable in production
// and, just as importantly, contains the thrown-undefined so it can never crash
// the server-side handler.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real error to the console so it is still diagnosable even
    // though the boundary swallowed it for the UI. Guarded because the thrown
    // value can be a non-Error (the undefined-abort case), where reading fields
    // would otherwise be unsafe.
    console.error("[global-error] root layout render failed:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            maxWidth: "28rem",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "0.9375rem",
              lineHeight: 1.5,
              color: "#475569",
              margin: "0 0 1.5rem",
            }}
          >
            The workspace hit an unexpected error while loading. Your data is on
            your own disk and is untouched. Try again, and if it keeps happening
            reload the page.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              appearance: "none",
              border: "none",
              borderRadius: "0.625rem",
              padding: "0.625rem 1.25rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "#ffffff",
              background: "#2563eb",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
