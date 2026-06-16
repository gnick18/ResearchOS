# Handoff — BeakerBot shared widget kit + per-type tinted tiles (2026-06-15, evening)

Grant asked to take the analysis-picker's restyle (2-col + a calm category-tinted icon tile, "Option B") and apply that **design language to ALL BeakerBot widgets**. Built as a shared kit, live-verified, Grant signed off. Memory `[[reference_beakerbot_widget_kit]]`.

## What shipped — branch `feat/beakerbot-widget-kit` (commit `1662842a8`, rebased onto current main as `a65b376ac`)

Clean fast-forward over main, NO nav-route changes (wiki-coverage gate safe). Touches only `frontend/src/components/ai/*` (6 files, 1 new). Whole-repo tsc 0; mention/record-set/slash/recipe suites 36/36; icon-guard clean.

**New `components/ai/widget-kit.tsx`** — one source of truth: `WidgetIconTile`, `WidgetRow`, `WidgetSection`, `WidgetOptionGrid`, `WidgetHeader` + `WidgetTint` / `tintForObjectType(type)` / `tintDotClass(tint)` / `widgetCardClass(inline)`. Rows lead with a small icon tile **tinted by DOMAIN FAMILY (not per-item)**: bio=purple (sequence/molecule/tree/phylo), data=teal (datahub/dataset/graph), protocol=blue (method/experiment/task/analysis), org=gray (project/note/file, theme-aware `surface-sunken`), commerce=amber (purchase/inventory). Tint lives ONLY in the 22-26px tile; row bg stays neutral so a mixed list stays calm. Reuses the existing `TYPE_ICON` glyphs (no new icons); Tailwind scale classes with `dark:` variants.

Rolled out where objects are actually listed:
- **AnalysisPickerWidget** — onto the kit: Option B = 2-col `@container` grid + section tiles (analyses=protocol/blue, graphs=data/teal) + 2-line clamped hints. Supersedes the interim uncommitted 2-col polish that was sitting dirty in main's working tree.
- **RecordSetWidget** — rail rows + compact chip-tabs lead with per-type tiles.
- **ComposerMentionPicker** — rows get per-type tiles; group headers get family dots.
- **ComposerSlashMenu** — section dots (commands neutral, macros purple).
- **MacroEditorSheet** — header badge → kit tile (macro tint).

**Deliberately left as-is** (no object-row list → tinting would be over-application, the exact "fruit salad" Grant wanted to avoid): BeakerBotPlanCard (status colors ARE the meaning + it's Chrome-verified), RecipeComparisonWidget (a comparison table), PdfFigurePicker (BeakerBot's own brand-tinted modal).

## Verify — DONE (Grant live pass on a throwaway worktree server)

Ran a `:3030` Turbopack dev server FROM the worktree (isolated from the shared `:3000`). Grant hard-reloaded and signed off ("looks good"). The Chrome-verify recipe (@-picker tiles, /-menu dots, Data Hub "Analyze" door 2-col picker) hits AI-free entry points. Gotchas that bit the verify, now recorded in the memory:
- Worktree has NO `.env.local` (gitignored) → all `NEXT_PUBLIC_*` default off → Data Hub/Phylo/BeakerBot dark + the OLD welcome shows. Fix: `cp frontend/.env.local` into the worktree, restart.
- Turbopack `next dev` rejects a `node_modules` symlink pointing outside the worktree root (tsc/vitest tolerate it) → real `pnpm install` in `worktree/frontend` (warm store ~12s).
- icon-guard substring-matches the literal `<svg` even inside a comment — don't write that string.

## Open / next
1. **Merge:** branch is Grant-verified + a clean ff over main; handed to MobileUI (merge-sequencing role) to ff-merge. Re-rebase if main moves first (10s).
2. **After merge:** add the AGENTS.md BeakerAI pointer (path-scoped, hot file — do it immediately post-merge), tear down the `:3030` server + the `widget-kit` worktree.
3. **Carry-over from the takeover handoff (unrelated to this branch):** SmartDataWizard needs the same inline-whitespace fix — Phylo's file, claim message sent, awaiting their ack before editing (Grant: "I do it, coordinate first"). Picker-in-chat branch `feat/picker-result-in-chat` still gated on step-4 verify. Onboarding tour-mount coupled browser pass still pending.
