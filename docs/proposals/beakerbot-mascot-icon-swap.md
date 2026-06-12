# Spec for BeakerAI: swap the vial glyph for the real BeakerBot mascot on AI surfaces

From the icon de-collision audit (2026-06-12). This is a relay to the BeakerAI lane, the files below are yours, so this is a spec to apply at your discretion, not a cross-lane edit.

## Why
House rule, the mascot IS BeakerBot. Several AI surfaces currently use the generic `vial` glyph (`<Icon name="vial">`, plain glassware) as a stand-in for the assistant. Per the one-glyph-per-meaning audit, glassware should mean a reagent or molecule, not the assistant. Wherever the assistant is represented, render the real `<BeakerBot>` mascot component instead.

The rest of the audit already shipped on main, splitting the overloaded glyphs (tree, vial-for-calculators, merge, scale, book, chart, gauge). The AI mascot spots were left to you because they are in your files and one is an active A/B experiment.

## The asset
`@/components/BeakerBot` default export. Props, `pose` (required, see the union in BeakerBot.tsx), `direction`, `className` (Tailwind on the wrapping svg, default 40x40 text-sky-500), `animated` (default true), `noLiquid` (outline only, for monochrome contexts).

## Exact swaps (apply where it reads well, adjust poses to taste)
- `frontend/src/components/ai/BeakerBotConversation.tsx`
  - "BeakerBot has a question" (~:180), `name="vial"` to `<BeakerBot pose="idle" />`
  - "BeakerBot wants to transform a table" (~:323), `<BeakerBot pose="pointing" />`
  - "BeakerBot has a plan" (~:500), `<BeakerBot pose="pointing-up" />`
  - "BeakerBot drafted a note" (~:603), `<BeakerBot pose="idle" />`
- `frontend/src/components/datahub/NewAnalysisDialog.tsx`
  - "Help me choose" (~:449), `<BeakerBot pose="pointing" />`
- `frontend/src/components/ai/BeakerBotThinking.tsx`
  - The "beaker" thinking variant (~:74) currently renders the vial vessel. If you keep that variant, `<BeakerBot pose="thinking" animated />` is the natural fit. This is the one piece that is fully your call, it is one of three live A/B indicators (pulse, beaker, blink) and you may simply prefer pulse and drop the vial entirely. Keep the dev switcher intact.

## Sizing (the one real gotcha)
The mascot is a detailed 40x40 figure with a face, so at `h-4` (16px) it is illegible. Bump the inline header slots toward `h-6` or `h-7` and eyeball it. For a tiny monochrome slot where the rainbow liquid feels out of place, pass `noLiquid`.

## Verify visually
These are size and legibility sensitive, so check the rendered surfaces (the conversation headers, the analysis dialog, the thinking line) at real size, do not swap blind. Keep the thinking-indicator A/B switcher working.

## Scope
Additive, just replacing `<Icon name="vial">` with `<BeakerBot pose=...>` on these assistant surfaces. The `vial` glyph stays in the registry for its correct meaning (reagent or molecule, used by ObjectChip and ChemistryHub). No data-shape or behavior change.
