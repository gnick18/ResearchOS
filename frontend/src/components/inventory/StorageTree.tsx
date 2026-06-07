"use client";

// StorageTree (box-finder map UI). The nestable location tree on the left of
// the storage map: room -> freezer -> rack -> box, any depth, walked from the
// flat StorageNode list via parent_id. Nodes are expandable; selecting one
// raises it to the pane (a `box` node renders its BoxGrid). An "Add location"
// affordance creates a child (or top-level) StorageNode.
//
// The tree owns only presentation + expansion state; the parent owns the
// selected node and the create call. House style: <Icon> only (no inline svg),
// Tooltip on icon-only buttons, brand + semantic dark-mode tokens, no emojis /
// em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { StorageNode, StorageNodeKind } from "@/lib/types";
import { STORAGE_KIND_LABEL } from "./inventory-ui";

interface StorageTreeProps {
  nodes: StorageNode[];
  selectedId: number | null;
  onSelect: (node: StorageNode) => void;
  /** Open the add-location flow. `parentId` is the node to add under, or null
   *  for a top-level location. */
  onAddLocation: (parentId: number | null) => void;
}

/** The glyph for a node kind. `box` shows the box glyph; a leaf-ish container
 *  reuses the closest registry icon (no new glyph added). */
function kindIcon(kind: StorageNodeKind): IconName {
  return kind === "box" ? "box" : "tree";
}

export default function StorageTree({
  nodes,
  selectedId,
  onSelect,
  onAddLocation,
}: StorageTreeProps) {
  // Children index for O(1) expansion lookups.
  const childrenOf = useMemo(() => {
    const map = new Map<number | "root", StorageNode[]>();
    for (const n of nodes) {
      const key = (n.parent_id ?? "root") as number | "root";
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }
    return map;
  }, [nodes]);

  const roots = childrenOf.get("root") ?? [];

  // Expanded set; default every non-box ancestor open so the tree reads at a
  // glance on first paint.
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const s = new Set<number>();
    for (const n of nodes) if (n.kind !== "box") s.add(n.id);
    return s;
  });

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex w-56 flex-shrink-0 flex-col border-r border-border bg-surface-sunken">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="text-meta font-semibold text-foreground-muted">
          Locations
        </span>
        <Tooltip label="Add a top-level location">
          <button
            type="button"
            onClick={() => onAddLocation(null)}
            aria-label="Add a top-level location"
            className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-raised hover:text-foreground"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
      <div className="min-h-[16rem] flex-1 overflow-y-auto px-2 pb-3">
        {roots.length === 0 ? (
          <p className="px-2 py-3 text-meta text-foreground-muted">
            No locations yet. Add a freezer or shelf to start mapping where your
            stocks live.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {roots.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                childrenOf={childrenOf}
                expanded={expanded}
                selectedId={selectedId}
                onToggle={toggle}
                onSelect={onSelect}
                onAddLocation={onAddLocation}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  childrenOf,
  expanded,
  selectedId,
  onToggle,
  onSelect,
  onAddLocation,
}: {
  node: StorageNode;
  depth: number;
  childrenOf: Map<number | "root", StorageNode[]>;
  expanded: Set<number>;
  selectedId: number | null;
  onToggle: (id: number) => void;
  onSelect: (node: StorageNode) => void;
  onAddLocation: (parentId: number | null) => void;
}) {
  const children = childrenOf.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;

  return (
    <li>
      <div
        className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${
          isSelected
            ? "bg-surface-raised font-semibold shadow-sm"
            : "hover:bg-surface-raised"
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={isOpen ? "Collapse" : "Expand"}
            aria-expanded={isOpen}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-foreground-muted hover:text-foreground"
          >
            <Icon
              name="chevronRight"
              className={`h-3.5 w-3.5 transition-transform ${
                isOpen ? "rotate-90" : ""
              }`}
            />
          </button>
        ) : (
          <span className="h-4 w-4 flex-shrink-0" />
        )}
        <Icon
          name={kindIcon(node.kind)}
          className="h-3.5 w-3.5 flex-shrink-0 text-foreground-muted"
        />
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="min-w-0 flex-1 truncate text-left text-meta text-foreground"
          title={node.name}
        >
          {node.name}
        </button>
        <span className="hidden flex-shrink-0 rounded border border-border px-1 text-[10px] text-foreground-muted group-hover:hidden sm:inline">
          {STORAGE_KIND_LABEL[node.kind]}
        </span>
        <Tooltip label={`Add a location under ${node.name}`}>
          <button
            type="button"
            onClick={() => onAddLocation(node.id)}
            aria-label={`Add a location under ${node.name}`}
            className="hidden h-5 w-5 flex-shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-foreground group-hover:flex"
          >
            <Icon name="plus" className="h-3 w-3" />
          </button>
        </Tooltip>
      </div>
      {hasChildren && isOpen && (
        <ul className="space-y-0.5">
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              childrenOf={childrenOf}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
              onAddLocation={onAddLocation}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
