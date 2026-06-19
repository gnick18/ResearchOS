# ResearchOS design system (for Claude Design)

This folder is the curated ResearchOS design system, shaped for a Claude Design
sync. It is NOT the app. The app has ~1000 components; this folder is the small,
intentional set of tokens and reusable primitives that define the look, rendered
as standalone preview cards so they land cleanly in the Claude Design "Design
systems" pane.

## How it syncs

The Claude Design pane builds its card index from each preview HTML file whose
FIRST LINE is a marker comment:

```
<!-- @dsCard group="Buttons" name="Buttons" subtitle="..." width="920" height="460" -->
```

Two ways to push it:

- Run the skill yourself: `cd frontend/design-system` then `claude` then
  `/design-sync`. It reads this folder and uploads with your approval.
- Or Claude drives the `DesignSync` tool directly (create project, finalize plan,
  write files). The first call asks you to grant design-system access to your
  claude.ai login.

Either way the upload is incremental, one card at a time, never a wholesale
replace.

## Layout

```
design-system/
  tokens.css            single source of truth: colors, type scale, radii,
                        elevation. Extracted verbatim from frontend/src/app/globals.css.
                        Every card links this file.
  components/<slug>/index.html   one preview card each, @dsCard-marked.
```

## Tokens (authoritative, from globals.css)

- Brand: brand-sky `#1aa0e6` (identity blue, large marks only, fails AA for small
  text), brand-action `#1283c9` (the accessible UI accent for text/links/buttons),
  brand-ink `#111827` (wordmark, headings), brand-purple `#5b47d6`.
- Surfaces (light): surface `#f8fafc`, surface-raised `#ffffff`, surface-overlay
  `#ffffff`, surface-sunken `#f1f5f9`. Dark theme repaints the same tokens.
- Type (Geist): meta 12, body 14, title 16, heading 20, display 30. Use the
  semantic token, never an arbitrary px.
- Elevation (the LOCKED raised-shadow aesthetic): ros-popover-shadow (floating),
  ros-popup-card-shadow (modals and cards), ros-btn-raise (buttons). A colored and
  a neutral button share ros-btn-raise so they read as one elevation.

## Card groups

Foundations and brand: Colors, Type, Foundations (elevation, radius), Brand
(wordmark, BeakerBot mascot).

Components: Buttons, Inputs and forms, Cards and surfaces, Overlays (dialogs,
popovers, tooltips), Feedback (badges, toasts, empty states), Navigation, Icon
set, and the onboarding visual language (BeakerBot speech bubble, MarketingBackdrop,
the data-flow explainer, the walkthrough beats).

## Rules baked in

- The mascot IS BeakerBot. Always pastel. No alternatives.
- One glyph per meaning. New glyphs need sign-off.
- No emojis in production UI. Every icon is a custom inline SVG.
- No em-dashes, no emojis, no mid-sentence colons in copy.
