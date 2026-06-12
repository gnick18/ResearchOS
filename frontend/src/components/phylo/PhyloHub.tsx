"use client";

// The Phylogenetics hub (phylo Phase 1). The landing for the /phylo tab: two
// entry cards (Build a tree, Open the studio) and a per-project library of saved
// trees, mirroring the Chemistry and Sequences hubs. Matches the approved mockup
// (docs/mockups/2026-06-12-phylogenetics-page.html).

import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import { phyloApi } from "@/lib/phylo/api";

export type PhyloView = "hub" | "builder" | "studio";

export function PhyloHub({
  onNavigate,
}: {
  onNavigate: (view: PhyloView) => void;
}) {
  const { data: trees = [] } = useQuery({
    queryKey: ["phylo", "list"],
    queryFn: () => phyloApi.list(),
  });

  return (
    <div>
      <div className="flex items-end gap-3 mb-5">
        <Icon name="tree" className="w-9 h-9 text-brand-sky" />
        <div>
          <h1 className="text-heading font-extrabold text-foreground">
            Phylogenetics
          </h1>
          <p className="text-body text-foreground-muted">
            Generate the exact tree-building scripts, then turn the finished tree
            into a publication figure. Nothing runs on our servers.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EntryCard
          icon="align"
          title="Build a tree"
          body="A wizard that writes the recipe. Pick your data and the steps, get the exact MAFFT, trimAl, IQ-TREE commands plus an install guide for your machine. Or describe it to BeakerBot in plain language."
          tag="Generates scripts, never runs them"
          onClick={() => onNavigate("builder")}
        />
        <EntryCard
          icon="chart"
          title="Open the studio"
          body="Bring a finished tree, link a metadata table, auto-annotate, and edit the figure right here. Export SVG and PNG, plus the ggtree code that recreates it."
          tag="The iTOL alternative"
          onClick={() => onNavigate("studio")}
        />
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-bold text-foreground mb-2">Your trees</h3>
        {trees.length === 0 ? (
          <div className="border border-dashed border-border rounded-xl p-8 text-center text-foreground-muted text-sm">
            No saved trees yet. Open the studio to import a tree, or build one
            first.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {trees.map((t) => (
              <button
                key={t.id}
                onClick={() => onNavigate("studio")}
                className="text-left border border-border rounded-xl p-3 bg-surface-raised hover:border-accent transition-colors"
              >
                <div className="h-20 rounded-lg bg-surface border border-border grid place-items-center mb-2">
                  <Icon name="tree" className="w-8 h-8 text-foreground-muted" />
                </div>
                <div className="font-semibold text-foreground text-sm truncate">
                  {t.name}
                </div>
                <div className="text-xs text-foreground-muted">
                  {t.tip_count ?? "?"} tips
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EntryCard({
  icon,
  title,
  body,
  tag,
  onClick,
}: {
  icon: IconName;
  title: string;
  body: string;
  tag: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left flex gap-3.5 items-start border border-border rounded-2xl p-4 bg-surface-raised hover:-translate-y-0.5 hover:border-accent transition-all"
    >
      <span className="w-11 h-11 rounded-xl grid place-items-center bg-accent-soft text-accent shrink-0">
        <Icon name={icon} className="w-6 h-6" />
      </span>
      <span className="block">
        <span className="block text-title font-extrabold text-foreground">
          {title}
        </span>
        <span className="block text-sm text-foreground-muted mt-0.5">
          {body}
        </span>
        <span className="inline-block mt-2 text-xs font-bold px-2 py-0.5 rounded-full bg-accent-soft text-accent">
          {tag}
        </span>
      </span>
    </button>
  );
}
