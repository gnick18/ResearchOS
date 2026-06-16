// BeakerBot tool registry (ai tools bot, 2026-06-10).
//
// The single list of tools BeakerBot can call, plus a name-keyed lookup the agent
// loop dispatches through. Adding the next tool later (a wiki search, a write tool
// gated by approval) is one import and one array entry, no loop change. That is the
// extensibility the design asks for.
//
// The registry holds the read-only tools plus the first ACTION tool. The read-only
// set is read-only with respect to the user's DATA. Alongside the data readers it
// holds the live page-perception trio, read_page (perceive the current page),
// go_to_page (navigate when the target is elsewhere), and guide_to_element (scroll
// to and spotlight a perceived element). Those change the VIEW (a route and a
// decorative highlight) but never the user's files, so they stay in the read-only
// set with no approval gate.
//
// The first action tool is click_element, which dispatches a real click for the
// user. It carries action: true, so the agent loop routes it through the approval
// gate (a per-step confirm in step-by-step review mode, plan-approved or a single
// confirm in whole-plan mode, with a destructive hard-stop in both). A genuinely
// destructive or outward-facing future write tool reuses the SAME flag and gate,
// one import and one array entry.
//
// run_datahub_analysis is the exception that proves the rule. It DOES write (a new
// version-controlled AnalysisSpec), but it is non-destructive AND the user already
// expressed consent twice over, they asked for the analysis in words and picked the
// groups through ask_user. A second "Allow it?" on top of that is redundant friction
// the live test flagged, so it runs WITHOUT the per-action gate (it lives in the
// read-only set with respect to the gate, not in ACTION_TOOLS). Its execute then
// navigates the user to the stored result, so the gate is not where its safety
// lives, the explicit request and the group pick are.
//
// The old manifest-driven find_ui_element / spotlight_ui_element pair is retired,
// live perception supersedes a hand-built element catalog. The manifest's one
// surviving job, knowing which PAGE a feature lives on, lives in page-routing.ts and
// is used by go_to_page.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { getMyProjectsTool, getMyTasksTool } from "./read-my-work";
import { readPageTool } from "./read-page";
import { goToPageTool } from "./go-to-page";
import { guideToElementTool } from "./guide-to-element";
import { clickElementTool } from "./click-element";
import { proposePlanTool } from "./propose-plan";
import { askUserTool } from "./ask-user";
import {
  listDataHubTablesTool,
  runDataHubAnalysisTool,
  compareModelsTool,
  runMultipleRegressionTool,
  runLogisticRegressionTool,
  globalFitTool,
  runDoseResponseTool,
  runCoxRegressionTool,
  runRocCurveTool,
  runRepeatedMeasuresAnovaTool,
  runMixedModelTool,
  runGrubbsOutliersTool,
  runContingencyTool,
  runNestedTTestTool,
  runNestedAnovaTool,
  listDataHubAnalysesTool,
  readDataHubAnalysisTool,
  getAnalysisCodeTool,
} from "./datahub-analysis";
import { makeDataHubGraphTool } from "./datahub-graph";
import { listNotesTool, writeNoteTool } from "./write-note";
import { searchMyWorkTool } from "./search-my-work";
import { searchFullTextTool } from "./search-full-text";
import { listRecordsTool } from "./list-records";
import { summarizeExperimentsTool } from "./summarize-experiments";
import { summarizePurchasesTool } from "./summarize-purchases";
import { summarizeNotesTool } from "./summarize-notes";
import { summarizeProjectsTool } from "./summarize-projects";
import { summarizeInventoryTool } from "./summarize-inventory";
import { labDigestTool } from "./lab-digest";
import { listLabMembersTool } from "./lab-members";
import { searchLiteratureTool } from "./search-literature";
import {
  listPhyloTreesTool,
  readPhyloTreeTool,
  generateTreeTool,
  matchFigureStyleTool,
  suggestTreeOverlaysTool,
  compareTreeRecipesTool,
} from "./phylo-tools";
import { suggestAnalysesTool } from "./suggest-analyses";
import {
  createExperimentTool,
  rescheduleExperimentTool,
  createExperimentChainTool,
} from "./experiment-tools";
import { setupExperimentTool } from "./setup-experiment";
import { setupProjectTool } from "./setup-project";
import {
  draftPaperSummaryTool,
  extractPaperMethodTool,
} from "./paper-reproduce-tools";
import { saveSummaryAsNoteTool } from "./summary-artifact-tool";
import { createDatahubTableTool } from "./create-datahub-table";
import {
  rememberPreferenceTool,
  forgetPreferenceTool,
} from "./user-memory-tools";
import {
  createTaskTool,
  rescheduleTaskTool,
  updateTaskTool,
  linkTasksTool,
  deleteTaskTool,
} from "./task-tools";
import {
  createMethodTool,
  updateMethodTool,
  editMethodTool,
  deleteMethodTool,
} from "./method-tools";
import {
  createProjectTool,
  updateProjectTool,
  deleteProjectTool,
} from "./project-tools";
import {
  updateSequenceTool,
  updateMoleculeTool,
  updateNoteTool,
  updatePurchaseTool,
  editNoteTool,
  editSequenceTool,
  editMoleculeStructureTool,
  deleteSequenceTool,
  deleteNoteTool,
  deleteMoleculeTool,
  deletePurchaseTool,
} from "./edit-tools";
import {
  readNoteTool,
  readMethodTool,
  readSequenceTool,
  readExperimentTool,
  readProjectTool,
  readPurchaseTool,
  readMoleculeTool,
  readTaskTool,
  readInventoryTool,
  readDataHubTool,
} from "./read-artifact";
import {
  computeTmTool,
  translateSequenceTool,
  reverseComplementTool,
  findOrfsTool,
  designPrimersTool,
  createSequenceTool,
} from "./sequence-tools";
import {
  searchPubChemTool,
  createMoleculeTool,
  importMoleculeTool,
} from "./chemistry-tools";
import { planStudyTool } from "./plan-study";
import { transformTableTool } from "./transform-table";
import { wrangleTableTool } from "./wrangle-table";
import {
  listSequencesTool,
  readSequenceFeaturesTool,
  fetchSequenceTool,
  extractFeatureTool,
  assembleGibsonTool,
  digestLigateTool,
} from "./cloning-tools";
import { assembleTreeFastaTool } from "./assemble-tree-fasta";
import {
  addInventoryItemTool,
  adjustInventoryStockTool,
} from "./inventory-tools";
import { listCalculatorsTool, runCalculatorTool } from "./calculator-tools";
import { createPurchaseTool } from "./purchase-tools";
import type { AiTool } from "./types";

