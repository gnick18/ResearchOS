"use client";

// ColumnManager (DataHub-largetables lane, Increment 2).
//
// The wide-column manager, three tiers driven by the dataset's column count
// (mockup surface 2, spec section 5). It owns the SELECTED-columns set and hands
// it up to the dataset view, which projects only those columns into the preview.
//
//  - Tier A (<= ~30 cols): inline chip picker.
//  - Tier B (dozens to a few hundred): searchable column panel with a filter box,
//    per-column type + null rate, and select all / none.
//  - Tier C (hundreds-plus / thousands): NO grid by default. A schema browser
//    (name / type / %null / sample) plus SELECT COLUMNS BY RULE (a name pattern
//    with a live match count). Hand-picking thousands is infeasible, so the
//    pattern is the primary tool.
//
// House style: <Icon> only, no emojis / em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import type { DatasetColumn } from "@/lib/datahub/bigtable";
import {
  columnTier,
  compilePattern,
  matchColumns,
  nullRateLabel,
  type ColumnTier,
} from "@/lib/datahub/bigtable/column-tiers";

/** How many schema rows to render at once in Tier B / C (the list is windowed by
 *  a simple slice, since the user narrows with the filter / pattern first). */
const MAX_SCHEMA_ROWS = 60;

export default function ColumnManager({
  columns,
  rowCount,
  selected,
  onChange,
}: {
  columns: DatasetColumn[];
  rowCount: number;
  /** Currently selected column names (empty means "all", handled by the view). */
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const tier: ColumnTier = columnTier(columns.length);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  if (tier === "a") {
    return (
      <TierAChips
        columns={columns}
        selectedSet={selectedSet}
        onChange={onChange}
      />
    );
  }
  if (tier === "b") {
    return (
      <TierBPanel
        columns={columns}
        rowCount={rowCount}
        selectedSet={selectedSet}
        onChange={onChange}
      />
    );
  }
  return (
    <TierCSchema
      columns={columns}
      rowCount={rowCount}
      selected={selected}
      onChange={onChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Tier A: inline chip picker
// ---------------------------------------------------------------------------

function TierAChips({
  columns,
  selectedSet,
  onChange,
}: {
  columns: DatasetColumn[];
  selectedSet: Set<string>;
  onChange: (next: string[]) => void;
}) {
  const toggle = (name: string) => {
    const next = new Set(selectedSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(Array.from(next));
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="bigtable-tier-a">
      <span className="mr-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
        Columns
      </span>
      {columns.map((c) => {
        const on = selectedSet.has(c.name);
        return (
          <button
            key={c.name}
            type="button"
            onClick={() => toggle(c.name)}
            aria-pressed={on}
            className={`rounded-full border px-2.5 py-0.5 text-meta transition-colors ${
              on
                ? "border-brand-action bg-brand-action text-white"
                : "border-border text-foreground hover:bg-surface-sunken"
            }`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier B: searchable column panel
// ---------------------------------------------------------------------------

function TierBPanel({
  columns,
  rowCount,
  selectedSet,
  onChange,
}: {
  columns: DatasetColumn[];
  rowCount: number;
  selectedSet: Set<string>;
  onChange: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matched = q
      ? columns.filter((c) => c.name.toLowerCase().includes(q))
      : columns;
    return matched.slice(0, MAX_SCHEMA_ROWS);
  }, [columns, filter]);

  const toggle = (name: string) => {
    const next = new Set(selectedSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(Array.from(next));
  };

  return (
    <div data-testid="bigtable-tier-b">
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted">
            <Icon name="search" className="h-3.5 w-3.5" />
          </span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${columns.length} columns by name...`}
            className="w-full rounded-md border border-border bg-surface-raised py-1.5 pl-8 pr-2.5 text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            data-testid="bigtable-tier-b-filter"
          />
        </div>
        <button
          type="button"
          onClick={() => onChange(columns.map((c) => c.name))}
          className="ros-btn-neutral px-2.5 py-1.5 text-meta font-medium text-foreground"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          className="ros-btn-neutral px-2.5 py-1.5 text-meta font-medium text-foreground"
        >
          None
        </button>
      </div>
      <div className="max-h-52 overflow-auto rounded-md border border-border-soft">
        {visible.map((c) => (
          <label
            key={c.name}
            className="flex cursor-pointer items-center gap-2 border-b border-border-soft px-3 py-1 text-meta last:border-b-0 hover:bg-surface-sunken"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(c.name)}
              onChange={() => toggle(c.name)}
            />
            <span className="truncate text-foreground">{c.name}</span>
            <span className="ml-auto font-mono text-[10px] text-foreground-muted">
              {c.type}
            </span>
            <span className="w-16 text-right text-[10px] text-foreground-muted">
              {nullRateLabel(c, rowCount)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier C: schema browser + select by rule
// ---------------------------------------------------------------------------

function TierCSchema({
  columns,
  rowCount,
  selected,
  onChange,
}: {
  columns: DatasetColumn[];
  rowCount: number;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [pattern, setPattern] = useState("^");
  const re = useMemo(() => compilePattern(pattern), [pattern]);
  const invalid = pattern.trim() !== "" && re === null;
  const matched = useMemo(() => matchColumns(columns, re), [columns, re]);
  const shown = matched.slice(0, MAX_SCHEMA_ROWS);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (name: string) => {
    const next = new Set(selectedSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(Array.from(next));
  };

  return (
    <div data-testid="bigtable-tier-c">
      <div className="rounded-md border border-border-soft bg-surface-raised px-3 py-2 text-meta text-foreground-muted">
        {columns.length.toLocaleString()} columns is too many to list or chip. No
        grid is shown until you choose columns. Browse the schema, or select
        columns by a name rule.
      </div>

      <div className="my-2.5 flex flex-wrap items-center gap-2">
        <span className="text-meta font-semibold text-foreground-muted">
          Keep columns matching
        </span>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="^expr_"
          className="w-44 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-meta text-foreground focus:border-sky-400 focus:outline-none"
          data-testid="bigtable-tier-c-pattern"
        />
        <span className="text-meta text-foreground-muted" data-testid="bigtable-tier-c-match">
          {invalid ? (
            <span className="text-red-600 dark:text-red-400">invalid pattern</span>
          ) : (
            <>
              matches{" "}
              <b className="text-brand-action">
                {matched.length.toLocaleString()}
              </b>{" "}
              of {columns.length.toLocaleString()} columns
            </>
          )}
        </span>
        <button
          type="button"
          disabled={matched.length === 0}
          onClick={() => onChange(matched.map((c) => c.name))}
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-2.5 py-1.5 text-meta font-semibold disabled:opacity-50"
          data-testid="bigtable-tier-c-apply"
        >
          Preview these columns
        </button>
      </div>

      <div className="max-h-52 overflow-auto rounded-md border border-border-soft">
        {shown.length === 0 ? (
          <div className="px-3 py-3 text-meta text-foreground-muted">
            No columns match. Type a name pattern above, for example{" "}
            <span className="font-mono">^expr_</span>.
          </div>
        ) : (
          shown.map((c) => (
            <label
              key={c.name}
              className="flex cursor-pointer items-center gap-2 border-b border-border-soft px-3 py-1 text-meta last:border-b-0 hover:bg-surface-sunken"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(c.name)}
                onChange={() => toggle(c.name)}
              />
              <span className="truncate text-foreground">{c.name}</span>
              <span className="ml-auto font-mono text-[10px] text-foreground-muted">
                {c.type}
              </span>
              <span className="w-16 text-right text-[10px] text-foreground-muted">
                {nullRateLabel(c, rowCount)}
              </span>
              <span className="hidden w-28 truncate text-right text-[10px] text-foreground-muted sm:inline">
                {c.sample.length > 0 ? String(c.sample[0]) : ""}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
