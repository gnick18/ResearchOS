// sequence Phase 2c bot — the VIEW-CONTROL state. This is the lever that
// delivers the locked "calm by default / progressive disclosure" feel: SeqViz
// is prop-driven, so showing/hiding a layer == filtering the props we pass it.
// Everything here defaults to a CLEAN, uncluttered view: features + ruler on,
// everything heavier (translation, enzymes, ORFs) OFF until the user opts in.
// The complement strand is ALWAYS shown in the Sequence view (deliberate
// simplification, no toggle): a paired bottom strand is core to reading DNA.

export interface SequenceViewState {
  /** Master switch for the annotation layer. */
  showFeatures: boolean;
  /** Per-type visibility. Absent key => visible (default-on). A type set to
   *  false hides every feature of that type. */
  hiddenTypes: Record<string, boolean>;
  /** Per-feature hide overrides, keyed by a stable feature key. Absent => shown. */
  hiddenFeatures: Record<string, boolean>;
  /** Show restriction-enzyme cut sites (the simple 2c toggle; the full picker is 2d). */
  showEnzymes: boolean;
  /** Show amino-acid translation of CDS features. */
  showTranslation: boolean;
  /** Show open reading frames. */
  showOrfs: boolean;
  /** Show the index / ruler row. */
  showIndex: boolean;
  /** Show primer-binding annotations (the toggle / track; the full primer popup
   *  is Phase 2e). When off we feed SeqViz an empty primer list. */
  showPrimers: boolean;
  /** Render the molecule as LINEAR even when it is a circular plasmid. null /
   *  false => use the molecule's own topology (circular plasmids show the
   *  circular+linear "both" view). The topology toggle in the rail flips this. */
  forceLinear: boolean;
  /** seq nav bot — the linear viewer zoom (0-100), wired straight to SeqViz's
   *  `zoom.linear`. null => "auto": use the length-aware initial zoom. Once the
   *  user touches the zoom control this becomes a concrete number. */
  linearZoom: number | null;
  /** seq nav bot — the circular viewer zoom (0-100), wired to `zoom.circular`. */
  circularZoom: number;
  /** wrap toggle bot — the SnapGene-style WRAP mode for the LINEAR sequence view.
   *  true (default) => WRAPPED: the sequence is chunked into stacked rows and the
   *  viewer scrolls vertically (the original, just-shipped behavior). false =>
   *  SINGLE-LINE: the whole sequence renders on one continuous horizontal row at a
   *  fixed readable character width and the viewer scrolls left-right. Only the
   *  linear Sequence view honors this; circular molecules are unaffected. */
  wrapSequence: boolean;
}

/** The CALM default: features + ruler visible, every heavier layer off. */
export const DEFAULT_VIEW_STATE: SequenceViewState = {
  showFeatures: true,
  hiddenTypes: {},
  hiddenFeatures: {},
  showEnzymes: false,
  showTranslation: false,
  showOrfs: false,
  showIndex: true,
  // primer style bot — primers are now drawn ONLY by the dedicated primers layer
  // (thin SnapGene-style annealing brackets), not the annotation layer. Default
  // them VISIBLE so they don't disappear; the Primers rail toggle still hides them.
  showPrimers: true,
  forceLinear: false,
  linearZoom: null,
  circularZoom: 0,
  // wrap toggle bot — WRAPPED by default (byte-identical to the original view).
  wrapSequence: true,
};

// ── Sticky display preferences ───────────────────────────────────────────────
// The display LAYER toggles + wrap mode are a "how I like to read sequences"
// preference, so they persist across sequence switches and reloads instead of
// snapping back to the calm default every time. We deliberately do NOT persist
// the per-sequence bits: hiddenTypes / hiddenFeatures are keyed to one
// sequence's features, forceLinear is a per-molecule topology override, and the
// zoom levels are length-dependent (a zoom tuned for a 1 kb plasmid is wrong for
// a 200 kb one). Those stay per-sequence and reset on switch.

const DISPLAY_PREFS_KEY = "researchos:sequences:displayPrefs";

/** The subset of the view state that is remembered across sequences + reloads. */
export type PersistedDisplayPrefs = Pick<
  SequenceViewState,
  | "showFeatures"
  | "showEnzymes"
  | "showTranslation"
  | "showOrfs"
  | "showIndex"
  | "showPrimers"
  | "wrapSequence"
>;

const PERSISTED_PREF_KEYS: Array<keyof PersistedDisplayPrefs> = [
  "showFeatures",
  "showEnzymes",
  "showTranslation",
  "showOrfs",
  "showIndex",
  "showPrimers",
  "wrapSequence",
];

/** Read the remembered display preferences. Returns a partial (only the keys
 *  that were stored as booleans), so a caller merges it over DEFAULT_VIEW_STATE.
 *  Safe on the server and in private mode (returns {}). */
export function loadDisplayPrefs(): Partial<PersistedDisplayPrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISPLAY_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<PersistedDisplayPrefs> = {};
    for (const k of PERSISTED_PREF_KEYS) {
      if (typeof parsed[k] === "boolean") out[k] = parsed[k] as boolean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist just the remembered subset of the current view state. */
export function saveDisplayPrefs(view: SequenceViewState): void {
  if (typeof window === "undefined") return;
  try {
    const subset: PersistedDisplayPrefs = {
      showFeatures: view.showFeatures,
      showEnzymes: view.showEnzymes,
      showTranslation: view.showTranslation,
      showOrfs: view.showOrfs,
      showIndex: view.showIndex,
      showPrimers: view.showPrimers,
      wrapSequence: view.wrapSequence,
    };
    window.localStorage.setItem(DISPLAY_PREFS_KEY, JSON.stringify(subset));
  } catch {
    /* private mode / quota — non-fatal, prefs just will not persist */
  }
}

/** A small, common enzyme set surfaced by the simple "Show cut sites" toggle.
 *  The full enzyme picker/filters/saved-sets is Phase 2d; this is just the
 *  view-control on/off lever the brief asks for. These names match the bundled
 *  SeqViz enzyme list. */
export const COMMON_ENZYMES = [
  "ecori",
  "bamhi",
  "hindiii",
  "xhoi",
  "noti",
  "sali",
  "xbai",
  "psti",
  "kpni",
  "smai",
  "ncoi",
  "sphi",
];

/** Normalize a feature type to its visibility key. */
export function typeKey(type?: string): string {
  return (type || "misc_feature").trim().toLowerCase();
}

/** A stable per-feature key for hide overrides (type+coords+name is stable
 *  enough across renders within an editing session). */
export function featureKey(f: {
  name: string;
  type?: string;
  start: number;
  end: number;
  strand?: number;
}): string {
  return `${typeKey(f.type)}|${f.start}|${f.end}|${f.strand ?? 1}|${f.name}`;
}

/** Whether a feature is currently visible under the given view state. */
export function isFeatureVisible(
  view: SequenceViewState,
  f: { name: string; type?: string; start: number; end: number; strand?: number },
): boolean {
  if (!view.showFeatures) return false;
  if (view.hiddenTypes[typeKey(f.type)]) return false;
  if (view.hiddenFeatures[featureKey(f)]) return false;
  return true;
}
