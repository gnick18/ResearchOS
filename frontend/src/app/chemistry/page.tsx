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
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";

export default function ChemistryPage() {
  // null = closed, "new" = blank canvas, a string id = edit that molecule.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pubchemOpen, setPubchemOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Demo sessions get to preview the workbench even when the production flag is
  // off, so the public demo can showcase it while real production users never
  // see it. The demo signal is client-only, so we default to the prod-safe
  // value (not demo) and read it after mount. `mounted` lets us hold a neutral
  // frame until then, so a demo session never flashes the not-enabled notice
  // before the real surface appears. Prod (flag off, not demo) still lands on
  // the not-enabled notice, just one mount frame later.
  const [isDemo, setIsDemo] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setIsDemo(getDemoMode());
    setMounted(true);
  }, []);
  const surfaceEnabled = CHEMISTRY_ENABLED || isDemo;

  // The /chemistry?molecule=<id> deep link (note chips, project Molecules rows) is
  // handled inside ChemistryHub, which selects that molecule in the rail rather
  // than opening the heavy editor.

  if (!surfaceEnabled) {
    // Before mount we cannot yet know whether this is a demo session (the demo
    // signal is client-only), so when the flag is off we hold a neutral frame
    // rather than flashing the not-enabled notice on demo entry.
    if (!mounted) {
      return <AppShell>{null}</AppShell>;
    }
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
