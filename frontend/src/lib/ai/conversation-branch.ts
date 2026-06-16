// BeakerBot conversation branching engine (BeakerAI lane, 2026-06-16).
//
// The pure tree model behind "edit and resend / branch": fork a conversation at a
// turn, explore an alternate path, and switch between the branches without losing
// either. This is the headless core. It owns ZERO React + ZERO store state; it is a
// plain immutable data structure plus pure operations, so it is fully unit-testable
// and can be adopted by the conversation store (which currently keeps a flat
// messages[] + a parallel LoopMessage historyStore) without that store reasoning
// about tree shape itself.
//
// MODEL. A conversation is a tree of message nodes. Most nodes have a single child
// (the linear case). A FORK is a node whose parent has more than one child, each
// child being an alternate continuation (an edited user turn, or a regenerated
// assistant reply, kept side by side). The ACTIVE PATH is the root-to-leaf walk
// that follows the chosen child at every fork; rendering the conversation just
// means listing the messages along the active path. Switching a branch re-points
// the active leaf, which changes the active path, which changes what renders.
//
// Each node also stores the index into the linear LoopMessage history at the point
// this message was produced (historyLen), so the store can trim/restore its
// parallel model.historyStore to match a switched branch without re-deriving it.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { ChatMessage } from "./conversation-store";

/** One node in the branch tree, wrapping a single chat message. */
export interface BranchNode {
  id: string;
  message: ChatMessage;
  parentId: string | null;
  /** Children in creation order. More than one child means this node is a fork
   *  point and each child begins an alternate branch. */
  childIds: string[];
  /**
   * The length of the parallel LoopMessage history (model.historyStore) AT the
   * moment this message was added, so the store can restore its history to this
   * exact point when this branch becomes active. Optional, defaults are handled by
   * the store; the engine only carries it.
   */
  historyLen?: number;
}

/** The whole conversation as a tree, plus the currently active leaf. */
export interface BranchTree {
  nodes: Record<string, BranchNode>;
  /** The first message in the conversation (the tree root). Null for an empty
   *  conversation (no messages yet). */
  rootId: string | null;
  /** The active path's tip. The active path is the root-to-this walk. */
  activeLeafId: string | null;
}

/** An empty tree (no messages yet). */
export function emptyBranchTree(): BranchTree {
  return { nodes: {}, rootId: null, activeLeafId: null };
}

/** Shallow-clone the tree so an operation can mutate the copy and return it,
 *  keeping every public operation pure (no input mutation). */
function clone(tree: BranchTree): BranchTree {
  const nodes: Record<string, BranchNode> = {};
  for (const id of Object.keys(tree.nodes)) {
    const n = tree.nodes[id];
    nodes[id] = { ...n, childIds: [...n.childIds] };
  }
  return { nodes, rootId: tree.rootId, activeLeafId: tree.activeLeafId };
}

/**
 * Build a single-branch tree from a linear message list (the migration path for an
 * existing conversation, and the empty-tree-plus-first-message case). Each message
 * becomes a node whose only child is the next message. The last message is the
 * active leaf. historyLens, when given, are attached per message by index.
 */
export function fromLinear(messages: ChatMessage[], historyLens?: number[]): BranchTree {
  if (messages.length === 0) return emptyBranchTree();
  const nodes: Record<string, BranchNode> = {};
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    nodes[m.id] = {
      id: m.id,
      message: m,
      parentId: i === 0 ? null : messages[i - 1].id,
      childIds: i + 1 < messages.length ? [messages[i + 1].id] : [],
      ...(historyLens && typeof historyLens[i] === "number" ? { historyLen: historyLens[i] } : {}),
    };
  }
  return {
    nodes,
    rootId: messages[0].id,
    activeLeafId: messages[messages.length - 1].id,
  };
}

/** Walk root-to-leaf along the active path and return the messages in order. The
 *  store renders exactly this list, so branching is invisible to the rest of the
 *  panel except for the per-fork switcher. */
export function activePath(tree: BranchTree): ChatMessage[] {
  const path: ChatMessage[] = [];
  // Build the active path by walking UP from the active leaf to the root, then
  // reversing. Walking up is unambiguous (one parent each); walking down would
  // need a per-node "active child" pointer.
  let cur = tree.activeLeafId;
  const guard = new Set<string>();
  while (cur) {
    if (guard.has(cur)) break; // cycle guard (never expected)
    guard.add(cur);
    const node = tree.nodes[cur];
    if (!node) break;
    path.push(node.message);
    cur = node.parentId;
  }
  return path.reverse();
}

/** The node ids on the active path, root-first. */
export function activePathIds(tree: BranchTree): string[] {
  return activePath(tree).map((m) => m.id);
}

/**
 * Append a message to the end of the active path (the normal, non-branching case).
 * The new message becomes the only-or-additional child of the current active leaf
 * and the new active leaf. On an empty tree the message becomes the root.
 */
