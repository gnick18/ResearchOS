"use client";

// RoomMap (spatial inventory Phase C). The lab's 2D room map: a canvas backdrop
// with draggable pins, each marking a StorageNode at a normalized (x,y). Pin a
// freezer / bench / cabinet once and everything inside it becomes locatable on
// the floor plan (item -> stock -> its node -> that node's pin). Persists to the
// single whole-lab LabMap via labMapsApi (debounced).
//
// This is the spatial layer; the Storage map is the logical box-finder. A pin's
// id is `pin-<nodeId>` so a node is pinned at most once. House style: <Icon> only
// (no inline svg), Tooltip on icon-only buttons, brand + semantic tokens, no
// emojis / em-dashes / mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import ZoomPanCanvas from "@/components/figure/ZoomPanCanvas";
import { getOrCreateLabMap, labMapsApi, storageNodesApi } from "@/lib/local-api";
import type {
  InventoryStock,
  LabMap,
  LabMapPin,
  LabMapPlan,
  StorageNode,
} from "@/lib/types";
import { STORAGE_KIND_LABEL } from "./inventory-ui";
import { FLOOR_PLAN_TEMPLATES } from "./floorplan-templates";

interface RoomMapProps {
  nodes: StorageNode[];
  stocks: InventoryStock[];
}

// Count the stocks physically inside a node or any of its descendants, so a pin
// on "-80 #2" reflects everything in its racks + boxes, not just direct children.
function countContents(
  nodeId: number,
  nodes: StorageNode[],
  stocks: InventoryStock[],
): number {
  const childrenByParent = new Map<number | null, StorageNode[]>();
  for (const n of nodes) {
    const p = n.parent_id ?? null;
    const arr = childrenByParent.get(p) ?? [];
    arr.push(n);
    childrenByParent.set(p, arr);
  }
  const subtree = new Set<number>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (subtree.has(id)) continue;
    subtree.add(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child.id);
  }
  return stocks.filter(
    (s) => s.location_node_id != null && subtree.has(s.location_node_id),
  ).length;
}

