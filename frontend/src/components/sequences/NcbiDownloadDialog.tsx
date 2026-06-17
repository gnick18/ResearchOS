"use client";

// sequences / ncbi-wizard. "Download from NCBI" dialog shell.
//
// This used to be a typed three-tab form (Gene / Genome / Accession). It is now
// a thin shell around the GUIDED flow (GuidedNcbiImport): type an organism, pick
// the reference genome, browse contigs, search a gene by name, grab a window
// around it, import only that slice. An accession escape hatch on the first step
// keeps the fast path for people who already know what they want, and each step
// keeps a whole-genome / whole-chromosome option (NB-1 / NB-3).
//
// The shell owns the LivingPopup chrome and the close behavior; the wizard owns
// the flow and the network calls. The external API (open / onClose / onImported
// / prefill) is unchanged, so the page mount and its existing persistNew import
// path keep working untouched.
//
// PRIVACY. There is no consent gate. The only thing sent out is the public
// identifier the user typed (an organism name, a gene name, or an accession) to
// a public government API, and we receive a public sequence.
//
// House rules: icons via <Icon> (no inline svg), <Tooltip> for icon-only
// controls. No em-dash, no emoji, no mid-sentence colon.

import { useCallback } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import GuidedNcbiImport from "@/components/sequences/GuidedNcbiImport";
import type { NcbiImportedSequence } from "@/lib/sequences/ncbi-import";

/** Optional prefill applied when the dialog opens, so a cross-link (e.g. the
 *  taxonomy tree explorer's import jump on a species node) seeds the wizard with
 *  the organism or an accession. The legacy `tab` / `geneSymbol` fields are kept
 *  in the type for source compatibility with existing callers but no longer
 *  steer a tab (there are no tabs); only `organism` and `accession` seed the
 *  guided flow. */
export interface NcbiDownloadPrefill {
  /** Legacy, ignored by the guided flow (kept so old call sites still type). */
  tab?: "gene" | "genome" | "accession";
  /** Seed the organism step. */
  organism?: string;
  /** Legacy, ignored by the guided flow. */
  geneSymbol?: string;
  /** Seed (and open) the accession escape hatch. */
  accession?: string;
}

export interface NcbiDownloadDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the parsed, provenance-tagged sequences on a successful
   *  import. The page persists them via its existing persistNew path. */
  onImported: (sequences: NcbiImportedSequence[]) => void | Promise<void>;
  /** Optional one-shot prefill applied when the dialog opens. */
  prefill?: NcbiDownloadPrefill;
}

export default function NcbiDownloadDialog({
  open,
  onClose,
  onImported,
  prefill,
}: NcbiDownloadDialogProps) {
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <LivingPopup
      open
      onClose={handleClose}
      label="Download from NCBI"
      selfSize
      showClose={false}
    >
      <div
        className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-raised ros-popup-card-shadow"
        data-testid="ncbi-download-dialog"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <Icon name="download" className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">Download from NCBI</h2>
            <p className="text-meta text-foreground-muted">
              Live, browser-direct, no account. Only the identifier you type is sent to NCBI, a public government database.
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        {/* The guided flow. Keyed on open so a fresh open resets the wizard. */}
        <GuidedNcbiImport
          key={open ? "open" : "closed"}
          onImported={onImported}
          onClose={handleClose}
          initialOrganism={prefill?.organism}
          initialAccession={prefill?.accession}
        />
      </div>
    </LivingPopup>
  );
}