export function appendToActive(
  tree: BranchTree,
  message: ChatMessage,
  historyLen?: number,
): BranchTree {
  const next = clone(tree);
  const node: BranchNode = {
    id: message.id,
    message,
    parentId: next.activeLeafId,
    childIds: [],
    ...(typeof historyLen === "number" ? { historyLen } : {}),
  };
  next.nodes[message.id] = node;
  if (next.activeLeafId && next.nodes[next.activeLeafId]) {
    next.nodes[next.activeLeafId].childIds.push(message.id);
  } else {
    next.rootId = message.id;
  }
  next.activeLeafId = message.id;
  return next;
}

/**
 * Fork at a message: add an ALTERNATE version of it as a sibling (same parent),
 * and make that sibling the new active leaf. This is the engine behind edit and
 * resend (fork an edited user turn) and regenerate-as-branch (fork an alternate
 * assistant reply): the original message and everything under it is preserved on
 * its branch, while the new sibling starts a fresh continuation the caller then
 * appends to. Returns the unchanged tree if the message is unknown.
 *
 * Forking the ROOT message is allowed: the new sibling becomes an alternate root,
 * and rootId is left pointing at the original (rootId is only used as a render
 * fallback; activePath follows activeLeafId, which now points at the new sibling).
 */
export function forkAt(
  tree: BranchTree,
  messageId: string,
  altMessage: ChatMessage,
  historyLen?: number,
): BranchTree {
  const target = tree.nodes[messageId];
  if (!target) return tree;
  const next = clone(tree);
  const sibling: BranchNode = {
    id: altMessage.id,
    message: altMessage,
    parentId: target.parentId,
    childIds: [],
    ...(typeof historyLen === "number" ? { historyLen } : {}),
  };
  next.nodes[altMessage.id] = sibling;
  if (target.parentId && next.nodes[target.parentId]) {
    next.nodes[target.parentId].childIds.push(altMessage.id);
  }
  next.activeLeafId = altMessage.id;
  return next;
}

/**
 * The sibling branches at a message's fork point, in order, with the active one's
 * index. "Siblings" = the children of this message's parent (which includes the
 * message itself). A message that is not a fork (its parent has a single child)
 * reports total 1. Root messages with alternate roots are handled by scanning for
 * parentless nodes. Returns the node ids so the UI can drive switchBranch.
 */
export function branchesAt(
  tree: BranchTree,
  messageId: string,
): { ids: string[]; activeIndex: number; total: number } {
  const node = tree.nodes[messageId];
  if (!node) return { ids: [], activeIndex: -1, total: 0 };

  let siblings: string[];
  if (node.parentId && tree.nodes[node.parentId]) {
    siblings = tree.nodes[node.parentId].childIds;
  } else {
    // Parentless: alternate roots are every node with no parent.
    siblings = Object.values(tree.nodes)
      .filter((n) => n.parentId === null)
      .map((n) => n.id);
  }

  // Which sibling is on the active path?
  const activeIds = new Set(activePathIds(tree));
  let activeIndex = siblings.findIndex((id) => activeIds.has(id));
  if (activeIndex === -1) activeIndex = siblings.indexOf(messageId);
  return { ids: siblings, activeIndex, total: siblings.length };
}

/**
 * Switch the active path to go through `nodeId`. The active leaf becomes the
 * deepest descendant reached by always following each node's FIRST child from
 * nodeId down (the most recently active-ish leaf of that branch), so switching to a
 * branch lands on its tip, not its fork point. Returns the unchanged tree if nodeId
 * is unknown.
 */
export function switchBranch(tree: BranchTree, nodeId: string): BranchTree {
  if (!tree.nodes[nodeId]) return tree;
  const next = clone(tree);
  let leaf = nodeId;
  const guard = new Set<string>();
  while (true) {
    if (guard.has(leaf)) break;
    guard.add(leaf);
    const node = next.nodes[leaf];
    if (!node || node.childIds.length === 0) break;
    // Follow the LAST child, the most recently added continuation on this branch.
    leaf = node.childIds[node.childIds.length - 1];
  }
  next.activeLeafId = leaf;
  return next;
}

/** The historyStore length to restore when this branch's tip is active, read off
 *  the active leaf. Null when unknown (the store then keeps its current history). */
export function activeHistoryLen(tree: BranchTree): number | null {
  const leaf = tree.activeLeafId ? tree.nodes[tree.activeLeafId] : null;
  return leaf && typeof leaf.historyLen === "number" ? leaf.historyLen : null;
}

/** Whether the tree has any fork at all (more than one child anywhere, or more
 *  than one root). Lets the store skip all branch UI for a plain linear chat. */
export function hasAnyBranch(tree: BranchTree): boolean {
  const roots = Object.values(tree.nodes).filter((n) => n.parentId === null);
  if (roots.length > 1) return true;
  return Object.values(tree.nodes).some((n) => n.childIds.length > 1);
}
