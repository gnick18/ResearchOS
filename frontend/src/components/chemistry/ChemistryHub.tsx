"use client";

// The /chemistry hub (chemistry-workbench Phase 1). Home for the molecule
// library, the same way SequencesLauncher is home for DNA/protein. Search +
// quick actions on top, then the library grid of RDKit-thumbnail cards. Wired to
// moleculesApi (the per-user molecules/ store); an empty library shows a calm
// first-run state, not a dead grid.
//
// The parent (app/chemistry/page.tsx) owns the editor popup, so the hub takes
// `onNewStructure` + `onOpenMolecule` callbacks rather than routing itself.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "@/components/icons";
import { moleculesApi, type Molecule } from "@/lib/chemistry/api";
import { projectsApi } from "@/lib/local-api";
import { MoleculeThumbnail } from "./MoleculeThumbnail";
import { LiteratureSearch } from "./LiteratureSearch";

type SortKey = "recent" | "name";
type HubMode = "library" | "literature";

export function ChemistryHub({
  onNewStructure,
  onOpenMolecule,
  onSearchPubchem,
  onImportFile,
}: {
  onNewStructure: () => void;
  onOpenMolecule: (id: string) => void;
  onSearchPubchem: () => void;
  onImportFile: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [mode, setMode] = useState<HubMode>("library");

  const {
    data: molecules = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["molecules"],
    queryFn: () => moleculesApi.list(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "for-chemistry"],
    queryFn: () => projectsApi.list(),
  });

  // project id (string) -> display name, so a card chip reads "Anti-inflammatory
  // screen", not a numeric id.
  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(String(p.id), p.name);
    return map;
  }, [projects]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? molecules.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            (m.formula ?? "").toLowerCase().includes(q) ||
            (m.smiles ?? "").toLowerCase().includes(q),
        )
      : molecules.slice();
    filtered.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : Number(b.id) - Number(a.id),
    );
    return filtered;
  }, [molecules, query, sort]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <p className="text-meta text-foreground-muted mb-1">Workbench / Chemistry</p>
      <h1 className="text-display font-bold text-foreground mb-1">Chemistry</h1>
      <p className="text-body text-foreground-muted mb-5 max-w-[760px]">
        Draw, store, and search chemical structures, the same way the Sequences
        workbench handles DNA and protein. Your library lives in your data folder,
        linked to projects. Nothing leaves your browser unless you search a public
        database (PubChem, Europe PMC, SureChEMBL), and then only the name or
        fragment you ask about.
      </p>

      {/* mode toggle: the library vs the literature companion */}
      <div className="inline-flex gap-1 mb-5 p-1 bg-surface-sunken border border-border rounded-lg">
        <ModeTab active={mode === "library"} onClick={() => setMode("library")}>
          Library
        </ModeTab>
        <ModeTab
          active={mode === "literature"}
          onClick={() => setMode("literature")}
        >
          Find in literature
        </ModeTab>
      </div>

      {mode === "literature" ? (
        <LiteratureSearch />
      ) : (
        <>
          {/* search + sort */}
      <div className="flex flex-wrap gap-2.5 mb-5">
        <div className="flex-1 min-w-[240px] flex items-center gap-2 bg-surface-raised border border-border rounded-xl px-3 py-2">
          <Icon name="search" className="w-4 h-4 text-foreground-muted flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, formula, or SMILES"
            className="w-full bg-transparent text-body text-foreground outline-none placeholder:text-foreground-muted"
          />
        </div>
        <button
          type="button"
          onClick={() => setSort((s) => (s === "recent" ? "name" : "recent"))}
          className="px-3 py-2 text-meta font-semibold text-foreground bg-surface-raised border border-border rounded-lg hover:bg-surface-sunken transition-colors"
        >
          Sort: {sort === "recent" ? "recent" : "name"}
        </button>
      </div>

      {/* action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-7">
        <ActionCard
          icon="pencil"
          tone="action"
          title="New structure"
          body="Open a blank canvas and draw a molecule."
          onClick={onNewStructure}
        />
        <ActionCard
          icon="search"
          tone="purple"
          title="Search PubChem"
          body="Pull any of 100M+ compounds with full metadata."
          onClick={onSearchPubchem}
        />
        <ActionCard
          icon="download"
          tone="green"
          title="Import file"
          body="Drop a .mol, .sdf, .smi, or .smiles file."
          onClick={onImportFile}
        />
      </div>

      {/* library */}
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-meta font-bold uppercase tracking-wide text-foreground-muted">
          Your library
        </span>
        <span className="text-meta font-semibold text-brand-action bg-accent-soft rounded-full px-2.5 py-0.5">
          {molecules.length}
        </span>
      </div>

      {isError ? (
        <p className="text-meta text-red-600 dark:text-red-300 py-8">
          Could not read your molecule library. Check that your data folder is
          connected and try again.
        </p>
      ) : isLoading ? (
        <p className="text-meta text-foreground-muted py-8">Loading your library…</p>
      ) : molecules.length === 0 ? (
        <EmptyLibrary onNewStructure={onNewStructure} />
      ) : shown.length === 0 ? (
        <p className="text-meta text-foreground-muted py-8">
          No molecules match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(208px,1fr))]">
          {shown.map((m) => (
            <MoleculeCard
              key={m.id}
              molecule={m}
              projectName={projectName}
              onClick={() => onOpenMolecule(m.id)}
            />
          ))}
        </div>
      )}
        </>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-meta font-semibold rounded-md transition-colors ${
        active
          ? "bg-surface-raised text-brand-action shadow-sm"
          : "text-foreground-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ActionCard({
  icon,
  tone,
  title,
  body,
  onClick,
  soon,
}: {
  icon: "pencil" | "search" | "download";
  tone: "action" | "purple" | "green";
  title: string;
  body: string;
  onClick?: () => void;
  soon?: boolean;
}) {
  const toneClass =
    tone === "action"
      ? "bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300"
      : tone === "purple"
        ? "bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300"
        : "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
  return (
    <button
      type="button"
      onClick={soon ? undefined : onClick}
      disabled={soon}
      className={`flex gap-3 items-start text-left bg-surface-raised border border-border rounded-xl p-4 shadow-sm transition-colors ${
        soon ? "opacity-60 cursor-default" : "cursor-pointer hover:border-action"
      }`}
    >
      <span
        className={`w-9 h-9 flex-shrink-0 rounded-lg grid place-items-center ${toneClass}`}
      >
        <Icon name={icon} className="w-5 h-5" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-body font-bold text-foreground">{title}</span>
          {soon ? (
            <span className="text-[10px] font-bold uppercase tracking-wide text-foreground-muted bg-surface-sunken rounded px-1.5 py-0.5">
              Soon
            </span>
          ) : null}
        </span>
        <span className="block text-meta text-foreground-muted leading-snug mt-0.5">
          {body}
        </span>
      </span>
    </button>
  );
}

