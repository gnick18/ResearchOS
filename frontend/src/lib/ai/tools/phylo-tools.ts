// BeakerBot phylogenetics read tools (BeakerAI lane, 2026-06-12).
//
// Read-only access to the user's saved phylogenetic trees, plus the markdown
// BeakerBot emits to SHOW a tree as a chat card. The /phylo embed + deep-link are
// BUILT and frozen by the Phylogenetics lane (docs/proposals/2026-06-12-beakerbot-
// phylo-contract.md): ObjectEmbed dispatches phylo -> PhyloEmbed, and a reference
// to /phylo?doc=<id> opens the saved tree in the Tree Studio. So all BeakerBot
// needs is to FIND a tree (these tools) and emit the card link.
//
// Constraints from the contract (do not violate): consume READ-ONLY, never write
// or invent a tree / tip count / flag, no compute or inference. Building a tree
// from a wizard stays navigate + guide until the Phylogenetics lane re-relays the
// frozen BuilderOptions + catalog.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { phyloApi, type PhyloMeta } from "@/lib/phylo/api";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import type { AiTool } from "./types";

// The markdown that renders a saved tree as a self-contained card in chat (the
// #ros=studio fragment makes the embed pipeline draw the figure). Exported pure
// for tests and so the description and the tools agree on one format.
export function treeCardEmbed(meta: { id: string; name: string }): string {
  return `[${meta.name || "Tree"}](/phylo?doc=${meta.id}#ros=studio)`;
}

// Injectable seam so the tools are unit-testable without a real folder.
export type PhyloToolsDeps = {
  listTrees: () => Promise<PhyloMeta[]>;
  navigate: (path: string) => void;
};

export const phyloToolsDeps: PhyloToolsDeps = {
  listTrees: () => phyloApi.list(),
  navigate: requestNavigation,
};

/** Resolve a tree reference (a stable string id or a case-insensitive name) to a
 *  PhyloMeta, or null. Pure. */
export function resolveTree(trees: PhyloMeta[], ref: string | undefined): PhyloMeta | null {
  if (!ref) return null;
  const r = ref.trim();
  const byId = trees.find((t) => t.id === r);
  if (byId) return byId;
  const lower = r.toLowerCase();
  return trees.find((t) => (t.name ?? "").trim().toLowerCase() === lower) ?? null;
}

/** The compact per-tree shape the model relays. The embed is the markdown to
 *  show the figure as a card. */
function briefOf(meta: PhyloMeta) {
  return {
    id: meta.id,
    name: meta.name || "Untitled tree",
    tips: meta.tip_count ?? null,
    projectIds: meta.project_ids ?? [],
    addedAt: meta.added_at ?? null,
    embed: treeCardEmbed(meta),
  };
}

export const listPhyloTreesTool: AiTool = {
  name: "list_phylo_trees",
  description:
    "List the user's saved phylogenetic trees (the Phylogenetics page / Tree Studio). Use this when the user asks what trees they have, to find a tree by name, or before showing one. Returns each tree's id, name, tip count, and a ready-to-use embed markdown. To SHOW a tree to the user, end your reply with that tree's embed on its own line, the markdown [<name>](/phylo?doc=<id>#ros=studio), which renders the figure as a card in the chat. This is read-only, it changes nothing. You never invent a tree, a tip count, or a tree id, only repeat what this returns. To BUILD a new tree, you cannot do it programmatically yet, so guide the user to the Phylogenetics page instead (go_to_page).",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => {
    try {
      const trees = await phyloToolsDeps.listTrees();
      return { ok: true as const, count: trees.length, trees: trees.map(briefOf) };
    } catch {
      return { ok: false as const, error: "I could not read your saved trees. A folder may not be connected." };
    }
  },
};

export const readPhyloTreeTool: AiTool = {
  name: "read_phylo_tree",
  description:
    "Read one of the user's saved phylogenetic trees by name or id, to answer a question about it or to show it. Call list_phylo_trees first if you do not have the id. Returns the tree's name, tip count, projects, and the embed markdown. To show it, end your reply with the returned embed on its own line. Read-only, you never invent a tip count or any detail. To build or restyle a tree, guide the user to the Phylogenetics page, you cannot do it programmatically yet.",
  parameters: {
    type: "object",
    properties: {
      tree: {
        type: "string",
        description: "The tree to read, by its name or its stable id, from a list_phylo_trees result.",
      },
    },
    required: ["tree"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const ref = typeof args.tree === "string" ? args.tree : undefined;
    let trees: PhyloMeta[];
    try {
      trees = await phyloToolsDeps.listTrees();
    } catch {
      return { ok: false as const, error: "I could not read your saved trees. A folder may not be connected." };
    }
    const meta = resolveTree(trees, ref);
    if (!meta) {
      const names = trees.map((t) => `"${t.name}"`).join(", ");
      return {
        ok: false as const,
        error: `I could not find a tree called "${ref}". Your trees are: ${names || "(none yet)"}.`,
      };
    }
    return { ok: true as const, tree: briefOf(meta) };
  },
};
