# Onboarding tutor — animation vision + handoff (for Claude Design Studio)

Date 2026-06-19. The onboarding tutor is merged and live, but the deep-demo beats
are still STATIC mock pages. Grant's call: they should be entire animations, alive
and choreographed, not labeled frames. This doc hands off exactly what exists (so
the wiring is not broken) and drafts the vision for what each beat should become.
House style throughout: no em-dashes, no emojis, no mid-sentence colons. Every icon
is a custom inline SVG (icon-guard), never an emoji or icon font.

---

## 1. What exists today (the handoff, do not break these)

The tutor is a deterministic reel of beats. A pure step machine owns Next/Back/Skip
(no soft-locks); the LLM only personalizes copy. Order:

```
welcome -> interest picker -> [deep demo per picked surface] -> AI demo -> montage -> memory propose -> recap -> done
```

Key files (all under `frontend/src/`):
- `lib/onboarding/reel-director.ts` - builds the ordered beats from role + picks (adaptive deep count, role gates, montage complement). 7 deep surfaces: datahub, phylo, methods, sequences, chemistry, inventory, people.
- `lib/onboarding/tutor-machine.ts` - the welcome/picking/playing/done reducer + durable full-state resume (`tour-progress.ts`, localStorage).
- `lib/onboarding/showcase-choreography.ts` - per-surface demo SCRIPT as typed steps: `arrive -> seed -> cursor_move -> click -> reveal -> narrate`, each with a duration, plus the narration line + the `data-tutor-target` id + a `seedKind`.
- `lib/onboarding/showcase-player.ts` - pure reducer that ticks the choreography on real elapsed time (rAF), exposing selectors `cursorTarget / isClicking / isRevealed / narration`. IMPORTANT: it pauses when `document.hidden` (the demo waits when the user looks away), so any animation must be driven off this same elapsed-time tick, not a CSS-only autoplay that runs in the background.
- `components/onboarding/tutor/`:
  - `TutorScreen.tsx` - the centered full-screen overlay every beat sits on, with the `MarketingBackdrop` pastel-aurora wash. The tutor plays IN PLACE over the app; it does NOT navigate to /demo (no-warp redesign).
  - `BeakerSays.tsx` - the shared "Beaker speaks" composition: full-size `<BeakerBot>` (h-40) + a speech bubble in his signature `var(--font-ai)` (Hanken Grotesk). EVERY beat uses this; keep Beaker full-size + font-ai everywhere.
  - `ShowcaseStage.tsx` - one deep demo: renders `BeakerSays` + a page card whose body is `SurfacePage`, with a `PresenterCursor` that eases to the action control. Currently the "animation" is just a fade-in reveal.
  - `SurfacePage.tsx` - the per-surface page body + `surfaceControl()` (the action verb the cursor targets). THIS is the static mock that needs to become an animated scene.
  - `PresenterCursor.tsx` - Beaker's hand (CSS clip-path arrow, eases to a target, click ring).
  - `AiDemoBeat.tsx` / `MontageBeat.tsx` / `MemoryProposeBeat.tsx` / `RecapBeat.tsx` - the other beat kinds.
  - `WelcomeTakeover.tsx` / `InterestPicker.tsx` - the intro beats (already the nicest: living BeakerBot hero, gloss CTA).

Hard constraints the redesign MUST keep:
- Driven by the elapsed-time player (pauses in a hidden tab), not free-running CSS.
- Ephemeral, sample data only, nothing written to the real folder.
- BeakerBot is the only mascot, always pastel goo, always full-size + alive in beats.
- Speech in `var(--font-ai)`; everything else Geist.
- Brand rainbow / pastel aurora backdrop; calm, not busy.
- Custom inline SVG for any glyph (icon-guard at zero), no emoji, no icon font.
- `prefers-reduced-motion` must collapse every scene to a clean cross-fade.

---

## 2. The gap

Each deep demo is a labeled card with a single fade-in reveal. It reads as a
diagram of the feature, not the feature coming alive. Grant: "these need to be
entire animations." The payoff (the figure, the annotation, the tree) should be
CHOREOGRAPHED so the user feels the product do the thing.

---

## 3. The vision

