"use client";

import HomePage from "../page";

/**
 * Public in-browser demo entry point.
 *
 * `FileSystemProvider` keys off `getDemoMode()` (which checks
 * `window.location.pathname === "/demo"`) to install the in-memory
 * fixture and sign the visitor in as `alex` — so by the time this
 * component mounts, the app is already wired up to seeded demo data.
 *
 * We render the home page directly so `/demo` shows the project
 * dashboard. The URL stays `/demo` (good for sharing/bookmarks) and
 * clicking any nav link from inside the demo navigates normally. Edits
 * are ephemeral: they live in the in-memory fixture maps and disappear
 * on reload. The "Leave Demo" affordance in `<DemoLabBanner>` offers a
 * one-click export-as-ZIP before clearing.
 */
export default function DemoPage() {
  return <HomePage />;
}
