"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAllMethodsIncludingShared } from "@/lib/local-api";
import type {
  CellCultureScheduleInstance,
  CompoundChildSnapshotEntry,
  CompoundComponent,
  CompoundSnapshotPayload,
  LCGradientProtocol,
  Method,
  PCRSnapshotPayload,
  PlateAnnotationSnapshot,
  Task,
  TaskMethodAttachment,
} from "@/lib/types";
import { ownerScopedTasksApi } from "@/lib/tasks/owner-scoped-api";
import {
  getMethodTypeMeta,
  type MethodTypeId,
} from "@/lib/methods/method-type-registry";
import {
  MAX_COMPOUND_DEPTH,
  validateCompoundComponents,
} from "@/lib/methods/compound-graph";
import type { NestedSnapshotAdapter } from "@/lib/methods/nested-snapshot";
import MarkdownMethodTabContent from "./MarkdownMethodTabContent";
import PdfMethodTabContent from "./PdfMethodTabContent";
import PcrMethodTabContent from "./PcrMethodTabContent";
import LcMethodTabContent from "./LcMethodTabContent";
import PlateMethodTabContent from "./PlateMethodTabContent";
import CellCultureMethodTabContent from "./CellCultureMethodTabContent";
import VariationNotesPanel from "./VariationNotesPanel";

interface CompoundMethodTabContentProps {
  task: Task;
  method: Method;
  methodId: number;
  attachment: TaskMethodAttachment | undefined;
  onTaskUpdate?: (task: Task) => void;
  readOnly?: boolean;
  /** When this viewer renders as a child inside ANOTHER compound, the parent
   *  routes per-child reads/writes through this adapter. The viewer's
   *  internal `compound_snapshots[child_id]` writes then go through
   *  `nestedSnapshot.write(<recursive payload>)` instead of the standalone
   *  attachment row. Mirrors the per-type viewer adapters. */
  nestedSnapshot?: NestedSnapshotAdapter<CompoundSnapshotPayload>;
  hideVariationNotes?: boolean;
}

/** Empty payload used when neither the task attachment nor the nested
 *  adapter has any saved compound snapshot data yet. */
const EMPTY_PAYLOAD: CompoundSnapshotPayload = { version: 1, children: {} };

/** Parse `compound_snapshots` JSON safely. Returns the empty payload on
 *  null / parse errors so the renderer never crashes when disk drift
 *  produces a malformed string. */
function parseCompoundPayload(raw: string | null | undefined): CompoundSnapshotPayload {
  if (!raw) return EMPTY_PAYLOAD;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_PAYLOAD;
    const version = parsed.version === 1 ? 1 : 1; // forward-compat hedge
    const children =
      parsed.children && typeof parsed.children === "object" ? parsed.children : {};
    return { version, children };
  } catch {
    return EMPTY_PAYLOAD;
  }
}

/**
 * CompoundMethodTabContent — renders a compound method's components as a
 * stacked vertical column with a sticky horizontal chip-strip TOC at top.
 *
 * Per-child viewers are the SAME components the standalone tab uses
 * (PcrMethodTabContent, PlateMethodTabContent, etc), passed a
 * `nestedSnapshot` adapter so their reads/writes route through this
 * compound's `compound_snapshots[child_id]` slot.
 *
 * Cycles and orphan references render inline error bands where the
 * broken component would have appeared; valid components recurse normally.
 */
