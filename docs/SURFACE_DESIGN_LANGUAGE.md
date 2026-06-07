# Surface design language (light + dark)

The standard for how surfaces, buttons, popups, and loading states should look
so the app reads with depth and character in both light and dark mode. This is
the companion to `docs/TYPE_SCALE.md` (type) and `brand/README.md` (palette).
It exists because the first light-mode pass was a mechanical token swap that
left whole screens flat white-on-white with invisible controls. This doc is the
bar that the surface audit enforces.

House style for this doc and any copy it drives: no em-dashes, no emojis, no
mid-sentence colons.

## The core problem we are fixing

In light mode several surface tokens are the same or nearly the same color:

- `--surface` (page) `#ffffff`
- `--surface-raised` (cards, popups) `#ffffff`
- `--surface-sunken` (insets, wells) `#f8fafc`

So a card on the page, and a row inside the card, can all be white separated
only by a `#e5e7eb` hairline. Stack three of them and the screen collapses into
a flat white sheet with no depth, and any control that is "just a border plus
muted text" disappears. Dark mode has the mirror failure mode (every surface a
near-identical dark slate, white-dot textures left over from a light design,
brand text too dark to read on dark).

Tokens alone do not create depth. Depth comes from deliberate layering, shadow,
ambience, and giving controls real fills. That is what this doc requires.

## Principles

1. A surface must be distinguishable from whatever sits directly behind it.
   Never place `surface-raised` on `surface-raised`, or `surface-sunken` on
   `surface-sunken`, relying on a hairline alone. Separate layers with at least
   one of a shadow, a tint, or a clear (non-hairline) border.

2. Depth is built with shadow and hover motion, not just borders. Cards and
   tappable rows get `shadow-sm` at rest and lift on hover (`hover:shadow-md`
   plus `hover:-translate-y-0.5`). Big surfaces (the main card, popups) get
   `shadow-xl`/`shadow-2xl` and a `ring-1 ring-black/5`.

3. Full-screen gates and large empty backgrounds get ambience, not flat fill.
   A soft brand glow (sky to purple, low opacity, `blur-3xl`) plus a faint
   texture gives the surface life. The glow must adapt to dark mode (lower
   opacity) and any texture must use a mid neutral (slate), never pure white or
   pure black, so it is faintly visible on both light and dark.

4. Every interactive control has visible character at rest. A button is never
   only a hairline border plus muted text. It carries a fill or a tint, a
   readable label color, and a hover state that changes more than the cursor.
   - Primary action: solid brand fill (`btn-brand` / brand-action background,
     white text).
   - Secondary action: a brand-tinted fill (for example `bg-brand-action/[0.06]`)
     with a brand border and a brand label, lifting on hover.
   - Tertiary / quiet: at minimum `surface-sunken` fill plus a real border, or
     a clearly colored text link. Never invisible.

5. Color must pass WCAG AA. `brand-sky` (#1aa0e6) is decorative only, it fails
   AA on white for small text. Use `brand-action` (#1283c9, 4.5:1 on white) for
   any text, icon label, link, or small accent in light mode, and flip to the
   lighter `brand-sky` in dark mode (`text-brand-action dark:text-brand-sky`)
   where the deep blue would be too dark on the dark surface.

6. Loading and empty states get the same care as the loaded UI. A spinner alone
   on a flat panel is a lazy surface. Skeletons use a visible `surface-sunken`
   block with motion, empty states use a real illustration or BeakerBot plus a
   characterful primary action.

7. Both modes are first-class. Anything added for light must be checked in dark
   and vice versa. Decorative layers built for one mode (white dots, dark-only
   glows) are bugs in the other.

## Worked example: the account login gate

`frontend/src/components/UserLoginScreen.tsx` is the reference implementation
Grant signed off as the bar.

- Background: `bg-gradient-to-br from-surface-sunken via-surface to-surface-sunken`
  plus a brand glow `from-brand-sky/30 via-brand-purple/15 to-transparent`
  (`opacity-70 blur-3xl dark:opacity-40`) and a slate dot texture at
  `opacity-[0.05]` (was invisible white dots).
- Account rows: `bg-surface` tiles with `border border-border shadow-sm`,
  `hover:-translate-y-0.5 hover:shadow-md hover:border-brand-sky/50`. They read
  as raised tiles on the card instead of melting into it.
- Create New User (secondary action): `border border-dashed border-brand-action/45
  bg-brand-action/[0.06] text-brand-action dark:text-brand-sky font-medium
  shadow-sm`, hover deepens the tint and border and lifts. Keeps the add-new
  dashed affordance but is actually visible.
- Bottom chrome consolidated into one fixed cluster with a soft fade up from the
  page so nothing overlaps the centered card.

## Anti-patterns (what the audit flags)

- A `surface-raised` or `surface-sunken` element whose direct parent is the same
  token, separated only by a hairline border (no shadow, no tint).
- A button or link styled only as `border-border` + `text-foreground-muted` with
  no fill and no hover beyond a color tweak.
- A full-screen or large background that is a flat single surface color with no
  glow, texture, or gradient.
- `brand-sky` used for small text, labels, or links (AA failure on white).
- A decorative layer that only works in one mode (white-on-white dots in light,
  a glow that vanishes or blinds in dark, brand-action text unreadable on dark).
- A loading or empty state that is a bare spinner or a single line of muted text
  on a flat panel.

## Audit checklist (per surface)

1. Is this surface visually separated from its parent (shadow, tint, or real
   border, not just a hairline)?
2. Does every button and link have a visible fill or tint and a real hover
   state?
3. Do all text and icon colors pass AA in this mode?
4. Does any decorative layer (texture, glow, gradient) render in this mode?
5. Does the loading and empty state of this surface have character?

A finding is anything that fails one of these. Report the file, the element, the
failing class string, the mode it fails in, and the suggested fix using the
patterns above. Do not change code in the audit pass, just report.