// The read-only toolset, read-only with respect to the user's data. Exported on
// its own so a future cautious "question only" mode can hand the model just these
// and nothing that acts (design doc section 4, the capability wall).
export const READ_ONLY_TOOLS: AiTool[] = [
  getMyTasksTool,
  getMyProjectsTool,
  readPageTool,
  goToPageTool,
  guideToElementTool,
  listDataHubTablesTool,
  // Non-gated by design (see the header note). run_datahub_analysis writes a
  // reversible analysis the user explicitly requested and whose groups they picked
  // through ask_user, so it carries no `action` flag and runs immediately like the
  // perception tools, then navigates the user to the result.
  runDataHubAnalysisTool,
  // Non-gated for the same reason. compare_models fits two curve models on an XY
  // table and reports the F test (nested) + AICc through the same validated
  // runAnalysis path, storing a reversible analysis the user asked for, then
  // navigates to it. The engine owns every fit and statistic.
  compareModelsTool,
  // Non-gated for the same reason. run_multiple_regression and
  // run_logistic_regression fit a regression through the same validated
  // runAnalysis path, storing a reversible analysis the user asked for, then
  // navigate to it. The engine owns every coefficient and statistic.
  runMultipleRegressionTool,
  runLogisticRegressionTool,
  // Non-gated for the same reason. global_fit jointly fits several dose-response
  // curves with shared parameters through the same runAnalysis path, storing a
  // reversible analysis the user asked for, then navigates to it.
  globalFitTool,
  // Non-gated for the same reason. run_dose_response fits a single 4PL/5PL curve
  // and reads out the EC50 / IC50 through the same validated runAnalysis path,
  // storing a reversible analysis the user asked for, then navigates to it. The
  // engine owns the fit, the EC50, the Hill slope, and the R-squared.
  runDoseResponseTool,
  // Non-gated for the same reason (Data Hub Themes 3 + 4). Each runs a Survival,
  // XY, or within-subject Column analysis through the same validated runAnalysis
  // path, storing a reversible analysis the user asked for, then navigates to it.
  // The engine owns every hazard ratio, AUC, F, variance component, and outlier
  // flag; the model only relays the numbers it returned.
  runCoxRegressionTool,
  runRocCurveTool,
  runRepeatedMeasuresAnovaTool,
  runMixedModelTool,
  runGrubbsOutliersTool,
  runContingencyTool,
  runNestedTTestTool,
  runNestedAnovaTool,
  // Non-gated for the same reason. make_datahub_graph builds a reversible,
  // version-controlled figure the user explicitly asked for (and whose graph type
  // / error bar they may have tapped through ask_user) through the validated plot
  // engine, then navigates the user to the figure. The engine builds the figure,
  // the model never computes a plotted value.
  makeDataHubGraphTool,
  // list_datahub_analyses and read_datahub_analysis are READ-only. They let the
  // model read back stored analysis results so the user can ask "what did the
  // t-test show?" without re-running anything. list_datahub_analyses gives the
  // model a disambiguation list; read_datahub_analysis returns the stored result
  // for a known id. Neither navigates nor mutates any data.
  listDataHubAnalysesTool,
  readDataHubAnalysisTool,
  // get_analysis_code returns the reproducible show-the-code snippet for a
  // stored analysis so the model can drop the exact stat code into a note. The
  // engine wrote the snippet; the tool only relays it. Read-only.
  getAnalysisCodeTool,
  // plan_study is READ-only and computes nothing of the user's data. It answers
  // study-design questions (how many samples, what power, smallest detectable
  // effect) through the validated power / sample-size engine before any data is
  // collected. Non-gated, like the other deterministic engine-computed tools, the
  // model maps the request to the engine and relays the number.
  planStudyTool,
  // list_notes is READ-only with respect to the user's data, it returns the user's
  // notes (id + title + snippet) so write_note can find the note to append to. The
  // WRITE half (write_note) is gated and lives in ACTION_TOOLS below.
  listNotesTool,
  // Layer 1 (artifact-index): cross-type search. search_my_work lets the model find
  // any artifact by the user's words when the artifact is not already in the context
  // line. It calls each type's list() concurrently, ranks the briefs by a local
  // title+keyword scorer, and returns a compact list of matched briefs. Only the
  // briefs (titles, ids, deep links) cross to the model, never any bodies.
  searchMyWorkTool,
  // search_full_text is the deliberate DEEP search of full note + method BODY text
  // (the index only covers titles/headings/tags/descriptions). Read-only; the model
  // confirms the exact term via ask_user first (system-prompt). Snippets + match
  // counts only, no body crosses as a finding.
  searchFullTextTool,
  // list_records is the deterministic top-N / sorted-list resolver (listArtifacts):
  // the tool sorts by date/title and slices the top N, so the model never eyeballs
  // records to decide which are newest/first. Briefs only, read-only.
  listRecordsTool,
  // Summary suite Layer 2 (artifact-index filterArtifacts + deterministic
  // aggregates). summarize_experiments and summarize_purchases aggregate ACROSS
  // many records over a shared filter (types / dates / owners / projects /
  // status / keywords) and return a structured tally. Read-only, they run
  // straight away with no approval step. The TOOL owns every count, group-by,
  // and money total; the model only relays the aggregate and never counts a
  // record, derives a status, or adds a dollar itself. A summary reports
  // STRUCTURE (counts, dates, totals, titles, status), never a finding (the
  // global no-interpretation scope). The owners filter respects the existing
  // ACL, the shared loaders only surface what the current user may see, so a PI
  // summarizing the lab never reads a member's private work.
  summarizeExperimentsTool,
  summarizePurchasesTool,
  // Same suite, the remaining per-type aggregators plus the cross-type rollup.
  // summarize_notes is STRUCTURAL ONLY (counts, dates, titles, the first entry
  // heading), never a model-extracted finding. summarize_projects rolls up the
  // per-project task counts / percent complete / next due deterministically.
  // summarize_inventory flags low / out / expiring from the real low_at_count +
  // expiration_date fields. lab_digest COMPOSES the per-type aggregates over one
  // window, it never recomputes a count or a total. Every one is read-only, runs
  // straight away, owns its own arithmetic, and respects the shared-only ACL.
  summarizeNotesTool,
  summarizeProjectsTool,
  summarizeInventoryTool,
  labDigestTool,
  // Lab roster, so the summary wizard's whose-step can offer real member names
  // and resolve a typed name to a real owner. Read-only.
  listLabMembersTool,
  // Custom calculator tools. list_calculators surfaces every available calculator
  // (own + shared) with its input descriptors; run_calculator validates inputs and
  // delegates entirely to evaluateCustomCalculator. The engine owns every number,
  // the model only relays the pre-formatted display strings. Read-only, non-gated.
  listCalculatorsTool,
  runCalculatorTool,
  // Layer 2 (read-by-id): one read tool per artifact type. Each accepts an id from
  // a search_my_work brief and returns a trimmed projection of that artifact's
  // content. Trimmed to protect the context window. All read-only, none navigates.
  // read_datahub_analysis already lives above (from Layer 0), not duplicated here.
  readNoteTool,
  readMethodTool,
  readSequenceTool,
  readExperimentTool,
  readProjectTool,
  readPurchaseTool,
  readMoleculeTool,
  // read_task covers GENERIC list-type tasks (task_type "list"), the sibling of
  // read_experiment (task_type "experiment"); each refuses a record of the other
  // type. read_inventory reads one inventory item plus its stocks (summed count,
  // low-at threshold, soonest expiry), the per-id complement of summarize_inventory.
  // read_datahub reads a Data Hub DOCUMENT's metadata (name, columns, row count,
  // analyses present) WITHOUT the cell data, distinct from read_datahub_analysis
  // which reads one analysis result. All three read-only, none navigates.
  readTaskTool,
  readInventoryTool,
  readDataHubTool,
  // Sequence compute tools. Deterministic, non-gated, engine-computed. The model
  // orchestrates (maps the user's words to a sequenceId or a raw string), the
  // validated engine computes every number, the model relays the result. None of
  // these writes or navigates, they are pure computation on the user's sequence.
  computeTmTool,
  translateSequenceTool,
  reverseComplementTool,
  findOrfsTool,
  designPrimersTool,
  // Chemistry Workbench tools. search_pubchem is read-only (a network read to
  // PubChem, a public NIH resource; no local write). The two write tools
  // (create_molecule and import_molecule) live in ACTION_TOOLS below because they
  // create a new library record and go through the approval gate.
  searchPubChemTool,
  // search_literature is read-only (a network read to Europe PMC, a public
  // bibliographic database; no local write). It finds published papers the model
  // can cite or, on a separate user-approved write_note, pull into a note. The
  // model only relays what Europe PMC returns and never invents a paper or a DOI.
  searchLiteratureTool,
  // Phylogenetics READ tools. list_phylo_trees / read_phylo_tree surface the
  // user's saved trees by name or id and hand the model the embed markdown to
  // SHOW one as a chat card (the /phylo embed pipeline is built + frozen by the
  // Phylogenetics lane). generate_tree builds a runnable recipe (alignment +
  // trimming + model selection + tree inference + support) from catalog options
  // and returns the commands / install steps / conda env / run script / markdown
  // for the user to run on their own machine. All three are read-only: the model
  // never invents a tree, a tip count, or a flag, and no compute runs in-app.
  listPhyloTreesTool,
  readPhyloTreeTool,
  generateTreeTool,
  // suggest_tree_overlays (Phase 4 Smart Data Binding, chat front door) is
  // read-only: it ranks the user's Data Hub tables that join the open tree's tips
  // via the SAME deterministic engine the /phylo GUI uses, then rides the
  // candidates UI-only so BeakerBotConversation mounts the SAME SmartDataWizard
  // inline. The model only narrates the ranked facts; the write is the user's
  // wizard Add (host commit), so no approval card.
  suggestTreeOverlaysTool,
  // suggest_analyses (constraint-aware analysis/graph picker, chat front door) is
  // read-only: it calls the SAME deterministic tableCapabilities engine the Data
  // Hub "Analyze" UI uses, narrates only the VALID analyses + graphs, and rides
  // them UI-only so the inline picker mounts. The model can never offer a test or
  // figure that cannot run on the table, the fix for suggest-then-refuse.
  suggestAnalysesTool,
  // compare_tree_recipes (reproduce-from-PDF "light comparison" carve-out) is
  // read-only + deterministic: it diffs the paper's recipe vs the user's
  // (resolveBuilderOptions on both -> compareBuilderOptions) and rides the result
  // UI-only as an inline comparison card. FACTS ONLY by construction (no ranking is
  // produced), the scoped no-interpretation loosening Grant signed off for this flow.
  compareTreeRecipesTool,
  // match_figure_style (PDF-reproduce Output 4) is non-gated for the same reason
  // as make_datahub_graph: it writes a reversible figure-style spec the user
  // explicitly asked for onto the user's OWN tree (a saved tree or pasted Newick),
  // then navigates the user to Tree Studio hydrated with that style. It emits ONLY
  // the visual style the model read off the attached figure image, never the tree
  // itself, the user's Newick is the source of truth. The user edits everything
  // else in the Studio it lands in, so a draft card would be redundant friction.
  matchFigureStyleTool,
  // Cloning coworker READ tools. list_sequences gives the model real sequence ids
  // + feature names; read_sequence_features returns one sequence's full annotation
  // list (with coordinates + strand) so the model can pick a region to extract.
  // Both cache the loaded detail so the action tools' synchronous describeAction
  // can preview an extract / an assembly with no await. Neither writes or navigates.
  listSequencesTool,
  readSequenceFeaturesTool,
];

