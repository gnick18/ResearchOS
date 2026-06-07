"use client";

// StorageMap (box-finder map UI). The "Storage" view of the inventory surface:
// the location tree on the left, the selected box rendered as a BoxGrid on the
// right with a breadcrumb, plus the add-location, cell-detail, and place-stock
// flows. It owns the StorageNode query and every storage write (create node,
// place / move / remove a stock's location); the parent page owns the
// items/stocks queries and passes them down read-only.
//
// House style: <Icon> only (no inline svg), LivingPopup for dialogs, Tooltip on
// icon-only buttons, brand + semantic dark-mode tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/icons";
import LivingPopup from "@/components/ui/LivingPopup";
import { wellId } from "@/components/ui/GridCanvas";
import {
  fetchAllStorageNodesIncludingShared,
  inventoryStocksApi,
  storageNodesApi,
} from "@/lib/local-api";
import { normalizeSharedWith, WHOLE_LAB_SENTINEL } from "@/lib/sharing/unified";
import type {
  InventoryItem,
  InventoryStock,
  StorageNode,
  StorageNodeCreate,
} from "@/lib/types";
import BoxGrid from "./BoxGrid";
import CellDetailDialog from "./CellDetailDialog";
import AddLocationDialog from "./AddLocationDialog";
import StorageTree from "./StorageTree";
import {
  buildBoxOccupancy,
  buildNodePath,
  type BoxCellOccupant,
} from "./inventory-ui";

/** A node a viewer may edit: owner, or an edit-level entry for them / whole-lab.
 *  Mirrors canEditItem on the page (the location tree is typically whole-lab
 *  shared, so this is usually true). */
function canEditNode(node: StorageNode, currentUser: string | null): boolean {
  if (!currentUser) return false;
  if (node.owner === currentUser) return true;
  const list = normalizeSharedWith(node.shared_with);
  return list.some(
    (s) =>
      (s.username === currentUser || s.username === WHOLE_LAB_SENTINEL) &&
      s.level === "edit",
  );
}

/** Owner to route a storage-node write through (the owner's dir when the node
 *  was shared into me, else my own). Mirrors effectiveOwnerOf on the page. */
function effectiveNodeOwner(node: StorageNode, currentUser: string | null) {
  return node.is_shared_with_me && node.owner !== currentUser
    ? node.owner
    : undefined;
}

interface StorageMapProps {
  items: InventoryItem[];
  stocks: InventoryStock[];
  currentUser: string | null;
  /** Refresh the parent items/stocks queries after a location write. */
  onRefresh: () => void;
  /** Open the item detail (reuses the page's item list expansion). */
  onOpenItem: (item: InventoryItem) => void;
  /** A cell to select on mount / when it changes (the breadcrumb jump target).
   *  Cleared by the parent after it is consumed. */
  jumpTarget?: { nodeId: number; position: string | null } | null;
  onJumpConsumed?: () => void;
}

type AddState = { open: false } | { open: true; parentId: number | null };

type CellState =
  | { open: false }
  | { open: true; box: StorageNode; position: string; occupant: BoxCellOccupant | null };