### Motion language (applies to every beat)
- Beaker is ALIVE the whole time: idle breathing, then reacts to events. He points as the cursor moves, leans in at the click, and does a small cheer/nod on the reveal. His pose changes are beats, not decoration.
- Entrance choreography: page elements cascade in with a short stagger (rows, cells, branches), never all-at-once.
- Caption crossfade: the narration line fades up as each step changes (tie to the player's `narration` selector), so the words track the action.
- The reveal is the payoff: a short, satisfying build with a soft brand-rainbow glow and a few sparse particles, then settle. One payoff per beat, earned.
- Easing is organic and slightly spring-y (the BeakerBot personality), never linear.
- Each deep demo runs ~6 to 10s, auto-advancing, pausable, resumable; reduced-motion collapses to a cross-fade.
- Timing is owned by the existing player steps (`arrive / seed / cursor_move / click / reveal / narrate`); the animation hangs off those step transitions + the elapsed fraction within a step, so pause/resume and hidden-tab freeze keep working.

### Per deep-demo scene (the "entire animation")
- Data Hub (Make figure): a messy results table streams in row by row. The cursor glides to "Make figure". On click, one column lifts out of the table, the cells fly up and morph into bars that grow with a spring, axes draw in, a title types. Caption crossfades "your data" -> "your figure". Sparkle on land.
- Sequences (Annotate): the base strip types in (colored A/T/G/C, monospace, typewriter cadence). Cursor selects a region; an annotation bar slides in beneath it labeled GFP; a primer Tm chip pops with a count-up to 61.4 C.
- Phylo (Export): branches DRAW in from root to tips (stroke-dash draw), tip labels fade in. Cursor to "Export"; a figure-size frame snaps around the tree with dimension labels, the tree scales to fit, a soft ready-pulse.
- Methods (View on phone): protocol steps stagger in. Cursor to "View on phone"; a phone rises from the bottom, the current step animates onto its screen, a progress dot advances 1 of 4.
- Chemistry (Render): SMILES types into the input. Cursor to "Render"; the molecule self-draws (bonds draw in sequence, atoms pop), a gentle settle.
- Inventory (Reorder): stock rows slide in; the low-stock row pulses. Cursor to "Reorder"; a "reordered" badge stamps in with a pop and the red calms to brand green.
- People (Lab overview): roster cards fan in; the cursor hovers a member and a detail expands with their current work + a tiny activity sparkline.

### Other beats
- AI demo: the chat reply STREAMS in token by token; a plan card assembles step by step (each step checks off in sequence); the final result morphs onto the page behind it.
- Montage: the un-picked surfaces flash by as a smooth filmstrip of ~1s mini-scenes, the "and so much more" answer.
- Memory propose: the fact writes into a little private memory vault with a lock click; on "Yes, remember" the card folds into a saved memory chip.
- Recap: the sample data dissolves/sweeps away to a clean slate, Beaker waves, the recap items stamp in, ends on the invitation (never a forced task).

---

## 4. How this plugs back in

- The design studio designs the SCENES (per-surface animated bodies + the shared motion primitives). Each scene is a presentational component that takes the player's current step + the elapsed fraction within it (and `revealed` / `clicking` / `narration`), so it stays in lockstep with `showcase-player.ts` and inherits pause/resume + hidden-tab freeze for free. Do not introduce a second autoplay clock.
- Drop-in points: `SurfacePage.tsx` (per-surface scenes), `BeakerSays.tsx` (bubble + Beaker reactions), `TutorScreen.tsx` / `MarketingBackdrop` (the calmer backdrop), `PresenterCursor.tsx` (cursor micro-interactions), `AiDemoBeat` / `MontageBeat` / `MemoryProposeBeat` / `RecapBeat`.
- Design-system sections this maps to (in "ResearchOS Design"): Onboarding > Walkthrough beats, Onboarding > BeakerBot speech bubble, Onboarding > Marketing backdrop, Foundations > Elevation/shadow + Radius/spacing for the cards, Feedback for the reveal accents.
- The choreography step list + durations in `showcase-choreography.ts` are the timeline; lengthen/segment steps there if a scene needs more phases (keep the `arrive/seed/move/click/reveal/narrate` spine so the cursor + narration selectors keep working).

---

## 5. Brief for the Claude Design Studio (paste-able)

> Design the animated onboarding-tutor beats for ResearchOS on the "ResearchOS Design" system. Each deep-demo beat is an entire choreographed scene where BeakerBot (full size, alive, speaking in var(--font-ai)) shows a feature come to life on a centered card over the pastel aurora backdrop. Build the per-surface scenes in section 3 (Data Hub table-to-figure morph, Sequences annotate, Phylo export, Methods phone, Chemistry render, Inventory reorder, People overview) plus the shared motion language: staggered entrances, caption crossfades, an earned reveal with a soft brand-rainbow glow + sparse particles, organic spring easing, Beaker reacting (point/lean/cheer). Calmer, cleaner backdrop. Mascot + button + dot micro-interactions. Honor: no emojis (custom inline SVG only), house style (no em-dashes / mid-sentence colons), full prefers-reduced-motion fallback to a cross-fade, and timing driven by discrete steps (arrive/seed/cursor-move/click/reveal/narrate) so it can pause/resume and freeze in a background tab. Deliver each scene as a presentational component that takes the current step + elapsed fraction.
```
