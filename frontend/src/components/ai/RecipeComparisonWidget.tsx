"use client";

// RecipeComparisonWidget: the inline card for the reproduce-from-PDF "light
// comparison" carve-out. Renders the deterministic paper-vs-user recipe diff
// (computed by compare_tree_recipes) as a fixed side-by-side. It shows the tool's
// EXACT values, so the model never reformats a bootstrap count or model string.
// FACTS ONLY: differing rows are highlighted, same rows muted, with no ranking,
// no "better/worse", no recommendation anywhere (the data carries none).
//
// House style: no em-dashes, no emojis, no mid-sentence colons; no inline svg.

import type { RecipeComparisonPayload } from "@/lib/ai/recipe-compare";

const COLS = "grid grid-cols-[1.1fr_1fr_1fr]";

export default function RecipeComparisonWidget({
  payload,
}: {
  payload: RecipeComparisonPayload;
}) {
  const { rows, paperLabel, mineLabel } = payload;
  return (
    <div
      data-testid="beakerbot-recipe-comparison"
      className="w-full overflow-hidden rounded-lg border border-border bg-surface-raised"
      style={{ fontFamily: "var(--font-ai)" }}
    >
      <div className={`${COLS} border-b border-border bg-surface-sunken`}>
        <div className="px-3 py-2 text-[11px] text-foreground-muted">Step</div>
        <div className="border-l border-border px-3 py-2 text-[12px] font-semibold text-foreground">
          {paperLabel}
        </div>
        <div className="border-l border-border px-3 py-2 text-[12px] font-semibold text-foreground">
          {mineLabel}
        </div>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.label}
          className={`${COLS} ${i < rows.length - 1 ? "border-b border-border" : ""}`}
        >
          <div className="px-3 py-2 text-[12px] text-foreground-muted">{r.label}</div>
          <div
            className={`border-l border-border px-3 py-2 text-[12px] ${r.same ? "text-foreground-muted" : "font-medium text-brand"}`}
          >
            {r.paper}
          </div>
          <div
            className={`border-l border-border px-3 py-2 text-[12px] ${r.same ? "text-foreground-muted" : "font-medium text-brand"}`}
          >
            {r.mine}
          </div>
        </div>
      ))}
    </div>
  );
}