export default function StorageMap({
  items,
  stocks,
  currentUser,
  onRefresh,
  onOpenItem,
  jumpTarget,
  onJumpConsumed,
}: StorageMapProps) {
  const queryClient = useQueryClient();

  const nodesQuery = useQuery({
    queryKey: ["storage-nodes", currentUser],
    queryFn: fetchAllStorageNodesIncludingShared,
    enabled: !!currentUser,
  });
  const nodes = useMemo(() => nodesQuery.data ?? [], [nodesQuery.data]);

  const nodesById = useMemo(() => {
    const m = new Map<number, StorageNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const itemsById = useMemo(() => {
    const m = new Map<number, InventoryItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);
  const [addState, setAddState] = useState<AddState>({ open: false });
  const [cellState, setCellState] = useState<CellState>({ open: false });

  const selectedNode = selectedId != null ? nodesById.get(selectedId) ?? null : null;
  const selectedBox =
    selectedNode && selectedNode.kind === "box" ? selectedNode : null;

  // Consume a breadcrumb jump: select the node (walk to its nearest box
  // ancestor if the target itself is not a box) and highlight the cell.
  useEffect(() => {
    if (!jumpTarget) return;
    if (!nodesById.has(jumpTarget.nodeId)) return;
    setSelectedId(jumpTarget.nodeId);
    setSelectedPosition(jumpTarget.position ?? null);
    onJumpConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTarget, nodesById]);

  const refreshNodes = () =>
    queryClient.invalidateQueries({ queryKey: ["storage-nodes"] });

  // ── Writes ───────────────────────────────────────────────────────────────
  const handleAddLocation = async (data: StorageNodeCreate) => {
    const parentId = addState.open ? addState.parentId : null;
    // Route the create under the parent's owner so a child lands in the same
    // namespace as its parent (a shared-in tree stays whole). Top-level adds go
    // to the current user's dir (owner undefined).
    const parent = parentId != null ? nodesById.get(parentId) : null;
    const owner = parent ? effectiveNodeOwner(parent, currentUser) : undefined;
    const created = await storageNodesApi.create(
      { ...data, parent_id: parentId },
      owner,
    );
    setAddState({ open: false });
    refreshNodes();
    // Jump straight to a freshly-added box so the user can start placing.
    if (created.kind === "box") {
      setSelectedId(created.id);
      setSelectedPosition(null);
    }
  };

  // Find the owner to route a stock write through (the stock's own dir, or its
  // owner's when shared into me).
  const stockOwner = (stock: InventoryStock) =>
    stock.is_shared_with_me && stock.owner !== currentUser
      ? stock.owner
      : undefined;

  const placeStock = async (stock: InventoryStock, position: string) => {
    if (!selectedBox) return;
    await inventoryStocksApi.update(
      stock.id,
      { location_node_id: selectedBox.id, position },
      stockOwner(stock),
    );
    setCellState({ open: false });
    setSelectedPosition(position);
    onRefresh();
  };

  const removeStock = async (stock: InventoryStock) => {
    await inventoryStocksApi.update(
      stock.id,
      { location_node_id: null, position: null },
      stockOwner(stock),
    );
    setCellState({ open: false });
    onRefresh();
  };

  // The unplaced stocks (no box) for the place picker, paired with their item.
  const unplaced = useMemo(
    () =>
      stocks
        .filter((s) => s.location_node_id == null)
        .map((s) => ({ stock: s, item: itemsById.get(s.item_id) ?? null })),
    [stocks, itemsById],
  );

  // The empty cells in the selected box (for the Move target picker).
  const emptyCells = useMemo(() => {
    if (!selectedBox) return [];
    const occ = buildBoxOccupancy(
      selectedBox.id,
      stocks,
      itemsById,
      new Date(),
    );
    const rows = selectedBox.box_rows && selectedBox.box_rows > 0 ? selectedBox.box_rows : 9;
    const cols = selectedBox.box_cols && selectedBox.box_cols > 0 ? selectedBox.box_cols : 9;
    const out: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = wellId(r, c);
        if (!occ.has(id)) out.push(id);
      }
    }
    return out;
  }, [selectedBox, stocks, itemsById]);

  const breadcrumb = selectedNode
    ? buildNodePath(selectedNode.id, nodesById)
    : [];

  const canEditSelected = selectedNode
    ? canEditNode(selectedNode, currentUser)
    : false;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
      <div className="flex min-h-[22rem]">
        <StorageTree
          nodes={nodes}
          selectedId={selectedId}
          onSelect={(node) => {
            setSelectedId(node.id);
            setSelectedPosition(null);
          }}
          onAddLocation={(parentId) => setAddState({ open: true, parentId })}
        />

        <div className="min-w-0 flex-1 p-5">
          {!selectedNode ? (
            <EmptyPane hasNodes={nodes.length > 0} />
          ) : selectedBox ? (
            <div>
              <Breadcrumb path={breadcrumb} box={selectedBox} />
              <BoxGrid
                box={selectedBox}
                stocks={stocks}
                itemsById={itemsById}
                selectedPosition={selectedPosition}
                onCellClick={(position, occupant) => {
                  setSelectedPosition(position);
                  if (!canEditSelected && !occupant) return;
                  setCellState({
                    open: true,
                    box: selectedBox,
                    position,
                    occupant,
                  });
                }}
              />
              <GridLegend />
            </div>
          ) : (
            <NonBoxPane node={selectedNode} childCount={nodes.filter((n) => n.parent_id === selectedNode.id).length} />
          )}
        </div>
      </div>

      {/* Add location */}
      <LivingPopup
        open={addState.open}
        onClose={() => setAddState({ open: false })}
        label="Add location"
        widthClassName="max-w-xl"
        card
        closeOnScrimClick={false}
        fillHeight
      >
        {addState.open && (
          <div className="overflow-y-auto">
            <AddLocationDialog
              parentName={
                addState.parentId != null
                  ? nodesById.get(addState.parentId)?.name ?? null
                  : null
              }
              onCancel={() => setAddState({ open: false })}
              onSubmit={handleAddLocation}
            />
          </div>
        )}
      </LivingPopup>

      {/* Cell detail / place */}
      <LivingPopup
        open={cellState.open}
        onClose={() => setCellState({ open: false })}
        label={cellState.open && cellState.occupant ? "Cell detail" : "Place a stock"}
        widthClassName="max-w-md"
        card
      >
        {cellState.open && (
          <CellDetailDialog
            box={cellState.box}
            position={cellState.position}
            occupant={cellState.occupant}
            emptyCells={emptyCells}
            unplaced={unplaced}
            onOpenItem={(item) => {
              setCellState({ open: false });
              onOpenItem(item);
            }}
            onPlace={placeStock}
            onMove={placeStock}
            onRemove={removeStock}
            onClose={() => setCellState({ open: false })}
          />
        )}
      </LivingPopup>
    </div>
  );
}

