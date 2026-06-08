# Mobile app polish plan (toward website parity)

Status: plan, 2026-06-08. Grant wants the companion to feel as polished + modern as the website. NO new features, this is entirely about feel, motion, depth, and brand presence. The v2 design system, living BeakerBot, and branded shrink-out splash are already in; this is the layer on top.

## Philosophy

Premium feels like restraint plus responsiveness. Three north stars:
- Every touch responds instantly (press physics + haptics).
- Things enter and leave with intention (no hard pop-in or pop-out).
- BeakerBot and the rainbow show up at the right moments, sparingly, so they stay special.

The bar is "would this look at home in a top-tier consumer app," calm, confident, branded, never busy.

## Principles (apply everywhere)

- One motion language: a single spring config + a single easing curve reused across the app, not ad-hoc per screen.
- Haptics are punctuation, light on taps, success on completion, warning on failure. Never constant.
- Rainbow is a signature accent, not a theme. It marks brand + success moments, not every surface.
- Depth via soft layered shadow + surface tint, not hard 1px borders.
- Respect reduce-motion (already wired for BeakerBot) and dark mode depth throughout.

## Phase 1, tactile foundation (highest feel-per-effort, quick)

The single biggest jump in "feel" for the least code, because it touches every interaction.
- Press physics in the `Button` primitive (app-wide in one change): scale to ~0.96 + slight opacity on pressIn, spring back on release.
- Same press treatment on every tappable, rows, chips, keypad keys, list items, tab buttons.
- Haptics (expo-haptics, already a dep): light impact on primary taps + keypad, success notification on capture Sent / paired / note saved, warning on failures.
- Image fade-in: use expo-image `transition` so thumbnails fade in instead of snapping (outbox, today, reorder).

## Phase 2, motion language (entrance + reflow)

- Card + list entrance: Reanimated `entering` (FadeInDown, gently staggered) for cards, outbox items, today task rows, timers, devices.
- Layout animations for add/remove: items animate in/out and the list reflows smoothly (outbox send, timer cancel/finish, today refresh, unpair).
- Status transitions: Queued -> Sending -> Sent animates (color + a check), not an instant text swap.
- Screen transitions: tune the expo-router Stack to a smooth native feel; consider a shared-element transition for capture thumbnail -> preview and today row -> detail (if added later).
- Pull-to-refresh: a branded refresh affordance (a small BeakerBot or rainbow spinner) instead of the default.

## Phase 3, depth, material, type

- Elevation scale: refine the card shadow into a small layered system (ambient + key light), theme-aware, subtle.
- Tab bar modernization: animated active icon (scale + color + a soft pill/indicator) and an optional translucent blur background. DECISION below (blur adds expo-blur).
- Headers: consistent treatment across screens (large-title iOS feel or a custom branded header), generous top rhythm.
- Type: a tightened scale with consistent line-height + letter-spacing. DECISION below on a custom brand font (Geist/Inter via expo-font) for titles/wordmark to match the website vs a polished system font.
- Spacing: lock an 8pt rhythm + consistent corner radii + 44pt min hit targets.

## Phase 4, brand expressiveness (BeakerBot + rainbow at the right moments)

- BeakerBot reactions: port the web pose/expression system so he reacts, happy on a successful send, a thinking beat while syncing, a celebratory pose on first pair, a calm idle on empty states. The web BeakerBot already has these poses; bring a curated subset.
- Branded toasts: a small toast for Sent / Paired / Note saved with a BeakerBot glyph + a haptic, instead of silent state changes.
- Empty states upgraded from a flat icon to a small BeakerBot illustration (a relaxed pose) so empty never feels broken.
- Rainbow accents on key moments only: the paired badge, a successful-send flash, the Today header hairline. Intentional and sparse.

## Phase 5, screen-by-screen refinement

- Home: hero rhythm, the paired card as the confident centerpiece, clear primary action.
- Capture: shutter feedback (flash + haptic), cleaner preview + caption flow, smoother outbox.
- Timers: tactile keypad (press + haptic per key), nicer running cards, an animated countdown, optionally a circular progress ring.
- Today: card + section polish, overdue emphasis, a clear last-synced freshness affordance.
- Reorder + Pair: animated scan reticle, a satisfying match/scan-success moment.

## Cross-cutting finish

- Skeletons over spinners for any load.
- Dark-mode depth pass (true layered dark, not inverted light).
- Consistent iconography (the inline SVG set), no stray default glyphs.
- Accessibility, dynamic type, contrast, reduce-motion, VoiceOver labels.

## Sequencing + how we build it

Run as parallel background passes (Sonnet for the mechanical ones, Opus for the taste-critical brand moments), integrating + on-device-reviewing each:
1. Phase 1 (tactile) first, it transforms the feel immediately and is low-risk.
2. Phase 2 (motion) next, builds on the press language.
3. Phases 3-5 interleaved, with Phase 4 (BeakerBot reactions) on Opus.

## Decisions to lock (Grant)

1. Tab bar, translucent blur (adds expo-blur) vs a refined solid bar.
2. Brand font, load a custom font (Geist/Inter via expo-font) for titles + wordmark to match the website, vs a polished system-font scale (no font download).
3. BeakerBot expressiveness, reactive expressions on events (send/pair/sync) vs idle-only (keep him calm and just breathing).
4. Rainbow dosage, signature-sparse (key moments only) vs a bit more present across surfaces.

## Notes

House terms, no em-dashes, no emojis, no mid-sentence colons in any copy. Everything additive + visual, zero feature/logic change. expo-haptics is already a dep; expo-blur + expo-font(custom) are the only potential new deps, both gated on the decisions above.
