# Calm Aesthetic Kit — app-wide visual polish checklist

The reusable vocabulary for unifying every surface on the warm "calm" (sand)
light surface and the dark room. Approved by Grant 2026-06-14 on the Purchase
popups ("7/10 to 10/10"). Apply this checklist when polishing any page.

Throwaway exploration pages (delete after rollout): `/dev/popup-chrome`,
`/dev/scrollbars`, `/dev/scroll-recede`, `/dev/popup-titles`.

## The five elements

### 1. ScrollArea (custom overlay scrollbar)
`frontend/src/components/ui/ScrollArea.tsx`. Replaces native scroll on
substantial content scroll regions.
- Pill thumb, fixed 6px width (10px on grab), length tracks content (44px min).
- Dim at rest (14%) → brighter while scrolling (30%, settles after ~700ms) →
  hover+grab share one dark tone (42%); grab changes only SIZE (back-eased snap).
- Wrap: outer `className` takes layout (`flex-1 min-h-0` / `h-full` / fixed
  height + rounding), `viewportClassName` takes padding. Forward
  `viewportProps` (role/tabIndex/aria/onKeyDown/data-testid) + `viewportRef`
  when the caller owns the scroll element (focus, keyboard nav).
- DO apply to: popup/modal bodies, document panels, data tables, long lists.
- DON'T apply to: tiny dropdowns, menus, comboboxes, autosuggest popovers.
- Supersedes the old `.ros-thin-scroll` hover-reveal (flaky in Chrome).

### 2. Card shadow — `.ros-popup-card-shadow`
Light: soft black drop (`0 20px 50px -10px rgba(0,0,0,0.25)`). Dark: SAME
geometry recolored to bluish-white (`rgba(120,150,210,0.3)`) + a faint light
ring, because a black shadow is invisible on the dark room. Apply to any
popup/modal/panel CARD that should lift off the backdrop. Built into
CalmPopupShell automatically; add the class to other card surfaces.

### 3. Title accent — CalmPopupShell `titleAccent`
A colored marker block behind a title (snug height, longer than the text, title
font unchanged). `titleAccent`: `amber | violet | sky | emerald | rose`. Light =
crisp pastel behind dark text; dark = OPAQUE saturated fill of the SAME hue
(deeper shade) behind light text. NEVER low-alpha translucent in dark (the room
bleeds through = mud). One uniform hue per object type.
- SCHEME LOCKED (Grant 2026-06-14): **domain family** — related objects share a
  hue; utility/system dialogs stay PLAIN (no accent). The 5-hue map:
  - **amber** procurement: Purchase, Supply, Funding, Approvals
  - **sky** writing: Note, Notebook, Wiki, Lab notes
  - **emerald** experiments: Experiment, Method, Result, Protocol
  - **rose** molecular: Sequence, Molecule, Chemistry
  - **violet** work+data: Project, Task, Data Hub, Analysis, History, Calendar
  - **plain** (no accent): settings, wizards, confirms, import/export, sharing,
    feedback, billing, and other system/utility dialogs.
- Assigned: NewPurchaseModal=amber, PurchaseHistoryPopup=violet (history=work+data).
- RECOLOR DEPTH LOCKED (Grant 2026-06-14, option 3): the family hue reaches the
  title marker AND every affordance (focus rings, selected chips/tabs, edit
  borders, status text, hovers) — but PRIMARY ACTION BUTTONS stay their semantic
  color (green = save/confirm, red = destructive). So per popup: recolor its old
  accent hue → family hue everywhere EXCEPT primary/destructive action buttons.
- Classes `.ros-title-accent` + `.ros-accent-<hue>` (globals.css) for non-shell
  titles (page headers) too.

### 4. Raised button — `.ros-btn-neutral`
Neutral/grey buttons on the calm/warm surface must read as real raised buttons,
never flat grey patches. Single source of truth: the `.ros-btn-neutral` class
(globals.css). Add it + your own sizing/typography (px/py/text/font); the class
owns the raised fill + hairline + soft two-layer shadow + hover/active states,
including the dark recolor (bluish-white shadow) and the inverted dark hover
(lighten, not darken). The CalmPopupShell footer Done/Close button uses it.
`.ros-btn-destructive` is the red sibling (same raised surface, red text +
red-tinted hover, dark-correct) for destructive actions. (Memory:
feedback_grey_buttons_need_shadow.)

### 5. Seam depth — `.ros-seam` + `.ros-seam-divider`
`.ros-seam` (globals.css): a raised-card depth (lighter than the popup drop)
for stacked section cards, so they separate with depth instead of a flat
`shadow-sm`. `.ros-seam-divider`: a soft horizontal divider that fades at the
ends, for rail group separators. Both recolor for dark (bluish-white). Apply
`.ros-seam` to section cards (replace `shadow-sm`); use `.ros-seam-divider` as a
1px element between rail groups.

## DARK MODE IS HALF THE WORK (learned 2026-06-14)
Every surface must be checked in BOTH modes. The recurring dark-mode traps:
- **Black shadows are invisible on the dark room.** Any depth (card shadow, seam,
  glow, drop shadow, button lift) needs a dark recolor to a soft bluish-white
  (`rgba(190,205,235,a)` for edges/rings, `rgba(120,150,210,a)` for the big soft
  drop). Never leave a `rgba(0,0,0,...)` or `rgba(15,23,42,...)` shadow as the
  dark value.
- **Hardcoded light colors** leak into dark: `bg-stone-50`/`bg-white`/`bg-amber-50`
  need a `dark:` variant; `text-*-700` needs `dark:text-*-300`; `prose-gray` needs
  `dark:prose-invert`. Grep each file for raw color utilities without a `dark:`.
- Tailwind `dark:` is wired to `[data-theme="dark"]` (globals.css @custom-variant),
  so `dark:` utilities work on the calm surface.
- **Hover/press direction inverts in dark.** Light mode darkens on hover
  (`hover:bg-surface-sunken`); in dark, sunken is *darker* than the raised
  control, so that goes the wrong way. Dark should LIGHTEN: keep the base
  (`dark:hover:bg-surface-raised`) + `dark:hover:brightness-125`, and
  `dark:active:brightness-150` for press (light side: `active:brightness-95`).

## Per-page checklist
For each page/surface, ask:
- [ ] Substantial scroll region? → ScrollArea
- [ ] Card/modal/panel that should lift off the backdrop? → `.ros-popup-card-shadow`
- [ ] Object detail popup/modal with a title? → `titleAccent` (its hue)
- [ ] Flat grey-on-calm buttons? → raised-button shadow
- [ ] Stacked section cards / rail groups? → `.ros-seam` (when ready)
- [ ] Check BOTH light and dark.

## Dev pages vs production
Throwaway/dev pages (`/dev/*`, review scaffolding) can be loose — don't spend
effort polishing their own chrome (toggle buttons, section rows, etc.). The bar
applies to PRODUCTION surfaces only, where there are NO shortcuts: both modes,
every shadow recolored, every hover/press direction correct, every hardcoded
color given a `dark:` variant.

## Process
- Sweep in batches by area; Grant verifies each batch on his `:3000` (the
  orchestrator can't drive Chrome here).
- Coordinate before editing a file another lane owns (Settings is handed to this
  lane; check with other lanes for shared files).
- Build in worktrees / commit atomically on the shared dirty main.
