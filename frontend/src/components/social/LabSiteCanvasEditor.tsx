"use client";

// Lab companion-site canvas editor (P2 companion builder, social lane).
//
// WIX-style block-based page editor for companion data-site pages. A left
// PALETTE lists the available block kinds (text layout blocks + highlighted
// data blocks). The center CANVAS renders the page's LabSiteBlock[] as live,
// editable blocks using LabSiteBlockView for the visual. The right INSPECTOR
// shows the settings for the selected block (source picker, caption, width
// for data blocks; read-only hint for text blocks whose editing is inline).
//
// Drag vs click-to-add: HTML5 drag-from-palette is implemented. If the drag
// event does not fire (e.g. in certain sandboxed environments) a fallback
// "Click to add" mode is provided so the author can click a palette item and
// then choose insertion position. Up/down toolbar controls are always available
// as a reorder alternative to drag-and-drop.
//
// Inspector pattern: mirrors FigureComposer select-to-side-panel but docked on
// the RIGHT, per Grant's explicit P2 tweak (build plan, 2026-06-20).
//
// Bake-on-publish (P2 TODO): the canvas calls scanBlockEmbedHrefs on the
// current block array, then bakes via bakeOne for each href and stores into
// snapshots_json. This is wired into the publish flow via the flowOnFreeze
// callback exposed through LabSiteCanvasEditorProps. The caller (LabSiteDash-
// board) passes onFreeze which we use to override the markdown-body bake with
// the block-href bake.
//
// Gate: rendered only when the page carries a blocks_json column value (or is
// being created as a new companion/blocks page). The existing markdown textarea
// path in LabSiteDashboard remains unchanged for body_md pages.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import ReferencePicker from "@/components/references/ReferencePicker";
import LabSiteBlockView from "@/components/social/LabSiteBlockView";
import {
  type LabSiteBlock,
  type LabSiteLeafBlock,
  type BlockWidth,
  isDataBlockKind,
  parseLabSiteBlocks,
  serializeLabSiteBlocks,
} from "@/lib/social/lab-site-blocks";
import { parseObjectEmbed } from "@/lib/references";

// ---------------------------------------------------------------------------
// Block kind metadata (used by the palette)
// ---------------------------------------------------------------------------

interface BlockKindMeta {
  kind: LabSiteBlock["kind"];
  label: string;
  icon: IconName;
  /** Data blocks are the competitive moat and get highlighted styling. */
  isData: boolean;
}

const BLOCK_KINDS: BlockKindMeta[] = [
  // Layout / text blocks
  { kind: "heading", label: "Heading", icon: "text", isData: false },
  { kind: "text", label: "Text", icon: "text", isData: false },
  { kind: "image", label: "Image", icon: "export", isData: false },
  { kind: "two-column", label: "Two columns", icon: "list", isData: false },
  // Data blocks (highlighted group)
  { kind: "figure", label: "Figure", icon: "figure", isData: true },
  { kind: "table", label: "Table", icon: "table", isData: true },
  { kind: "dataset-explorer", label: "Dataset", icon: "database", isData: true },
  { kind: "chart", label: "Chart", icon: "chart", isData: true },
];

// ---------------------------------------------------------------------------
// Block-factory helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `b${Math.random().toString(36).slice(2, 10)}`;
}

