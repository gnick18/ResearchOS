"use client";

import type { ComponentType, SVGProps } from "react";

/**
 * SequencesLauncher — the calm "workbench overview" shown in the right pane of
 * /sequences when no sequence is open. It replaces a bare empty state with a
 * scannable map of what the molecular-biology workbench can do, so the breadth
 * of the tooling is discoverable without a new top-level nav tab.
 *
 * Two groups:
 *  - ACTIONS YOU CAN TAKE NOW: clickable cards that reuse the page's existing
 *    header handlers (New / Assemble / Align / Import), passed in as props. This
 *    component owns no dialog logic; it is purely presentational.
 *  - AVAILABLE WHEN YOU OPEN A SEQUENCE: an informational hint list of the
 *    editor-internal tools (primers, restriction sites, feature detection,
 *    protein domains, properties, export) so users learn they exist.
 *
 * Inline stroke-only SVG icons (no emoji), site typography tokens
 * (text-title / text-body / text-meta), SnapGene-calm aesthetic.
 */

type IconProps = SVGProps<SVGSVGElement>;

function baseSvg(props: IconProps) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

/** Plus-in-document glyph for "New sequence". */
function NewIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="12" x2="12" y2="18" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

/** Plasmid built from arc fragments — matches the header AssembleIcon. */
function AssembleIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <circle cx="12" cy="12" r="8" strokeDasharray="12.5 4.25" />
    </svg>
  );
}

/** Two strands joined by dotted base-pair lines — matches the header AlignIcon. */
function AlignIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <line x1="8" y1="7" x2="8" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="12" y1="7" x2="12" y2="17" strokeDasharray="1.5 2.5" />
      <line x1="16" y1="7" x2="16" y2="17" strokeDasharray="1.5 2.5" />
    </svg>
  );
}

/** Tray with a downward arrow — matches the header ImportIcon spirit. */
function ImportIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="8 11 12 15 16 11" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

/** Cloud with a downward arrow for "Download from NCBI". Matches the header
 *  NcbiCloudIcon. */
function NcbiIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" />
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  );
}

/** Branching life-tree glyph for "Look up an organism" (taxonomy lineage). */
function TaxonomyIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <path d="M12 20.5V7" />
      <path d="M10.5 20.5h3" />
      <circle cx="12" cy="4.8" r="1.7" />
      <path d="M12 11 7.6 8.4" />
      <circle cx="6.2" cy="7.6" r="1.7" />
      <path d="M12 11 16.4 8.4" />
      <circle cx="17.8" cy="7.6" r="1.7" />
      <path d="M12 15 8 12.9" />
      <circle cx="6.6" cy="12.1" r="1.7" />
      <path d="M12 15 16 12.9" />
      <circle cx="17.4" cy="12.1" r="1.7" />
    </svg>
  );
}

/** A wider branching tree for "Explore the tree of life" (walk up and down). */
function ExploreTreeIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <circle cx="12" cy="4" r="2" />
      <circle cx="5" cy="13" r="2" />
      <circle cx="12" cy="13" r="2" />
      <circle cx="19" cy="13" r="2" />
      <circle cx="12" cy="20" r="2" />
      <path d="M12 6v5M12 15v3M10.5 11.5 6.3 12M13.5 11.5 17.7 12" />
    </svg>
  );
}

/** Primer / Tm glyph: a short primer annealed to a template strand. */
function PrimerIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="7" y1="9" x2="15" y2="9" />
      <polyline points="13 7 15 9 13 11" />
    </svg>
  );
}

/** Restriction-site glyph: a strand with a scissor-cut notch. */
function ScissorsIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <line x1="8" y1="7.5" x2="20" y2="16.5" />
      <line x1="8" y1="16.5" x2="20" y2="7.5" />
    </svg>
  );
}

/** Feature-detect glyph: a magnifier over a strand. */
function DetectIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** Protein-domain glyph: a chain of linked beads (a domain architecture). */
function DomainIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <line x1="8.5" y1="12" x2="15.5" y2="12" />
    </svg>
  );
}

/** Protein-properties glyph: a simple gauge / readout. */
function PropertiesIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <line x1="4" y1="20" x2="4" y2="4" />
      <line x1="4" y1="20" x2="20" y2="20" />
      <polyline points="7 14 11 10 14 13 19 7" />
    </svg>
  );
}

