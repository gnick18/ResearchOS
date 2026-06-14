"use client";

// The /phylo route. A full-screen Tree Studio (phylo v3 unified layout, Grant
// 2026-06-13): the shared split shell + collection rail, like /sequences and
// /datahub, with no in-page header (the global left nav already marks the page).
// The Tree Builder recipe wizard opens from the rail's "Build a tree" button as
// an overlay; the old Hub launcher is retired (trees live only in the rail).
// Gated by PHYLO_ENABLED; the nav entry is hidden when the flag is off
// (AppShell), and a direct visit shows a calm not-enabled notice rather than a
// broken page. Design: docs/proposals/2026-06-12-phylogenetics-page.md.

import { useEffect, useState } from "react";

import AppShell from "@/components/AppShell";
import { PhyloStudio } from "@/components/phylo/PhyloStudio";
import { PHYLO_ENABLED } from "@/lib/phylo/config";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";

export default function PhyloPage() {
  // Demo sessions get to preview the page even when the production flag is off,
  // so the public demo can showcase it while real production users never see it.
  // The demo signal is client-only, so default prod-safe (not demo) and read it
  // after mount, holding a neutral frame until then so a demo session never
  // flashes the not-enabled notice. Same pattern as /chemistry.
  const [isDemo, setIsDemo] = useState(false);
  const [mounted, setMounted] = useState(false);
  // A `?doc=<id>` deep link (the form a phylo object reference / embed builds via
  // objectDeepLink("phylo", ...)) opens that tree in the Tree Studio. Read
  // client-side after mount, like the demo signal, so the static export never
  // trips on useSearchParams. Captured once into state and handed to the Studio.
  const [docId, setDocId] = useState<string | null>(null);
  useEffect(() => {
    setIsDemo(getDemoMode());
    setMounted(true);
    if (typeof window !== "undefined") {
      const doc = new URLSearchParams(window.location.search).get("doc");
      if (doc) setDocId(doc);
    }
  }, []);
  const surfaceEnabled = PHYLO_ENABLED || isDemo;

  if (!surfaceEnabled) {
    if (!mounted) {
      return <AppShell>{null}</AppShell>;
    }
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <h1 className="text-heading font-bold text-foreground mb-2">
            Phylogenetics is not enabled
          </h1>
          <p className="text-body text-foreground-muted">
            The phylogenetics page is an opt-in module. Turn it on in feature
            setup, or set NEXT_PUBLIC_PHYLO_ENABLED to try it.
          </p>
        </div>
      </AppShell>
    );
  }

  // The Studio fills the full main height (its split shell + rail need a height
  // context), so it gets a flex column with no fixed header above it.
  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <PhyloStudio initialTreeId={docId ?? undefined} />
        </div>
      </div>
    </AppShell>
  );
}
