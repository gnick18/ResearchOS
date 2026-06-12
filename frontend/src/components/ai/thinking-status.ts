// thinking-status (BeakerAI manager, 2026-06-12).
//
// Pure mapping from the agent loop's LoopStatus to the single grey status line
// the "BeakerBot is thinking" indicator shows while he works. This is the one
// place that turns a raw phase / tool name into friendly human copy, so it can
// be unit-tested in isolation and reused by both the conversation store (which
// already flattens LoopStatus to a string on the reactive state) and any future
// surface that wants the same wording.
//
// Wording is short, capitalized, present-progressive, and distinct from the
// eventual printed answer. Known tools get a tailored phrase, every unknown
// tool falls back to a generic "Working on it" so a new tool never shows a raw
// snake_case name to the user.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { LoopStatus } from "@/lib/ai/agent-loop";

// Map a known tool name to its friendly status line. Anything not listed falls
// back to the generic phrase in statusLabel below, so adding a tool never leaks
// a raw name into the UI.
const TOOL_PHRASES: Record<string, string> = {
  // Read / search across the user's work.
  search_my_work: "Searching your work",
  get_my_tasks: "Checking your tasks",
  get_my_projects: "Looking at your projects",
  list_notes: "Looking through your notes",
  read_note: "Reading the note",
  read_project: "Reading the project",
  read_method: "Reading the method",
  read_experiment: "Reading the experiment",
  read_purchase: "Reading the purchase",

  // Data Hub analysis + figures.
  list_datahub_tables: "Looking at your data tables",
  list_datahub_analyses: "Looking at stored analyses",
  read_datahub_analysis: "Reading the stored result",
  run_datahub_analysis: "Running the analysis",
  make_datahub_graph: "Making the figure",
  wrangle_table: "Wrangling the data",
  transform_table: "Wrangling the data",

  // Writing.
  write_note: "Writing it up",

  // Sequence + cloning.
  fetch_sequence: "Fetching from NCBI",
  list_sequences: "Looking through your sequences",
  read_sequence: "Reading the sequence",
  read_sequence_features: "Reading the sequence features",
  create_sequence: "Saving the sequence",
  assemble_gibson: "Planning the assembly",
  digest_ligate: "Planning the assembly",
  design_primers: "Designing primers",
  find_orfs: "Scanning for ORFs",
  extract_feature: "Pulling out the feature",
  translate_sequence: "Translating the sequence",
  reverse_complement: "Taking the reverse complement",
  compute_tm: "Computing the melting temperature",

  // Chemistry.
  search_pubchem: "Looking up PubChem",
  import_molecule: "Importing the molecule",
  create_molecule: "Saving the molecule",
  read_molecule: "Reading the molecule",

  // Experiments.
  create_experiment: "Setting up the experiment",
  create_experiment_chain: "Setting up the experiments",
  reschedule_experiment: "Rescheduling the experiment",

  // Navigation / guidance.
  read_page: "Looking at the page",
  go_to_page: "Taking you there",
  guide_to_element: "Showing you where",
  click_element: "Clicking for you",

  // Coordination tools (not actions, but the loop still reports them).
  propose_plan: "Planning the steps",
  ask_user: "Asking what you would like",
};

/** Fallback when a tool is running but not in the table above. */
const UNKNOWN_TOOL_LABEL = "Working on it";

/** Map the agent loop status to the friendly grey status line. Pure, so it can
 *  be unit-tested directly. */
export function statusLabel(status: LoopStatus): string {
  if (status.phase === "thinking") {
    return "Thinking";
  }
  if (status.phase === "awaiting-approval") {
    if (status.toolName === "ask_user") return "Waiting for your choice";
    if (status.toolName === "write_note") return "Waiting for your review";
    return "Waiting for your go-ahead";
  }
  // status.phase === "tool"
  return TOOL_PHRASES[status.toolName] ?? UNKNOWN_TOOL_LABEL;
}