function makeDefaultBlock(kind: LabSiteBlock["kind"]): LabSiteBlock {
  switch (kind) {
    case "heading":
      return { id: generateId(), kind: "heading", props: { text: "New heading", level: 2 } };
    case "text":
      return { id: generateId(), kind: "text", props: { markdown: "New text block." } };
    case "image":
      return { id: generateId(), kind: "image", props: { src: "", alt: "", caption: "", width: "column" } };
    case "figure":
      return { id: generateId(), kind: "figure", props: { sourceId: "", caption: "", width: "column" } };
    case "table":
      return { id: generateId(), kind: "table", props: { sourceId: "", caption: "", width: "column" } };
    case "dataset-explorer":
      return { id: generateId(), kind: "dataset-explorer", props: { sourceId: "", caption: "", width: "column" } };
    case "chart":
      return { id: generateId(), kind: "chart", props: { sourceId: "", caption: "", width: "column" } };
    case "two-column":
      return { id: generateId(), kind: "two-column", props: { left: [], right: [] } };
    // Section block kinds (P3 homepage builder). These are never added via
    // the canvas palette; this arm exists solely to satisfy the exhaustiveness
    // check now that SectionBlock is part of LabSiteBlock. The canvas palette
    // only lists the kinds in BLOCK_KINDS above.
    case "section-hero":
      return { id: generateId(), kind: "section-hero", props: { labName: "", tagline: "", coverImageUrl: "", ctaLabel: "", ctaUrl: "" } };
    case "section-about":
      return { id: generateId(), kind: "section-about", props: { heading: "", body: "", imageUrl: "", imageAlt: "" } };
    case "section-team":
      return { id: generateId(), kind: "section-team", props: { heading: "", members: [] } };
    case "section-publications":
      return { id: generateId(), kind: "section-publications", props: { heading: "", publications: [] } };
    case "section-contact":
      return { id: generateId(), kind: "section-contact", props: { heading: "", address: "", email: "", linkLabel: "", linkUrl: "" } };
    default: {
      const _: never = kind;
      void _;
      return { id: generateId(), kind: "text", props: { markdown: "" } };
    }
  }
}

// ---------------------------------------------------------------------------
// Width picker component (used in inspector)
// ---------------------------------------------------------------------------

