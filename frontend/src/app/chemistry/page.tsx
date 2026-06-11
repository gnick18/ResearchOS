"use client";

// The /chemistry route (chemistry-workbench Phase 1). A flagship-style hub like
// /sequences: the molecule library + quick actions, with the Ketcher structure
// editor opening in a popup over it. Gated by CHEMISTRY_ENABLED; the nav entry is
// hidden when the flag is off (AppShell), and a direct visit shows a calm
// not-enabled notice rather than a broken page.

import { useEffect, useState } from "react";

import AppShell from "@/components/AppShell";
import { ChemistryHub } from "@/components/chemistry/ChemistryHub";
import { MoleculeEditorPopup } from "@/components/chemistry/MoleculeEditorPopup";
import { PubChemImportDialog } from "@/components/chemistry/PubChemImportDialog";
import { ImportFileDialog } from "@/components/chemistry/ImportFileDialog";
import { CHEMISTRY_ENABLED } from "@/lib/chemistry/config";

export default function ChemistryPage() {
  // null = closed, "new" = blank canvas, a string id = edit that molecule.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pubchemOpen, setPubchemOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Deep link: /chemistry?molecule=<id> opens that molecule in the editor (used by
  // the project Molecules section + inline note chips). Read from the URL directly
  // (not useSearchParams) to avoid the Suspense/prerender boundary it requires, and
  // strip the param so a later close does not reopen on refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const molecule = params.get("molecule");
    if (molecule) {
      setEditing(molecule);
      params.delete("molecule");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    }
  }, []);

  if (!CHEMISTRY_ENABLED) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <h1 className="text-heading font-bold text-foreground mb-2">
            Chemistry is not enabled
          </h1>
          <p className="text-body text-foreground-muted">
            The chemistry workbench is an opt-in module. Turn it on in feature
            setup, or set NEXT_PUBLIC_CHEMISTRY_ENABLED to try it.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ChemistryHub
        onNewStructure={() => setEditing("new")}
        onOpenMolecule={(id) => setEditing(id)}
        onSearchPubchem={() => setPubchemOpen(true)}
        onImportFile={() => setImportOpen(true)}
      />
      <MoleculeEditorPopup
        moleculeId={editing}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
      <PubChemImportDialog
        open={pubchemOpen}
        onClose={() => setPubchemOpen(false)}
      />
      <ImportFileDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </AppShell>
  );
}
