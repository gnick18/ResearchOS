"use client";

// LocationPicker (box-finder map UI). The cascading freezer -> ... -> box ->
// position selector on the stock form. It walks the StorageNode tree one level
// at a time (top-level locations, then the children of whatever was picked, and
// so on), so it handles any tree depth, not a fixed freezer/rack/box schema.
// Once a `box` node is selected its A1 cells become the position options.
//
// It is fully controlled: the parent owns `nodeId` + `position` and gets the
// chosen pair back through onChange. A "Clear" affordance unsets the node-based
// location so the form can fall back to the v1 free-text note. House style:
// <Icon> only (no inline svg), brand + semantic dark-mode tokens, no emojis /
// em-dashes / mid-sentence colons.

import { useMemo } from "react";

import { Icon } from "@/components/icons";
import { wellId } from "@/components/ui/GridCanvas";
import type { StorageNode } from "@/lib/types";
import { STORAGE_KIND_LABEL, buildNodePath } from "./inventory-ui";

const SELECT_CLASS =
  "w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised text-foreground focus:outline-none focus:ring-2 focus:ring-brand-action";

interface LocationPickerProps {
  nodes: StorageNode[];
  nodeId: number | null;
  position: string | null;
  onChange: (next: { nodeId: number | null; position: string | null }) => void;
}

export default function LocationPicker({
  nodes,
  nodeId,
  position,
  onChange,
}: LocationPickerProps) {
  const nodesById = useMemo(() => {
    const m = new Map<number, StorageNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const childrenOf = useMemo(() => {
    const m = new Map<number | "root", StorageNode[]>();
    for (const n of nodes) {
      const key = (n.parent_id ?? "root") as number | "root";
      const arr = m.get(key) ?? [];
      arr.push(n);
      m.set(key, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }
    return m;
  }, [nodes]);

  // The chain of selected nodes from root to the chosen node (inclusive).
  const chain = useMemo(
    () => (nodeId != null ? buildNodePath(nodeId, nodesById) : []),
    [nodeId, nodesById],
  );

  const selectedNode = nodeId != null ? nodesById.get(nodeId) ?? null : null;
  const selectedBox =
    selectedNode && selectedNode.kind === "box" ? selectedNode : null;

  // Each cascading <select> level: the children to choose from and the picked
  // child at that level. We render one row per filled level, plus one trailing
  // row when the deepest pick still has selectable children (so the user can go
  // deeper). The position select appears once a box is selected.
  const levels: { options: StorageNode[]; value: number | "" }[] = [];

  // Level 0 is always the top-level nodes.
  let parentKey: number | "root" = "root";
  for (let i = 0; i <= chain.length; i++) {
    const options = childrenOf.get(parentKey) ?? [];
    if (options.length === 0) break;
    const picked = chain[i];
    levels.push({ options, value: picked ? picked.id : "" });
    if (!picked) break;
    parentKey = picked.id;
  }

  const handleLevelChange = (levelIndex: number, value: string) => {
    if (value === "") {
      // Cleared this level: unset everything from here down.
      const parent = levelIndex === 0 ? null : chain[levelIndex - 1]?.id ?? null;
      onChange({ nodeId: parent, position: null });
      return;
    }
    const id = Number(value);
    const node = nodesById.get(id);
    onChange({
      nodeId: id,
      // Keep the position only if we re-picked the same box; otherwise reset.
      position: node && node.kind === "box" && id === nodeId ? position : null,
    });
  };

  const positionOptions = useMemo(() => {
    if (!selectedBox) return [];
    const rows =
      selectedBox.box_rows && selectedBox.box_rows > 0 ? selectedBox.box_rows : 9;
    const cols =
      selectedBox.box_cols && selectedBox.box_cols > 0 ? selectedBox.box_cols : 9;
    const out: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) out.push(wellId(r, c));
    }
    return out;
  }, [selectedBox]);

  if (nodes.length === 0) {
    return (
      <p className="text-meta text-foreground-muted">
        No storage locations yet. Add a freezer and a box on the Storage map to
        pin a stock to a cell, or use the free-text note below.
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {levels.map((level, i) => (
          <select
            key={i}
            className={SELECT_CLASS}
            value={level.value}
            onChange={(e) => handleLevelChange(i, e.target.value)}
            aria-label={`Location level ${i + 1}`}
          >
            <option value="">
              {i === 0 ? "Pick a location" : "Pick a sub-location"}
            </option>
            {level.options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name} ({STORAGE_KIND_LABEL[opt.kind]})
              </option>
            ))}
          </select>
        ))}

        {selectedBox && (
          <select
            className={SELECT_CLASS}
            value={position ?? ""}
            onChange={(e) =>
              onChange({
                nodeId,
                position: e.target.value || null,
              })
            }
            aria-label="Position in the box"
          >
            <option value="">Pick a cell</option>
            {positionOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </div>

      {nodeId != null && (
        <button
          type="button"
          onClick={() => onChange({ nodeId: null, position: null })}
          className="mt-2 inline-flex items-center gap-1 text-meta font-medium text-foreground-muted hover:text-foreground"
        >
          <Icon name="close" className="h-3 w-3" />
          Clear location
        </button>
      )}
      {selectedNode && !selectedBox && (
        <p className="mt-2 text-meta text-foreground-muted">
          Keep going until you reach a box to pin an exact cell, or stop here to
          record the general spot.
        </p>
      )}
    </div>
  );
}