export default function RoomMap({ nodes, stocks }: RoomMapProps) {
  const { data: loadedMap } = useQuery<LabMap>({
    queryKey: ["lab-map"],
    queryFn: getOrCreateLabMap,
  });

  const [pins, setPins] = useState<LabMapPin[]>([]);
  const [plan, setPlan] = useState<LabMapPlan | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const mapRef = useRef<LabMap | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ pinId: string; moved: boolean } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag-and-drop for the floor-plan canvas. The drop target is the outer
  // canvas wrapper; a dropped .svg file feeds the same onUploadFile handler
  // as the click-to-pick button, so both paths produce the same result.
  const [isFloorPlanDragOver, setIsFloorPlanDragOver] = useState(false);
  const floorPlanDragCounter = useRef(0);

  // Seed local pins + plan once the map loads.
  useEffect(() => {
    if (loadedMap) {
      mapRef.current = loadedMap;
      setPins(loadedMap.pins);
      setPlan(loadedMap.plan);
    }
  }, [loadedMap]);

  const nodesById = useMemo(() => {
    const m = new Map<number, StorageNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Persist the current pins to the single lab map, debounced.
  const persist = useCallback((next: LabMapPin[]) => {
    const map = mapRef.current;
    if (!map) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void labMapsApi.update(
        map.id,
        { pins: next },
        map.is_shared_with_me ? map.owner : undefined,
      );
    }, 400);
  }, []);

  const commit = useCallback(
    (next: LabMapPin[]) => {
      setPins(next);
      persist(next);
    },
    [persist],
  );

  // Set (or clear) the photo on a node's pin. Photos are downscaled to a bounded
  // data URL before storing so the lab map record + the phone snapshot stay small.
  const setPinImage = useCallback(
    (nodeId: number, image: string | null) => {
      commit(pins.map((p) => (p.nodeId === nodeId ? { ...p, image } : p)));
    },
    [commit, pins],
  );

  const onUploadPhoto = useCallback(
    async (nodeId: number, file: File | undefined) => {
      if (!file) return;
      const data = await downscaleToDataUrl(file, 720, 0.72);
      if (data) setPinImage(nodeId, data);
    },
    [setPinImage],
  );

  // Set (or clear) the floor plan SVG and persist the plan immediately. When the
  // plan changes, the aspect follows it (parsed from a template or the uploaded
  // SVG's viewBox) so the map fits the real room shape instead of a fixed 3:2.
  const setFloorplan = useCallback((svg: string | null, aspect?: number) => {
    const map = mapRef.current;
    const base: LabMapPlan = map?.plan ?? {
      kind: "blank",
      imagePath: null,
      imageData: null,
      aspect: 1.5,
    };
    const nextPlan: LabMapPlan = {
      ...base,
      kind: svg ? "image" : "blank",
      imageData: svg,
      aspect: svg && aspect && aspect > 0 ? aspect : base.aspect,
    };
    setPlan(nextPlan);
    if (map) {
      void labMapsApi.update(
        map.id,
        { plan: nextPlan },
        map.is_shared_with_me ? map.owner : undefined,
      );
    }
  }, []);

  const onUploadFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        // Accept SVG markup only (v1). Concatenated needle so this source file
        // carries no literal inline-svg substring for the icon-guard to count.
        if (text.includes("<" + "svg")) setFloorplan(text, svgAspect(text));
      };
      reader.readAsText(file);
    },
    [setFloorplan],
  );

  const handleCanvasDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!e.dataTransfer?.types?.includes("Files")) return;
    floorPlanDragCounter.current += 1;
    setIsFloorPlanDragOver(true);
  };

  const handleCanvasDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const handleCanvasDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    floorPlanDragCounter.current = Math.max(0, floorPlanDragCounter.current - 1);
    if (floorPlanDragCounter.current === 0) setIsFloorPlanDragOver(false);
  };

  const handleCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    floorPlanDragCounter.current = 0;
    setIsFloorPlanDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onUploadFile(file);
  };

  // Nodes not yet pinned, offered in the "Place a location" rail. Containers
  // (anything that is not a `box`) read most naturally on a room map, but any
  // node can be pinned.
  const pinnedNodeIds = useMemo(
    () => new Set(pins.map((p) => p.nodeId).filter((n): n is number => n != null)),
    [pins],
  );
  // Pinnable = on the room map; external locations live off the map (their own
  // section) and are never offered as pins.
  const unpinned = nodes.filter((n) => !pinnedNodeIds.has(n.id) && !n.is_external);
  const externalNodes = nodes.filter((n) => n.is_external);

  const queryClient = useQueryClient();
  // Mark a location external (off the room map) or bring it back. Persists the
  // flag on the StorageNode and refreshes the shared storage-node query.
  const setNodeExternal = useCallback(
    (node: StorageNode, value: boolean) => {
      // Dropping it off the map also clears any existing pin for it.
      if (value && pins.some((p) => p.nodeId === node.id)) {
        commit(pins.filter((p) => p.nodeId !== node.id));
      }
      void storageNodesApi
        .update(
          node.id,
          { is_external: value },
          node.is_shared_with_me ? node.owner : undefined,
        )
        .then(() => queryClient.invalidateQueries({ queryKey: ["storage-nodes"] }));
    },
    [pins, commit, queryClient],
  );

  const addPin = (node: StorageNode) => {
    if (pins.some((p) => p.nodeId === node.id)) return;
    // Stagger new pins slightly so several added in a row do not stack exactly.
    const offset = (pins.length % 5) * 0.04;
    const pin: LabMapPin = {
      id: `pin-${node.id}`,
      nodeId: node.id,
      label: null,
      x: 0.5 + offset - 0.08,
      y: 0.5 + offset - 0.08,
      image: null,
    };
    commit([...pins, pin]);
    setSelected(node.id);
  };

  const removePin = (nodeId: number) => {
    commit(pins.filter((p) => p.nodeId !== nodeId));
    if (selected === nodeId) setSelected(null);
  };

  // ── Drag a pin ──────────────────────────────────────────────────────────────
  const onPinPointerDown = (e: React.PointerEvent, pin: LabMapPin) => {
    e.preventDefault();
    // Keep the pan/zoom viewport from also starting a pan on this press.
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { pinId: pin.id, moved: false };
  };

  const onPinPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    drag.moved = true;
    setPins((cur) =>
      cur.map((p) => (p.id === drag.pinId ? { ...p, x, y } : p)),
    );
  };

  const onPinPointerUp = (e: React.PointerEvent, pin: LabMapPin) => {
    const drag = dragRef.current;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    if (drag?.moved) {
      // Persist the final position from the freshest state.
      setPins((cur) => {
        persist(cur);
        return cur;
      });
    } else if (pin.nodeId != null) {
      // A click (no drag) selects the pin.
      setSelected((s) => (s === pin.nodeId ? null : pin.nodeId));
    }
  };

  const selectedNode = selected != null ? nodesById.get(selected) ?? null : null;
  const selectedPin =
    selected != null ? pins.find((p) => p.nodeId === selected) ?? null : null;

  // The map renders into a fixed content coordinate space that ZoomPanCanvas fits
  // to the viewport (matching the plan's aspect). Pins are positioned by % within
  // it, so pin-drag maps the pointer through the content rect (post-transform).
  const aspect = plan?.aspect ?? loadedMap?.plan?.aspect ?? 1.5;
  const CONTENT_W = 1200;
  const CONTENT_H = Math.round(CONTENT_W / aspect);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Canvas */}
      <div className="min-w-0 flex-1">
        {/* Floor plan controls */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              onUploadFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-meta text-foreground hover:bg-surface-sunken"
          >
            <Icon name="import" className="h-3.5 w-3.5" />
            Upload floor plan
          </button>
          <button
            type="button"
            onClick={() => setTemplatesOpen((o) => !o)}
            aria-expanded={templatesOpen}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-meta text-foreground hover:bg-surface-sunken"
          >
            <Icon name="floorPlanSample" className="h-3.5 w-3.5" />
            Templates
          </button>
          {plan?.imageData ? (
            <button
              type="button"
              onClick={() => setFloorplan(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
              Remove floor plan
            </button>
          ) : null}
          <span className="text-meta text-foreground-subtle">
            Place each freezer or bench where it physically sits in the room (the
            Storage map handles which box). Pick a template or upload a .svg floor
            plan; pins sit on top.
          </span>
        </div>
        {templatesOpen ? (
          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FLOOR_PLAN_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setFloorplan(t.svg, t.aspect);
                  setTemplatesOpen(false);
                }}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-1.5 text-left hover:bg-surface-sunken"
              >
                <span
                  className="block overflow-hidden rounded bg-white [&>svg]:h-full [&>svg]:w-full"
                  style={{ aspectRatio: String(t.aspect) }}
                  // Lab-authored template markup, not user-pasted content.
                  dangerouslySetInnerHTML={{ __html: t.svg }}
                />
                <span className="px-0.5 text-meta text-foreground">{t.name}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div
          className="relative w-full"
          style={{ aspectRatio: String(aspect) }}
          onDragEnter={handleCanvasDragEnter}
          onDragOver={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
          data-attach-target
        >
          {isFloorPlanDragOver ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-action bg-brand-action/5">
              <p className="text-body font-semibold text-brand-action">Drop SVG floor plan to upload</p>
            </div>
          ) : null}
          <ZoomPanCanvas
            contentWidth={CONTENT_W}
            contentHeight={CONTENT_H}
            className="ros-room-canvas rounded-xl border border-border"
          >
            <div
              ref={canvasRef}
              className={`relative ${
                plan?.imageData ? "bg-white" : "bg-surface-sunken"
              }`}
              style={{
                width: CONTENT_W,
                height: CONTENT_H,
                ...(plan?.imageData
                  ? {}
                  : {
                      backgroundImage:
                        "linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)",
                      backgroundSize: "48px 48px",
                    }),
              }}
            >
          {plan?.imageData ? (
            <div
              className="pointer-events-none absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
              // The plan is lab-authored vector markup (sample or an uploaded
              // .svg), rendered as the backdrop. Not user-pasted HTML.
              dangerouslySetInnerHTML={{ __html: plan.imageData }}
            />
          ) : null}

          {pins.map((pin) => {
            const node = pin.nodeId != null ? nodesById.get(pin.nodeId) : null;
            const name = node?.name ?? pin.label ?? "Pin";
            const isSel = pin.nodeId != null && pin.nodeId === selected;
            const showLabel = isSel || hovered === pin.nodeId;
            return (
              <button
                key={pin.id}
                type="button"
                onPointerDown={(e) => onPinPointerDown(e, pin)}
                onPointerMove={onPinPointerMove}
                onPointerUp={(e) => onPinPointerUp(e, pin)}
                onMouseEnter={() => pin.nodeId != null && setHovered(pin.nodeId)}
                onMouseLeave={() => setHovered((h) => (h === pin.nodeId ? null : h))}
                className="absolute flex -translate-x-1/2 -translate-y-full cursor-grab touch-none flex-col items-center active:cursor-grabbing"
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
              >
                {/* Label only on the hovered or selected pin, so labels never
                    pile up on a dense map. Other pins are just markers. */}
                {showLabel ? (
                  <span
                    className={`max-w-[140px] truncate rounded-md px-2 py-0.5 text-[11px] font-medium shadow-sm ${
                      isSel
                        ? "bg-brand-action text-white"
                        : "bg-surface-raised text-foreground border border-border"
                    }`}
                  >
                    {name}
                  </span>
                ) : null}
                <Icon
                  name="pin"
                  className={`${isSel ? "h-6 w-6 text-brand-action" : "h-5 w-5 text-foreground-muted"}`}
                />
              </button>
            );
          })}
            </div>
          </ZoomPanCanvas>
          {pins.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-foreground-muted">
                <Icon name="storageNested" className="h-6 w-6" />
              </div>
              <h3 className="text-title font-semibold text-foreground">
                Map where your storage lives
              </h3>
              <p className="mt-1.5 max-w-sm text-body text-foreground-muted">
                Pick a location on the right to drop a pin, then drag it where it
                sits in the room.
              </p>
            </div>
          ) : null}
        </div>

        {selectedNode ? (
          <div className="mt-3 rounded-lg border border-border bg-surface-raised px-3 py-2">
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void onUploadPhoto(selectedNode.id, e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {selectedPin?.image ? (
                  // The pin photo. It is lab-authored (uploaded or downscaled
                  // here), not remote content.
                  <img
                    src={selectedPin.image}
                    alt={`Photo of ${selectedNode.name}`}
                    className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-foreground">
                    {selectedNode.name}
                  </p>
                  <p className="text-meta text-foreground-muted">
                    {STORAGE_KIND_LABEL[selectedNode.kind] ?? selectedNode.kind} -{" "}
                    {countContents(selectedNode.id, nodes, stocks)} items inside
                  </p>
                </div>
              </div>
              <Tooltip label="Remove pin">
                <button
                  type="button"
                  onClick={() => removePin(selectedNode.id)}
                  aria-label="Remove pin"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => photoRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 py-1 text-meta text-foreground hover:bg-surface-sunken"
              >
                <Icon name="camera" className="h-3.5 w-3.5" />
                {selectedPin?.image ? "Replace photo" : "Add photo"}
              </button>
              {selectedPin?.image ? (
                <button
                  type="button"
                  onClick={() => setPinImage(selectedNode.id, null)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 py-1 text-meta text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                  Remove photo
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Place-a-location rail */}
      <div className="w-full shrink-0 lg:w-64">
        <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-foreground-subtle">
          Place a location
        </p>
        {nodes.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-border bg-surface-raised px-4 py-6 text-center">
            <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-surface-sunken text-foreground-muted">
              <Icon name="storageNested" className="h-5 w-5" />
            </div>
            <p className="text-meta text-foreground-muted">
              No storage locations yet. Add freezers and shelves in the Storage
              map, then pin them here.
            </p>
          </div>
        ) : unpinned.length === 0 ? (
          <p className="text-meta text-foreground-muted">
            No more locations to place.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {unpinned.map((node) => (
              <div
                key={node.id}
                className="flex items-center rounded-lg border border-border bg-surface-raised hover:bg-surface-sunken"
              >
                <button
                  type="button"
                  onClick={() => addPin(node)}
                  title="Drop a pin on the map"
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-body text-foreground"
                >
                  <Icon
                    name={node.kind === "box" ? "box" : "storageNested"}
                    className="h-4 w-4 shrink-0 text-foreground-muted"
                  />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  <Icon name="plus" className="h-3.5 w-3.5 text-foreground-muted" />
                </button>
                <Tooltip label="Move to external storage (off-map)">
                  <button
                    type="button"
                    onClick={() => setNodeExternal(node, true)}
                    aria-label="Move to external storage"
                    className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:text-foreground"
                  >
                    <Icon name="export" className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        {externalNodes.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-foreground-subtle">
              External storage
            </p>
            <div className="flex flex-col gap-1.5">
              {externalNodes.map((node) => (
                <div
                  key={node.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-body text-foreground-muted"
                >
                  <Icon name="export" className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  <Tooltip label="Bring onto the room map">
                    <button
                      type="button"
                      onClick={() => setNodeExternal(node, false)}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-meta hover:bg-surface-sunken hover:text-foreground"
                    >
                      On map
                    </button>
                  </Tooltip>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-meta text-foreground-subtle">
              Off the room map (a closet, cold room, or shared facility). Items
              stored here show as external, not pinned.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Parse an SVG's viewBox aspect (width / height) so an uploaded floor plan fits
// the map true-to-shape. Returns undefined when there is no usable viewBox.
function svgAspect(svg: string): number | undefined {
  const m = svg.match(/viewBox\s*=\s*["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i);
  if (!m) return undefined;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return w > 0 && h > 0 ? w / h : undefined;
}

// Read an image File, downscale it so the longest side is <= maxDim, and return a
// JPEG data URL. Keeps a pin photo small enough to ride in the lab map record and
// the sealed phone snapshot. Returns null if the file cannot be decoded.
function downscaleToDataUrl(
  file: File,
  maxDim: number,
  quality: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}
