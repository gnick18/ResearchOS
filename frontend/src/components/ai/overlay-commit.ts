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
import { parseTree } from "@/lib/phylo/parse";
import { mergeTableColumnsIntoMetadata } from "@/lib/phylo/smart-binding";
import { makePanel } from "@/components/phylo/PhyloLayers";
import { requestNavigation } from "@/components/ai/navigation-bridge";
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
  | { ok: true; treeId: string }
  | { ok: false; error: string };

/** Apply the wizard's chosen overlays onto a saved tree, then navigate to it.
 *  Mirrors PhyloStudio.addSmartOverlays, persisting via phyloApi.updateMeta. */
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
  const nameFor = new Map(merged.addedColumns.map((a) => [a.columnId, a.name]));
  const newPanels: AlignedPanel[] = [];
  for (const s of args.selections) {
    const name = nameFor.get(s.columnId);
    if (name) newPanels.push(makePanel(s.geom, [name]));
  }

  // Splice the new panels just inside any labels layer (labels stay outermost),
  // mirroring the GUI. Build a valid minimal figure when the tree has none yet.
  const existingPanels: AlignedPanel[] = meta.figure?.panels ?? [];
  const labelIdx = existingPanels.findIndex((p) => p.kind === "labels");
  const panels =
    labelIdx === -1
      ? [...existingPanels, ...newPanels]
      : [
          ...existingPanels.slice(0, labelIdx),
          ...newPanels,
          ...existingPanels.slice(labelIdx),
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

  requestNavigation(`/phylo?doc=${args.treeId}#ros=studio`);
  return { ok: true, treeId: args.treeId };
}
