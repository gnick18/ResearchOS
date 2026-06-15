"use client";

// BeakerBot context bridge (ai context-layer0 bot, 2026-06-11).
//
// A tiny, framework-free store that any page can write to tell the BeakerBot
// panel what the user currently has open. The panel reads it at send time and
// injects a fresh system message each turn so the model can resolve "this",
// "the t-test", or "this result" to the on-screen selection without asking.
//
// Why a module-level store instead of React state or a context provider: the
// bridge has to be writable from any page component (which is a React tree) but
// readable from useAiChat (also React) with no shared ancestor, so a common
// provider would require wiring the entire App tree. A module store is simpler
// and more robust. The values are tiny (just IDs and names), so there is no
// memory concern. The panel re-reads the store on every send, so it is always
// fresh and never stale.
//
// Generic design: the BeakerSelection type is intentionally open-typed (a
// string "type" discriminant) so notes, sequences, methods, and any future
// surface can contribute a selection without a datahub-specific shape. The
// bridge does not know what the selection means; the panel's description
// function formats it for the model.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

/** A single selected entity on the current page. Generic so every surface (Data
 *  Hub, notes, sequences, methods, ...) can push its own selection shape by
 *  setting a "type" discriminant. The id and name are always present so the
 *  model can pass the id straight to the matching read tool. The optional parent
 *  field captures a container, for example the table that owns an analysis. */
export type BeakerSelection = {
  /** Discriminant, e.g. "datahub-table", "datahub-analysis", "datahub-plot",
   *  "note", "sequence". */
  type: string;
  id: string;
  name: string;
  /** The container this selection lives in. For an analysis the parent is its
   *  table, which gives the model both ids in one message. */
  parent?: { type: string; id: string; name: string };
  /** The project(s) this selection belongs to, when the surface knows them.
   *  Published by PhyloStudio for an open tree so a tool can default a new
   *  object (e.g. create_datahub_table) into the same project — "make a table
   *  from this and put it on my tree" then files into the tree's project.
   *  Plural: a tree can union several projects. Optional and open-typed; a
   *  surface that does not know its projects simply omits it. */
  projectIds?: string[];
};

/** The full context snapshot a page publishes. route and pageLabel tell the
 *  model where the user is. selection is the entity the user currently has open
 *  or highlighted, if any. A page publishes null to clear the context when the
 *  user navigates away. */
export type BeakerContext = {
  /** The current window path, e.g. "/datahub". */
  route: string;
  /** Human label for the page, e.g. "Data Hub". */
  pageLabel?: string;
  /** The entity the user currently has open or selected. Omit when nothing
   *  specific is open (the model will see only the route). */
  selection?: BeakerSelection;
};

// ---------------------------------------------------------------------------
// Module-level store (one live context at a time)
// ---------------------------------------------------------------------------

let _ctx: BeakerContext | null = null;

/** Publish what the user currently has open. Pages call this in a useEffect
 *  whenever selectedTableId / selectedAnalysisId / etc. change, and again with
 *  null on unmount to clear the context when the user leaves the page. */
export function setBeakerContext(ctx: BeakerContext | null): void {
  _ctx = ctx;
}

/** Read the live context. The BeakerBot panel calls this at send time to build
 *  the per-turn context system message. It is synchronous and always returns
 *  the most recent value. */
export function getBeakerContext(): BeakerContext | null {
  return _ctx;
}

// ---------------------------------------------------------------------------
// describeBeakerContext (PURE, no side effects)
// ---------------------------------------------------------------------------

/** Render a compact English description of the context for the model, or null
 *  when there is nothing useful to say (no context, or context with only a
 *  route the model already knows). The model reads this as a system message so
 *  it can resolve "this", "the t-test", or "this result" without asking.
 *
 *  Pure: takes the context as an argument rather than reading _ctx so it is
 *  trivially unit-testable and the panel can call it with a snapshot it
 *  captured rather than the live store if it needs to. */
export function describeBeakerContext(ctx: BeakerContext | null): string | null {
  if (!ctx) return null;

  const { route, pageLabel, selection } = ctx;
  const label = pageLabel ?? route;

  if (!selection) {
    // Route only. A bare "the user is on /datahub" is not useful on its own
    // because the model can read_page to find that out. Return null so the
    // panel does not waste a system-message slot on a no-op.
    return null;
  }

  const parts: string[] = [];
  parts.push(`The user is currently on the ${label}.`);

  if (selection.parent) {
    parts.push(
      `They have the ${selection.parent.type.replace("datahub-", "")} "${selection.parent.name}" open.`,
    );
  }

  // Build the entity line. Include the id so the model can pass it straight to
  // the matching read tool (read_datahub_analysis, etc.) without guessing.
  const kindLabel = selection.type
    .replace("datahub-", "")
    .replace("-", " ");

  parts.push(
    `They have the ${kindLabel} "${selection.name}" (id ${selection.id}) selected.`,
  );

  parts.push(
    `If they say "this", "the ${kindLabel}", or refer to a result without naming it, they most likely mean this ${kindLabel}. Use its id (${selection.id}) directly when calling a read tool, do not ask what they mean unless there is genuine ambiguity.`,
  );

  return parts.join(" ");
}
