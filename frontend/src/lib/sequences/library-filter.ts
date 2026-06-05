// sequence editor master — PURE filtering for the Assemble DNA library picker.
//
// The Cloning Workspace "Your DNA library" panel filters the user's DNA
// sequences by a free-text search (display_name substring) and a topology
// segmented control (All / Circular / Linear). The default topology is chosen
// per assembly method by the component, but the application of that choice plus
// the search is pure, DOM-free, and unit-tested here so the picker stays a thin
// display layer over it.
//
// No emojis, no em-dashes, no mid-sentence colons in the prose here.

/** The topology filter the segmented control drives. */
export type TopologyFilter = "all" | "circular" | "linear";

/** The minimum shape the filter needs from a library record. We accept any
 *  object carrying these two fields so the helper works on full SequenceRecord
 *  summaries without depending on the rest of that type. */
export interface FilterableSequence {
  display_name: string;
  circular: boolean;
}

/**
 * Apply the topology filter and the case-insensitive display_name substring
 * search to a list of library sequences, preserving input order.
 *
 * Pure and order-stable. "all" keeps every topology; "circular" / "linear"
 * keep only matching records. An empty or whitespace search matches everything.
 */
export function filterLibrary<T extends FilterableSequence>(
  list: T[],
  topology: TopologyFilter,
  search: string,
): T[] {
  const needle = search.trim().toLowerCase();
  return list.filter((s) => {
    if (topology === "circular" && !s.circular) return false;
    if (topology === "linear" && s.circular) return false;
    if (needle && !s.display_name.toLowerCase().includes(needle)) return false;
    return true;
  });
}
