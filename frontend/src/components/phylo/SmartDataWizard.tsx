"use client";

// Tree Studio Phase 4: the Smart Data Binding wizard (the GUI front door).
// See docs/proposals/2026-06-14-phylo-phase4-smart-data-binding.md and the
// approved mockup docs/mockups/2026-06-14-phylo-phase4-smart-data-binding.html.
//
// A self-contained, presentational widget that walks the user through adding a
// Data Hub table's columns onto the open tree as overlays. It takes the
// DETERMINISTIC engine's output (rankJoinCandidates -> JoinCandidate[]) as a
// prop and reports the user's chosen (column, geom) selections back through
// onAddOverlays; the HOST owns the app operation (mergeTableColumnsIntoMetadata
// + makePanel + state). Because it is pure props in / callbacks out, the SAME
// widget mounts in the /phylo Layers Add menu AND inline in a BeakerBot chat
// message (the locked "one engine, two front doors" design). The model only
// narrates; this widget + the engine do the work.
//
// Icon-guard: no inline vector elements, every glyph comes from @/components/icons.
// Live preview thumbnails per geom are a follow-up (they need a new render path
// + an icon-baseline sign-off); v1 uses labeled geom cards.

import { useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import type {
  JoinCandidate,
  OverlayGeom,
  OverlaySuggestion,
} from "@/lib/phylo/smart-binding";

/** One chosen overlay to add: a table column rendered as a specific geom. */
export interface OverlaySelection {
  columnId: string;
  columnName: string;
  geom: OverlayGeom;
}

export interface SmartDataWizardProps {
  /** Ranked joinable tables from the engine (already computed by the host). */
  candidates: JoinCandidate[];
  /**
   * Add the chosen overlays. The host merges the table's columns into the tree's
   * metadata (mergeTableColumnsIntoMetadata) and appends one panel per selection
   * (makePanel(geom, [mergedName])). May be async; the wizard shows the done
   * step on resolve.
   */
  onAddOverlays: (args: {
    tableId: string;
    tableName: string;
    joinColumnId: string;
    selections: OverlaySelection[];
  }) => void | Promise<void>;
  /** Dismiss the wizard. */
  onClose: () => void;
  /** Mounted inline in a scrolling chat (vs the centered GUI modal). When inline
   *  the body must NOT introduce its own vertical scroll, or it traps the wheel
   *  and the chat cannot scroll while the cursor is over the wizard. The wizard
   *  grows naturally and the chat owns the scroll. */
  inline?: boolean;
}

type Step = "table" | "columns" | "geoms" | "done";

/** Human label + one-line description per geom (the card copy). */
const GEOM_META: Record<OverlayGeom, { label: string; desc: string }> = {
  bars: { label: "Bars", desc: "aligned bar per tip" },
  heat: { label: "Heatmap", desc: "color cell per tip" },
  dots: { label: "Dots", desc: "sized / colored dot per tip" },
  point: { label: "Point", desc: "point with error whisker" },
  strip: { label: "Color strip", desc: "categorical band" },
};

/** Coverage chip styling: strong join reads brand, partial reads amber. */
function coverageTone(rate: number): "hi" | "mid" {
  return rate >= 0.5 ? "hi" : "mid";
}

function selKey(columnId: string, geom: OverlayGeom): string {
  return `${columnId}::${geom}`;
}

export function SmartDataWizard({
  candidates,
  onAddOverlays,
  onClose,
  inline = false,
}: SmartDataWizardProps) {
  const [step, setStep] = useState<Step>("table");
  const [tableId, setTableId] = useState<string | null>(
    candidates[0]?.tableId ?? null,
  );
  // Chosen columns (step 2) and chosen (column, geom) pairs (step 3).
  const [columnIds, setColumnIds] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  const table = useMemo(
    () => candidates.find((c) => c.tableId === tableId) ?? null,
    [candidates, tableId],
  );

  const chosenOverlays = useMemo<OverlaySuggestion[]>(
    () => (table ? table.overlays.filter((o) => columnIds.has(o.columnId)) : []),
    [table, columnIds],
  );

  const selections = useMemo<OverlaySelection[]>(() => {
    const out: OverlaySelection[] = [];
    for (const o of chosenOverlays)
      for (const g of o.geoms)
        if (picks.has(selKey(o.columnId, g)))
          out.push({ columnId: o.columnId, columnName: o.columnName, geom: g });
    return out;
  }, [chosenOverlays, picks]);

  // --- step transitions ---

  function pickTable(id: string) {
    setTableId(id);
    const t = candidates.find((c) => c.tableId === id);
    // Pre-select every overlayable column (the user trims down).
    setColumnIds(new Set(t ? t.overlays.map((o) => o.columnId) : []));
    setStep("columns");
  }

  function toColumns() {
    setStep("columns");
  }

  function toGeoms() {
    // Pre-check each chosen column's recommended geom.
    const next = new Set<string>();
    for (const o of chosenOverlays) next.add(selKey(o.columnId, o.recommendedGeom));
    setPicks(next);
    setStep("geoms");
  }

  function toggleColumn(id: string) {
    setColumnIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePick(columnId: string, geom: OverlayGeom) {
    setPicks((prev) => {
      const next = new Set(prev);
      const k = selKey(columnId, geom);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function add() {
    if (!table || selections.length === 0) return;
    setAdding(true);
    try {
      await onAddOverlays({
        tableId: table.tableId,
        tableName: table.tableName,
        joinColumnId: table.joinColumnId,
        selections,
      });
      setAddedCount(selections.length);
      setStep("done");
    } finally {
      setAdding(false);
    }
  }

  function restart() {
    setColumnIds(new Set());
    setPicks(new Set());
    setAddedCount(0);
    setTableId(candidates[0]?.tableId ?? null);
    setStep("table");
  }

  // --- render ---

  return (
    <div className="w-[440px] max-w-full rounded-2xl border border-border bg-surface-raised shadow-xl overflow-hidden">
      <Header onClose={onClose} title={titleFor(step, table)} />
      {step !== "done" && <StepRail step={step} />}

      <div className={inline ? "px-4 py-3" : "max-h-[460px] overflow-y-auto px-4 py-3"}>
        {step === "table" && (
          <TableStep candidates={candidates} selectedId={tableId} onPick={pickTable} />
        )}
        {step === "columns" && table && (
          <ColumnStep
            table={table}
            columnIds={columnIds}
            onToggle={toggleColumn}
          />
        )}
        {step === "geoms" && (
          <GeomStep overlays={chosenOverlays} picks={picks} onToggle={togglePick} />
        )}
        {step === "done" && table && (
          <DoneStep count={addedCount} tableName={table.tableName} />
        )}
      </div>

      <Footer
        step={step}
        canNextFromTable={!!table}
        columnCount={columnIds.size}
        selectionCount={selections.length}
        adding={adding}
        onCancel={onClose}
        onBack={() => setStep(step === "geoms" ? "columns" : "table")}
        onTableNext={toColumns}
        onColumnsNext={toGeoms}
        onAdd={add}
        onAddAnother={restart}
        onDone={onClose}
      />
    </div>
  );
}

function titleFor(step: Step, table: JoinCandidate | null): string {
  if (step === "table") return "Find data for this tree";
  if (step === "columns") return `${table?.tableName ?? "Table"} → columns`;
  if (step === "geoms") return "Pick overlays to add";
  return "Overlays added";
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
      <Icon name="bolt" className="w-4 h-4 text-accent shrink-0" />
      <div className="text-sm font-semibold text-foreground truncate">{title}</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="ml-auto text-foreground-muted hover:text-foreground"
      >
        <Icon name="x" className="w-4 h-4" />
      </button>
    </div>
  );
}

function StepRail({ step }: { step: Step }) {
  const idx = step === "table" ? 0 : step === "columns" ? 1 : 2;
  const labels = ["Pick a table", "Columns", "Overlays"];
  return (
    <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border bg-surface">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-1.5">
          {i > 0 && (
            <Icon name="chevronRight" className="w-3 h-3 text-foreground-muted/50" />
          )}
          <span
            className={`flex items-center gap-1.5 text-xs ${
              i === idx ? "text-foreground font-semibold" : "text-foreground-muted"
            }`}
          >
            <span
              className={`w-[18px] h-[18px] rounded-full grid place-items-center text-[10px] border ${
                i < idx
                  ? "bg-accent-soft border-accent text-accent"
                  : i === idx
                    ? "bg-accent border-accent text-white"
                    : "bg-surface border-border"
              }`}
            >
              {i < idx ? <Icon name="check" className="w-2.5 h-2.5" /> : i + 1}
            </span>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function CoverageBar({ rate, tone }: { rate: number; tone: "hi" | "mid" }) {
  return (
    <div className="h-1 rounded-full bg-border mt-1.5 overflow-hidden">
      <div
        className={tone === "hi" ? "h-full bg-accent" : "h-full bg-amber-500"}
        style={{ width: `${Math.round(rate * 100)}%` }}
      />
    </div>
  );
}

function overlaysSummary(table: JoinCandidate): string {
  const num = table.overlays.filter((o) => o.columnKind === "numeric").length;
  const cat = table.overlays.filter((o) => o.columnKind === "categorical").length;
  const parts: string[] = [];
  if (num) parts.push(`${num} numeric → heatmap, bars, dots`);
  if (cat) parts.push(`${cat} category → color strip`);
  return parts.join(" · ");
}

function TableStep({
  candidates,
  selectedId,
  onPick,
}: {
  candidates: JoinCandidate[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  if (candidates.length === 0) {
    return (
      <p className="text-sm text-foreground-muted px-1 py-6 text-center">
        No table in this collection shares a column with these tip labels. Add a
        Data Hub table whose rows are keyed by your tip names, then try again.
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      {candidates.map((t) => {
        const tone = coverageTone(t.joinRate);
        const sel = t.tableId === selectedId;
        return (
          <button
            key={t.tableId}
            type="button"
            onClick={() => onPick(t.tableId)}
            className={`w-full text-left flex gap-3 items-start p-3 rounded-xl border transition-colors ${
              sel
                ? "border-accent bg-accent-soft"
                : "border-border hover:bg-surface"
            }`}
          >
            <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent grid place-items-center shrink-0">
              <Icon name="table" className="w-4 h-4" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-foreground truncate">
                {t.tableName}
              </span>
              <span className="block text-xs text-foreground-muted mt-0.5">
                {overlaysSummary(t)}
              </span>
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-semibold mt-1.5 px-2 py-0.5 rounded-full ${
                  tone === "hi"
                    ? "bg-accent-soft text-accent"
                    : "bg-amber-500/15 text-amber-600"
                }`}
              >
                joins {t.matchedTips} of {t.totalTips} tips
              </span>
              <CoverageBar rate={t.joinRate} tone={tone} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function kindTag(kind: OverlaySuggestion["columnKind"]): {
  label: string;
  cls: string;
} {
  return kind === "numeric"
    ? { label: "numeric", cls: "bg-accent-soft text-accent" }
    : { label: "category", cls: "bg-surface text-foreground-muted" };
}

function ColumnStep({
  table,
  columnIds,
  onToggle,
}: {
  table: JoinCandidate;
  columnIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-accent bg-accent-soft text-xs text-accent">
        <Icon name="check" className="w-3.5 h-3.5 shrink-0" />
        <span>
          Joining on <b>{table.joinColumnName}</b> &mdash; matched{" "}
          {table.matchedTips} of {table.totalTips} tips
        </span>
      </div>
      {table.overlays.map((o) => {
        const sel = columnIds.has(o.columnId);
        const tag = kindTag(o.columnKind);
        return (
          <button
            key={o.columnId}
            type="button"
            onClick={() => onToggle(o.columnId)}
            className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg border ${
              sel ? "border-accent ring-1 ring-accent" : "border-border hover:bg-surface"
            }`}
          >
            <span
              className={`w-4 h-4 rounded grid place-items-center shrink-0 border ${
                sel ? "bg-accent border-accent" : "border-border"
              }`}
            >
              {sel && <Icon name="check" className="w-3 h-3 text-white" />}
            </span>
            <span className="text-sm font-medium text-foreground">{o.columnName}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tag.cls}`}>
              {tag.label}
            </span>
            <span className="ml-auto text-[11px] text-foreground-muted">
              {o.geoms.map((g) => GEOM_META[g].label).join(" · ")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function GeomStep({
  overlays,
  picks,
  onToggle,
}: {
  overlays: OverlaySuggestion[];
  picks: Set<string>;
  onToggle: (columnId: string, geom: OverlayGeom) => void;
}) {
  if (overlays.length === 0) {
    return (
      <p className="text-sm text-foreground-muted px-1 py-6 text-center">
        Go back and choose at least one column to overlay.
      </p>
    );
  }
  return (
    <div className="space-y-3.5">
      {overlays.map((o) => {
        // Prevent-at-add-time (Grant 2026-06-15): default is one overlay per
        // column (the recommended geom is pre-checked); picking a 2nd geom for the
        // SAME column draws the same data twice and crowds the figure (the MIC
        // heat+bars report), so warn - but never hard-block (no soft-lock).
        const selCount = o.geoms.filter((g) =>
          picks.has(selKey(o.columnId, g)),
        ).length;
        return (
        <div key={o.columnId}>
          <div className="text-xs font-semibold text-foreground mb-1.5">
            {o.columnName}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {o.geoms.map((g) => {
              const sel = picks.has(selKey(o.columnId, g));
              const meta = GEOM_META[g];
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => onToggle(o.columnId, g)}
                  className={`text-left p-2.5 rounded-lg border ${
                    sel
                      ? "border-accent ring-1 ring-accent bg-accent-soft"
                      : "border-border hover:bg-surface"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-4 h-4 rounded grid place-items-center shrink-0 border ${
                        sel ? "bg-accent border-accent" : "border-border"
                      }`}
                    >
                      {sel && <Icon name="check" className="w-3 h-3 text-white" />}
                    </span>
                    <span className="text-xs font-semibold text-foreground">
                      {meta.label}
                    </span>
                  </span>
                  <span className="block text-[11px] text-foreground-muted mt-1">
                    {meta.desc}
                  </span>
                </button>
              );
            })}
          </div>
          {selCount > 1 && (
            <p className="mt-1.5 text-[11px] text-amber-600">
              {o.columnName} will be added as {selCount} overlays. One geom is
              usually enough; multiple draw the same data on top of each other and
              crowd the figure.
            </p>
          )}
        </div>
        );
      })}
    </div>
  );
}

function DoneStep({ count, tableName }: { count: number; tableName: string }) {
  return (
    <div className="px-1 py-5 text-center">
      <span className="inline-grid place-items-center w-10 h-10 rounded-full bg-accent-soft text-accent mb-3">
        <Icon name="check" className="w-5 h-5" />
      </span>
      <p className="text-sm text-foreground">
        Added <b>{count}</b> {count === 1 ? "overlay" : "overlays"} from{" "}
        <b>{tableName}</b> to the tree.
      </p>
      <p className="text-xs text-foreground-muted mt-1">
        Want to put another table on this tree?
      </p>
    </div>
  );
}

function Btn({
  children,
  onClick,
  variant = "ghost",
  disabled,
  icon,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "ghost" | "primary" | "outline";
  disabled?: boolean;
  icon?: IconName;
}) {
  const base =
    "inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-accent text-white hover:brightness-95"
      : variant === "outline"
        ? "border border-border text-foreground hover:bg-surface"
        : "text-foreground-muted hover:text-foreground";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {icon && <Icon name={icon} className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}

function Footer({
  step,
  canNextFromTable,
  columnCount,
  selectionCount,
  adding,
  onCancel,
  onBack,
  onTableNext,
  onColumnsNext,
  onAdd,
  onAddAnother,
  onDone,
}: {
  step: Step;
  canNextFromTable: boolean;
  columnCount: number;
  selectionCount: number;
  adding: boolean;
  onCancel: () => void;
  onBack: () => void;
  onTableNext: () => void;
  onColumnsNext: () => void;
  onAdd: () => void;
  onAddAnother: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-surface-raised">
      {step === "table" && (
        <>
          <Btn onClick={onCancel}>Cancel</Btn>
          <div className="flex-1" />
          <Btn variant="primary" onClick={onTableNext} disabled={!canNextFromTable}>
            Next: columns
          </Btn>
        </>
      )}
      {step === "columns" && (
        <>
          <Btn onClick={onBack} icon="chevronLeft">
            Back
          </Btn>
          <div className="flex-1" />
          <span className="text-[11px] text-foreground-muted">
            {columnCount} column{columnCount === 1 ? "" : "s"} selected
          </span>
          <Btn variant="primary" onClick={onColumnsNext} disabled={columnCount === 0}>
            Next: overlays
          </Btn>
        </>
      )}
      {step === "geoms" && (
        <>
          <Btn onClick={onBack} icon="chevronLeft">
            Back
          </Btn>
          <div className="flex-1" />
          <Btn
            variant="primary"
            onClick={onAdd}
            disabled={selectionCount === 0 || adding}
            icon="plus"
          >
            {adding
              ? "Adding…"
              : `Add ${selectionCount} overlay${selectionCount === 1 ? "" : "s"}`}
          </Btn>
        </>
      )}
      {step === "done" && (
        <>
          <Btn onClick={onDone}>Done</Btn>
          <div className="flex-1" />
          <Btn variant="outline" onClick={onAddAnother} icon="plus">
            Add another table
          </Btn>
        </>
      )}
    </div>
  );
}
