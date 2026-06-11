"use client";

import Link from "@/components/FixtureLink";
import { useQuery } from "@tanstack/react-query";

import { moleculesApi, type Molecule } from "@/lib/chemistry/api";
import { MoleculeThumbnail } from "@/components/chemistry/MoleculeThumbnail";
import type { Project } from "@/lib/types";

interface MoleculesInventoryProps {
  project: Project;
}

// PRESENTATION-ONLY, mirrors SequencesInventory. Reads the chemistry arc's live
// `moleculesApi.listByProject` and renders the molecules linked to this project as
// a read-only list. It does NOT embed the Ketcher editor; each row deep-links to
// `/chemistry?molecule=<id>`, which auto-opens that molecule in the editor.
const CHEMISTRY_ROUTE = "/chemistry";

export default function MoleculesInventory({ project }: MoleculesInventoryProps) {
  // project.id is numeric; molecule project_ids are stringified ids (the locked
  // MoleculeMeta shape), so query by the string form.
  const { data: molecules = [], isLoading } = useQuery<Molecule[]>({
    queryKey: ["project-molecules", project.owner, project.id],
    queryFn: () => moleculesApi.listByProject(String(project.id), project.owner),
  });

  return (
    <section id="molecules" className="scroll-mt-32">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-title font-semibold text-foreground">Molecules</h2>
        <Link
          href={CHEMISTRY_ROUTE}
          className="text-meta text-foreground-muted hover:text-foreground hover:underline whitespace-nowrap"
        >
          Manage in the chemistry library →
        </Link>
      </div>

      {isLoading ? (
        <p className="text-body text-foreground-muted italic">Loading molecules…</p>
      ) : molecules.length === 0 ? (
        <p className="text-body text-foreground-muted italic">
          No molecules linked yet. Structures linked to this project in the
          chemistry library will appear here.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden bg-surface-raised">
          {molecules.map((mol) => {
            const mw =
              mol.mol_weight != null ? `${mol.mol_weight.toFixed(2)} g/mol` : "";
            const meta = [mol.formula, mw].filter(Boolean).join(" · ");
            return (
              <Link
                key={mol.id}
                href={`${CHEMISTRY_ROUTE}?molecule=${encodeURIComponent(mol.id)}`}
                className="px-3 py-2 flex items-center gap-3 hover:bg-surface-sunken transition-colors"
              >
                <span className="w-10 h-10 flex-shrink-0 bg-white rounded-md border border-border grid place-items-center overflow-hidden">
                  <MoleculeThumbnail
                    structure={mol.smiles ?? ""}
                    width={40}
                    height={40}
                  />
                </span>
                <span className="text-body font-medium text-foreground truncate flex-1 min-w-0">
                  {mol.name}
                </span>
                {meta ? (
                  <span className="text-meta text-foreground-muted font-mono flex-shrink-0">
                    {meta}
                  </span>
                ) : null}
                {mol.source ? (
                  <span className="text-meta px-2 py-0.5 bg-surface-sunken text-foreground-muted rounded-full flex-shrink-0">
                    {mol.source}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
