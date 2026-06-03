# Typography scale

This is the canonical font-size scale for ResearchOS. It is a small set of
semantic tokens (named by role, not by pixel size) defined as Tailwind v4
font-size utilities in `frontend/src/app/globals.css` (the `@theme` block).

The one rule: use a semantic token, never an arbitrary `text-[Npx]`.

A site-wide audit found 16 distinct font sizes across 295 files, the worst of it
roughly 620 arbitrary `text-[8-15px]` one-offs. The fix is to collapse type onto
five named tiers so a glance at a class tells you the role, and so any raw
`text-[Npx]` reads as a smell to be cleaned up.

## The five tokens

| Token           | Size            | Line height    | Role                                                                 |
| --------------- | --------------- | -------------- | -------------------------------------------------------------------- |
| `text-meta`     | 0.75rem (12px)  | 1rem (16px)    | Secondary text, captions, readouts, badges, grey chrome, fine print  |
| `text-body`     | 0.875rem (14px) | 1.25rem (20px) | Default body text, lists, form controls, menus, dialog body          |
| `text-title`    | 1rem (16px)     | 1.5rem (24px)  | Section, card, and panel titles, dialog headers                      |
| `text-heading`  | 1.25rem (20px)  | 1.75rem (28px) | Page headings                                                        |
| `text-display`  | 1.875rem (30px) | 2.25rem (36px) | Hero and top-level display headings                                  |

Each token equals an existing built-in Tailwind size, so adopting a token in
place of the matching built-in is pixel-identical:

- `text-meta` equals `text-xs`
- `text-body` equals `text-sm`
- `text-title` equals `text-base`
- `text-heading` equals `text-xl`
- `text-display` equals `text-3xl`

The built-in `text-xs` / `text-sm` / `text-base` / `text-lg` / `text-xl` /
`text-3xl` utilities are untouched and still work. The tokens are additive
aliases layered on top: same generated CSS, semantic name.

## Mapping guidance (not a hard rename)

When migrating an area, read each `text-*` for its role and pick the token that
matches, rather than blindly find-replacing. As a starting heuristic:

- `text-xs` regions (captions, badges, readouts) usually map to `text-meta`.
- `text-sm` body text usually maps to `text-body`.
- `text-base` section or panel titles usually map to `text-title`.
- A page-level heading maps to `text-heading`, a hero to `text-display`.
- Arbitrary `text-[Npx]` snaps to the nearest token by role: 8 to 12px to
  `text-meta`, 13 to 14px to `text-body`, 15 to 16px to `text-title`, and so on.
  When a one-off sits between tiers, choose by role and accept the small size
  shift, or raise the case for a new tier rather than reintroducing arbitrary px.

This is guidance, not a mechanical rename: a `text-sm` used as a small heading
might become `text-title`, and a `text-base` used as long-form body might become
`text-body`. The role decides.

### Out of scope for the token scale

- SVG `fontSize` numbers (for example the 10 / 11 sequence-character labels in
  the sequence map) are canvas rendering geometry, not document typography. Leave
  them as numbers.
- Monospace sequence and code rendering bases that set their own size for layout
  reasons stay as they are.
- `prose` markdown styling in `globals.css` uses `em`-relative sizes by design
  and is independent of this scale.

## Rollout

This is the canonical scale being rolled out site-wide in phases.

- Phase 1 (this change): define the five tokens, write this doc, and adopt the
  tokens in the sequence editor as the worked reference (it was just normalized
  to one size per role, so the swap is a clean 1:1: `text-base` to `text-title`,
  `text-sm` to `text-body`, `text-xs` to `text-meta`). The rest of the app keeps
  using raw `text-*` until its phase.
- Later phases: migrate other areas to the tokens area by area, and retire the
  arbitrary `text-[Npx]` one-offs surfaced by the audit.

New code in any area should reach for a semantic token now, even in areas not yet
migrated, so the migration only ever shrinks.