function WidthPicker({
  value,
  onChange,
}: {
  value: BlockWidth;
  onChange: (w: BlockWidth) => void;
}) {
  const opts: { v: BlockWidth; label: string }[] = [
    { v: "inset", label: "Inset" },
    { v: "column", label: "Column" },
    { v: "full", label: "Full" },
  ];
  return (
    <div className="flex gap-1.5">
      {opts.map(({ v, label }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
            value === v
              ? "border-brand bg-brand/10 text-brand"
              : "border-border bg-surface-sunken text-foreground-muted hover:bg-surface"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector panel (right dock)
// ---------------------------------------------------------------------------

interface InspectorProps {
  block: LabSiteBlock | null;
  onChange: (updated: LabSiteBlock) => void;
  onClose: () => void;
}

function Inspector({ block, onChange, onClose }: InspectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!block) {
    return (
      <aside className="flex h-full flex-col rounded-xl border border-border bg-surface-raised p-4">
        <p className="text-sm text-foreground-muted">
          Click a block on the canvas to see its settings here.
        </p>
      </aside>
    );
  }

  // Capture a non-null reference so inner functions can use it without TS
  // complaining (the early return above guarantees non-null past this point).
  const nonNullBlock = block;
  const isData = isDataBlockKind(nonNullBlock.kind);

  // Helper for data blocks that have sourceId + caption + width.
  function updateDataProp(
    field: "sourceId" | "caption" | "width",
    value: string,
  ) {
    if (
      nonNullBlock.kind !== "figure" &&
      nonNullBlock.kind !== "table" &&
      nonNullBlock.kind !== "dataset-explorer" &&
      nonNullBlock.kind !== "chart"
    ) return;
    onChange({
      ...nonNullBlock,
      props: { ...nonNullBlock.props, [field]: value },
    } as LabSiteBlock);
  }

  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          {block.kind}
        </span>
        <Tooltip label="Deselect block">
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 hover:bg-surface-sunken"
          >
            <Icon name="close" className="h-3.5 w-3.5 text-foreground-muted" />
          </button>
        </Tooltip>
      </div>

      {/* Heading inspector */}
      {block.kind === "heading" && (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted">
              Text
            </label>
            <input
              type="text"
              value={block.props.text}
              onChange={(e) =>
                onChange({ ...block, props: { ...block.props, text: e.target.value } })
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted">
              Level
            </label>
            <div className="flex gap-1.5">
              {([1, 2, 3] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() =>
                    onChange({ ...block, props: { ...block.props, level: l } })
                  }
                  className={`flex-1 rounded-lg border py-1.5 text-xs font-medium ${
                    block.props.level === l
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border bg-surface-sunken text-foreground-muted hover:bg-surface"
                  }`}
                >
                  H{l}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Text inspector */}
      {block.kind === "text" && (
        <div>
          <p className="text-xs text-foreground-muted">
            Edit text directly on the canvas. Markdown formatting is supported.
          </p>
        </div>
      )}

      {/* Image inspector */}
      {block.kind === "image" && (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted">
              Image URL
            </label>
            <input
              type="url"
              value={block.props.src}
              onChange={(e) =>
                onChange({ ...block, props: { ...block.props, src: e.target.value } })
              }
              placeholder="https://..."
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted">
              Alt text
            </label>
            <input
              type="text"
              value={block.props.alt}
              onChange={(e) =>
                onChange({ ...block, props: { ...block.props, alt: e.target.value } })
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted">
              Caption
            </label>
            <input
              type="text"
              value={block.props.caption}
              onChange={(e) =>
                onChange({ ...block, props: { ...block.props, caption: e.target.value } })
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted">
              Width
            </label>
            <WidthPicker
              value={block.props.width}
              onChange={(w) =>
                onChange({ ...block, props: { ...block.props, width: w } })
              }
            />
          </div>
        </>
      )}

      {/* Data block inspector (figure / table / dataset-explorer / chart) */}
      {isData && (block.kind === "figure" || block.kind === "table" || block.kind === "dataset-explorer" || block.kind === "chart") && (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted">
              Source (ResearchOS object)
            </label>
            {block.props.sourceId ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-1.5 text-xs text-foreground">
                <Icon name="figure" className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                <span className="min-w-0 flex-1 truncate font-mono">
                  {block.props.sourceId}
                </span>
                <button
                  type="button"
                  onClick={() => updateDataProp("sourceId", "")}
                  className="shrink-0 rounded p-0.5 hover:bg-surface"
                >
                  <Icon name="close" className="h-3 w-3 text-foreground-muted" />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="ros-btn-neutral inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
              {block.props.sourceId ? "Change source" : "Pick source"}
            </button>
            {pickerOpen && (
              <ReferencePicker
                onPick={(markdown) => {
                  // The picker returns a markdown embed link; extract the href.
                  const match = markdown.trim().match(/^\[[^\]]*\]\((.+)\)$/);
                  if (match) {
                    updateDataProp("sourceId", match[1]);
                  }
                  setPickerOpen(false);
                }}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted">
              Caption
            </label>
            <input
              type="text"
              value={block.props.caption}
              onChange={(e) => updateDataProp("caption", e.target.value)}
              placeholder="Optional caption shown below the embed"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground-muted">
              Width
            </label>
            <WidthPicker
              value={block.props.width}
              onChange={(w) => updateDataProp("width", w)}
            />
          </div>
          {/* Source validity hint */}
          {block.props.sourceId && (() => {
            const desc = parseObjectEmbed(block.props.sourceId);
            if (!desc || !desc.isEmbed) {
              return (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Source does not look like a valid embed link. Pick a source above to replace it.
                </p>
              );
            }
            return null;
          })()}
        </>
      )}

      {/* Two-column inspector */}
      {block.kind === "two-column" && (
        <div>
          <p className="text-xs text-foreground-muted">
            Add blocks to the left and right columns by clicking the column areas
            on the canvas, then selecting a block type from the palette above.
          </p>
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Block hover toolbar (move up / move down / delete)
// ---------------------------------------------------------------------------

function BlockToolbar({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface-raised px-0.5 py-0.5 shadow-sm">
      <Tooltip label="Move up">
        <button
          type="button"
          disabled={!canMoveUp}
          onClick={onMoveUp}
          className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-30"
        >
          {/* caret points down by default; rotate 180 to point up */}
          <Icon name="caret" className="h-3.5 w-3.5 rotate-180" />
        </button>
      </Tooltip>
      <Tooltip label="Move down">
        <button
          type="button"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground disabled:opacity-30"
        >
          <Icon name="caret" className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <div className="mx-0.5 h-4 w-px bg-border" />
      <Tooltip label="Delete block">
        <button
          type="button"
          onClick={onDelete}
          className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-muted hover:bg-destructive/10 hover:text-destructive"
        >
          <Icon name="trash" className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas block wrapper (selection ring + toolbar)
// ---------------------------------------------------------------------------

interface CanvasBlockProps {
  block: LabSiteBlock;
  index: number;
  total: number;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onTextChange: (text: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function CanvasBlock({
  block,
  index,
  total,
  selected,
  dragging,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  onTextChange,
  onDragStart,
  onDragOver,
  onDrop,
}: CanvasBlockProps) {
  const handleRef = useRef<HTMLDivElement>(null);

  // For text/heading blocks we provide inline editing via a textarea / input
  // overlay so the user can type without needing the inspector.
  const isInlineEditable = block.kind === "text" || block.kind === "heading";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDrop={(e) => { e.preventDefault(); onDrop(e); }}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
      className={`group relative rounded-xl border p-3 transition-colors ${
        selected
          ? "border-brand shadow-[0_0_0_1px_var(--color-brand)]"
          : dragging
          ? "border-brand/40 bg-brand/5"
          : "border-transparent hover:border-border"
      }`}
    >
      {/* Drag handle */}
      <div
        ref={handleRef}
        className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Icon
          name="more"
          className="h-4 w-4 rotate-90 cursor-grab text-foreground-muted"
        />
      </div>

      {/* Toolbar (shown on hover or when selected) */}
      <BlockToolbar
        canMoveUp={index > 0}
        canMoveDown={index < total - 1}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDelete={onDelete}
      />

      {/* Block content */}
      {isInlineEditable ? (
        // Inline-edit for text and heading blocks
        <InlineEditBlock block={block as LabSiteLeafBlock} onChange={onTextChange} />
      ) : (
        // Use the read-only renderer for everything else (data blocks get the
        // live ObjectEmbed path since bakedEmbeds is absent here)
        <div onClick={(e) => e.stopPropagation()}>
          <LabSiteBlockView blocks={[block]} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline edit for text / heading blocks
// ---------------------------------------------------------------------------

function InlineEditBlock({
  block,
  onChange,
}: {
  block: LabSiteLeafBlock;
  onChange: (text: string) => void;
}) {
  if (block.kind === "heading") {
    const Tag = (`h${block.props.level}` as "h1" | "h2" | "h3");
    const sizeClass =
      block.props.level === 1
        ? "text-2xl font-bold"
        : block.props.level === 3
        ? "text-lg font-semibold"
        : "text-xl font-bold";
    return (
      <Tag className={`${sizeClass} text-foreground outline-none`}>
        <span
          contentEditable
          suppressContentEditableWarning
          onBlur={(e) => onChange(e.currentTarget.textContent ?? "")}
          onClick={(e) => e.stopPropagation()}
          className="block focus:rounded focus:bg-brand/5 focus:outline-none"
        >
          {block.props.text}
        </span>
      </Tag>
    );
  }

  if (block.kind === "text") {
    return (
      <textarea
        value={block.props.markdown}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        rows={3}
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-brand focus:outline-none"
        placeholder="Markdown text. Use **bold**, *italic*, etc."
      />
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Drop zone between blocks
// ---------------------------------------------------------------------------

function DropZone({
  active,
  onDrop,
  onDragOver,
}: {
  active: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDrop={(e) => { e.preventDefault(); onDrop(e); }}
      className={`my-1 h-2 rounded-full transition-all ${
        active ? "h-8 bg-brand/10 border border-dashed border-brand" : "hover:h-4 hover:bg-border/30"
      }`}
    />
  );
}

// ---------------------------------------------------------------------------
// Main exported canvas editor component
// ---------------------------------------------------------------------------

export interface LabSiteCanvasEditorProps {
  /** Current blocks, serialized JSON string from the DB or empty for a new page. */
  initialBlocksJson: string | null;
  /** Called whenever the block array changes (to trigger auto-save or track dirty state). */
  onChange: (blocksJson: string) => void;
  /** True when the editor should render in a disabled/read-only state. */
  disabled?: boolean;
}

/**
 * The P2 companion canvas editor. Renders three columns:
 *   LEFT  - block palette (click or drag to add)
 *   CENTER - canvas (the page as a sequence of editable blocks)
 *   RIGHT  - inspector panel (settings for the selected block)
 *
 * Persists via onChange (which the parent wires to the blocks API). The P4
 * publish flow is handled by the parent (LabSiteDashboard); this component
 * exposes the current blocks via onChange so the parent can call
 * scanBlockEmbedHrefs and bake them on publish.
 */
export default function LabSiteCanvasEditor({
  initialBlocksJson,
  onChange,
  disabled = false,
}: LabSiteCanvasEditorProps) {
  const [blocks, setBlocks] = useState<LabSiteBlock[]>(() =>
    parseLabSiteBlocks(initialBlocksJson),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Index of the block being dragged from the canvas (for reorder highlight).
  // Using state rather than a ref so the dragging highlight renders correctly.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  // Palette drag kind (stored in a ref so it doesn't trigger re-renders on every drag).
  const dragFromPalette = useRef<LabSiteBlock["kind"] | null>(null);
  // The drop-zone index that is actively highlighted (between blocks).
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Sync blocks out to the parent on every change.
  useEffect(() => {
    const json = serializeLabSiteBlocks(blocks);
    if (json) onChange(json);
  }, [blocks, onChange]);

  // Update one block by id.
  const updateBlock = useCallback((id: string, updated: LabSiteBlock) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? updated : b)));
  }, []);

  // Move a block up or down.
  const moveBlock = useCallback((index: number, direction: "up" | "down") => {
    setBlocks((prev) => {
      const next = [...prev];
      const swap = direction === "up" ? index - 1 : index + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[index], next[swap]] = [next[swap], next[index]];
      return next;
    });
  }, []);

  // Delete a block.
  const deleteBlock = useCallback(
    (id: string) => {
      setBlocks((prev) => prev.filter((b) => b.id !== id));
      setSelectedId((prev) => (prev === id ? null : prev));
    },
    [],
  );

  // Insert a new block at an index.
  const insertAt = useCallback((kind: LabSiteBlock["kind"], index: number) => {
    const block = makeDefaultBlock(kind);
    setBlocks((prev) => {
      const next = [...prev];
      next.splice(index, 0, block);
      return next;
    });
    setSelectedId(block.id);
  }, []);

  // Palette drag start.
  const handlePaletteDragStart = useCallback(
    (kind: LabSiteBlock["kind"]) => {
      dragFromPalette.current = kind;
      setDraggingIndex(null);
    },
    [],
  );

  // Canvas block drag start (reorder).
  const handleCanvasDragStart = useCallback((index: number) => {
    setDraggingIndex(index);
    dragFromPalette.current = null;
  }, []);

  // Drop onto a drop zone at a given index.
  const handleDropAt = useCallback(
    (targetIndex: number) => {
      setDropTargetIndex(null);
      if (dragFromPalette.current !== null) {
        insertAt(dragFromPalette.current, targetIndex);
        dragFromPalette.current = null;
        return;
      }
      if (draggingIndex !== null) {
        const fromIndex = draggingIndex;
        setDraggingIndex(null);
        if (fromIndex === targetIndex || fromIndex === targetIndex - 1) return;
        setBlocks((prev) => {
          const next = [...prev];
          const [moved] = next.splice(fromIndex, 1);
          // Adjust target after removal if needed.
          const adjustedTarget = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
          next.splice(adjustedTarget, 0, moved);
          return next;
        });
      }
    },
    [insertAt, draggingIndex],
  );

  // Click-to-add: add at the end (simple fallback).
  const handlePaletteClick = useCallback(
    (kind: LabSiteBlock["kind"]) => {
      insertAt(kind, blocks.length);
    },
    [blocks.length, insertAt],
  );

  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 gap-3 xl:grid xl:grid-cols-[200px_1fr_240px] xl:items-start">
      {/* ------------------------------------------------------------------- */}
      {/* LEFT: palette                                                        */}
      {/* ------------------------------------------------------------------- */}
      <aside className="shrink-0 rounded-xl border border-border bg-surface-raised p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-foreground-muted">
          Layout
        </p>
        {BLOCK_KINDS.filter((k) => !k.isData).map((meta) => (
          <PaletteItem
            key={meta.kind}
            meta={meta}
            disabled={disabled}
            onDragStart={() => handlePaletteDragStart(meta.kind)}
            onClick={() => handlePaletteClick(meta.kind)}
          />
        ))}
        <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-widest text-foreground-muted">
          Data
        </p>
        {BLOCK_KINDS.filter((k) => k.isData).map((meta) => (
          <PaletteItem
            key={meta.kind}
            meta={meta}
            disabled={disabled}
            onDragStart={() => handlePaletteDragStart(meta.kind)}
            onClick={() => handlePaletteClick(meta.kind)}
          />
        ))}
        <p className="mt-3 text-[10px] text-foreground-muted leading-relaxed">
          Drag a block onto the canvas, or click to add at the end.
        </p>
      </aside>

      {/* ------------------------------------------------------------------- */}
      {/* CENTER: canvas                                                       */}
      {/* ------------------------------------------------------------------- */}
      <div
        className="min-h-96 flex-1 rounded-xl border border-border bg-surface-raised p-4"
        onDragOver={(e) => e.preventDefault()}
      >
        {blocks.length === 0 && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDropTargetIndex(0); }}
            onDrop={(e) => { e.preventDefault(); handleDropAt(0); }}
            className={`flex min-h-56 flex-col items-center justify-center rounded-xl border-2 border-dashed text-sm text-foreground-muted transition-colors ${
              dropTargetIndex === 0
                ? "border-brand bg-brand/5 text-brand"
                : "border-border"
            }`}
          >
            <Icon name="plus" className="mb-2 h-6 w-6" />
            <p>Drag a block here or click a block in the palette to add it.</p>
          </div>
        )}

        {blocks.map((block, index) => (
          <div key={block.id}>
            {/* Drop zone before this block */}
            <DropZone
              active={dropTargetIndex === index}
              onDragOver={() => setDropTargetIndex(index)}
              onDrop={() => handleDropAt(index)}
            />

            <CanvasBlock
              block={block}
              index={index}
              total={blocks.length}
              selected={selectedId === block.id}
              dragging={draggingIndex === index}
              onSelect={() => setSelectedId(block.id === selectedId ? null : block.id)}
              onMoveUp={() => moveBlock(index, "up")}
              onMoveDown={() => moveBlock(index, "down")}
              onDelete={() => deleteBlock(block.id)}
              onTextChange={(text) => {
                if (block.kind === "heading") {
                  updateBlock(block.id, {
                    ...block,
                    props: { ...block.props, text },
                  } as LabSiteBlock);
                } else if (block.kind === "text") {
                  updateBlock(block.id, {
                    ...block,
                    props: { ...block.props, markdown: text },
                  } as LabSiteBlock);
                }
              }}
              onDragStart={(e) => {
                dragFromPalette.current = null;
                handleCanvasDragStart(index);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={() => setDropTargetIndex(index)}
              onDrop={() => handleDropAt(index)}
            />
          </div>
        ))}

        {/* Drop zone after the last block */}
        {blocks.length > 0 && (
          <DropZone
            active={dropTargetIndex === blocks.length}
            onDragOver={() => setDropTargetIndex(blocks.length)}
            onDrop={() => handleDropAt(blocks.length)}
          />
        )}
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* RIGHT: inspector                                                     */}
      {/* ------------------------------------------------------------------- */}
      <Inspector
        block={selectedBlock}
        onChange={(updated) => {
          if (selectedId) updateBlock(selectedId, updated);
        }}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Palette item
// ---------------------------------------------------------------------------

function PaletteItem({
  meta,
  disabled,
  onDragStart,
  onClick,
}: {
  meta: BlockKindMeta;
  disabled: boolean;
  onDragStart: () => void;
  onClick: () => void;
}) {
  return (
    <div
      draggable={!disabled}
      onDragStart={onDragStart}
      onClick={disabled ? undefined : onClick}
      className={`mb-1.5 flex cursor-grab items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors active:cursor-grabbing ${
        meta.isData
          ? "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300 dark:hover:bg-purple-900"
          : "border-border bg-surface-sunken text-foreground hover:bg-surface"
      } ${disabled ? "pointer-events-none opacity-40" : ""}`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
          meta.isData
            ? "bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300"
            : "bg-brand/10 text-brand"
        }`}
      >
        <Icon name={meta.icon} className="h-3.5 w-3.5" />
      </span>
      {meta.label}
    </div>
  );
}
