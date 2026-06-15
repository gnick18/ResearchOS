// BeakerBot tool layer types (ai tools bot, 2026-06-10; ai transform-tool bot, 2026-06-11).
//
// A tool is the unit the agent loop dispatches. The model is told each tool's
// name, description, and JSON-Schema parameters, and when it decides to call one
// the loop looks the tool up by name and runs `execute`. Keeping the shape this
// small is the whole point, adding the next tool later (a wiki search, a write
// tool behind approval) is just one more object in the registry, no loop change.
//
// Design doc section 1, the LLM orchestrates and never computes the truth. These
// definitions are what the model is handed. The read-only guarantee lives in the
// `execute` implementations, the loop itself imposes no write capability because
// no write tool exists yet.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

// A JSON-Schema object describing a tool's arguments. Kept loose on purpose, the
// provider only needs a plain JSON Schema object, and over-typing it here would
// fight every tool's bespoke shape.
export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

// How many options the user picks in a choice request. "one" is a single tap
// that resolves immediately, "multiple" toggles chips and confirms.
export type ChoiceSelect = "one" | "multiple";

// A request the agent loop surfaces to the UI before it proceeds. It comes in a
// few shapes, distinguished by `kind`, so the panel can render the right control.
// All three ride the SAME pause/resume bridge (requestApproval / resolveApproval),
// the loop awaits the user's answer through one resolver and never blocks the UI
// thread.
//
//   - kind "plan", BeakerBot is PROPOSING a whole plan up front. The user sees
//     the human-readable steps and approves the lot once with Approve / Cancel.
//     On approve the loop runs every routine step with no further asking. This is
//     what propose_plan raises.
//   - kind "action", a single ACTION needs a final confirm at the moment it runs
//     (Allow / Skip). This is the destructive hard-stop (delete, send, share,
//     pay) that ALWAYS confirms, even inside an already-approved plan, and the
//     fallback per-action confirm for a lone action with no plan.
//   - kind "choice", BeakerBot needs the user to PICK from a known small set
//     (which groups, which table, which test, yes or no). The user TAPS a button
//     instead of typing the answer, so the model gets a structured selection.
//     This is what ask_user raises. It is not an approval, the user is choosing,
//     so it resolves with the picked option(s), not allow / skip.
//   - kind "draft", BeakerBot has DRAFTED note content and wants to write it into
//     one of the user's notes. The user sees the proposed text rendered as a draft
//     preview (markdown) BEFORE anything is written, and approves or rejects it.
//     This is what write_note raises through the gate. Writing the user's actual
//     note content is sensitive, so the preview IS the consent, and only on Approve
//     does the tool's execute write to the note. Like plan and action it resolves
//     with allow / skip (Approve = allow, Reject = skip), so it reuses the same
//     pause/resume bridge with no parallel loop.
//
// The plan and action shapes describe what BeakerBot wants to do in plain words.
// The action shape can carry a perceived element ref so the UI spotlights the
// target before the user allows it. The draft shape carries the proposed note
// content so the UI can show it before the write.
export type ApprovalRequest =
  | {
      kind: "plan";
      /** The tool that raised the proposal, for the UI to label the prompt. */
      toolName: string;
      /** The human-readable steps BeakerBot intends to run, in order, for
       *  example ["Go to the Methods page", "Click the New Method button"]. */
      steps: string[];
      /** An optional one-line summary of the whole plan. */
      summary?: string;
    }
  | {
      kind: "action";
      /** The tool that wants to run, for the UI to label the confirm. */
      toolName: string;
      /** A short human sentence, for example "click New method". Authored by the
       *  tool through `describeAction`, never raw arguments. */
      summary: string;
      /** When the action targets a perceived element, its ref, so the UI can
       *  spotlight it. Optional, not every future action has a DOM target. */
      ref?: string;
      /** True when the destructive hard-stop forced this confirm, so the UI can
       *  warn more firmly. */
      destructive?: boolean;
    }
  | {
      kind: "draft";
      /** The tool that raised the draft, for the UI to label the prompt (always
       *  write_note). */
      toolName: string;
      /** The proposed note content, drafted by BeakerBot, shown to the user as a
       *  markdown preview BEFORE anything is written. This is what they approve. */
      content: string;
      /** Whether approving CREATES a new note or APPENDS the content to an
       *  existing one, so the preview can say which. */
      mode: "create" | "append";
      /** The title BeakerBot proposes for a new note, or the entry heading for an
       *  appended section. Optional, the UI falls back to a generic label. */
      title?: string;
      /** The title of the existing note the content would be appended to, for the
       *  preview copy on an append. Optional. */
      noteTitle?: string;
    }
  | {
      kind: "choice";
      /** The tool that raised the choice, for traceability (always ask_user). */
      toolName: string;
      /** The question shown above the buttons, for example "Which two groups
       *  would you like to compare?". */
      question: string;
      /** The options to render as buttons, each a short human label. */
      options: string[];
      /** "one" for a single immediate pick, "multiple" for a toggle-and-confirm. */
      select: ChoiceSelect;
      /** For "multiple", the exact number the user must pick before Confirm is
       *  enabled, for example 2 for a two-group t-test. Undefined means any
       *  number from one up. */
      count?: number;
    }
  | {
      kind: "transform";
      /** The tool that raised the transform approval (transform_table). */
      toolName: string;
      /** The human-readable name of the source table, for the card header. */
      sourceName: string;
      /** The proposed name for the new derived table, for the card header. */
      resultName: string;
      /** The ordered list of transform step blocks to render in the card. v1
       *  emits exactly one block. The array shape is the multi-step pipeline
       *  interface so the card generalizes without a type change. */
      steps: TransformStepBlock[];
    }
  | {
      kind: "step";
      /** The previewable tool that raised the step approval (run_datahub_analysis,
       *  compare_models, make_datahub_graph, the regression / global-fit family). */
      toolName: string;
      /** An Icon-registry glyph name for the step badge (e.g. "chart" for a stat
       *  test, "growth" for a plot, "lineage" for a model comparison). Rendered via
       *  the <Icon> component, so it must be a real registry name. */
      iconName: string;
      /** The card header line, what the step will do (e.g. "Run a Welch t-test,
       *  Control vs Drug"). */
      title: string;
      /** An optional second header line (e.g. the table it acts on). */
      subtitle?: string;
      /** The ordered step blocks. The previewable analysis / plot / model tools
       *  emit exactly one block; the array shape keeps the card future-proof for a
       *  multi-step preview without a type change. */
      steps: TransformStepBlock[];
    };