function MoleculeCard({
  molecule,
  projectName,
  onClick,
}: {
  molecule: Molecule;
  projectName: Map<string, string>;
  onClick: () => void;
}) {
  const structure = molecule.smiles ?? "";
  const mw =
    molecule.mol_weight != null ? `${molecule.mol_weight.toFixed(2)} g/mol` : "";
  const metaLine = [molecule.formula, mw].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-surface-raised border border-border rounded-xl overflow-hidden shadow-sm transition-transform hover:-translate-y-0.5 hover:border-action"
    >
      <div className="h-[150px] bg-white grid place-items-center border-b border-border p-2">
        <MoleculeThumbnail structure={structure} className="max-w-full" />
      </div>
      <div className="px-3 py-3">
        <div className="text-body font-bold text-foreground mb-0.5 truncate">
          {molecule.name}
        </div>
        {metaLine ? (
          <div className="text-meta text-foreground-muted font-mono truncate">
            {metaLine}
          </div>
        ) : null}
        <div className="flex gap-1.5 flex-wrap mt-2">
          {molecule.project_ids.map((pid) => (
            <span
              key={pid}
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300"
            >
              {projectName.get(pid) ?? "Project"}
            </span>
          ))}
          {molecule.source ? (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
              {molecule.source}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function EmptyLibrary({ onNewStructure }: { onNewStructure: () => void }) {
  return (
    <div className="border border-dashed border-border rounded-xl bg-surface-raised px-6 py-12 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-accent-soft text-brand-action grid place-items-center">
        <Icon name="vial" className="w-6 h-6" />
      </div>
      <h3 className="text-title font-bold text-foreground mb-1">
        Your library is empty
      </h3>
      <p className="text-meta text-foreground-muted max-w-[420px] mx-auto mb-4">
        Draw your first structure and it lands here, with its formula and weight
        computed for you. Everything stays in your data folder.
      </p>
      <button
        type="button"
        onClick={onNewStructure}
        className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-gradient-to-br from-brand-action to-brand-purple"
      >
        <Icon name="pencil" className="w-4 h-4" />
        New structure
      </button>
    </div>
  );
}