// The action toolset. Each tool here carries action: true and goes through the
// agent loop's approval gate. click_element dispatches a real click for the user,
// a genuine page effect that always wants the user's blessing and keeps the
// destructive hard-stop. write_note writes DRAFTED content into one of the user's
// notes, and is gated unlike the analysis / graph writes, because writing the
// user's actual prose is sensitive. Its gate raises a DRAFT PREVIEW (the proposed
// content with Approve / Reject), and only on Approve does it write. Create and
// append are non-destructive and version-controlled, so it never forces the
// destructive hard-stop, the preview is the consent.
//
// create_experiment, reschedule_experiment, create_experiment_chain are the
// experiment scheduling coworker tools. All three are gated writes (action: true,
// isDestructive false). The user sees a preview of exactly what will be written
// (name, dates, or the full proposed chain) before anything is created or moved.
// create_experiment_chain also wires finish-to-start Gantt dependency edges so the
// chain relationship is visible on the schedule. None is destructive (creating is
// reversible by deleting, rescheduling leaves the experiment intact), so none forces
// the destructive hard-stop.
//
// create_sequence is the sequence coworker write tool (action: true, isDestructive
// false). The user sees a preview showing the sequence name, type, and length before
// anything is saved. Only on Approve does the sequence write to the library.
//
// create_molecule and import_molecule are the chemistry coworker write tools
// (action: true, isDestructive false). create_molecule derives formula + MW from
// the user-supplied SMILES via RDKit, then writes a "drawn" molecule record.
// import_molecule fetches an existing compound from PubChem by CID (name, formula,
// MW, and 2D SDF), then writes a "pubchem" molecule record. The user sees a preview
// of the name + CID (for import) or name + SMILES (for create) before anything is
// written. Only on Approve does the molecule write to the library.
//
// transform_table is the Data Hub wrangling coworker tool (action: true,
// isDestructive false). It maps the user's plain-English transform request onto
// one of the five existing Data Hub deterministic transforms, runs a real preview
// through the engine (runTransform), and shows the user a block card (step name,
// blurb, param pills, and a live first-rows preview) before anything is created.
// Only on Approve does it create the new derived table and navigate the user to it.
// The engine computes every cell; the model only maps and relays.
//
// wrangle_table is the full-pipeline sibling of transform_table (action: true,
// isDestructive false). Where transform_table applies one column transform,
// wrangle_table runs a multi-step RELATIONAL recipe (join, groupby, filter, pivot,
// unpivot, union, derive, sort, dedupe, select, drop, rename, plus the five column
// transforms) over one or more existing tables through the real pipeline engine
// (executePipeline), and shows the user a block card with one step per op before
// anything is created. Only on Approve does it create the derived table (storing the
// { sources, recipe } link) and navigate the user to it. The engine computes every
// cell; the model only maps the request to ops and real table ids.
export const ACTION_TOOLS: AiTool[] = [
  clickElementTool,
  writeNoteTool,
  // draft_paper_summary and extract_paper_method are Outputs 1 and 2 of the
  // PDF-reproduce flow (spec docs/proposals/beakerbot-pdf-reproduce-analysis.md).
  // Both are gated writes raising a draft preview so the user reviews the proposed
  // note or method before anything writes. The paper text is already-extracted (PDF
  // ingestion is a separate task). HARD RULE: these tools are pure transcription
  // vehicles; the model never interprets, judges, ranks, or concludes about the paper.
  draftPaperSummaryTool,
  extractPaperMethodTool,
  // save_summary_as_note assembles a structured note from a summary-suite result and
  // writes it via the draft-preview gate. Numbers come verbatim from the summary tool,
  // the model only supplies the narration paragraph.
  saveSummaryAsNoteTool,
  // create_datahub_table (action: true, isDestructive false) turns pasted CSV/TSV
  // into a Data Hub "column" table in one call, reusing importTextToTable + the
  // dataHubApi.create path. The parser computes columns/rows verbatim; the user
  // approves the detected columns + row count before the write. Fills the CRUD gap
  // (no Data Hub table create tool before) and lets BeakerBot create a table then
  // suggest_tree_overlays it onto a tree, all in chat.
  createDatahubTableTool,
  // Memory coworker tools (action: true, isDestructive false). remember_preference
  // saves a standing user preference to _beakerbot_memory.json, reversible via
  // forget_preference. Both are low-stakes local writes the user explicitly asked for.
  rememberPreferenceTool,
  forgetPreferenceTool,
  createExperimentTool,
  rescheduleExperimentTool,
  createExperimentChainTool,
  // setup_experiment is the one-shot experiment setup coworker tool (action: true,
  // isDestructive false). In a single consented action it creates the experiment,
  // attaches methods, creates named prep tasks as FS-linked dependencies on the
  // Gantt, and scaffolds the results.md file so the Results tab opens with a real
  // header. The user sees a numbered preview of every step before anything writes.
  // None of the individual writes is destructive, so it never forces the hard-stop.
  setupExperimentTool,
  // setup_project is the project-level composite (action: true, isDestructive
  // false). In one consented action it creates the project, then creates each
  // experiment ALREADY assigned to that new project (scheduled back-to-back),
  // optionally links them as a finish-to-start chain, and scaffolds each results
  // file. The back-reference (children pointing at a parent that did not exist
  // before the call) is what the model cannot reliably do by chaining separate
  // create_* calls. The user sees a numbered preview of every step before any
  // write. None of the individual writes is destructive.
  setupProjectTool,
  // Scheduling coworker tools (action: true, isDestructive false). create_task
  // adds a task to a project the user names; reschedule_task moves a task through
  // the dependency-aware shift path (tasksApi.move) so dependents cascade and the
  // returned ShiftResult tells the model how many moved; update_task renames,
  // marks complete/incomplete, or moves a task to another project. The user sees a
  // one-line confirm before each writes. None deletes, so none forces the
  // destructive hard-stop. The local-api owns every write; the model only maps the
  // request to real project / task ids. Own-user tasks only for v1.
  createTaskTool,
  rescheduleTaskTool,
  updateTaskTool,
  linkTasksTool,
  // Method-library coworker tools (action: true, isDestructive false). create_method
  // authors a new markdown protocol (writes the body file, then records it) filed
  // under a folder with tags; update_method renames a method, sets its tags, or moves
  // it to another folder (metadata only). The user sees a one-line confirm before each
  // writes. Neither deletes, so neither forces the destructive hard-stop. NO
  // INTERPRETATION: create_method writes the user's own protocol, never an invented one.
  createMethodTool,
  updateMethodTool,
  // edit_method edits the protocol BODY of a markdown method (append a section or
  // rewrite). Reads the current file, writes the new body, re-stamps the excerpt.
  // NO-INTERPRETATION: the user's own protocol text, never invented steps.
  editMethodTool,
  // Project coworker tools (action: true, isDestructive false). create_project makes
  // a new project (the container a task/experiment needs); update_project renames,
  // sets tags, or archives/unarchives one (archive is reversible, never a delete).
  // One-line confirm before each writes; own projects only.
  createProjectTool,
  updateProjectTool,
  // Edit (update) coworker tools (action: true, isDestructive false). These close
  // the last "create but cannot edit" gaps: update_sequence / update_molecule /
  // update_note rename their object; update_purchase changes an order's item name,
  // quantity, vendor, or unit price, or moves its status (needs ordering -> ordered
  // -> received, via setOrderStatus so the bell fires). One-line confirm before each
  // writes; own objects only; none deletes.
  updateSequenceTool,
  updateMoleculeTool,
  updateNoteTool,
  updatePurchaseTool,
  // edit_note edits the CONTENT of a note (rewrite or append to an existing entry,
  // or the description for an entry-less note), distinct from write_note's append
  // of a NEW entry. NO-INTERPRETATION: the user's own words.
  editNoteTool,
  // edit_sequence / edit_molecule_structure replace the actual scientific content
  // (a sequence's bases via rawSeqToGenbank, a molecule's structure via the RDKit
  // SMILES->molblock path). ABSOLUTE no-interpretation: the bases / SMILES come from
  // the USER, never invented; a bad SMILES is rejected by the engine.
  editSequenceTool,
  editMoleculeStructureTool,
  // create_purchase logs an order (action: true, isDestructive false). The preview
  // shows vendor, item, quantity, price, and project before anything writes. Two-step
  // write: a parent Task with task_type "purchase", then the linked PurchaseItem.
  // Project resolved by name or id, money display strings are pre-formatted verbatim.
  createPurchaseTool,
  createSequenceTool,
  createMoleculeTool,
  importMoleculeTool,
  transformTableTool,
  wrangleTableTool,
  // Cloning coworker WRITE tools (action: true, isDestructive false). Each maps a
  // natural-language cloning request onto a validated, golden-tested engine and
  // shows a per-write approval card before creating a new library sequence.
  //   - fetch_sequence pulls a record from NCBI (by accession, or gene symbol +
  //     organism, or a genome accession; size-capped) and saves it.
  //   - extract_feature slices a region out of a sequence (by feature name or
  //     coordinates, reverse-complementing a minus-strand region) via extractRegion.
  //   - assemble_gibson runs assembleGibson over N fragments (homology, designed
  //     junction primers, rebased features) and saves the construct.
  //   - digest_ligate runs cutAndLigate (restriction + Golden Gate) and saves the
  //     chosen product.
  // The agent loop already chains tool calls, so "download GAPDH, pull the CDS,
  // Gibson it into pUC19" runs fetch -> extract -> assemble, each gated by its own
  // card. None is destructive (creating is reversible by deleting), so none forces
  // the destructive hard-stop. The engines compute every base; the model only maps
  // the request to engine calls and real ids.
  fetchSequenceTool,
  extractFeatureTool,
  assembleGibsonTool,
  digestLigateTool,
  // assemble_tree_fasta (output 3 input binding): fetches the user's library
  // sequences by id, assembles a raw multi-FASTA, and delivers it as a browser
  // download in the Allow-gesture window so the user can run a generate_tree
  // recipe on it. Reads sequences, never writes them; the download is reversible.
  assembleTreeFastaTool,
  // Inventory write tools (action: true, isDestructive false). add_inventory_item
  // creates a catalog record; adjust_inventory_stock restocks, consumes, or
  // corrects the count of an existing item resolved by name. Both preview before
  // writing; neither deletes, so neither forces the destructive hard-stop.
  addInventoryItemTool,
  adjustInventoryStockTool,
  // Delete coworker tools (action: true, isDestructive TRUE). Every delete is a
  // soft-delete (moves the object to _trash, recoverable), but it always forces the
  // destructive hard-stop confirm in both review modes. Own objects only.
  // delete_task also covers experiments (task records).
  deleteMethodTool,
  deleteProjectTool,
  deleteTaskTool,
  deleteNoteTool,
  deleteSequenceTool,
  deleteMoleculeTool,
  deletePurchaseTool,
];