/**
 * One step block inside a transform approval card. Carries the step's kind,
 * its human label and blurb (from KIND_META in TransformDialog), the param
 * pills (label/value pairs the card renders as readable chips), and an optional
 * real preview of the first rows of the transformed output.
 *
 * The kind is a TransformKind string. Typed as string here so this file does
 * not depend on datahub/model/types, keeping the tool layer self-contained.
 */
export type TransformStepBlock = {
  /** The TransformKind discriminator string (e.g. "normalize"). */
  kind: string;
  /** Human label from KIND_META (e.g. "Normalize"). */
  name: string;
  /** One-line blurb from KIND_META. */
  blurb: string;
  /** Human-readable param pills to render on the card. */
  params: { label: string; value: string }[];
  /** A live preview of the first rows of the transformed output. Optional;
   *  absent when the engine could not run (bad params). */
  preview?: {
    columns: string[];
    rows: string[][];
  };
  /** A non-tabular live preview, a few short readout lines (e.g. the resolved
   *  test name and the groups for a stat test, the figure kind and columns for a
   *  plot, the two models for a comparison). Used by the previewable analysis /
   *  plot tools whose preview is not a table. Optional; rendered under the params
   *  when present. */
  previewLines?: string[];
};

/**
 * A TransformApprovalRequest is the `kind:"transform"` member of ApprovalRequest,
 * re-exported as a named type so transform-table.ts can reference it directly
 * without repeating the shape. It IS the ApprovalRequest variant, just narrowed.
 */
