# Universal list-row + sidebar right-click actions

Author: sequence editor master, 2026-06-05. Status: DESIGN DRAFT. Grant: one shared
right-click menu for any list row across the app (sequences, methods, notes, files,
collections, projects) with Rename, Duplicate, Delete, Move, Share, Export, and
"Copy reference / deep link." Copy-reference feeds the notes-link-to-objects flow.
Builds on the website-wide context-menu framework
(`docs/proposals/global-context-menu-framework.md`).

## Decisions (Grant, 2026-06-05)

- ROLLOUT: build the shared menu builder + the deep-link system, wire it to the
  SEQUENCES list (and the collection sidebar) first as the proof, then roll the
  SAME builder out to methods / notes / files / projects incrementally.
- COPY REFERENCE goes FULL note-chip end-to-end in v1: right-click an object ->
  copy a reference; pasting it into a note renders a LIVE clickable object chip
  (name + type icon, click navigates to the object).

## The shared menu builder

A pure builder `buildObjectMenuItems(item, handlers)` where `item = { type, id,
name }` and `handlers` is a partial of `{ onRename, onDuplicate, onDelete, onMove,
onShare, onExport, onCopyReference }`. It returns `EditMenuItem[]` showing ONLY the
actions whose handler is provided (so a surface that cannot Duplicate simply omits
that handler), with Copy reference always present, Rename near the top, Delete in a
destructive group. Each surface wires its own handlers and opens the menu via the
framework's `openMenu(event, items)`.

## Reference + deep-link model (sanitize-safe)

A reference is a SAME-ORIGIN in-app URL so it survives markdown sanitization and
works as a real link even outside notes:
- `objectDeepLink(type, id)` -> the route that opens the object, e.g.
  `/sequences?seq=<id>`, `/methods/<id>`, `/notes/<id>`, etc.
- `objectReferenceMarkdown(type, id, name)` -> `[name](<deepLink>)` (a normal
  markdown link to the app path).
- `parseObjectDeepLink(href)` -> `{ type, id } | null` (recognizes our internal
  routes), used by the chip renderer + the deep-link resolver.
COPY REFERENCE writes the markdown reference to the clipboard (and the plain URL as
a fallback line). Pasting into a note yields a link our renderer upgrades to a chip;
pasting elsewhere yields readable markdown / a working URL.

## Deep-link routing (open an object by reference)

Each surface resolves its URL param to open the object. v1 wires SEQUENCES: a
`?seq=<id>` param on `/sequences` selects that sequence on load (read it on mount /
when it changes, set the selection, clear the param or keep it). Collections can
take a `?collection=<id>` param. Other surfaces add their own param as they are
wired. The resolver is `objectDeepLink` in reverse, so a chip click does a
client-side `router.push(objectDeepLink(type, id))`.

## Note chip rendering

In `RenderedMarkdown` (ReactMarkdown), add a custom `a` component (or a small
rehype rule) that, when `parseObjectDeepLink(href)` matches, renders a CHIP instead
of a plain link: a small inline pill with the object-type icon + the link text
(the object name), styled calm, that on click does a client-side navigation to the
object (and does not full-page reload). Non-matching links render as today. The
sanitize schema already allows same-origin hrefs, so no scheme allow-listing is
needed. The live editor preview + the read-only render both go through
`RenderedMarkdown`, so the chip shows in both.

## v1 scope (this pass)

- The pure `buildObjectMenuItems` builder + the reference helpers
  (`objectDeepLink` / `objectReferenceMarkdown` / `parseObjectDeepLink`), all
  tested.
- COPY REFERENCE action + the note-chip renderer in `RenderedMarkdown` (the full
  end-to-end: copy on a sequence -> paste in a note -> live chip -> click opens the
  sequence).
- SEQUENCES list rows: the row right-click uses the shared builder. Wire the
  handlers from what already exists, and add the cheap ones:
  - Copy reference (always), Rename (inline quick, reuse the prompt pattern),
    Duplicate (if a duplicate path exists or is cheap to add), Delete (reuse the
    existing per-row delete), Export (reuse the existing export), Move to
    collection (reuse the collection-move if present), Share (reuse the
    cross-boundary share entry if present). Show only what is wired; do not block
    v1 on the harder ones (Move / Share can be follow-ups if no clean path).
  - KEEP the taxonomy Copy/Paste items already on the row (group them).
- COLLECTION SIDEBAR items: a right-click menu with Rename, Copy reference,
  Delete (and New-here if cheap).
- The `?seq=` deep-link resolver on `/sequences`.

## Out of scope (incremental follow-ups)

- Methods / notes / files / projects row menus (same builder, wired per surface).
- Their deep-link params + any chip icon per type (the chip renderer handles all
  types from the start; the params get added as each surface is wired).
- Drag-and-drop, multi-select bulk variants of these (the bulk bar already exists
  for delete/send).

## Reuse

- The context-menu framework (`useContextMenu` / `openMenu`).
- The existing per-row delete + export + the taxonomy row menu (sequences).
- `RenderedMarkdown` for the chip; `SequencePromptDialog` for inline rename.
- The router for chip navigation + the deep-link resolver.

## Tests

- `buildObjectMenuItems`: only provided handlers appear; copy-reference always;
  destructive grouping.
- The reference round-trip: `objectDeepLink` <-> `parseObjectDeepLink` for each
  type; `objectReferenceMarkdown` shape.
- The chip renderer: a matching href renders the chip (name + icon), a normal href
  renders a plain link, click triggers navigation (mocked router).
- The `?seq=` resolver selects the right sequence.

## Risks

- BREADTH: keep v1 to sequences + collections + the chip; do not fan out to all
  surfaces at once (Grant's rollout decision).
- SANITIZE: same-origin URL references avoid the scheme-stripping trap; verify the
  chip href survives `rehypeSanitize`.
- CHIP NAVIGATION must be client-side (router.push), not a hard reload, and must
  resolve a now-missing object gracefully (a dimmed "not found" chip).
- Per-surface action availability varies; the builder showing only wired handlers
  keeps each surface honest without dead items.

## Open questions for Grant

1. Rename UX: inline prompt dialog (reuse Select Range pattern) vs in-place editing
   of the row label. Recommend the prompt for v1 (cheap, consistent).
2. A missing-object chip (the referenced object was deleted): a calm dimmed
   "(removed)" chip vs hide it. Recommend the dimmed chip so the note keeps context.
