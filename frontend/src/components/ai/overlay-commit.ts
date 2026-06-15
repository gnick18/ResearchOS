// Chat-side host commit for the Smart Data Binding wizard (BeakerAI lane,
// 2026-06-14).
//
// suggest_tree_overlays mounts the SAME SmartDataWizard the /phylo GUI uses, so
// applying overlays must do the SAME two writes the GUI host (PhyloStudio.
// addSmartOverlays) does, but persist them directly (the chat is not inside the
// Studio): (1) merge the chosen table columns into the tree's tip-keyed metadata
// via the engine, and (2) append one overlay panel (makePanel) per selection,
// spliced just inside any labels layer so labels stay outermost. Then navigate to
// the Tree Studio so the user sees the restyled tree.
//
// The engine (mergeTableColumnsIntoMetadata) is deterministic and owned by the
// phylo lane; this host only orchestrates the load + merge + persist.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { phyloApi } from "@/lib/phylo/api";
import { dataHubApi } from "@/lib/datahub/api";
import { parseTree, leaves } from "@/lib/phylo/parse";
import { mergeTableColumnsIntoMetadata } from "@/lib/phylo/smart-binding";
import { projectTracksToPanels } from "@/lib/phylo/panels";
import { makePanel } from "@/components/phylo/PhyloLayers";
import type { AlignedPanel, PhyloFigureSpec } from "@/lib/phylo/types";
import type { OverlaySelection } from "@/components/phylo/SmartDataWizard";

export type OverlayCommitArgs = {
  /** The tree to overlay (from the wizard payload, not the wizard callback). */
  treeId: string;
  tableId: string;
  tableName: string;
  joinColumnId: string;
  selections: OverlaySelection[];
};

export type OverlayCommitResult =
  | { ok: true; treeId: string; treeName: string }
  | { ok: false; error: string };

/** Apply the wizard's chosen overlays onto a saved tree, persisting via
 *  phyloApi.updateMeta. Mirrors PhyloStudio.addSmartOverlays. Does NOT navigate,
 *  the chat host shows the result as a live inline tree card in place instead (the
 *  calm, GUI-parity behavior, Grant 2026-06-14). */
export async function applyOverlayCommit(
  args: OverlayCommitArgs,
): Promise<OverlayCommitResult> {
  let files;
  try {
    files = await phyloApi.get(args.treeId);
  } catch {
    return { ok: false, error: "I could not read that tree's file." };
  }
  if (!files) return { ok: false, error: "That tree could not be found." };

  let tree;
  try {
    tree = parseTree(files.tree);
  } catch {
    return { ok: false, error: "I could not parse that tree." };
  }

  const content = await dataHubApi.getContent(args.tableId);
  if (!content) return { ok: false, error: "I could not read that table's data." };

  const meta = files.meta;
  const binding = meta.metadata;
  const columnIds = Array.from(new Set(args.selections.map((s) => s.columnId)));

  const merged = mergeTableColumnsIntoMetadata({
    tree,
    existing:
      binding?.rows && binding.tipColumn
        ? { rows: binding.rows, tipColumn: binding.tipColumn }
        : null,
    tableName: args.tableName,
    content,
    joinColumnId: args.joinColumnId,
    columnIds,
  });

  // One overlay panel per selection, bound to the merged (collision-free) name.
  // mergeTableColumnsIntoMetadata reports each requested column's bound name in
  // addedColumns (including a column already on the tree, once the engine reuses
  // it). We bind every selection to that name.
  const nameFor = new Map(merged.addedColumns.map((a) => [a.columnId, a.name]));
  const newPanels: AlignedPanel[] = [];
  for (const s of args.selections) {
    const name = nameFor.get(s.columnId);
    if (name) newPanels.push(makePanel(s.geom, [name]));
  }

  // Never report a false success. If the user picked overlays but none resolved
  // to a panel (e.g. the engine did not report a bound name for the column), the
  // commit is a no-op, so fail loudly instead of letting the wizard claim "added".
  if (args.selections.length > 0 && newPanels.length === 0) {
    return {
      ok: false,
      error:
        "I could not add those overlays. The column may already be on the tree, or its data did not resolve.",
    };
  }

  // The panels to splice into. When the tree has a saved figure, use its panels.
  // When it has NONE yet (never opened in the Studio), seed the SAME baseline
  // stack PhyloStudio.defaultPanels uses (labels + default decorations) FIRST, so
  // the result is a normal labeled tree plus the overlays, not bare overlays on an
  // unlabeled tree (phylo lane recipe, 2026-06-14). The tree topology itself is
  // always drawn by renderTreeSvg independent of panels.
  const basePanels: AlignedPanel[] =
    meta.figure?.panels ??
    projectTracksToPanels({
      tracks: {
        labels: leaves(tree).length <= 100,
        labelsItalic: true,
        points: true,
        strip: true,
        bars: false,
        heat: false,
        clade: false,
        support: false,
      },
    });

  // Splice the new panels just inside any labels layer (labels stay outermost).
  const labelIdx = basePanels.findIndex((p) => p.kind === "labels");
  const panels =
    labelIdx === -1
      ? [...basePanels, ...newPanels]
      : [
          ...basePanels.slice(0, labelIdx),
          ...newPanels,
          ...basePanels.slice(labelIdx),
        ];

  const figure: PhyloFigureSpec = meta.figure
    ? { ...meta.figure, panels }
    : { layout: "rectangular", branchLengths: true, tracks: {}, panels };

  const metadata = {
    ...(binding ?? {}),
    tipColumn: merged.tipColumn,
    rows: merged.rows,
  };

  try {
    await phyloApi.updateMeta(args.treeId, { figure, metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `I could not save the overlays: ${msg}` };
  }

  // No navigation: the chat host renders the overlaid tree as a live inline card
  // (with its own Open-in-Studio button) so the user stays in the conversation.
  return { ok: true, treeId: args.treeId, treeName: meta.name || "Tree" };
}
