// sequence editor master. The VERIFIED ICON REGISTRY.
//
// Every user-facing icon on ResearchOS is a custom inline SVG (the house rule:
// no icon library). Icons drifted across ~237 files; we unified them onto a
// canonical set, and this registry locks that set in. It is the single source
// of truth for icons (the icon equivalent of brand/), rendered through the
// <Icon name="..." /> component.
//
// Each entry's `body` is the verbatim inner SVG markup lifted from the now
// canonical sources (SequenceEditView, SequenceTabBar, SequenceDisplayStrip,
// sequences/page, SequenceLineageFooter, SequenceOperationsRail). Do NOT invent
// new glyphs here. Adding a new icon is a VERIFIED ASSET change that requires
// Grant's explicit sign-off (see AGENTS.md "Icons are a verified library").
//
// The default wrapper (see Icon.tsx) supplies:
//   fill="none" stroke="currentColor" strokeWidth={2}
//   strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
// Children that need their own stroke / fill (the NCBI badge, the AGC letters)
// carry those attrs themselves and override the wrapper, which is fine.

import type { ReactNode } from "react";

export interface IconEntry {
  /** Human concept label, used for catalog grouping and documentation. */
  concept: string;
  /** The inner SVG elements (paths / circles / lines / text). */
  body: ReactNode;
  /** Override the default "0 0 24 24" viewBox if a glyph needs it. */
  viewBox?: string;
}

