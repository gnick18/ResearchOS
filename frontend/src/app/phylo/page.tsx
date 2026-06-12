"use client";

// The /phylo route (phylo Phase 0/1). A flagship-style tab like /chemistry and
// /datahub: one route with three in-page views (Hub, Tree Builder, Tree Studio),
// matching the approved mockup (docs/mockups/2026-06-12-phylogenetics-page.html).
// Gated by PHYLO_ENABLED; the nav entry is hidden when the flag is off (AppShell),
// and a direct visit shows a calm not-enabled notice rather than a broken page.
//
// Phase 1 ships the Hub + the Tree Builder (the recipe generator). The Tree
// Studio is a placeholder until its build lands. Design:
// docs/proposals/2026-06-12-phylogenetics-page.md.

import { useEffect, useState } from "react";

import AppShell from "@/components/AppShell";
import { PhyloHub, type PhyloView } from "@/components/phylo/PhyloHub";
import { PhyloBuilder } from "@/components/phylo/PhyloBuilder";
import { PhyloStudio } from "@/components/phylo/PhyloStudio";
import { PHYLO_ENABLED } from "@/lib/phylo/config";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";

export default function PhyloPage() {
  const [view, setView] = useState<PhyloView>("hub");

  // Demo sessions get to preview the page even when the production flag is off,
  // so the public demo can showcase it while real production users never see it.
  // The demo signal is client-only, so default prod-safe (not demo) and read it
  // after mount, holding a neutral frame until then so a demo session never
  // flashes the not-enabled notice. Same pattern as /chemistry.
  const [isDemo, setIsDemo] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setIsDemo(getDemoMode());
    setMounted(true);
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

  return (
    <AppShell>
      <div className="max-w-[1180px] mx-auto px-4 py-6">
        <div className="text-sm text-foreground-muted mb-1">Phylogenetics</div>
        <div className="inline-flex gap-0.5 p-0.5 border border-border rounded-xl bg-surface-raised mb-6">
          {(
            [
              ["hub", "Hub"],
              ["builder", "Tree Builder"],
              ["studio", "Tree Studio"],
            ] as [PhyloView, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-lg font-bold text-sm transition-colors ${
                view === v
                  ? "bg-accent-soft text-accent"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "hub" && <PhyloHub onNavigate={setView} />}
        {view === "builder" && <PhyloBuilder />}
        {view === "studio" && <PhyloStudio />}
      </div>
    </AppShell>
  );
}
