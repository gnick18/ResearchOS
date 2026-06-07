# BeakerSearch on Links (exhaustive interaction spec)

This is the build-ready expansion of the Links surface for BeakerSearch, the
companion to [`beakersearch-website-wide.md`](./beakersearch-website-wide.md).
That master doc fixes the architecture (one global `BeakerSearchProvider`,
per-page `useBeakerSearchSource` contributors), the four context signals
(SELECTED, HOVERED, ON SCREEN, OPEN / FOCUSED), the item kinds (COMMAND,
NAVIGATE, RESULT, CONTEXT CARD), and the global layer. This doc does NOT restate
any of that. It takes the Links page from concept depth to a full interaction
spec grounded in the real `src/app/links/page.tsx` and its data layer
(`labLinksApi` in `src/lib/local-api.ts`, the `LabLink` type in `lib/types.ts`,
the sharing helpers in `lib/sharing/unified.ts`), so a builder can wire the
source object without re-reading the page.

Voice rule for this doc and any copy it specifies, no em-dashes, no en-dashes,
no emojis, no mid-sentence colons.

Reference shapes are the ones the Sequences palette already ships
(`components/sequences/editor-commands.ts`), so the Links source produces the
same `PaletteItem` union the provider already ranks and renders. The relevant
real types are `EditorCommand` (with `id`, `label`, `group`, `iconName`,
optional `shortcut`, `run`, optional `enabled`, optional `detail`, optional
`keywords`), `SequenceNavItem` / `ArtifactNavItem` (the NAVIGATE and RESULT
analogues), and the `PaletteItem` discriminated union over `kind`. Links adds ONE
genuinely new NAVIGATE flavor, an "open the external url" action, called out in
section 4.2 as the navigate-to-external kind. Everything else reuses the existing
kinds.

---

## 1. Entity model, data sources, keys

Everything below is read by `LabLinksPage` today. BeakerSearch reads the SAME
React Query cache (no new fetch), so it is always in sync with the page and costs
nothing extra.

### 1.1 Entities

| Entity | What it is | Identity in memory |
| --- | --- | --- |
| Lab link | A `LabLink` record. The bookmark card. Carries `id` (number), `title`, `url`, `description \| null`, `category \| null`, `color \| null`, `preview_image_url \| null`, `sort_order`, `created_at`, optional `owner`, optional `shared_with: SharedUser[]`, and the VCP R3 attribution stamps `last_edited_by?` / `last_edited_at?`. | `id` (number). Ids are PER-USER namespaced (the loader notes "no cross-user de-dupe is needed"), so within the merged list `id` is not globally unique across owners. Pair it with `owner` for a safe key, `` `${link.owner ?? currentUser}:${link.id}` ``. |
| Category | A derived string bucket. Either one the user typed or one of the eight suggested constants (`CATEGORIES` = Protocol, Database, Tool, Reference, Supplier, Publication, Software, Other). A link with no `category` falls into the synthetic "Other" group at render time (`link.category \|\| "Other"`). Categories are NOT a stored entity, they are computed by `groupedLinks`. | the category string itself. |
| Card color | One of eight `CARD_COLORS` presets (Blue `#3b82f6`, Green, Purple, Orange, Pink, Teal, Red, Yellow). Stored on the link as `color`. Used as the card's background bar when there is no preview image. | the hex value. |
| Link preview | The result of `labLinksApi.getPreview(url)`, shaped `{ title, description, image, site_name }`. Today it is a STUB that echoes the url back as the title and returns null image / description (see 1.5). The page uses it to auto-fill the form. It is not a persisted entity, only the fetched `preview_image_url` is saved onto the link. | n/a (transient). |

### 1.2 Data source (the single hook, already on the page)

```ts
// All links visible to the viewer, merged own + shared-in across the lab.
useQuery({ queryKey: ["lab-links"], queryFn: labLinksApi.list })
//   => links: LabLink[]   (each decorated with `owner`)
```

`labLinksApi.list()` walks every discovered user's link store and, per record,
applies the unified privacy gate before it can enter the result:

- Own links always pass (`owner === viewer.username`).
- A cross-user record MUST clear `canRead(shareable, viewer)`
  (`lib/sharing/unified.ts`), which returns true only when the viewer is the
  owner, OR the viewer is a `lab_head` (implicit view-all), OR `shared_with`
  contains the viewer's username OR the `"*"` whole-lab sentinel.

