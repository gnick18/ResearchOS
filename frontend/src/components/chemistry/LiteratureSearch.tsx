"use client";

// The hub "Find in literature" mode (chemistry-workbench Phase 1). The first-class
// version of the editor rail's Papers tab: type a compound (or pick one from your
// library), see the papers and patents that mention it, fetched browser-direct
// from Europe PMC + PubChem. This is the headline differentiator, the free answer
// to the SciFinder feature chemists pay for.
//
// SureChEMBL substructure-to-patent search (draw a fragment, find patent compounds
// containing it) is the one capability PubChem lacks; it is a follow-up chunk.

import { useState } from "react";

import { Icon } from "@/components/icons";
import { MoleculeLiterature } from "./MoleculeLiterature";
import { SubstructurePatentSearch } from "./SubstructurePatentSearch";

const EXAMPLES = ["caffeine", "aspirin", "ibuprofen", "dopamine", "penicillin"];

export function LiteratureSearch() {
  const [input, setInput] = useState("");
  // The query actually searched (submitted), separate from the input being typed.
  const [submitted, setSubmitted] = useState<string | null>(null);

  const run = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setInput(trimmed);
    setSubmitted(trimmed);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-heading font-bold text-foreground">
          Find in literature
        </h2>
        <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 rounded-full px-2 py-0.5">
          Live data
        </span>
      </div>
      <p className="text-body text-foreground-muted mb-4 max-w-[760px]">
        Type a compound, see the papers and patents that mention it. Every result
        is fetched live, browser-direct, from Europe PMC (full-text mentions) and
        PubChem (curated links). No backend, no account.
      </p>

      <div className="flex gap-2 max-w-xl">
        <input
          data-testid="lit-search-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run(input);
          }}
          placeholder="Compound name, e.g. caffeine"
          className="flex-1 text-body text-foreground bg-surface-raised border border-border rounded-lg px-3 py-2 outline-none focus:border-brand-action"
        />
        <button
          type="button"
          data-testid="lit-search-submit"
          onClick={() => run(input)}
          disabled={!input.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-brand-action transition-colors hover:bg-brand-action/90 disabled:opacity-60"
        >
          <Icon name="search" className="w-4 h-4" />
          Find
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => run(ex)}
            className="text-meta font-semibold px-2.5 py-1 rounded-full bg-accent-soft text-brand-action border border-border hover:border-brand-action"
          >
            {ex}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {submitted ? (
          // The full Literature Explorer (filter rail + per-year histogram +
          // sortable list) IS the default view here, not a flat list behind a
          // "View all". Read-only stars since the hub free-search has no molecule.
          <MoleculeLiterature
            key={submitted}
            query={submitted}
            maxPapers={60}
            maxPatents={60}
            inlineExplorer
          />
        ) : (
          <p className="text-meta text-foreground-muted">
            Search a compound, or pick an example, to see its literature.
          </p>
        )}
      </div>

      <SubstructurePatentSearch />
    </div>
  );
}