// The coordination toolset. These tools neither read the user's data nor act on
// it, they steer the user-input flow itself, and the loop recognizes each by name
// and raises a request on the shared pause/resume bridge. None carries an `action`
// flag, they must not flow through the per-action gate.
//   - propose_plan is the proposal step of the plan-first action flow, it raises
//     a single Approve / Cancel for the whole plan, then lets the routine action
//     tools run without re-asking.
//   - ask_user is the structured-choice primitive, it raises a "choice" request so
//     the user TAPS a button to pick from a known small set instead of typing the
//     answer back, and returns the selection to the model.
export const COORDINATION_TOOLS: AiTool[] = [proposePlanTool, askUserTool];

// The default toolset handed to the agent loop, the read-only tools plus the
// coordination tools plus the action tools. The loop reads each tool's `action`
// flag (and special-cases propose_plan by name) to decide how to handle each, so
// mixing them in one list is safe.
export const DEFAULT_TOOLS: AiTool[] = [
  ...READ_ONLY_TOOLS,
  ...COORDINATION_TOOLS,
  ...ACTION_TOOLS,
];

/** Build a name -> tool lookup for dispatch. The loop calls this once per run and
 *  resolves each model-requested tool_call by name. */
export function buildToolMap(tools: AiTool[]): Map<string, AiTool> {
  const map = new Map<string, AiTool>();
  for (const tool of tools) map.set(tool.name, tool);
  return map;
}