export type TransformApprovalRequest = Extract<ApprovalRequest, { kind: "transform" }>;

/**
 * The `kind:"step"` member of ApprovalRequest, re-exported so the previewable
 * analysis / plot / model tools can build it directly. It reuses TransformStepBlock
 * for the per-step body (label, blurb, param pills, and either a table or readout-
 * line preview) but carries its own generic header (icon, title, subtitle) rather
 * than the transform-specific source / result naming.
 */
export type StepApprovalRequest = Extract<ApprovalRequest, { kind: "step" }>;

// The UI's answer to a request on the bridge. The plan and action shapes resolve
// with the two-value approval decision, "allow" proceeds (run the action, or
// approve the plan), "skip" declines (do not run, or cancel) so the model can
// respond gracefully. The panel labels the buttons to match the request kind
// (Allow / Skip, Approve / Cancel). A choice request resolves with a richer value
// instead, the option(s) the user picked, or a cancelled flag when they dismissed
// without choosing, so the model continues with the real selection rather than a
// yes / no.
export type ApprovalDecision = "allow" | "skip" | ChoiceDecision | DraftSaveDecision;

// The answer to a DRAFT request when the user saves from Canvas. Canvas is the
// editable surface over the model's proposed draft content, so Save carries the
// user's EDITED text (which may equal the original when they did not change it).
// Saving IS the consent that replaces the old Approve. The draft gate, on this
// decision, calls the tool's draft.applyEdit(args, content) to write the edited
// string into that tool's own content arg, then proceeds so execute writes the
// user's text rather than the model's original. A "skip" decision (Discard) is
// the reject path, nothing is written.
export type DraftSaveDecision = {
  kind: "draft-save";
  /** The edited draft content the user chose to save. */
  content: string;
};

/** Type guard, narrow an ApprovalDecision to a draft-save decision. */
export function isDraftSaveDecision(
  decision: ApprovalDecision,
): decision is DraftSaveDecision {
  return typeof decision === "object" && decision.kind === "draft-save";
}

// The answer to a choice request. `selected` carries the picked option strings
// (exactly one for "one", one or more for "multiple"). `cancelled` is true when
// the user dismissed without choosing, in which case `selected` is empty.
export type ChoiceDecision = {
  kind: "choice";
  selected: string[];
  cancelled: boolean;
};

/** Type guard, narrow an ApprovalDecision to a choice decision. The plan and
 *  action gates only ever see "allow" / "skip", so this is how the ask_user
 *  handler reads its richer answer off the shared bridge. */
export function isChoiceDecision(
  decision: ApprovalDecision,
): decision is ChoiceDecision {
  return typeof decision === "object" && decision.kind === "choice";
}