/** Export glyph: a document with an up/out arrow. */
function ExportIcon(props: IconProps) {
  return (
    <svg {...baseSvg(props)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
      <line x1="16" y1="3" x2="21" y2="3" />
      <line x1="21" y1="3" x2="21" y2="8" />
      <line x1="13" y1="11" x2="21" y2="3" />
    </svg>
  );
}

type ActionCard = {
  key: string;
  title: string;
  description: string;
  Icon: ComponentType<IconProps>;
  onClick: () => void;
};

type HintItem = {
  key: string;
  title: string;
  description: string;
  Icon: ComponentType<IconProps>;
};

export interface SequencesLauncherProps {
  /** Open the New-sequence dialog (the header New button's handler). */
  onNew: () => void;
  /** Open the cloning workspace (the header Assemble button's handler). */
  onAssemble: () => void;
  /** Open the align / compare dialog (the header Align button's handler). */
  onAlign: () => void;
  /** Start the import flow (the header Import action's handler). */
  onImport: () => void;
  /** Open the "Download from NCBI" dialog (the header NCBI action's handler). */
  onNcbi: () => void;
  /** Open the standalone "look up an organism" taxonomy tool. */
  onLookupTaxonomy: () => void;
  /** Open the interactive taxonomy tree explorer. */
  onExploreTaxonomy: () => void;
}

export default function SequencesLauncher({
  onNew,
  onAssemble,
  onAlign,
  onImport,
  onNcbi,
  onLookupTaxonomy,
  onExploreTaxonomy,
}: SequencesLauncherProps) {
  const actions: ActionCard[] = [
    {
      key: "new",
      title: "New sequence",
      description: "Start a blank DNA, RNA, or protein sequence to edit.",
      Icon: NewIcon,
      onClick: onNew,
    },
    {
      key: "assemble",
      title: "Assemble a construct",
      description: "Combine fragments by Gibson, restriction, Golden Gate, or Gateway.",
      Icon: AssembleIcon,
      onClick: onAssemble,
    },
    {
      key: "align",
      title: "Align two sequences",
      description: "See percent identity, mismatches, gaps, and a dotplot.",
      Icon: AlignIcon,
      onClick: onAlign,
    },
    {
      key: "import",
      title: "Import files",
      description: "Bring in GenBank, FASTA, or a SnapGene collection.",
      Icon: ImportIcon,
      onClick: onImport,
    },
    {
      key: "ncbi",
      title: "Download from NCBI",
      description: "Pull a gene or genome from NCBI straight into your collection.",
      Icon: NcbiIcon,
      onClick: onNcbi,
    },
    {
      key: "taxonomy",
      title: "Look up an organism",
      description: "See an organism's taxonomy lineage from NCBI by name or tax id.",
      Icon: TaxonomyIcon,
      onClick: onLookupTaxonomy,
    },
    {
      key: "explore-tree",
      title: "Explore the tree of life",
      description: "Walk up and down the taxonomy to see related organisms.",
      Icon: ExploreTreeIcon,
      onClick: onExploreTaxonomy,
    },
  ];

  const hints: HintItem[] = [
    {
      key: "primers",
      title: "Design primers",
      description: "Pick primers, check Tm, and screen specificity.",
      Icon: PrimerIcon,
    },
    {
      key: "restriction",
      title: "Find restriction sites",
      description: "Map enzyme cut sites and plan a digest.",
      Icon: ScissorsIcon,
    },
    {
      key: "detect",
      title: "Detect features",
      description: "Annotate from a reference sequence automatically.",
      Icon: DetectIcon,
    },
    {
      key: "domains",
      title: "Annotate protein domains",
      description: "Find domains across a CDS translation.",
      Icon: DomainIcon,
    },
    {
      key: "properties",
      title: "Inspect protein properties",
      description: "Read length, mass, pI, and composition.",
      Icon: PropertiesIcon,
    },
    {
      key: "export",
      title: "Export your work",
      description: "Save to GenBank, FASTA, or an image.",
      Icon: ExportIcon,
    },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* Group 1: actions the user can take right now. */}
        <div>
          <h3 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
            Actions you can take now
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {actions.map(({ key, title, description, Icon, onClick }) => (
              <button
                key={key}
                type="button"
                onClick={onClick}
                className="group flex items-start gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3.5 text-left transition-colors hover:border-sky-300 hover:bg-sky-50/60 dark:hover:bg-sky-500/15 focus:outline-none focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-200"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sky-50 dark:bg-sky-500/15 text-sky-600 dark:text-sky-300 transition-colors group-hover:bg-sky-100 dark:group-hover:bg-sky-500/20">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-body font-medium text-foreground">
                    {title}
                  </span>
                  <span className="mt-0.5 block text-meta leading-relaxed text-foreground-muted">
                    {description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Group 2: informational — the editor-internal tools. NOT clickable;
            a calm hint list so users learn these exist before opening a
            sequence. */}
        <div className="mt-8">
          <h3 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
            Available when you open a sequence
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {hints.map(({ key, title, description, Icon }) => (
              <div key={key} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-foreground-muted">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-meta font-medium text-foreground">
                    {title}
                  </span>
                  <span className="mt-0.5 block text-meta leading-relaxed text-foreground-muted">
                    {description}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-5 text-meta leading-relaxed text-foreground-muted">
            Select a sequence from the library to open the editor and these tools.
          </p>
        </div>
      </div>
    </div>
  );
}
