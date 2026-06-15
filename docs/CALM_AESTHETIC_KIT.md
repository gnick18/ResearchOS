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
- Assigned: NewPurchaseModal=amber, PurchaseHistoryPopup=violet.
- Mockup picks for the rest: note=sky, experiment=emerald, sequence=rose
  (confirm new types with Grant; one hue per meaning).
- Classes `.ros-title-accent` + `.ros-accent-<hue>` (globals.css) for non-shell
  titles (page headers) too.

### 4. Raised button shadow
Neutral/grey buttons on the calm/warm surface must read as real raised buttons,
never flat grey patches: `bg-surface-raised` + `border border-border` + a soft
two-layer shadow that lifts on hover. Reference: CalmPopupShell footer
Done/Close button. (Memory: feedback_grey_buttons_need_shadow.)

### 5. Seam depth — `.ros-seam` (TODO: extract)
Soft depth between stacked section cards and rail group separators, recolored
for dark like the card shadow. Geometry-flexible (vertical column edge OR
horizontal divider). Settings lane is waiting on this. Until extracted, the
history-panel masked-gradient approach (`.ros-history-panel` + topglow/botglow)
is the column-edge reference.

## Per-page checklist
For each page/surface, ask:
- [ ] Substantial scroll region? → ScrollArea
- [ ] Card/modal/panel that should lift off the backdrop? → `.ros-popup-card-shadow`
- [ ] Object detail popup/modal with a title? → `titleAccent` (its hue)
- [ ] Flat grey-on-calm buttons? → raised-button shadow
- [ ] Stacked section cards / rail groups? → `.ros-seam` (when ready)
- [ ] Check BOTH light and dark.

## Process
- Sweep in batches by area; Grant verifies each batch on his `:3000` (the
  orchestrator can't drive Chrome here).
- Coordinate before editing a file another lane owns (Settings is handed to this
  lane; check with other lanes for shared files).
- Build in worktrees / commit atomically on the shared dirty main.
