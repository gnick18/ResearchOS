"use client";

// ManualSwitchControl (DataHub-largetables lane, Increment 2).
//
// The manual "Switch to large-dataset mode" control offered on a normal editable
// table (transform-builder mockup surface 3, mockup change 1 refined, spec
// section 2). The heavy lane is not only an automatic safety net. A user may want
// it on a medium table for speed and the rule tooling, so it is offered
// everywhere with an honest one-time load warning: it takes a few seconds, do not
// refresh, and cell-by-cell editing is replaced by the rule builder. A
// sub-threshold table can switch back later (noted, the round trip is a Phase 2
// seam).
//
// House style: <Icon> only, no emojis / em-dashes / mid-sentence colons.

import { useState } from "react";
import { Icon } from "@/components/icons";

export default function ManualSwitchControl({
  rowCount,
  reversible,
  busy,
  onConfirm,
}: {
  rowCount: number;
  /** True when the table is under the threshold (it could switch back later). */
  reversible: boolean;
  /** True while the conversion runs (the engine is loading). */
  busy: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <div
      className="rounded-lg border border-border bg-surface-raised p-3"
      data-testid="bigtable-manual-switch"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-meta font-semibold text-foreground">
            Currently in editable mode, {rowCount.toLocaleString()} rows
          </h4>
          <p className="mt-0.5 text-meta text-foreground-muted">
            Switch to large-dataset mode to use the rule builder and faster
            queries on this table too.
          </p>
        </div>
        {!armed ? (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-meta font-semibold"
            data-testid="bigtable-manual-switch-open"
          >
            <Icon name="database" className="h-3.5 w-3.5" />
            Switch to large-dataset mode
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setArmed(false)}
              disabled={busy}
              className="ros-btn-neutral px-2.5 py-1.5 text-meta font-medium text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-md px-3 py-1.5 text-meta font-semibold disabled:opacity-60"
              data-testid="bigtable-manual-switch-confirm"
            >
              {busy ? "Loading the engine..." : "Convert now"}
            </button>
          </div>
        )}
      </div>
      {armed && !busy && (
        <p className="mt-2 rounded-md border border-amber-500/50 bg-amber-500/[0.08] px-3 py-2 text-meta text-foreground-muted">
          Loading the background engine takes a few seconds. Do not refresh while
          it loads. Cell-by-cell editing is replaced by the rule builder.{" "}
          {reversible
            ? "A table this size can switch back later."
            : "A table this large cannot return to cell editing."}
        </p>
      )}
    </div>
  );
}
