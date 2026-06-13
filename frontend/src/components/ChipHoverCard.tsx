"use client";

// HR-embeds-hover. Lazy hover-card preview for ObjectChip pills.
//
// On first hover (or keyboard focus) of a chip, fetches a type-appropriate
// summary and floats a small calm card below the chip. Data is fetched at
// most once per type+id across the session — a module-level cache stores
// each result so repeated hovers never re-fetch.
//
// Positioning mirrors Tooltip.tsx: the card is portal-rendered to document.body
// with position:fixed so it cannot be clipped by any overflow:hidden ancestor
// inside a note panel or sidebar scroll container.
//
// Constraints strictly observed:
//   - Additive: does NOT touch the chip's click / navigation / popup behavior.
//   - No new inline SVG: icons via <Icon name=...>; thumbnail via MoleculeThumbnail.
//   - No em-dashes, no emojis, no mid-sentence colons.
//
// Voice. No em-dashes, no emojis, no mid-sentence colons.

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { splitMethodRefId, type ObjectRefType } from "@/lib/references";
import { moleculesApi, type MoleculeMeta } from "@/lib/chemistry/api";
import { sequencesApi, notesApi, methodsApi } from "@/lib/local-api";
import { dataHubApi } from "@/lib/datahub/api";
import { MoleculeThumbnail } from "@/components/chemistry/MoleculeThumbnail";

// ── card data shapes ─────────────────────────────────────────────────────────

type CardData =
  | { kind: "molecule"; name: string; formula?: string; molWeight?: number; smiles?: string }
  | { kind: "sequence"; name: string; length: number; seqType: string; featureCount: number }
  | { kind: "datahub"; name: string; rows: number; cols: number }
  | { kind: "method"; name: string; methodType?: string | null }
  | { kind: "note"; title: string; excerpt: string }
  | { kind: "generic"; typeLabel: string; name: string };

type LoadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; data: CardData }
  | { phase: "error" };

// ── module-level fetch cache (never re-fetches per session) ──────────────────

const _cache = new Map<string, CardData>();

function _cacheKey(type: ObjectRefType, id: string): string {
  return `${type}:${id}`;
}

function _typeLabel(type: ObjectRefType): string {
  const labels: Record<ObjectRefType, string> = {
    sequence: "Sequence",
    collection: "Collection",
    method: "Method",
    note: "Note",
    file: "File",
    project: "Project",
    molecule: "Molecule",
    datahub: "Data Hub doc",
    dataset: "Dataset",
    phylo: "Phylogenetic tree",
    task: "Task",
    experiment: "Experiment",
  };
  return labels[type] ?? "Object";
}

async function fetchCardData(
  type: ObjectRefType,
  id: string,
  label: string,
): Promise<CardData> {
  const key = _cacheKey(type, id);
  const hit = _cache.get(key);
  if (hit) return hit;

  let data: CardData;

  try {
    switch (type) {
      case "molecule": {
        const d = await moleculesApi.get(id);
        const meta: MoleculeMeta | null = d?.meta ?? null;
        data = meta
          ? {
              kind: "molecule",
              name: meta.name,
              formula: meta.formula,
              molWeight: meta.mol_weight,
              smiles: meta.smiles,
            }
          : { kind: "generic", typeLabel: _typeLabel(type), name: label };
        break;
      }
      case "sequence": {
        const numId = Number(id);
        const d = Number.isFinite(numId) ? await sequencesApi.get(numId) : null;
        data = d
          ? {
              kind: "sequence",
              name: d.display_name,
              length: d.length || d.seq.length,
              seqType: String(d.seq_type),
              featureCount: d.feature_count,
            }
          : { kind: "generic", typeLabel: _typeLabel(type), name: label };
        break;
      }
      case "datahub": {
        const c = await dataHubApi.getContent(id);
        data = c
          ? {
              kind: "datahub",
              name: c.meta.name,
              rows: c.rows.length,
              cols: c.columns.length,
            }
          : { kind: "generic", typeLabel: _typeLabel(type), name: label };
        break;
      }
      case "method": {
        // A "public:" scope prefix routes to the public store; a bare id
        // resolves private-first. Mirrors MethodEmbed so the hover preview and
        // the block embed agree on which method a public reference points at.
        const { id: numId, owner } = splitMethodRefId(id);
        const m = Number.isFinite(numId) ? await methodsApi.get(numId, owner) : null;
        data = m
          ? { kind: "method", name: m.name, methodType: m.method_type }
          : { kind: "generic", typeLabel: _typeLabel(type), name: label };
        break;
      }
      case "note": {
        const numId = Number(id);
        const n = Number.isFinite(numId) ? await notesApi.get(numId) : null;
        if (n) {
          const raw =
            n.entries?.[0]?.content ||
            n.entries?.[0]?.title ||
            n.description ||
            "";
          const excerpt = raw.replace(/\s+/g, " ").trim().slice(0, 120);
          data = { kind: "note", title: n.title, excerpt };
        } else {
          data = { kind: "generic", typeLabel: _typeLabel(type), name: label };
        }
        break;
      }
      default: {
        data = { kind: "generic", typeLabel: _typeLabel(type), name: label };
        break;
      }
    }
  } catch {
    data = { kind: "generic", typeLabel: _typeLabel(type), name: label };
  }

  _cache.set(key, data);
  return data;
}