// A single tool BeakerBot can call. `execute` receives the parsed argument object
// the model produced and returns a result that is JSON-serialized back into the
// conversation as the tool message. Results should be compact and model-friendly,
// not raw store records.
//
// An ACTION tool sets `action: true`. Action tools may CHANGE something (the
// first one is click_element, which dispatches a real click), so the agent loop
// routes them through the approval gate. A tool without `action` is treated as
// read-only and runs immediately, the way the perception and data-reader tools
// always have. New write tools (note writing, run_analysis) reuse this same flag
// and gate, no loop change per tool.
export type AiTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  /** When true, this tool performs an action and goes through the approval gate
   *  in the agent loop. In step review mode it shows a preview-and-confirm block
   *  for every call; in plan review mode it runs once the plan is approved (or
   *  pops a single confirm for a lone step), with a destructive hard-stop in
   *  both. Absent / false = read-only, runs immediately. */
  action?: boolean;
  /** When true, this action changes NOTHING in the user's data, it only moves
   *  around or shows the UI (navigate, click a nav link or tab, highlight an
   *  element). An immutable action runs WITHOUT a per-step confirm in BOTH review
   *  modes, so step-by-step does not ask permission to click to a page or point at
   *  a button. The destructive safety net still applies, an immutable click whose
   *  target looks destructive or outward-facing (Delete, Send, Pay, ...) still
   *  confirms via isDestructive. Only meaningful together with `action`. */
  immutable?: boolean;
  /** When true, this is a non-action tool that still shows a preview-and-confirm
   *  block in step review mode (the instant analysis/plot tools); ignored in plan
   *  mode. It writes a new, reversible, version-controlled result rather than an
   *  action, so it carries no `action` flag, but in step-by-step every meaningful
   *  step is reviewed, so it gates there too. */
  previewable?: boolean;
  /** For action tools, build the human approval summary and optional target ref
   *  from the parsed args, so the loop can show the user what will happen WITHOUT
   *  running the tool. Pure, never effectful. Optional, the loop falls back to a
   *  generic summary when absent.
   *
   *  An action whose approval is a DRAFT PREVIEW (write_note) returns a `draft`
   *  payload here instead of a plain summary. When present, the gate raises a
   *  `kind:"draft"` request carrying the proposed content (rendered as a markdown
   *  preview) rather than the one-line `kind:"action"` confirm, so the user reviews
   *  the actual text before it is written. It still resolves with allow / skip on
   *  the same bridge, Approve = allow, Reject = skip. */
  describeAction?: (args: Record<string, unknown>) => {
    summary: string;
    ref?: string;
    draft?: {
      content: string;
      mode: "create" | "append";
      title?: string;
      noteTitle?: string;
      /**
       * Write the user's Canvas-edited content back into the tool's OWN args so
       * execute() writes the edited text instead of the model's original draft.
       * The draft gate calls this with (args, editedContent) BEFORE proceed when
       * the user saves from Canvas. Each tool knows which arg its execute reads
       * (for example content / draftContent), or sets a reserved override arg the
       * execute prefers when the content is composed from structured inputs.
       * Mutates args in place. Optional, when absent the gate falls back to the
       * model's original draft content (older draft tools keep working unchanged).
       */
      applyEdit?: (args: Record<string, unknown>, editedContent: string) => void;
    };
    /**
     * When present, the gate raises a `kind:"transform"` block-card approval
     * instead of a one-line `kind:"action"` confirm. The user sees the step
     * block(s), param pills, and a live preview, then Approves or Rejects.
     * Resolves with allow / skip on the same bridge as the draft path.
     */
    transformPayload?: TransformApprovalRequest;
    /**
     * When present, the gate raises a `kind:"step"` rich-block approval instead
     * of the one-line `kind:"action"` confirm. Used by the previewable analysis,
     * plot, and model tools so each step shows a labelled block with input pills
     * and a readout preview before it runs. Resolves with allow / skip on the
     * same bridge as the transform path.
     */
    stepPayload?: StepApprovalRequest;
  };
  /** For action tools, decide whether THIS specific call must hard-stop for a
   *  confirm in BOTH review modes, even inside an already-approved whole plan
   *  (the destructive safety net). Pure. Optional, absent = never forces a
   *  confirm beyond what the review mode already requires. */
  isDestructive?: (args: Record<string, unknown>) => boolean;
};

// The wire shape the provider expects for tool definitions (OpenAI-compatible
// `tools` array). The loop maps each AiTool to this before sending, stripping the
// `execute` function, which must never leave the browser.
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

/** Strip an AiTool down to the provider-facing definition. The `execute`
 *  function is intentionally dropped, only name, description, and the JSON Schema
 *  cross the wire. */
export function toToolDefinition(tool: AiTool): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