export default function CompoundMethodTabContent({
  task,
  method,
  methodId,
  attachment,
  onTaskUpdate,
  readOnly = false,
  nestedSnapshot,
  hideVariationNotes = false,
}: CompoundMethodTabContentProps) {
  const queryClient = useQueryClient();
  const tasksApi = useMemo(() => ownerScopedTasksApi(task), [task]);

  const { data: allMethods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  const components = useMemo<CompoundComponent[]>(() => {
    const list = method.components ?? [];
    return [...list].sort((a, b) => a.ordering - b.ordering);
  }, [method.components]);

  // Resolve the active compound payload — from the nested-snapshot adapter
  // when this compound is itself a child of another compound, otherwise
  // from the task's standalone `compound_snapshots` attachment field.
  const nestedRead = nestedSnapshot?.read;
  const payload = useMemo<CompoundSnapshotPayload>(() => {
    if (nestedRead) {
      const fromAdapter = nestedRead();
      return fromAdapter ?? EMPTY_PAYLOAD;
    }
    return parseCompoundPayload(attachment?.compound_snapshots ?? null);
  }, [nestedRead, attachment?.compound_snapshots]);

  // Persist a new payload — either via the standalone attachment row or
  // via the nested-snapshot adapter for the recursive compound-in-compound
  // case. The renderer always writes the FULL payload back; the per-child
  // closures merge their slot into a fresh copy before calling this.
  const writePayload = useCallback(
    async (next: CompoundSnapshotPayload) => {
      if (nestedSnapshot) {
        await nestedSnapshot.write(next);
        return;
      }
      const updated = await tasksApi.update(task.id, {
        method_attachments: (task.method_attachments ?? []).map((a) =>
          a.method_id === methodId
            ? { ...a, compound_snapshots: JSON.stringify(next) }
            : a,
        ),
      });
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
      await queryClient.refetchQueries({ queryKey: ["task", task.id] });
      if (updated) onTaskUpdate?.(updated);
    },
    [
      nestedSnapshot,
      tasksApi,
      task.id,
      task.method_attachments,
      methodId,
      queryClient,
      onTaskUpdate,
    ],
  );

  // Per-child adapter factory. Each child's viewer gets a typed adapter
  // whose read/write/reset mutate this compound's payload at the
  // `compound_snapshots[child_id]` slot, then persist back via `writePayload`.
  const makeChildAdapter = useCallback(
    <T,>(childIdKey: string): NestedSnapshotAdapter<T> => ({
      read: () => {
        const entry = payload.children[childIdKey];
        return (entry?.snapshot as T) ?? null;
      },
      write: async (snapshot: T) => {
        const next: CompoundSnapshotPayload = {
          version: 1,
          children: {
            ...payload.children,
            [childIdKey]: {
              schema_version: 1,
              snapshot: snapshot as CompoundChildSnapshotEntry["snapshot"],
            },
          },
        };
        await writePayload(next);
      },
      reset: async () => {
        const nextChildren = { ...payload.children };
        delete nextChildren[childIdKey];
        await writePayload({ version: 1, children: nextChildren });
      },
    }),
    [payload, writePayload],
  );

  // Per-render graph validation — surfaces cycles + orphans inline rather
  // than crashing the render. The renderer still walks each component;
  // broken ones get an error band where they would have rendered.
  const graphCheck = useMemo(
    () =>
      validateCompoundComponents(components, allMethods, {
        id: method.id,
        owner: method.owner,
      }),
    [components, allMethods, method.id, method.owner],
  );

  // Pre-resolve each component's child Method row + adapter id key. Components
  // pointing at a missing method render an "orphan" placeholder; valid ones
  // dispatch to the type-specific viewer.
  const resolvedChildren = useMemo(() => {
    return components.map((c) => {
      const owner = c.owner ?? method.owner;
      const child = allMethods.find((m) => m.id === c.method_id && m.owner === owner);
      const idKey = String(c.method_id);
      return { c, child, idKey, owner };
    });
  }, [components, allMethods, method.owner]);

  return (
    <div className="flex flex-col h-full">
      {!hideVariationNotes && (
        <VariationNotesPanel
          task={task}
          methodId={methodId}
          variationNotes={attachment?.variation_notes || null}
          onSaved={(updatedTask) => {
            if (updatedTask) onTaskUpdate?.(updatedTask);
            queryClient.refetchQueries({ queryKey: ["tasks"] });
            queryClient.refetchQueries({ queryKey: ["allTasks"] });
          }}
          readOnly={readOnly}
        />
      )}
      <div className="flex-1 overflow-y-auto">
        {/* Sticky horizontal chip-strip TOC (Q-V2 lock — sticky CHIP STRIP,
            not sidebar). Mirrors the page-level tab strip's visual weight so
            composition feels like an extension of the tab pattern, not a new
            navigation paradigm. */}
        <CompoundToc
          components={components}
          resolvedChildren={resolvedChildren}
          compoundName={method.name}
        />
        {/* Graph-level error banner — fires once for the WHOLE compound when
            the validator caught a problem that prevents safe recursion (e.g.
            depth_exceeded). Per-component orphan/cycle markers also render
            inline below where the broken row would have appeared. */}
        {!graphCheck.ok && graphCheck.reason === "depth_exceeded" && (
          <div className="mx-6 mt-4 border border-red-200 bg-red-50 rounded p-3">
            <div className="text-xs font-medium text-red-700">Nested too deep</div>
            <div className="text-sm text-red-900 mt-1">
              This compound nests more than {MAX_COMPOUND_DEPTH} levels of compounds.
              Flatten one of the inner kits to render the full hierarchy.
            </div>
          </div>
        )}
        <div className="p-6 space-y-6">
          {resolvedChildren.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">
              This compound has no components yet. Edit the compound to add some.
            </p>
          )}
          {resolvedChildren.map(({ c, child, idKey, owner }, idx) => {
            const sectionId = `component-${methodId}-${c.method_id}-${idx}`;
            const displayLabel = c.label || child?.name || `Method ${c.method_id}`;
            // Orphan: the child method no longer exists in the methods list.
            if (!child) {
              return (
                <section
                  key={`${idKey}-${idx}`}
                  id={sectionId}
                  className="border border-amber-200 bg-amber-50 rounded p-3"
                >
                  <div className="text-xs font-medium text-amber-700">Component deleted</div>
                  <div className="text-sm text-amber-900 mt-1">
                    The method referenced here (id {c.method_id}, owner {owner}) no longer
                    exists. Edit this compound to remove the broken reference.
                  </div>
                </section>
              );
            }
            // Cycle: the validator flagged this component is on a cycle path.
            const onCyclePath =
              !graphCheck.ok &&
              graphCheck.reason === "cycle" &&
              graphCheck.details.cyclePath?.some(
                (n) => n.method_id === c.method_id && n.owner === owner,
              );
            if (onCyclePath) {
              return (
                <section
                  key={`${idKey}-${idx}`}
                  id={sectionId}
                  className="border border-red-200 bg-red-50 rounded p-3"
                >
                  <div className="text-xs font-medium text-red-700">Cycle detected</div>
                  <div className="text-sm text-red-900 mt-1">
                    Component {displayLabel} forms a cycle in this compound&apos;s
                    composition graph. The recursive render is stopped here.
                  </div>
                </section>
              );
            }
            return (
              <CompoundChildSection
                key={`${idKey}-${idx}`}
                sectionId={sectionId}
                label={displayLabel}
                child={child}
                ownerCtx={owner}
                task={task}
                attachment={attachment}
                methodId={c.method_id}
                onTaskUpdate={onTaskUpdate}
                readOnly={readOnly}
                makeChildAdapter={makeChildAdapter}
                idKey={idKey}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Sticky chip-strip TOC ───────────────────────────────────────────────────

function CompoundToc({
  components,
  resolvedChildren,
  compoundName,
}: {
  components: CompoundComponent[];
  resolvedChildren: ReturnType<typeof Array.prototype.map>;
  compoundName: string;
}) {
  if (components.length === 0) return null;
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5">
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mr-1">
          {compoundName}
        </span>
        {(resolvedChildren as Array<{
          c: CompoundComponent;
          child: Method | undefined;
          idKey: string;
        }>).map(({ c, child, idKey }, idx) => {
          const meta = getMethodTypeMeta(child?.method_type ?? null);
          const Icon = meta.icon;
          const label = c.label || child?.name || `Method ${c.method_id}`;
          const sectionId = `component-${idKey}-${idx}`;
          return (
            <a
              key={`${idKey}-${idx}`}
              href={`#${sectionId}`}
              onClick={(e) => {
                // Smooth-scroll on click so the user sees the section pop in
                // when chip is tapped on long compounds.
                const target = document.getElementById(sectionId);
                if (target) {
                  e.preventDefault();
                  target.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs ${meta.color.bg} ${meta.color.text} hover:opacity-80 transition-opacity`}
              title={`${label} (${meta.label})`}
            >
              <Icon className="w-3 h-3" />
              <span className="max-w-[140px] truncate">{label}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ── Per-component section renderer ──────────────────────────────────────────
//
// Dispatches the child to the right per-type viewer, wired up with a
// nestedSnapshot adapter typed for the child's snapshot shape.

interface CompoundChildSectionProps {
  sectionId: string;
  label: string;
  child: Method;
  ownerCtx: string;
  task: Task;
  attachment: TaskMethodAttachment | undefined;
  methodId: number;
  onTaskUpdate?: (task: Task) => void;
  readOnly: boolean;
  makeChildAdapter: <T>(childIdKey: string) => NestedSnapshotAdapter<T>;
  idKey: string;
}

function CompoundChildSection({
  sectionId,
  label,
  child,
  ownerCtx,
  task,
  attachment,
  methodId,
  onTaskUpdate,
  readOnly,
  makeChildAdapter,
  idKey,
}: CompoundChildSectionProps) {
  const childType = (child.method_type ?? "markdown") as MethodTypeId | "markdown";
  const meta = getMethodTypeMeta(child.method_type ?? null);
  const Icon = meta.icon;
  return (
    <section id={sectionId} className="rounded-lg border border-gray-200 overflow-hidden bg-white">
      {/* Section header — distinguishes one child from the next */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-800">{label}</h4>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.color.bg} ${meta.color.text}`}
          >
            {meta.shortLabel}
          </span>
          <span className="text-[10px] text-gray-400">
            (owner: {ownerCtx} · id {child.id})
          </span>
        </div>
      </div>
      <div className="p-0">
        <CompoundChildBody
          childType={childType}
          child={child}
          task={task}
          attachment={attachment}
          parentMethodId={methodId}
          onTaskUpdate={onTaskUpdate}
          readOnly={readOnly}
          makeChildAdapter={makeChildAdapter}
          idKey={idKey}
          childId={child.id}
        />
      </div>
    </section>
  );
}

interface CompoundChildBodyProps {
  childType: MethodTypeId | "markdown";
  child: Method;
  task: Task;
  attachment: TaskMethodAttachment | undefined;
  parentMethodId: number;
  onTaskUpdate?: (task: Task) => void;
  readOnly: boolean;
  makeChildAdapter: <T>(childIdKey: string) => NestedSnapshotAdapter<T>;
  idKey: string;
  childId: number;
}

function CompoundChildBody({
  childType,
  child,
  task,
  attachment,
  onTaskUpdate,
  readOnly,
  makeChildAdapter,
  idKey,
  childId,
}: CompoundChildBodyProps) {
  switch (childType) {
    case "pcr":
      return (
        <PcrMethodTabContent
          task={task}
          method={child}
          methodId={childId}
          attachment={attachment}
          onTaskUpdate={onTaskUpdate}
          readOnly={readOnly}
          hideVariationNotes
          nestedSnapshot={makeChildAdapter<PCRSnapshotPayload>(idKey)}
        />
      );
    case "lc_gradient":
      return (
        <LcMethodTabContent
          task={task}
          method={child}
          methodId={childId}
          attachment={attachment}
          onTaskUpdate={onTaskUpdate}
          readOnly={readOnly}
          hideVariationNotes
          nestedSnapshot={makeChildAdapter<LCGradientProtocol>(idKey)}
        />
      );
    case "plate":
      return (
        <PlateMethodTabContent
          task={task}
          method={child}
          methodId={childId}
          attachment={attachment}
          onTaskUpdate={onTaskUpdate}
          readOnly={readOnly}
          hideVariationNotes
          nestedSnapshot={makeChildAdapter<PlateAnnotationSnapshot>(idKey)}
        />
      );
    case "cell_culture":
      return (
        <CellCultureMethodTabContent
          task={task}
          method={child}
          methodId={childId}
          attachment={attachment}
          onTaskUpdate={onTaskUpdate}
          readOnly={readOnly}
          hideVariationNotes
          nestedSnapshot={makeChildAdapter<CellCultureScheduleInstance>(idKey)}
        />
      );
    case "pdf":
      return (
        <PdfMethodTabContent
          task={task}
          method={child}
          methodId={childId}
          attachment={attachment}
          onTaskUpdate={onTaskUpdate}
          readOnly={readOnly}
          hideVariationNotes
        />
      );
    case "compound":
      // Recursive case — render this child compound's own viewer inline.
      // Cycle/depth checks at the validator level catch infinite recursion;
      // here we just dispatch.
      return (
        <CompoundMethodTabContent
          task={task}
          method={child}
          methodId={childId}
          attachment={attachment}
          onTaskUpdate={onTaskUpdate}
          readOnly={readOnly}
          hideVariationNotes
          nestedSnapshot={makeChildAdapter<CompoundSnapshotPayload>(idKey)}
        />
      );
    case "markdown":
    default:
      return (
        <MarkdownMethodTabContent
          task={task}
          method={child}
          methodId={childId}
          attachment={attachment}
          onTaskUpdate={onTaskUpdate}
          readOnly={readOnly}
          hideVariationNotes
          nestedSnapshot={makeChildAdapter<{ body_override: string }>(idKey)}
        />
      );
  }
}