function Breadcrumb({ path, box }: { path: StorageNode[]; box: StorageNode }) {
  const dims =
    box.box_rows && box.box_cols ? `${box.box_rows} x ${box.box_cols}` : null;
  return (
    <p className="mb-3 text-meta text-foreground-muted">
      {path.map((n, i) => (
        <span key={n.id}>
          {i > 0 && <span className="px-1">/</span>}
          <span
            className={
              i === path.length - 1 ? "font-semibold text-foreground" : ""
            }
          >
            {n.name}
          </span>
        </span>
      ))}
      {dims && <span className="ml-1.5 text-foreground-muted">· {dims}</span>}
    </p>
  );
}

function GridLegend() {
  const items: { label: string; className: string }[] = [
    { label: "In stock", className: "bg-emerald-200 dark:bg-emerald-500/25" },
    { label: "Low", className: "bg-amber-200 dark:bg-amber-500/25" },
    { label: "Expiring", className: "bg-rose-200 dark:bg-rose-500/25" },
    {
      label: "Empty slot",
      className: "bg-surface-raised border border-border",
    },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-meta text-foreground-muted">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded ${it.className}`} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function EmptyPane({ hasNodes }: { hasNodes: boolean }) {
  return (
    <div className="flex h-full min-h-[18rem] flex-col items-center justify-center text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-foreground-muted">
        <Icon name="box" className="h-6 w-6" />
      </div>
      <h3 className="text-title font-semibold text-foreground">
        {hasNodes ? "Pick a location" : "Map where your stocks live"}
      </h3>
      <p className="mt-1.5 max-w-sm text-body text-foreground-muted">
        {hasNodes
          ? "Select a box on the left to see its grid. Selecting a freezer or rack shows what is inside it."
          : "Add a freezer, then a rack, then a box. A box gets a grid so each tube has a numbered home."}
      </p>
    </div>
  );
}

function NonBoxPane({
  node,
  childCount,
}: {
  node: StorageNode;
  childCount: number;
}) {
  return (
    <div className="flex h-full min-h-[18rem] flex-col items-center justify-center text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-foreground-muted">
        <Icon name="tree" className="h-6 w-6" />
      </div>
      <h3 className="text-title font-semibold text-foreground">{node.name}</h3>
      <p className="mt-1.5 max-w-sm text-body text-foreground-muted">
        {childCount > 0
          ? "Expand it on the left to reach the boxes inside, or select a box to see its grid."
          : "Nothing inside yet. Use the plus on its row to add a rack, a box, or another spot."}
      </p>
    </div>
  );
}