// The raw registry. `satisfies` validates each entry's shape while keeping the
// literal keys for IconName. ICONS (below) re-exposes it with the full
// IconEntry value type so consumers see the optional `viewBox`.
const ICONS_RAW = {
  // ── Operations rail (SequenceEditView RailIcons) ─────────────────────────
  primers: {
    concept: "Primers",
    body: (
      <>
        <line x1="3" y1="17" x2="21" y2="17" />
        <path d="M6 11h9l-2.5-2.5M6 11l2.5 2.5" />
      </>
    ),
  },
  cloning: {
    concept: "Cloning",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 1 6.9 4" strokeWidth="4" />
      </>
    ),
  },
  cut: {
    concept: "Cut / digest",
    body: (
      <>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <path d="M8 7l12 9M8 17L20 8" />
      </>
    ),
  },
  annotate: {
    concept: "Annotate",
    body: (
      <>
        <path d="M4 20 13.5 10.5" />
        <path d="M16 3.5l1.3 2.7 2.9 1.3-2.9 1.3L16 11.5l-1.3-2.7L11.8 7.5l2.9-1.3z" />
        <path d="M6 5l.6 1.4L8 7l-1.4.6L6 9l-.6-1.4L4 7l1.4-.6z" />
      </>
    ),
  },
  align: {
    concept: "Align",
    body: (
      <>
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="17" x2="20" y2="17" />
        <line x1="8" y1="7" x2="8" y2="17" strokeDasharray="1.5 2.5" />
        <line x1="12" y1="7" x2="12" y2="17" strokeDasharray="1.5 2.5" />
        <line x1="16" y1="7" x2="16" y2="17" strokeDasharray="1.5 2.5" />
      </>
    ),
  },
  protein: {
    concept: "Protein",
    body: (
      <>
        <path d="M4.5 13 8 8.5 12 12.5 16 8.5 19.5 13" strokeWidth="1.6" />
        <circle cx="4.5" cy="13" r="1.8" />
        <circle cx="8" cy="8.5" r="1.8" />
        <circle cx="12" cy="12.5" r="1.8" />
        <circle cx="16" cy="8.5" r="1.8" />
        <circle cx="19.5" cy="13" r="1.8" />
      </>
    ),
  },
  tree: {
    concept: "Tree",
    body: (
      <>
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
      </>
    ),
  },
  export: {
    concept: "Export",
    body: (
      <>
        <path d="M12 4v10M8 10l4 4 4-4" />
        <path d="M5 19h14" />
      </>
    ),
  },
  more: {
    concept: "More",
    body: (
      <>
        <circle cx="5" cy="12" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="19" cy="12" r="1.4" />
      </>
    ),
  },

  // ── Action glyphs (SequenceEditView ActionGlyphs) ────────────────────────
  plus: {
    concept: "Plus / new",
    body: <path d="M12 5v14M5 12h14" />,
  },
  list: {
    concept: "List",
    body: <path d="M4 7h16M4 12h16M4 17h10" />,
  },
  layer: {
    concept: "Layer / target",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
  },
  check: {
    concept: "Check",
    body: <path d="M4 12l5 5L20 6" />,
  },
  refresh: {
    concept: "Refresh",
    body: (
      <>
        <path d="M4 12a8 8 0 0 1 13.5-5.5L20 9" />
        <path d="M20 4v5h-5" />
        <path d="M20 12a8 8 0 0 1-13.5 5.5L4 15" />
        <path d="M4 20v-5h5" />
      </>
    ),
  },
  search: {
    concept: "Search",
    body: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
  },
  download: {
    concept: "Download",
    body: (
      <>
        <path d="M12 4v10M8 10l4 4 4-4" />
        <path d="M5 19h14" />
      </>
    ),
  },
  copy: {
    concept: "Copy",
    body: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </>
    ),
  },
  paste: {
    concept: "Paste",
    body: (
      <>
        <path d="M9 4h6v3H9zM7 5H5v15h14V5h-2" />
        <path d="M12 10v6M9 13l3 3 3-3" />
      </>
    ),
  },
  pencil: {
    concept: "Edit / pencil",
    body: (
      <>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
      </>
    ),
  },

  // ── Editor toolbar (SequenceEditView IconUndo/Redo/Save/Cut/PasteTool) ───
  undo: {
    concept: "Undo",
    body: (
      <>
        <path d="M9 14L4 9l5-5" />
        <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
      </>
    ),
  },
  redo: {
    concept: "Redo",
    body: (
      <>
        <path d="M15 14l5-5-5-5" />
        <path d="M20 9H9a5 5 0 0 0 0 10h1" />
      </>
    ),
  },
  save: {
    concept: "Save",
    body: (
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </>
    ),
  },

  // ── Tab bar (SequenceTabBar) ─────────────────────────────────────────────
  map: {
    concept: "Map / plasmid",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4v3M20 12h-3M12 20v-3M4 12h3" />
      </>
    ),
  },
  sequence: {
    concept: "Sequence",
    body: (
      <>
        <text
          x="12"
          y="13"
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="800"
          letterSpacing="1"
          fill="currentColor"
          fontFamily="ui-monospace, Menlo, monospace"
        >
          AGC
        </text>
        <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  features: {
    concept: "Features / tag",
    body: (
      <>
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </>
    ),
  },
  history: {
    concept: "History / clock",
    body: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 4v4h4" />
        <path d="M12 8v4l3 2" />
      </>
    ),
  },

  // ── Display strip toggles (SequenceDisplayStrip) ─────────────────────────
  eye: {
    concept: "Eye / show",
    body: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  eyeOff: {
    concept: "Eye off / hide",
    body: (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </>
    ),
  },
  caret: {
    concept: "Caret / disclosure",
    body: <polyline points="6 9 12 15 18 9" />,
  },
  translation: {
    concept: "Translation",
    body: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 15l1.8-5 1.8 5" />
        <path d="M7.4 13.4h2.8" />
        <path d="M14 15l1.8-5 1.8 5" />
        <path d="M14.4 13.4h2.8" />
      </>
    ),
  },
  orfs: {
    concept: "ORFs",
    body: (
      <>
        <path d="M3 8h10l-3-3M3 8l3 3" />
        <path d="M21 16H11l3 3M21 16l-3-3" />
      </>
    ),
  },
  ruler: {
    concept: "Ruler",
    body: (
      <>
        <rect x="2" y="9" width="20" height="6" rx="1" />
        <line x1="6" y1="9" x2="6" y2="12" />
        <line x1="10" y1="9" x2="10" y2="12" />
        <line x1="14" y1="9" x2="14" y2="12" />
        <line x1="18" y1="9" x2="18" y2="12" />
      </>
    ),
  },
  wrapped: {
    concept: "Wrapped layout",
    body: (
      <>
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="14" y2="17" />
      </>
    ),
  },
  singleLine: {
    concept: "Single-line layout",
    body: (
      <>
        <line x1="3" y1="8" x2="21" y2="8" />
        <polyline points="6 14 3 17 6 20" />
        <polyline points="18 14 21 17 18 20" />
        <line x1="3" y1="17" x2="21" y2="17" />
      </>
    ),
  },

  // ── Sequences list page (sequences/page) ─────────────────────────────────
  moleculeCircular: {
    concept: "Molecule (circular)",
    body: <circle cx="12" cy="12" r="8" />,
  },
  moleculeLinear: {
    concept: "Molecule (linear)",
    body: <line x1="4" y1="12" x2="20" y2="12" />,
  },
  focus: {
    concept: "Focus mode",
    body: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
      />
    ),
  },
  share: {
    concept: "Share",
    body: (
      <>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
        <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
      </>
    ),
  },
  import: {
    concept: "Import / upload",
    body: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 9 12 4 17 9" />
        <line x1="12" y1="4" x2="12" y2="16" />
      </>
    ),
  },
  assemble: {
    concept: "Assemble",
    body: <circle cx="12" cy="12" r="8" strokeDasharray="12.5 4.25" />,
  },
  ncbi: {
    concept: "NCBI download",
    body: (
      <>
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" />
          <polyline points="8 17 12 21 16 17" />
          <line x1="12" y1="12" x2="12" y2="21" />
        </g>
        <g>
          <rect x="13" y="2.5" width="9.5" height="6" rx="1.5" fill="#20558a" />
          <text
            x="17.75"
            y="7"
            textAnchor="middle"
            fontSize="3.6"
            fontWeight="800"
            fill="#fff"
            fontFamily="Arial, sans-serif"
          >
            NCBI
          </text>
        </g>
      </>
    ),
  },
  chevronDown: {
    concept: "Chevron down",
    body: <polyline points="6 9 12 15 18 9" />,
  },
  folder: {
    concept: "Folder",
    body: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  },
  file: {
    concept: "File",
    body: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </>
    ),
  },
  trash: {
    concept: "Trash / delete",
    body: (
      <>
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </>
    ),
  },

  // ── Close (SequenceOperationsRail inspector close) ───────────────────────
  close: {
    concept: "Close",
    body: <path d="M6 6l12 12M18 6L6 18" />,
  },

  // ── Notebooks (Notes-tab rail + dialogs, notebooks-gen Phase 2) ──────────
  book: {
    concept: "Notebook",
    body: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </>
    ),
  },
  users: {
    concept: "Shared / members",
    body: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
  userPlus: {
    concept: "Add a member",
    body: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </>
    ),
  },

  // ── Vial / reagent (Inventory tab, chunk-5 bot 2026-06-07) ──────────────
  // Standard lab-ware silhouette: a narrow cylinder with a rounded bottom.
  // Consistent 2-px stroke, strokeLinecap round, viewBox 0 0 24 24.
  vial: {
    concept: "Vial / reagent",
    body: (
      <>
        <line x1="9" y1="3" x2="15" y2="3" />
        <path d="M9 3v8L5 19a2 2 0 0 0 1.8 2.8h10.4A2 2 0 0 0 19 19l-4-8V3" />
        <line x1="6.4" y1="14" x2="17.6" y2="14" />
      </>
    ),
  },
} satisfies Record<string, IconEntry>;

export type IconName = keyof typeof ICONS_RAW;

export const ICONS: Record<IconName, IconEntry> = ICONS_RAW;
