"use client";

// The Phylogenetics hub (phylo Phase 1). The landing for the /phylo tab: two
// entry cards (Build a tree, Open the studio). The saved-trees library moved into
// the Tree Studio's collection rail (phylo v3, 2026-06-13), so it lives in exactly
// one place and the Hub is a pure launcher.

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";

export type PhyloView = "hub" | "builder" | "studio";

export function PhyloHub({
  onNavigate,
}: {
  onNavigate: (view: PhyloView) => void;
}) {
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