// ── card body sub-renderers ───────────────────────────────────────────────────

function MoleculeCardBody({
  data,
}: {
  data: Extract<CardData, { kind: "molecule" }>;
}) {
  const facts = [
    data.formula,
    data.molWeight != null ? `${data.molWeight.toFixed(2)} g/mol` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <div className="flex items-start gap-2 p-2.5">
      {data.smiles ? (
        <span
          data-testid="molecule-thumb"
          className="shrink-0 grid place-items-center overflow-hidden rounded border border-border bg-white"
          style={{ width: 72, height: 52 }}
        >
          <MoleculeThumbnail structure={data.smiles} width={72} height={52} />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-meta font-semibold text-foreground truncate">{data.name}</p>
        {facts ? (
          <p className="text-meta text-foreground-muted mt-0.5">{facts}</p>
        ) : null}
      </div>
    </div>
  );
}

function SequenceCardBody({
  data,
}: {
  data: Extract<CardData, { kind: "sequence" }>;
}) {
  const unit = data.seqType.toLowerCase().includes("protein") ? "aa" : "bp";
  return (
    <div className="p-2.5">
      <p className="text-meta font-semibold text-foreground truncate">{data.name}</p>
      <p className="text-meta text-foreground-muted mt-0.5">
        {data.length.toLocaleString()} {unit}
        {"  ·  "}
        {data.seqType}
        {"  ·  "}
        {data.featureCount} {data.featureCount === 1 ? "feature" : "features"}
      </p>
    </div>
  );
}

function DataHubCardBody({
  data,
}: {
  data: Extract<CardData, { kind: "datahub" }>;
}) {
  const dims = `${data.rows} ${data.rows === 1 ? "row" : "rows"}  ×  ${data.cols} ${data.cols === 1 ? "col" : "cols"}`;
  return (
    <div className="p-2.5">
      <p className="text-meta font-semibold text-foreground truncate">{data.name}</p>
      <p className="text-meta text-foreground-muted mt-0.5">{dims}</p>
    </div>
  );
}

function MethodCardBody({
  data,
}: {
  data: Extract<CardData, { kind: "method" }>;
}) {
  const sub = data.methodType
    ? data.methodType
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : null;
  return (
    <div className="p-2.5">
      <p className="text-meta font-semibold text-foreground truncate">{data.name}</p>
      {sub ? <p className="text-meta text-foreground-muted mt-0.5">{sub}</p> : null}
    </div>
  );
}

function NoteCardBody({
  data,
}: {
  data: Extract<CardData, { kind: "note" }>;
}) {
  return (
    <div className="p-2.5">
      <p className="text-meta font-semibold text-foreground truncate">{data.title}</p>
      {data.excerpt ? (
        <p className="text-meta text-foreground-muted mt-0.5 leading-snug line-clamp-2">
          {data.excerpt}
        </p>
      ) : null}
    </div>
  );
}

function GenericCardBody({
  data,
}: {
  data: Extract<CardData, { kind: "generic" }>;
}) {
  return (
    <div className="p-2.5">
      <p className="text-meta text-foreground-muted">{data.typeLabel}</p>
      <p className="text-meta font-semibold text-foreground truncate">{data.name}</p>
    </div>
  );
}

function CardBody({ data }: { data: CardData }) {
  if (data.kind === "molecule") return <MoleculeCardBody data={data} />;
  if (data.kind === "sequence") return <SequenceCardBody data={data} />;
  if (data.kind === "datahub") return <DataHubCardBody data={data} />;
  if (data.kind === "method") return <MethodCardBody data={data} />;
  if (data.kind === "note") return <NoteCardBody data={data} />;
  return <GenericCardBody data={data} />;
}

// ── positioning constants (mirrors Tooltip.tsx) ───────────────────────────────

const GAP = 6;
const MARGIN = 4;

// ── main export ───────────────────────────────────────────────────────────────

interface Props {
  type: ObjectRefType;
  id: string;
  label: string;
  children: React.ReactElement<Record<string, unknown>>;
}

/**
 * Wraps a chip and injects lazy hover/focus preview. The chip's click handler,
 * navigation, and popup behavior are preserved exactly via React.cloneElement:
 * we only merge onMouseEnter/Leave and onFocus/Blur handlers (composing with
 * any existing ones), identical to how Tooltip.tsx works.
 *
 * The floating card is pointer-events:none so no click can be stolen from the
 * chip, and it is portal'd to document.body so no overflow:hidden ancestor can
 * clip it.
 */
export default function ChipHoverCard({ type, id, label, children }: Props) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const fetchedRef = useRef(false);

  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>({ phase: "idle" });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Clean up any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  // Recompute card position whenever visibility or load state changes so the
  // card repositions itself once its content height is known.
  useLayoutEffect(() => {
    if (!visible || !triggerRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const card = cardRef.current?.getBoundingClientRect();
    const cardW = card?.width ?? 220;
    const cardH = card?.height ?? 60;

    // Default placement: below the trigger, horizontally centred on it.
    let top = trigger.bottom + GAP;
    let left = trigger.left + trigger.width / 2 - cardW / 2;

    // Clamp to viewport so the card never spills off-screen.
    const maxLeft = Math.max(MARGIN, window.innerWidth - cardW - MARGIN);
    const maxTop = Math.max(MARGIN, window.innerHeight - cardH - MARGIN);
    left = Math.max(MARGIN, Math.min(left, maxLeft));
    top = Math.max(MARGIN, Math.min(top, maxTop));

    setPos({ top, left });
  }, [visible, loadState]);

  const show = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setVisible(true);
      if (!fetchedRef.current) {
        fetchedRef.current = true;
        setLoadState({ phase: "loading" });
        fetchCardData(type, id, label)
          .then((data) => setLoadState({ phase: "done", data }))
          .catch(() => setLoadState({ phase: "error" }));
      }
    }, 80);
  }, [type, id, label]);

  const hide = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
    setPos(null);
  }, []);

  const child = React.Children.only(children);

  type ChildHandlers = {
    onMouseEnter?: React.MouseEventHandler;
    onMouseLeave?: React.MouseEventHandler;
    onFocus?: React.FocusEventHandler;
    onBlur?: React.FocusEventHandler;
    ref?: React.Ref<HTMLElement>;
  };
  const orig = (React.isValidElement(child) ? child.props : {}) as ChildHandlers;

  // Compose our ref with any existing ref on the child.
  const composedRef = useCallback(
    (el: HTMLElement | null) => {
      triggerRef.current = el;
      const existing = orig.ref;
      if (!existing) return;
      if (typeof existing === "function") {
        existing(el);
      } else {
        (existing as React.MutableRefObject<HTMLElement | null>).current = el;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orig.ref],
  );

  const merged: Record<string, unknown> = {
    onMouseEnter: (e: React.MouseEvent) => {
      orig.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      orig.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      orig.onFocus?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      orig.onBlur?.(e);
      hide();
    },
    ref: composedRef,
  };

  if (!React.isValidElement(child)) return <>{children}</>;

  return (
    <>
      {React.cloneElement(child, merged)}
      {mounted &&
        visible &&
        createPortal(
          <div
            ref={cardRef}
            role="status"
            aria-live="polite"
            data-chip-hover-card={type}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              opacity: pos ? 1 : 0,
              transition: "opacity 100ms",
              // Pointer-events off: the card is purely informational; clicks
              // must still reach the chip beneath / around it.
              pointerEvents: "none",
              zIndex: 1000,
              minWidth: 180,
              maxWidth: 280,
            }}
            className="rounded-lg border border-border bg-surface-raised shadow-lg text-foreground overflow-hidden"
          >
            {loadState.phase === "loading" && (
              <div className="p-2.5 text-meta text-foreground-muted">Loading...</div>
            )}
            {loadState.phase === "done" && <CardBody data={loadState.data} />}
          </div>,
          document.body,
        )}
    </>
  );
}

// Test-only helper to reset the module-level fetch cache between test cases.
export function __resetChipHoverCardCache(): void {
  _cache.clear();
}
