// Phylo Tree Studio, Newick / Nexus parser (Phase 2).
//
// Turns a tree-text string into an immutable tree object the layout + renderer
// read. Phase 0 already ships a standalone tip COUNTER (newick.ts) so the store
// can stamp tip_count without pulling in the renderer; this is the full parser
// that produces a real node tree, kept separate so the SSR-safe counter never
// drags the Studio in.
//
// We hand-write a tiny parser rather than add a dependency: Newick is a small
// grammar, an in-house parser keeps the bundle lean and the behavior auditable
// (the design doc left "tiny in-house vs small MIT dep" open, in-house wins for
// no-new-dep and full control over quoted labels / support values).
//
// No em-dashes, no emojis, no mid-sentence colons.

/**
 * One node in a parsed tree. Immutable by convention (the editing ops in
 * layout.ts return new trees, they never mutate). A leaf has an empty children
 * array. Internal nodes may be unnamed. `support` is the internal-node support
 * value when the label parses as a bare number (the IQ-TREE / RAxML convention).
 */
export interface TreeNode {
  /** Stable id, assigned depth-first on parse, so edits can target a node. */
  id: number;
  /** Tip / clade name. Empty string for an unnamed internal node. */
  name: string;
  /** Branch length to the parent, or null when the tree carries none. */
  branchLength: number | null;
  /** Internal-node support value (parsed from a numeric internal label). */
  support: number | null;
  children: TreeNode[];
}

/** A parse problem surfaced to the user instead of throwing into the UI. */
export class TreeParseError extends Error {}

/**
 * Pull the first Newick expression out of arbitrary tree text. A `.treefile`
 * may carry comment lines or a leading label, and a Nexus file wraps the Newick
 * in a TREES block, so we slice from the first "(" to the matching ";".
 */
function extractNewickString(text: string): string {
  const start = text.indexOf("(");
  if (start === -1) {
    // A single-tip tree (no parens) is still legal Newick, e.g. "A;".
    const semi = text.indexOf(";");
    return semi === -1 ? text.trim() : text.slice(0, semi + 1).trim();
  }
  const end = text.indexOf(";", start);
  return end === -1 ? text.slice(start) : text.slice(start, end + 1);
}

/**
 * Extract the Newick tree string from a Nexus TREES block. Nexus stores trees
 * as `tree NAME = [&R] (newick);` inside a `begin trees;` block, often with a
 * `translate` table mapping integer tokens to real taxon names. We reuse the
 * translate table so tip labels come back as the real names, not "1", "2".
 */
function nexusToNewick(text: string): string {
  const lower = text.toLowerCase();
  // Translate table: "translate 1 A, 2 B, ... ;".
  const translate: Record<string, string> = {};
  const tIdx = lower.indexOf("translate");
  if (tIdx !== -1) {
    const tEnd = text.indexOf(";", tIdx);
    const body = text.slice(tIdx + "translate".length, tEnd === -1 ? undefined : tEnd);
    for (const entry of body.split(",")) {
      const m = entry.trim().match(/^(\S+)\s+(.+)$/);
      if (m) translate[m[1]] = stripQuotes(m[2].trim());
    }
  }
  // First "tree ... = ... ;" statement.
  const treeMatch = text.match(/tree\s+[^=]+=\s*(\[[^\]]*\]\s*)?([^;]+;)/i);
  if (!treeMatch) {
    throw new TreeParseError("No tree statement found in the Nexus file.");
  }
  let nwk = treeMatch[2];
  if (Object.keys(translate).length > 0) {
    // Replace whole-token integer labels with their translated names.
    nwk = nwk.replace(/([(,])\s*(\w+)/g, (whole, sep: string, tok: string) =>
      translate[tok] ? `${sep}${translate[tok]}` : whole,
    );
  }
  return nwk;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    // Newick escapes a literal quote by doubling it.
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/** Is this text a Nexus file (so we route through nexusToNewick first)? */
export function isNexus(text: string): boolean {
  return /^\s*#nexus/i.test(text);
}

/**
 * Parse a Newick string into a TreeNode. Handles quoted labels (single quotes,
 * with doubled-quote escaping), branch lengths, numeric internal support
 * labels, multifurcation, and unnamed internal nodes. Throws TreeParseError on
 * a malformed string so the Studio can show a calm message instead of crashing.
 */
export function parseNewick(text: string): TreeNode {
  const s = extractNewickString(text);
  if (!s) throw new TreeParseError("The tree text is empty.");
  let i = 0;
  let nextId = 0;

  function peek(): string {
    return s[i];
  }

  function readLabel(): string {
    // Quoted label: read to the closing quote, honoring doubled-quote escapes.
    if (peek() === "'") {
      let out = "";
      i++; // opening quote
      while (i < s.length) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            out += "'";
            i += 2;
            continue;
          }
          i++; // closing quote
          break;
        }
        out += s[i++];
      }
      return out;
    }
    // Bare label: read to a token boundary. Newick allows "_" to mean a space.
    let out = "";
    while (i < s.length && !"():,;".includes(s[i])) out += s[i++];
    return out.trim().replace(/_/g, " ");
  }

  function readNumber(): number | null {
    let out = "";
    while (i < s.length && /[\d.eE+-]/.test(s[i])) out += s[i++];
    if (out === "") return null;
    const n = Number(out);
    return Number.isFinite(n) ? n : null;
  }

  function parseNode(): TreeNode {
    const node: TreeNode = {
      id: nextId++,
      name: "",
      branchLength: null,
      support: null,
      children: [],
    };
    if (peek() === "(") {
      i++; // consume "("
      // At least one child, comma-separated, until the matching ")".
      // eslint-disable-next-line no-constant-condition
      while (true) {
        node.children.push(parseNode());
        if (peek() === ",") {
          i++;
          continue;
        }
        if (peek() === ")") {
          i++;
          break;
        }
        throw new TreeParseError(
          `Unexpected character "${peek() ?? "end"}" at position ${i}.`,
        );
      }
    }
    // Optional label (tip name, or numeric support on an internal node).
    if (i < s.length && !"():,;".includes(peek())) {
      const label = readLabel();
      if (node.children.length > 0 && /^\d+(\.\d+)?$/.test(label)) {
        node.support = Number(label);
      } else {
        node.name = label;
      }
    }
    // Optional branch length.
    if (peek() === ":") {
      i++;
      node.branchLength = readNumber();
    }
    return node;
  }

  const root = parseNode();
  return root;
}

/** Parse Newick OR Nexus, auto-detecting which (the two formats the Studio reads). */
export function parseTree(text: string): TreeNode {
  if (isNexus(text)) return parseNewick(nexusToNewick(text));
  return parseNewick(text);
}

/** Depth-first list of leaf nodes, left to right (the tip order top to bottom). */
export function leaves(node: TreeNode, acc: TreeNode[] = []): TreeNode[] {
  if (node.children.length === 0) acc.push(node);
  else for (const c of node.children) leaves(c, acc);
  return acc;
}

/** Every node in the tree, depth-first. */
export function allNodes(node: TreeNode, acc: TreeNode[] = []): TreeNode[] {
  acc.push(node);
  for (const c of node.children) allNodes(c, acc);
  return acc;
}

/** Tip count for a parsed tree (the renderer-side twin of countNewickTips). */
export function tipCount(node: TreeNode): number {
  return leaves(node).length;
}
