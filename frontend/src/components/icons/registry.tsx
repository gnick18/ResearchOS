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
// ONE GLYPH PER MEANING (Grant, 2026-06-12). This registry dedupes the
// genuinely SAME concept, it does NOT license reusing a glyph for a different
// meaning that happens to share a word. Before reusing an existing `name`,
// read its `concept` below and confirm it matches what your button actually
// MEANS, not just the noun. If the meaning differs, the right move is a NEW
// entry (Grant signs off), never overloading a same-word glyph. Each `concept`
// string is the contract for that glyph, keep it specific so the next person
// can tell whether their use fits. (This rule exists because the `tree` glyph
// drifted into the lab mentorship hierarchy, inventory storage nesting, and
// unrelated "Results" headers all at once before it was split.)
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
    concept: "Phylogenetic tree (rooted cladogram, branches to tips)",
    body: (
      <>
        <path d="M3 12H6" />
        <path d="M6 6V16" />
        <path d="M6 6H13" />
        <path d="M6 16H10" />
        <path d="M10 12V20" />
        <path d="M10 12H13" />
        <path d="M10 20H13" />
        <circle cx="14.5" cy="6" r="1.5" />
        <circle cx="14.5" cy="12" r="1.5" />
        <circle cx="14.5" cy="20" r="1.5" />
      </>
    ),
  },
  labTree: {
    concept: "Lab / mentorship hierarchy (people who mentor whom)",
    body: (
      <>
        <circle cx="12" cy="4" r="1.8" />
        <path d="M9.4 8.6a2.6 2.6 0 0 1 5.2 0" />
        <circle cx="6" cy="15.5" r="1.8" />
        <path d="M3.8 19.6a2.2 2.2 0 0 1 4.4 0" />
        <circle cx="18" cy="15.5" r="1.8" />
        <path d="M15.8 19.6a2.2 2.2 0 0 1 4.4 0" />
        <path d="M12 8.6V11" />
        <path d="M6 11h12" />
        <path d="M6 11v2.7" />
        <path d="M18 11v2.7" />
      </>
    ),
  },
  storageNested: {
    concept: "Inventory storage location (containers nested within a container)",
    body: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <rect x="6" y="6" width="5" height="5" rx="1" />
        <rect x="13" y="13" width="5" height="5" rx="1" />
      </>
    ),
  },
  calculator: {
    concept: "Saved calculator (a lab calculator from the builder)",
    body: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <rect x="7" y="5.5" width="10" height="3" rx="0.6" />
        <circle cx="8.5" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="15.5" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="8.5" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="15.5" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
      </>
    ),
  },
  move: {
    concept: "Move / relocate (reposition an item, e.g. inventory)",
    body: (
      <>
        <path d="M12 4V20" />
        <path d="M4 12H20" />
        <path d="M9.5 6.5 12 4 14.5 6.5" />
        <path d="M9.5 17.5 12 20 14.5 17.5" />
        <path d="M6.5 9.5 4 12 6.5 14.5" />
        <path d="M17.5 9.5 20 12 17.5 14.5" />
      </>
    ),
  },
  lineage: {
    concept: "Lineage / variant family (a method's fork ancestry)",
    body: (
      <>
        <path d="M7 7.2V16.8" />
        <circle cx="7" cy="5.5" r="1.7" />
        <circle cx="7" cy="18.5" r="1.7" />
        <path d="M7 11C12 11 17 12 17 14.3" />
        <circle cx="17" cy="16" r="1.7" />
      </>
    ),
  },
  resize: {
    concept: "Resize (drag to resize a figure / element)",
    body: (
      <>
        <path d="M7 7 17 17" />
        <path d="M7 12.5V7H12.5" />
        <path d="M17 11.5V17H11.5" />
      </>
    ),
  },
  library: {
    concept: "Template library / catalog (shelved collection of templates)",
    body: (
      <>
        <rect x="4" y="5" width="3.5" height="14" rx="0.8" />
        <rect x="8.5" y="5" width="3.5" height="14" rx="0.8" />
        <path d="M15 6.2 18.4 7.2 15.4 19.8 12 18.8 Z" />
      </>
    ),
  },
  reference: {
    concept: "Literature reference / citation (an open reference book)",
    body: (
      <>
        <path d="M12 6.5V19.5" />
        <path d="M12 6.5C10 5 6 5 4 6.5V18.5c2-1.5 6-1.5 8 0" />
        <path d="M12 6.5c2-1.5 6-1.5 8 0V18.5c-2-1.5-6-1.5-8 0" />
      </>
    ),
  },
  results: {
    concept: "Analysis results (a results report, distinct from a graph)",
    body: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <rect x="9" y="2.5" width="6" height="3" rx="1" />
        <path d="M8.5 10.5h7" />
        <path d="M8.5 13.5h4.5" />
        <path d="M8.5 16.8 10 18.3 13 15.3" />
      </>
    ),
  },
  growth: {
    concept: "Growth area / development (a sprout)",
    body: (
      <>
        <path d="M12 21V11" />
        <path d="M12 13C9 13 7 11 7 8C10 8 12 10 12 13" />
        <path d="M12 11.5C15 11.5 17 9.5 17 6.5C14 6.5 12 8.5 12 11.5" />
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
  x: {
    concept: "Close / dismiss",
    body: <path d="M6 6l12 12M18 6L6 18" />,
  },
  list: {
    concept: "List",
    body: <path d="M4 7h16M4 12h16M4 17h10" />,
  },
  table: {
    concept: "Table / data grid",
    body: (
      <>
        <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
        <path d="M3.5 10h17M3.5 14.5h17M11.5 5v14" />
      </>
    ),
  },
  figure: {
    concept: "Figure / composed publication figure page (Figures composer)",
    body: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
        <path d="M3.5 13h17" />
        <path d="M6.5 10.8l2.4-2.6 2 1.8 3-3" />
        <path d="M6.5 15.8h8M6.5 17.6h4.5" />
      </>
    ),
  },
  chart: {
    concept: "Chart / graph",
    body: (
      <>
        <path d="M5 4v15h15" />
        <path d="M9 19v-5M13 19v-9M17 19v-7" />
      </>
    ),
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
  floorPlan: {
    concept:
      "Floor plan / lab room map (top-down room layout with an open-door swing). The spatial inventory Room map, distinct from the plasmid `map` and the logical `storageNested` box-finder.",
    body: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M12 3V9" />
        <path d="M12 9H16" />
        <path d="M16 9A4 4 0 0 1 12 13" />
        <path d="M13 15H21" />
      </>
    ),
  },
  floorPlanSample: {
    concept:
      "Load a sample / starter floor plan (the `floorPlan` glyph with a corner sparkle). Used on the Room map 'Use sample plan' control only.",
    body: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M12 3V9" />
        <path d="M12 9H16" />
        <path d="M16 9A4 4 0 0 1 12 13" />
        <path d="M13 15H21" />
        <path
          d="M20.5 2l.62 1.63L22.75 4.25l-1.63.62L20.5 6.5l-.62-1.63L18.25 4.25l1.63-.62z"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
  },
  pin: {
    concept:
      "Map pin / physical location marker (a place on the room map). The find-on-map markers + 'where is it' affordance, distinct from `storageNested` (a storage container) and `location` (nested-containers storage concept).",
    body: (
      <>
        <path d="M12 21c4-4.9 6-8.1 6-11a6 6 0 1 0-12 0c0 2.9 2 6.1 6 11Z" />
        <circle cx="12" cy="10" r="2.2" />
      </>
    ),
  },
  sequence: {
    concept: "Sequence",
    body: (
      <>
        <text
          aria-hidden="true"
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
            aria-hidden="true"
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

  // ── Status (lab-head PI edit confirm, 2026-06-07) ───────────────────────
  // Classic alert-triangle, Grant-voted from a 5-candidate HTML review. Body
  // is verbatim from the shipped PiEditConfirmDialog (145fefaa6).
  alert: {
    concept: "Alert / caution",
    body: (
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </>
    ),
  },

  // ── Inventory signals (chunk 3 health strip + step-down) ─────────────────
  // Grant-voted from a 5-candidate interactive HTML chooser (2026-06-07).
  alarmClock: {
    concept: "Alarm clock / expiring",
    body: (
      <>
        <circle cx="12" cy="13" r="7" />
        <path d="M12 10v3l2 2" />
        <path d="M5 4 2.5 6.5M19 4l2.5 2.5M7 20l-1.5 2M17 20l1.5 2" />
      </>
    ),
  },
  bell: {
    concept: "Bell / notifications",
    body: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
  },
  hourglass: {
    concept: "Hourglass / stale",
    body: (
      <path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9" />
    ),
  },
  dropletLow: {
    concept: "Droplet low / low or empty",
    body: (
      <>
        <path d="M12 3s5 6 5 10a5 5 0 0 1-10 0c0-4 5-10 5-10z" />
        <path d="M7.4 14.5a5 5 0 0 0 9.2 0z" fill="currentColor" stroke="none" />
      </>
    ),
  },
  minus: {
    concept: "Minus / step down",
    body: <path d="M5 12h14" />,
  },

  // ── Receive-to-inventory dialog chrome (chunk 4, Grant sign-off 2026-06-07).
  //    Bodies verbatim from the shipped ReceiveToInventoryDialog (434107790).
  box: {
    concept: "Box / package",
    body: (
      <>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </>
    ),
  },
  merge: {
    concept: "Merge / add to existing",
    body: (
      <>
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M6 21V9a9 9 0 0 0 9 9" />
      </>
    ),
  },
  transform: {
    concept: "Data transform / derived table",
    body: (
      <>
        <path d="M5 5h14l-5 7v5l-4 2v-7z" />
      </>
    ),
  },
  skip: {
    concept: "Skip / not tracked",
    body: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M4.93 4.93 19.07 19.07" />
      </>
    ),
  },
  chevronLeft: {
    concept: "Chevron left / back",
    body: <polyline points="15 18 9 12 15 6" />,
  },
  chevronRight: {
    concept: "Chevron right / forward",
    body: <polyline points="9 18 15 12 9 6" />,
  },
  // Barcode scanner entry point (chunk 6). Grant-voted from an interactive
  // scan-icon chooser (2026-06-07).
  scan: {
    concept: "Scan / barcode",
    body: (
      <>
        <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
        <path d="M7.5 8v8M10 8v8M12.5 8v8M16.5 8v8" />
      </>
    ),
  },
  // Fit a figure to the viewport (plotting toolbar). Corner brackets framing a
  // centered rectangle (the figure sitting inside the frame). Distinct from
  // `scan` (barcode lines) and from `focus` (arrows outward, now Fullscreen);
  // Grant sign-off 2026-06-14.
  fitView: {
    concept: "Fit figure to view",
    body: (
      <>
        <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
        <rect x="8" y="9.5" width="8" height="5" rx="1.5" />
      </>
    ),
  },

  // ── Companion / phone linking (Settings Devices redesign, Grant sign-off
  //    2026-06-08). Bodies verbatim from the shipped DevicesSection. The
  //    BeakerBot tile renders the real <BeakerBot> mascot, not a registry glyph
  //    (the mascot IS BeakerBot), so there is no `companion` robot icon here.
  phone: {
    concept: "Phone / device",
    body: (
      <>
        <rect x="6" y="3" width="12" height="18" rx="3" />
        <path d="M11 18h2" />
      </>
    ),
  },
  lock: {
    concept: "Lock / identity locked",
    body: (
      <>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  logout: {
    concept: "Log out / sign out (door with an arrow leaving)",
    body: (
      <>
        <path d="M13.5 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h6.5" />
        <path d="M10 12h11" />
        <path d="M17.5 8.5 21 12l-3.5 3.5" />
      </>
    ),
  },
  camera: {
    concept: "Camera / photo",
    body: (
      <>
        <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6h0a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <circle cx="12" cy="13" r="3.2" />
      </>
    ),
  },
  mic: {
    concept: "Microphone / voice dictation",
    body: (
      <>
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
        <line x1="12" y1="18" x2="12" y2="22" />
        <line x1="8" y1="22" x2="16" y2="22" />
      </>
    ),
  },
  sun: {
    concept: "Sun / today",
    body: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
      </>
    ),
  },
  today: {
    concept: "Calendar / today",
    body: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
        <rect
          x="7"
          y="14"
          width="3.5"
          height="3.5"
          rx="0.5"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
  },
  // ── Pricing page feature glyphs (public /pricing, 2026-06-10 mockup) ────────
  // Branded line icons that break up the feature-card copy on the pricing page.
  // Bodies are the verbatim paths from the approved mockup's FBICONS map
  // (docs/mockups/2026-06-10-pricing-page.html), drawn with the registry's
  // default 2px round stroke. NEW glyphs, flagged for Grant's icon sign-off.
  cloud: {
    concept: "Cloud / optional cloud storage",
    body: (
      <path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 5.5 5.5 0 0 1 10.66-1.2A4 4 0 0 1 17.5 18.5z" />
    ),
  },
  gauge: {
    concept: "Gauge / throttle",
    body: (
      <>
        <path d="M4.5 18a7.5 7.5 0 1 1 15 0" />
        <path d="M12 18l3.5-4" />
      </>
    ),
  },
  // BeakerBot autonomy toggle (ai-assistant manager, 2026-06-11). `ask` (question
  // in a circle) marks ask-before-doing mode, `bolt` (lightning) marks auto mode.
  ask: {
    concept: "Ask / question",
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.2 9.2a2.9 2.9 0 1 1 3.7 2.8c-0.9 0.3-1.4 0.9-1.4 1.9" />
        <path d="M12 17.3h0.01" />
      </>
    ),
  },
  bolt: {
    concept: "Lightning / auto",
    body: <path d="M13 3 5 13h6l-1 8 9-11h-6z" />,
  },
  receipt: {
    concept: "Receipt / one invoice",
    body: (
      <>
        <path d="M6 3h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4V3z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
      </>
    ),
  },
  mail: {
    concept: "Mail / invite by email",
    body: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3.5 7l8.5 6 8.5-6" />
      </>
    ),
  },
  shield: {
    concept: "Shield / cost circuit breaker",
    body: <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />,
  },
  scale: {
    concept: "Scale / priced to sustain",
    body: (
      <>
        <path d="M12 4v16" />
        <path d="M6 20h12" />
        <path d="M5 8h14" />
        <path d="M5 8l-2.5 5.5a3 3 0 0 0 5 0z" />
        <path d="M19 8l-2.5 5.5a3 3 0 0 0 5 0z" />
      </>
    ),
  },
  database: {
    concept: "Database / storage",
    body: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
        <path d="M5 12c0 1.6 3.1 3 7 3s7-1.4 7-3" />
      </>
    ),
  },
  heart: {
    concept: "Heart / sponsor us",
    body: (
      <path d="M12 20s-6.5-4.3-6.5-9A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 6.5 3C18.5 15.7 12 20 12 20z" />
    ),
  },

  // ── Literature explorer ─────────────────────────────────────────────────────
  // star: outlined star for the save-paper toggle in the literature explorer.
  // Callers fill it via className (fill-current or fill-amber-400) when starred.
  star: {
    concept: "Star / save a paper to a molecule",
    body: (
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    ),
  },
  // filter: funnel icon for the literature explorer filter rail toggle button.
  filter: {
    concept: "Filter / funnel",
    body: (
      <path d="M3 4h18l-7 9v7l-4-2v-5L3 4z" />
    ),
  },

  // ── Wisconsin state silhouette (MadeInMadison badge, brand identity) ────────
  // Accurate Wisconsin border (MIT state-svg-defs, viewBox cropped to the shape).
  // Grant approved in the 2026-06-10 pricing-page mockup (.wibadge). The circle
  // is Madison (coral dot, fixed fill so it always reads even if the parent
  // strokes a different color). stroke="currentColor" lets callers tint the
  // border; the fill is a light brand-action tint applied via className.
  // Grant sign-off: 2026-06-10, pricing-page mockup section 9.
  wisconsin: {
    concept: "Wisconsin state silhouette (green-gold gradient, Madison star)",
    viewBox: "4 -1 59.4 66",
    body: (
      <>
        <defs>
          <linearGradient id="wiGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2E8B45" />
            <stop offset="1" stopColor="#FFB81C" />
          </linearGradient>
        </defs>
        <path
          fill="url(#wiGrad)"
          fillOpacity={0.2}
          stroke="url(#wiGrad)"
          d="M61.6 24.48l-0.88 1.36-1.2 0.48-0.24 1.68-1.040 1.28-0.080 1.040 0.72 0.96 1.52-1.84-0.080-0.56 1.36-1.84-0.56-0.56 0.56 0.16-0.080-1.44 0.64-0.16-0.16-0.56h-0.48zM62.56 22.8l-0.32 0.96h1.040l0.080-0.88zM25.28 4.080l1.44-0.8-0.16-0.48-2 1.6zM27.040 2l0.24-0.32-1.28 0.48 1.040 0.24v-0.4zM24.48 1.84l-0.64-0.4-0.8 0.4-1.44 1.12-0.96-0.4-1.92 1.44-3.68 1.12-1.68 0.16-1.28-1.28-1.2 1.52h-0.64l-0.16 8.16-0.72 0.64h-0.72l-2.88 1.6-1.76 2.88v1.84l1.28 0.080 0.8 2.080-1.12 1.76v2.32l-0.48 0.72 0.48 2.080-0.72 2.48 2.16 2 1.92 0.4 1.040 1.52 1.84 0.64 1.6 1.44 1.28 2.56 1.52 1.36 2.48 0.72 1.12 1.28 0.4 2.72v3.68l0.4 1.44 1.12 0.8-0.8 2.16 0.8 5.12 0.8 1.2 3.2 0.8 0.48 2h29.6l0.080-4.080-1.36-3.36-0.16-3.36 1.92-6.24-0.4-3.28 0.88-2.32 1.44-1.44-0.64-1.76 1.92-6.72-1.12-1.12-1.28 0.56-1.76 2.64-1.6 1.6-0.64 0.16-0.64-0.48 1.92-4.8 1.92-1.12 0.48-1.6-1.28-1.12 0.4-2.72-2 0.16 0.72-1.68-0.080-2.72-0.88-0.88-2.16-0.56 0.16-1.12-0.96-1.040-3.44-0.96-2.96-0.16-2.72-1.44-9.84-2.64-1.040-2.48-1.52-0.4-0.24-0.72-1.6-0.16-1.76-1.36-0.24 0.88-1.52 0.4 1.76-4zM25.6 2.16v-0.32l-0.48-0.32-0.24 0.32zM23.2 1.44l0.24-0.32-0.24-0.24-0.32 0.4zM28.32 0.88v-0.88l-0.64 1.12z"
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
        {/* Madison, a Green Bay Packers gold star with a thin green outline */}
        <path d="M38.00 51.90 L38.91 54.65 L41.80 54.66 L39.47 56.38 L40.35 59.14 L38.00 57.45 L35.65 59.14 L36.53 56.38 L34.20 54.66 L37.09 54.65 Z" fill="#FFB81C" stroke="#1e7d3a" strokeWidth={0.5} strokeLinejoin="round" />
      </>
    ),
  },
  text: {
    concept: "Text / strings (Aa)",
    body: (
      <>
        <path d="M3 18l4-11 4 11" />
        <path d="M4.4 14h5.2" />
        <circle cx="17" cy="14.8" r="2.7" />
        <path d="M19.7 12v5.6" />
      </>
    ),
  },
  emptySet: {
    concept: "Empty set / missing or null values",
    body: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M7.2 16.8 16.8 7.2" />
      </>
    ),
  },
  pivot: {
    concept: "Pivot / reshape",
    body: (
      <>
        <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
        <path d="M14 8h5m0 0-2.2-2.2M19 8l-2.2 2.2" />
        <path d="M8 14v5m0 0 2.2-2.2M8 19l-2.2-2.2" />
      </>
    ),
  },

  // ── Attachments (editor quiet toolbar + insert rail, L1 Phase B) ───────────
  // Classic paperclip. Grant signed off this new glyph for the editor's
  // Attachments control (2026-06-13). Path is verbatim from the standalone
  // PaperclipIcon in lib/utils/icons.tsx so the two stay identical.
  attach: {
    concept: "Attachments / attach a file (paperclip)",
    body: (
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    ),
  },
} satisfies Record<string, IconEntry>;

export type IconName = keyof typeof ICONS_RAW;

export const ICONS: Record<IconName, IconEntry> = ICONS_RAW;