So the list BeakerSearch reads is already privacy-filtered. It never needs a
second read, and it must never re-read the raw stores (that would bypass
`canRead`). The query key is the flat `["lab-links"]`, there is no per-user
parameter in the key (unlike Purchases' `["purchases-all", currentUser]`),
because the merge happens inside the query function.

Role / identity comes from `useFileSystem()` => `currentUser`, plus the per-user
display-name map `useLabUserProfileMap()` (`profileMap`) used to badge shared-in
cards. There is no lab-head-only query on this page (the page does not branch on
account type beyond the upstream tab-visibility gate), so the Links source is
simpler than Purchases, no approval queue, no live-session gate.

### 1.3 Ownership and composite keys (NAVIGATE must preserve these)

- A link is OWNED by the viewer when `!link.owner || link.owner === currentUser`
  (the page's `isOwnLink(link)` predicate). Legacy pre-R1b links have no `owner`
  and live in the viewer's own folder, so they count as owned.
- Because ids are per-user namespaced, a NAVIGATE / selection item MUST carry the
  composite `` `${link.owner ?? currentUser}:${link.id}` ``, NOT a bare numeric
  id, or a shared-in link could collide with an own link of the same id. This is
  the same shared-vs-own discipline the master doc calls out for tasks /
  purchases / projects, applied to links.
- Shared-in cards are VIEW-ONLY. The page hides edit / delete affordances
  entirely when `!isOwnLink(link)`, so BeakerSearch must gate every write the
  same way (section 3.1).

### 1.4 Query key for invalidation (what each command must invalidate)

There is exactly ONE cache to keep fresh.

| After | Invalidate |
| --- | --- |
| Create a link | `["lab-links"]`. Matches `handleCreate`'s `invalidateQueries({ queryKey: ["lab-links"] })`. |
| Edit a link (incl. color, category, visibility, preview image) | `["lab-links"]`. Matches `handleUpdate`. |
| Delete a link | `["lab-links"]`. Matches `handleDelete`. |
| Change a link's category from the palette | `["lab-links"]` (a category change is an `update`). |
| Refresh a link's preview and save it | `["lab-links"]` (re-fetch then `update` the `preview_image_url`). |

Open the url, copy the url, filter by category, and start the create / edit form
are pure UI / navigation moves and invalidate NOTHING (they change page state or
the browser, not the store). The provider does not own the cache, each Links
COMMAND `run` calls the same `labLinksApi` handler the page uses and invalidates
`["lab-links"]`, so the page re-renders identically whether the action came from
a card button or BeakerSearch.

### 1.5 The preview stub (a grounding correction)

`labLinksApi.getPreview` is currently a STUB. It returns
`{ title: url, description: null, image: null, site_name: null }` with no network
fetch. So today the "Fetch preview" button auto-fills the title with the raw url
and never produces a thumbnail. Any BeakerSearch "Refresh preview" command must
be written against this contract (it is cheap and never fails), and the
open-question in section 8 flags that a real OpenGraph fetcher would change the
echo copy. The spec below assumes the stub and degrades gracefully if a real
fetcher lands.

---

## 2. Context model (the four signals on Links)

The source's `context()` returns `{ focused?, selected?, hovered?, onScreen? }`
plus a render hint for the CONTEXT CARD.

### 2.1 OPEN / FOCUSED

There is no single "open document" on Links the way Sequences has an open
sequence. The page's identity IS the category-grouped board plus the saved-count
header (`{links.length} links saved`). So FOCUSED maps to the page-level frame,
surfaced as the card's first line. A secondary FOCUSED signal exists, the inline
create / edit FORM. When `isCreating === true` the page is focused on a NEW link
draft, and when `editingLink !== null` it is focused on editing THAT link (see
2.2). That form state is a stronger "what am I doing right now" signal than the
board and leads the card when active.

### 2.2 SELECTED

Links has no persistent row-selection like Purchases' `selectedTask`. The closest
real selection signal is `editingLink: LabLink | null`, set by `startEdit(link)`
(the card's pencil button). When `editingLink` is non-null, the user has
explicitly picked that link to act on, so BeakerSearch SELECTED = `editingLink`.
It is the strongest signal and drives the top Suggested actions (save, cancel,
change color, change visibility, the field-focused edits in section 3.2).

The create form (`isCreating`) is a SELECTED-adjacent state too, but it targets a
DRAFT, not an existing link, so it gets its own Suggested set (section 3.5)
rather than the per-link set.

### 2.3 HOVERED / UNDER THE MOUSE

The provider tracks the last hovered `[data-beaker-target]` element app-wide. For
Links, tag the link CARD (the `<a>` wrapping each bookmark) with
`data-beaker-target` and a payload key
`` `link:${link.owner ?? currentUser}:${link.id}` ``. The card is already a
discrete, hoverable element (it has a `group` hover treatment), so this is a
clean opt-in surface, on par with the Purchases order cards the master doc
recommends prototyping hover on first.

When the palette opens with no SELECTED (`editingLink` null, not creating) but a
hovered card, that hovered link is promoted to the same Suggested treatment as a
selection, with a softer card line ("Pointing at 'Addgene plasmid catalog'"). The
hovered link's per-link actions (open, copy url, edit, delete, change category,
refresh preview) become the top Suggested set, respecting the same owner gate.

One Links-specific subtlety, the card is an `<a href target="_blank">`. A plain
click already opens the url in a new tab, and the edit / delete buttons
`preventDefault` + `stopPropagation` to avoid navigating. BeakerSearch's hover
capture must NOT trigger navigation, it only records the hovered key on
pointerover, so tagging the `<a>` is safe.

### 2.4 ON SCREEN

ON SCREEN = the category grouping plus the saved count. The page has no explicit
category FILTER today (every category group renders stacked, `groupedLinks` is
the full board). So "on screen" is the set of category groups currently rendered
and their order, plus the total `links.length`. BeakerSearch ADDS a category
filter as a navigation move (section 4.3 and 6), so once the user filters, ON
SCREEN narrows to the chosen category and the card snapshot reflects it.

Concretely ON SCREEN carries:

- `categories`, the distinct category buckets present (`Object.keys(groupedLinks)`).
- `activeCategory`, the BeakerSearch-managed category filter (null = show all).
  This is NEW palette-owned state, the page does not persist a filter today.
- `visibleCount`, `links.length` when unfiltered, else the count in the active
  category bucket.

ON SCREEN scopes ENTITIES (empty-query jump list is the active category's links
first, or the whole board when unfiltered) and biases Suggested (an active
category filter unlocks "New link in {category}", section 3.4).

### 2.5 The CONTEXT CARD contents

The card is non-selectable. Its lines, computed from the signals above:

- Line 1 (FOCUSED + ON SCREEN), the scope and the snapshot:
  `Links, 24 saved, 6 categories`. Built from `links.length` and
  `Object.keys(groupedLinks).length`. When a category filter is active it reads
  `Links, Protocol, 5 links`.
- Line 2 (SELECTED, editing), when `editingLink` is set:
  `Editing "Addgene plasmid catalog" - Database - shared with the whole lab`.
  Title from `editingLink.title`, category from `editingLink.category` (or
  "Uncategorized"), visibility from `isWholeLabShared(editingLink.shared_with ?? [])`
  => "shared with the whole lab" vs "private to you".
- Line 2 alt (FOCUSED, creating), when `isCreating`:
  `New link draft` (plus `- unsaved` when `title` or `url` has content, mirroring
  the page's `hasLinkContent`).
- Line 2 alt (HOVERED, no selection): `Pointing at "Addgene plasmid catalog"`,
  with a sub-segment `- shared by Morgan` when the hovered card is shared-in
  (`!isOwnLink`), reusing the card's existing owner badge copy.
- Line 3 (preview state), only while editing / creating with a preview fetch in
  flight: `Fetching preview...` (from `isLoadingPreview`), so the card reflects
  the spinner the form shows.

While the query is typed, the card collapses to its one-line header (`Links, 24
saved`) exactly like the Sequences card slims.

---

## 3. SUGGESTED (contextual + permission-aware)

Suggested items are COMMANDs (kind `"command"`) with the target echoed in the
row's `detail`, identical to how Sequences echoes "from 612..632". Each lists its
exact real handler, its `enabled` predicate, and the row echo. Ranking follows
the master priority, SELECTED > HOVERED > ON SCREEN > FOCUSED.

### 3.1 The permission split (applies to every per-link write)

Links has a single, clean ownership gate, simpler than the Purchases role matrix.

- Own links (`isOwnLink(link)`, i.e. `!link.owner || link.owner === currentUser`)
  allow every action, open, copy, edit, delete, change category / color /
  visibility, refresh preview.
- Shared-in links (`!isOwnLink(link)`) are VIEW-ONLY. The page hides edit /
  delete entirely. BeakerSearch sets `enabled: isOwnLink(link)` on every write
  and either omits the row or greys it with detail
  "Only the owner ({display name}) can change this", using
  `profileMap[link.owner]?.displayName ?? link.owner` for the name.
- Read-only actions (Open the url, Copy the url, Jump to it) are allowed on
  shared-in links too, since the viewer can already see the card.

There is NO lab-head override for editing here. A lab head can READ every link
(`canRead` implicit view-all) but the page's `isOwnLink` gate still hides write
affordances on links a lab head does not own, so BeakerSearch matches that, view
all, edit only your own.

### 3.2 A link SELECTED (`editingLink`) or HOVERED

Let `link` be the selected (`editingLink`) or hovered link, `own = isOwnLink(link)`.

| Suggested label | When shown | Handler | `enabled` | Row echo (`detail`) |
| --- | --- | --- | --- | --- |
| `Open "{link.title}"` | always | open `link.url` in a new tab, `window.open(link.url, "_blank", "noopener,noreferrer")` (matches the card's `target="_blank" rel="noopener noreferrer"`) | always | `new URL(link.url).hostname` |
| `Copy URL` | always | `navigator.clipboard.writeText(link.url)` | always | the url (truncated) |
| `Edit "{link.title}"` | always (own) | `startEdit(link)` (sets `editingLink`, fills the form, scrolls to it) | `own` | category + visibility |
| `Change color` | own | open the edit form focused on the color row, OR direct `labLinksApi.update(link.id, { color })` via a follow-on color picker (the eight `CARD_COLORS`), then invalidate `["lab-links"]` | `own` | current color name |
| `Change category` | own | follow-on category picker (the eight `CATEGORIES` plus free text), then `labLinksApi.update(link.id, { category })`, invalidate `["lab-links"]` | `own` | current category or "Uncategorized" |
| `Make {private / whole-lab}` | own | `labLinksApi.update(link.id, { whole_lab: !currentlyWholeLab })`, invalidate `["lab-links"]`. Label flips on `isWholeLabShared(link.shared_with ?? [])` | `own` | "everyone in your lab" vs "only you" |
| `Refresh preview` | own | `labLinksApi.getPreview(link.url)` then `labLinksApi.update(link.id, { preview_image_url: preview.image })`, invalidate `["lab-links"]` | `own` | "re-fetches the thumbnail" (see 1.5, stub today) |
| `Delete "{link.title}"` | own | `setDeleteConfirmId(link.id)` (keeps the page's confirm modal, then `handleDelete`), OR call `labLinksApi.delete(link.id)` directly behind a palette confirm | `own` | "removes the bookmark" |
| `Save changes` | only when `editingLink === link` and the form is dirty | `handleUpdate()` | `own && title.trim() && url.trim()` | "saves your edits" |
| `Cancel editing` | only when `editingLink === link` | `cancelEdit()` (clears `editingLink`, resets the form) | always | "discards unsaved edits" |

For a SHARED-IN hovered / selected link, only `Open`, `Copy URL`, and
`Jump to it` survive, the write rows are omitted (cleaner than greying eight
rows). The card line already says "shared by {owner}", so the reason is visible.

When the selected link is being EDITED (`editingLink === link`), `Save changes`
and `Cancel editing` lead, because the form is the live focus, the other per-link
edits (color / category / visibility) act on the FORM state, not a second write.

### 3.3 A category filter active (palette-managed), no link selected

When `activeCategory` is set (the user filtered via section 4.3 / 6):

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `New link in {category}` | `startCreate()` then prefill the form's category field with `activeCategory` (set `category` state) | always |
| `Clear the {category} filter` | clear `activeCategory` (show all groups) | always |
| `Open all in {category}` | iterate the category's links and `window.open` each in a new tab, behind a confirm when the bucket has more than a few (see 8, the bulk-open question) | the bucket is non-empty |

### 3.4 ON SCREEN, board visible, nothing selected or hovered

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `Add a link` | `startCreate()` (opens the inline create form, resets fields, defaults visibility to "Just me") | always |
| `Filter by category` | follow-on picker over `Object.keys(groupedLinks)`, sets `activeCategory` | `links.length > 0` |
| `Jump to a category` | scrolls the board to the chosen category's group heading | `links.length > 0` |

`Add a link` is the universal first move, mirroring the header's "Add Link"
button (`startCreate`). It is always present even when the board is empty (the
empty-state copy on the page is literally "Add a link to save it here").

### 3.5 Creating a new link (`isCreating`)

When the inline create form is open, Suggested acts on the DRAFT:

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `Create link` | `handleCreate()` | `title.trim() && url.trim()` (matches the form's disabled state) |
| `Fetch preview` | `handleFetchPreview()` (fills title / description / image from `getPreview`) | `url.trim() && !isLoadingPreview` (matches the button) |
| `Set visibility to whole lab` / `Set visibility to just me` | `setWholeLab(!wholeLab)` | always |
| `Pick a color` | follow-on color picker, `setColor(value)` | always |
| `Cancel` | `setIsCreating(false)` + `resetForm()` | always |

These mirror the create form's controls one-for-one so the user can drive the
whole form from the keyboard without touching the inputs.

---

## 4. NAVIGATE (entities to jump to, plus the external-url kind)

NAVIGATE items are the `"sequence"`-kind analogue (a links-specific nav item
reusing `SequenceNavItem`'s `{ id, label, detail, iconName }` shape, or a small
`LinkNavItem` variant if the builder prefers an explicit type). Links contributes
TWO distinct navigate flavors, an INTERNAL jump (scroll / focus a card on the
board) and an EXTERNAL open (leave the app for `link.url`). The external one is
the new kind the master doc's NAVIGATE family did not yet have a real example of.

Empty query, the list is the active category's links first (or the whole board
when unfiltered), then widens to all links as the user types.

### 4.1 Internal jumps (stay on the page)

| NAVIGATE target | Effect | Carries |
| --- | --- | --- |
| A link by title | scroll the board to that card and apply a brief highlight pulse (no navigation, no form) | `` `${link.owner ?? currentUser}:${link.id}` `` |
| A category | set `activeCategory` (or scroll to the category group heading) | the category string |
| A color group | (optional) filter to links of a chosen `CARD_COLORS` value | the hex |

### 4.2 The external open (NAVIGATE-to-external, the new kind)

| NAVIGATE target | Effect | Carries |
| --- | --- | --- |
| Open "{link.title}" externally | `window.open(link.url, "_blank", "noopener,noreferrer")`, a NEW TAB, never replacing the app | `link.url` + the composite key |
| Open the raw url you typed | when the query parses as a url, offer "Open {hostname}" directly | the typed url |

This is the navigate-to-external item kind. Three Links-specific rules govern it,
because opening an arbitrary user-pasted url from a command palette is a small
trust surface:

1. ALWAYS a new tab with `rel="noopener noreferrer"` semantics, mirroring the
   card's `<a target="_blank" rel="noopener noreferrer">`. Use
   `window.open(url, "_blank", "noopener,noreferrer")` so the opened page cannot
   reach back into the app via `window.opener`.
2. NEVER auto-open. The external open only fires on an explicit Enter / click on
   that row, it is never the default highlighted item when the palette first
   opens (the CONTEXT CARD and `Add a link` lead). Typing does not pre-select an
   external open.
3. The row renders the destination plainly, `Open Addgene plasmid catalog` with
   detail `addgene.org (opens in a new tab)`, so the user sees where they are
   going before they go. Use `new URL(link.url).hostname` for the host. Guard the
   `new URL()` parse, a malformed stored url (the page assumes valid urls but
   does not enforce) should degrade to showing the raw string and an "opens
   externally" note rather than throwing.

The page itself does not gate or confirm external opens (a card click opens
immediately), so the palette MATCHES that, no confirm dialog for a single
external open. The only confirm is for BULK opens (section 3.3 "Open all in
{category}"), where opening many tabs at once is the surprising action. This is
called out as an open question in section 8.

### 4.3 Fuzzy fields

Fuzzy match runs over `title`, `url` (so typing a domain like "addgene" or
"ncbi" surfaces the link), `description`, and `category`, scored like
`scoreSequenceNav` over label + detail. Owner display name is a secondary match
field for shared-in links (typing a labmate's name surfaces the links they
shared). The nav row's detail reads
`Database - addgene.org - shared by Morgan` for a shared-in link, or
`Protocol - bio-protocol.org` for an own one.

---

## 5. RESULTS (no artifacts, so recent links is the substitute)

Links produce NO computed artifacts (there is no alignment / scan / export to
reopen, unlike Sequences or the Purchases CSV). So per the master doc's "links do
not produce artifacts, specify a substitute" instruction, the RESULTS zone is
repurposed as RECENT LINKS, the freshest reopenable signal on the page.

`results()` returns up to ~5 recently-touched links, ranked by recency:

- Sort by `last_edited_at` when present (the VCP R3 stamp), falling back to
  `created_at`, both ISO strings, newest first.
- Label `Addgene plasmid catalog`, detail `Database - opened just now` or
  `added 2 days ago` / `edited yesterday` (relative time from the chosen
  timestamp). Distinguish "added" (no `last_edited_at`) from "edited" (has one).
- Selecting a recent link runs the EXTERNAL open (4.2), it reopens the bookmark's
  destination, which is the natural "reopen" for a link. A secondary action (a
  modifier / the row's right-side affordance) can instead JUMP to the card on the
  board (4.1) for the user who wants to edit rather than visit.

Optionally track "recently OPENED" links in a small session-scoped list (the last
few links the user opened FROM BeakerSearch), surfaced above "recently added /
edited" as `Recently opened`. This is palette-owned ephemeral state, it does not
touch the store, and it gives the page a genuine "reopen what I just used"
result even though the store has no open-history field. The store-backed
"recently added / edited" is the durable substitute, the session "recently
opened" is the bonus.

---

## 6. COMMANDS (the full long tail, grouped)

These are the page's complete command set, the `commands()` half of the contract.
Groups print in a fixed order (mirroring `CommandGroup` on Sequences). Every row
lists its real handler and permission gate.

### Create
- `Add a link` -> `startCreate()` (opens the inline create form). Always.
- `Create link` -> `handleCreate()`. `enabled` when the create form is open and
  `title` + `url` are non-empty.
- `Fetch preview for the draft` -> `handleFetchPreview()`. `enabled` when creating
  / editing and `url` is non-empty and not already loading.

### Edit (a selected / hovered link, own only)
- `Edit link` -> `startEdit(link)`.
- `Save changes` -> `handleUpdate()`. `enabled` when editing and the form is valid.
- `Cancel editing` -> `cancelEdit()`.
- `Change color` -> `labLinksApi.update(id, { color })`, invalidate `["lab-links"]`.
- `Change category` -> `labLinksApi.update(id, { category })`, invalidate.
- `Refresh preview` -> `getPreview(url)` then `update(id, { preview_image_url })`,
  invalidate.
- All gated `isOwnLink(link)`.

### Visibility
- `Make link whole-lab` / `Make link private` -> `labLinksApi.update(id, { whole_lab })`,
  invalidate `["lab-links"]`. The toggle rewrites `shared_with` in lockstep (the
  `"*"` sentinel for whole-lab, `[]` for private), matching the create / update
  paths. `isOwnLink(link)` only.

### Delete
- `Delete link` -> `setDeleteConfirmId(id)` (keeps the page's confirm modal),
  then `handleDelete(id)` on confirm, invalidate `["lab-links"]`.
  `isOwnLink(link)` only. The page's delete confirm copy is "Delete Link? This
  action cannot be undone." and Escape closes it (`useEscapeToClose`), so the
  palette's confirm should read the same.

### Open / copy (any link, shared-in allowed)
- `Open link` -> `window.open(url, "_blank", "noopener,noreferrer")`. Always.
- `Copy link URL` -> `navigator.clipboard.writeText(url)`. Always.

### Filter / view (palette-managed)
- `Filter by category` -> set `activeCategory` (follow-on picker over the present
  categories). `enabled` when `links.length > 0`.
- `Clear category filter` -> clear `activeCategory`. `enabled` when a filter is set.
- `Jump to a category` -> scroll to the category group heading.
- `Open all in a category` -> bulk `window.open` (behind a confirm). `enabled`
  when the bucket is non-empty.

### Navigate out (global layer, listed for completeness)
- Cross-page jumps (Gantt / Calendar / Workbench / Purchases / Sequences /
  Methods / Search / Settings) and global object search come from the GLOBAL
  source, not the Links source. The Links source contributes only the page-local
  commands above.

---

## 7. `useBeakerSearchSource` implementation sketch

The page calls one hook. It reads the same `["lab-links"]` cache the page already
holds (so this hook lives inside `LabLinksPage` or a colocated
`useLinksBeakerSource()` that takes the page's already-fetched data + setters as
input, to avoid a second fetch). Types are illustrative, `PaletteCommand` here is
the page's local alias for the provider's `EditorCommand`-shaped command, and
`LinkNavItem` reuses `SequenceNavItem`'s field shape.

```ts
function useLinksBeakerSource(args: {
  // already-fetched page state + setters
  links: LabLink[];                    // from useQuery(["lab-links"])
  groupedLinks: Record<string, LabLink[]>;
  editingLink: LabLink | null;
  isCreating: boolean;
  isLoadingPreview: boolean;
  // form state (for the create / edit Suggested set)
  title: string;
  url: string;
  wholeLab: boolean;
  color: string;
  // palette-owned view state (NEW, the page has no filter today)
  activeCategory: string | null;
  setActiveCategory: (c: string | null) => void;
  // real page handlers
  startCreate: () => void;
  startEdit: (l: LabLink) => void;
  cancelEdit: () => void;
  handleCreate: () => Promise<void>;
  handleUpdate: () => Promise<void>;
  handleDelete: (id: number) => Promise<void>;
  handleFetchPreview: () => Promise<void>;
  setDeleteConfirmId: (id: number | null) => void;
  setCategory: (c: string) => void;
  setColor: (hex: string) => void;
  setWholeLab: (b: boolean) => void;
  // identity
  currentUser: string;
  profileMap: Record<string, { displayName?: string }>;
  hoveredKey: string | null;           // from the provider's [data-beaker-target]
}): BeakerSearchSource {
  const queryClient = useQueryClient();

  const isOwn = (l: LabLink) => !l.owner || l.owner === args.currentUser;
  const keyOf = (l: LabLink) => `${l.owner ?? args.currentUser}:${l.id}`;

  // read-only external open, the navigate-to-external kind (section 4.2)
  const openExternally = (l: LabLink) => {
    try {
      window.open(l.url, "_blank", "noopener,noreferrer");
    } catch {
      /* malformed url, the row already showed the raw string */
    }
  };

  // a write helper that wraps update + the single invalidation
  const patch = (id: number, p: LabLinkUpdate) =>
    labLinksApi
      .update(id, p)
      .then(() => queryClient.invalidateQueries({ queryKey: ["lab-links"] }));

  const refreshPreview = (l: LabLink) =>
    labLinksApi
      .getPreview(l.url)
      .then((pv) => patch(l.id, { preview_image_url: pv.image }));

  return {
    id: "links",

    context() {
      const sel = args.editingLink;
      const hovered =
        !sel && !args.isCreating && args.hoveredKey?.startsWith("link:")
          ? args.links.find((l) => `link:${keyOf(l)}` === args.hoveredKey)
          : undefined;
      return {
        focused: { kind: "page", label: "Links" },
        selected: sel ? { kind: "link", link: sel } : undefined,
        hovered: hovered ? { kind: "link", link: hovered } : undefined,
        onScreen: {
          categories: Object.keys(args.groupedLinks),
          activeCategory: args.activeCategory,
          visibleCount: args.activeCategory
            ? (args.groupedLinks[args.activeCategory]?.length ?? 0)
            : args.links.length,
        },
        cardHint: buildLinksCardLines(/* signals above + isCreating + isLoadingPreview */),
      };
    },

    suggested(ctx) {
      if (args.isCreating) return suggestForDraft(args);       // section 3.5
      const focus = ctx.selected ?? ctx.hovered;               // SELECTED beats HOVERED
      if (focus) return suggestForLink(focus.link, isOwn(focus.link)); // section 3.2
      if (args.activeCategory) return suggestForCategory(args.activeCategory); // 3.3
      return suggestBoard(args);                               // section 3.4
    },

    entities(ctx, query) {
      // on-screen first, then widen to the whole board when typing
      const base =
        !query && args.activeCategory
          ? (args.groupedLinks[args.activeCategory] ?? [])
          : args.links;
      return [
        ...base.map((l) => toLinkNavItem(l, { openExternally, isOwn })), // jump + open
        ...Object.keys(args.groupedLinks).map(toCategoryNavItem),        // jump to category
      ];
    },

    results() {
      // no artifacts, the substitute is recent links (section 5)
      return recentLinks(args.links).map((l) => toRecentLinkResult(l, openExternally));
    },

    commands() {
      return linksCommandSet(args, { patch, refreshPreview, openExternally, isOwn }); // section 6
    },
  };
}
```

Permission gating is centralized in `isOwn`, `suggestForLink` and the command
builders set `enabled: isOwn(link)` on every write and OMIT the write rows
entirely for shared-in links, so a shared-in link only ever offers open / copy /
jump. The external open is always a new tab with `noopener,noreferrer` and never
the default-highlighted row. Every write `run` invalidates the single
`["lab-links"]` key. The provider handles ranking, rendering, keyboard, and
merging with the global layer.

One wiring note, the page does NOT have `activeCategory` state today. Adding the
category filter means lifting a `useState<string | null>(null)` into
`LabLinksPage` (and optionally honoring it in the `groupedLinks` render so the
board itself filters, not just the palette). Until that lands, "Filter by
category" can fall back to "Jump to a category" (pure scroll, no new state).

---

## 8. Keyboard, states, edge cases, open questions

### Keyboard
Inherits the shared model, up / down skipping disabled (greyed shared-in write
rows, if shown rather than omitted) and non-selectable (the context card), Enter
runs / navigates / opens the highlighted item, Escape closes the palette (and,
when the delete confirm is open, the page's own `useEscapeToClose` closes that
first). The external open fires only on an explicit Enter / click, never as the
default highlight (section 4.2). No Links-specific shortcuts beyond what the rows
carry in `shortcut`, though `Add a link` is a natural candidate for a mnemonic.

### Empty vs typed
- Empty query, CONTEXT CARD (section 2.5), then SUGGESTED (3), then on-screen
  links as ENTITIES (4), then Recent links (5), then the grouped COMMANDS (6),
  then the slim global section.
- Typed query, card slims to one line, everything collapses into one fuzzy list
  over commands + link / category entities + recent-link results + global,
  grouped by kind. Typing a domain, a labmate name, a category, or words from the
  title / description surfaces matching links via the section 4.3 fuzzy fields.
  When the query itself parses as a url, offer the "Open the raw url you typed"
  external row (4.2) plus "Add a link" prefilled with that url.

### Empty states
- No links at all (`links.length === 0`), Suggested shows only `Add a link`,
  ENTITIES and Recent are empty, the card reads `Links, none saved yet`. Mirrors
  the page's "No links saved yet" / "Add a link to save it here" empty block.
- A category bucket empty after filtering, clear the filter via
  `Clear the {category} filter`, ENTITIES widens back to the whole board so the
  user can still jump.

### Edge cases
- Shared-in links, read-only. Open / copy / jump are allowed, every write is
  omitted (cleaner than greying), the card / nav detail carries "shared by
  {owner}" using `profileMap`. Built from the already-privacy-filtered
  `labLinksApi.list()` result, never a raw store read, so `canRead` is always
  honored and a private link of another member never appears.
- Malformed `url`, the page calls `new URL(link.url).hostname` unguarded in the
  card host line. The palette MUST guard every `new URL()` (hostname detail,
  external-open host) and degrade to the raw string, since the store does not
  enforce url validity.
- Uncategorized links, `link.category` is null, they render in the synthetic
  "Other" group (`link.category || "Other"`). The card / nav detail shows
  "Uncategorized" (not "Other") for clarity, while the category nav targets the
  real "Other" bucket.
- The preview stub (1.5), `getPreview` returns the url as the title and a null
  image today. "Refresh preview" will not change the thumbnail until a real
  OpenGraph fetcher lands, so its echo copy should be honest ("re-checks the link
  for a thumbnail") and it must tolerate a null image (no-op the
  `preview_image_url` write when `pv.image` is null).
- Legacy pre-R1b links (no `owner`), counted as owned (`isOwnLink` true), full
  write set, keyed under `currentUser` in the composite key.
- The create form is an INLINE card, not an overlay (the page comment notes this
  explicitly), so opening BeakerSearch while creating does not dismiss the form,
  the draft Suggested set (3.5) acts on the still-open form.

### Permissions summary
- Any viewer, sees own links plus shared-in links that cleared `canRead` (named,
  whole-lab `"*"`, or lab-head view-all). Open / copy / jump on all of them.
- Owner of a link, full edit / delete / visibility / preview on it.
- Lab head, reads everything (implicit `canRead` view-all) but still edits only
  links they own (the page's `isOwnLink` gate is not relaxed for lab heads), so
  BeakerSearch matches, view all, edit own.

### Links-specific open questions
1. The external-url navigate kind is new to the palette. Confirm the no-confirm
   rule for a SINGLE external open (matches the card, which opens on click) and
   the confirm-on-BULK rule for "Open all in {category}" (opening many tabs at
   once is the surprising action). Should a single open ever prompt for an
   untrusted / non-https url? The spec says no (parity with the card) but flags it.
2. The page has no category FILTER state today (`groupedLinks` always renders all
   buckets). Adding `activeCategory` to drive both the palette and the board is a
   small `useState` lift. Until it lands, "Filter by category" degrades to
   "Jump to a category" (pure scroll). Decide whether the palette filter should
   also visibly filter the board or only scope the palette.
3. "Refresh preview" depends on `getPreview`, currently a stub. Either ship a real
   OpenGraph fetcher (changes the echo + actually populates thumbnails) or keep
   the command honest about being a re-check that may find nothing. The whole
   "preview image" story is thin until that fetcher exists.
4. "Change color" and "Change category" want a follow-on picker step inside the
   palette (a sub-list of the eight `CARD_COLORS` / `CATEGORIES`). The provider
   does not yet have a two-step command model, either add one or have these
   commands open the inline edit form positioned on the right field
   (`startEdit(link)` then focus color / category), reusing the existing form
   rather than building palette pickers.
5. "Recently opened" (session-scoped open history) is palette-owned ephemeral
   state with no store backing. Confirm it is worth the extra state, or keep
   RESULTS to the store-backed "recently added / edited" substitute only.
