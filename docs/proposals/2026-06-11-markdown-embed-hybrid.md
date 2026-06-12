# Markdown + ResearchOS embed hybrid

Status: design proposal, 2026-06-11. Author: Dr. Grant Nickles (orchestrator session). Locked decisions from Grant this session: URL-fragment raw format, render in editor AND preview, live-with-pin freshness.

## The problem

The `/` reference picker inserts `[name](/deeplink)`. In Preview that becomes a small ObjectChip pill, in Edit it shows the raw link. Either way a reference is just a hyperlink. There is no rich, integrated visual of the thing being referenced. Grant wants a markdown + ResearchOS hybrid, where the raw file stays a portable, usable markdown link, but our renderer understands certain links are special embeds and draws the real object inline (a sequence map, a structure, a live table, a plot, a purchase-order card).

The model to copy is Notion / Obsidian live preview. The note reads like a rich document while you edit it, but the file on disk is still plain, portable markdown.

## The contract (portability first)

Every reference is, and stays, a standard markdown link:

```
[pGEX-3X (U13852)](/sequences?seq=2#ros=map&region=1-500)
```

- Outside ResearchOS (Obsidian, GitHub, a plain viewer, `cat`) this is a normal clickable link to the path. The reader sees the name and can follow the link. Nothing breaks.
- Inside ResearchOS the renderer reads the `#ros=...` URL fragment and draws the rich embed. Plain markdown tools ignore the fragment entirely (it is just a link anchor), so the file degrades gracefully.

This is why the URL-fragment form wins over a fenced `researchos` block (not clickable elsewhere) or a custom `:::directive` (shows as raw text elsewhere). The link is always a real link.

### Fragment grammar

`#ros=<view>` plus optional `&key=value` pairs. All values URL-encoded.

| Key | Meaning | Example |
| --- | --- | --- |
| `ros` | render mode / view. Absent or `chip` means the inline pill (today's behavior) | `ros=map` |
| `region` | sequence base range to focus | `region=1-500` |
| `rows` / `cols` | table-preview size | `rows=8` |
| `w` / `h` | plot / map size hint | `w=480` |
| `analysis` / `plot` | sub-object id inside a Data Hub doc | `analysis=a3` |
| `pin` | freeze to a point in time (see Pinning) | `pin=2026-06-11T19:00:00Z` |

Backward compatible: an existing `[name](/path)` with no `#ros` renders as a chip exactly as today. Nothing in existing notes changes.

### Inline chip vs block embed

- **Inline mention**: the link appears mid-sentence, or `ros` is absent / `ros=chip`. Renders the small pill with a richer hover-card preview. Use when you are writing prose that name-drops an object.
- **Block embed**: the link is alone in its paragraph (its own line) and has a non-chip `ros` view. Renders a full card. Use when the object IS the content at that point in the note.

The alone-in-paragraph rule is what Notion and Obsidian use, and it falls out naturally from the markdown AST (a paragraph whose only child is the link).

## One renderer, two hosts

A single `<ObjectEmbed type id view opts />` React component, lazy-loading a per-type renderer module. It is the only place per-type rendering lives, and it is consumed by both hosts so the editor and the preview never drift:

1. **Preview** (`RenderedMarkdown`, react-markdown). The existing custom `a:` component already intercepts object deep links. Extend it: alone-in-paragraph + a view fragment renders `<ObjectEmbed>` (block), everything else renders `<ObjectChip>` (inline, enhanced hover card).
2. **Editor** (CodeMirror 6, `InlineMarkdownEditor`). A `ViewPlugin` scans the doc and decorates object-embed links: alone-on-line links become an atomic block widget rendering the same `<ObjectEmbed>`, inline ones become an inline chip widget. Live-preview behavior: when the selection enters an embed's line, reveal the raw link for editing, when it leaves, show the widget again.

Both hosts render the identical component, so an embed looks the same while you write and after.

## Per-type embed catalog

Existing `ObjectRefType`: sequence, collection, method, note, file, project, molecule, datahub, task, experiment. This proposal adds `purchase` and `inventory`, and treats Data Hub `analysis` (result) and `plot` (graph) as sub-views of a datahub doc via the `analysis=` / `plot=` fragment keys.

For every type: the inline chip, the default block view, other available views, and what the live source is.

### sequence  `/sequences?seq=ID`
- Chip: dna icon + name, hover shows type, length, topology.
- Block default `map`: compact linear or plasmid map (reuse the sequences `LinearMap`), header line with name, length, circular/linear, feature count. `region` focuses a range.
- Views: `map`, `features` (feature table), `seq` (sequence text snippet, region-limited).
- Live: reads the `.gb` from the connected folder.

### molecule (compound)  `/chemistry?molecule=ID`
- Chip: small RDKit structure thumbnail + name (already in ObjectChip).
- Block default `structure`: larger RDKit 2D depiction + name + formula + MW + Lipinski badge.
- Views: `structure`, `card` (structure + identity table), `props` (druglikeness panel).
- Live: reads the `.mol`, RDKit renders client-side.

### Data Hub table  `/datahub?doc=ID#ros=table`
- Chip: table icon + doc name.
- Block default `table`: preview of the data grid (first `rows` x `cols`), title, full dimensions, Open-in-Data-Hub affordance.
- Views: `table`, `summary` (per-column stats).
- Live: reads the Data Hub doc.

### Data Hub result (analysis)  `/datahub?doc=ID&analysis=AID#ros=result`
- Chip: result icon + analysis name (for example "t-test, A vs B").
- Block default `result`: the computed statistics card (test name, n, statistic, df, p, effect size, CI), rendered from the AnalysisSpec. This is the "results" type Grant named.
- Live: reads (or recomputes from) the analysis in the Data Hub engine.

### Data Hub plot (graph)  `/datahub?doc=ID&plot=PID#ros=plot`
- Chip: chart icon + plot title.
- Block default `plot`: the actual rendered chart from the PlotSpec, live from current data. `w` / `h` size it.
- Live: the Data Hub plotting renderer.

### method  `/methods/ID`
- Chip: book icon + method name.
- Block default `card`: method card, name + type badge + a short step / summary preview, Open-method affordance. Structured methods (PCR, LC) show their key params compactly.
- Views: `card`, `steps`.
- Live: reads the method markdown / structured record.

### purchase order  `/purchases?item=ID`  (new type `purchase`)
- Chip: receipt icon + item name.
- Block default `order`: PO card, item, vendor, catalog number, quantity, unit cost, total, a status badge (requested / approved / ordered / received), order date.
- Live: reads the purchase record.

### inventory reagent  `/supplies?item=ID`  (new type `inventory`)
- Chip: box icon + reagent name.
- Block default `reagent`: reagent card, name, vendor / catalog, storage location, amount on hand, expiry, a low-stock badge.
- Live: reads the inventory item + stock.

### experiment  `/?openTask=ID#ros=results`
- Chip: experiment icon + name.
- Block default `results`: a card with the experiment's results-doc excerpt or key outputs, Open-experiment affordance. (An experiment lab-notes embed is the same card with `ros=notes`.)
- Live: reads the task's results.md / notes.md.

### note  `/notes/ID`
- Chip: pencil icon + title.
- Block default `card`: note card, title + first-lines excerpt + last-edited stamp. Self-reference and cycles are guarded (render as a chip beyond depth 1).
- Live: reads the note.

### file  `/files/ID`  (render the content, by type)
A file embed renders the file's CONTENT inline, with the renderer chosen by extension, so a note can inline any artifact from anywhere in the data folder (not only this note's own attachments). This is the powerful reframe of the original "file card": the card is just the fallback.
- Chip: file icon + filename (inline mention, unchanged).
- image (png / jpg / tif / gif): renders the actual image as a figure. The embed adds what native attachment cannot. Resize (`w=`), caption, reposition (it is a block line, so it moves with the text), and Annotate, which opens the existing photo-annotation editor and renders the `.annot.json` vector overlay on top of the image. Native attachment (the Images tab) still works for quick capture, the embed is the richer in-context option.
- pdf: an inline PDF viewer (a page, or first page plus expand), not a thumbnail card.
- csv / tsv / xlsx: rendered through the Data Hub table view, the same grid plus summary the datahub-table embed uses, so a raw data file reads like a real table.
- rmd / md / ipynb: rendered fully inline as a nested document inside the larger note (the markdown / notebook rendered, not shown as source).
- everything else: a compact open / download card (icon + name + size).
- Live: reads the file from the folder. Heavy renderers (PDF, notebook) lazy-load and render on scroll. The per-extension renderer is the same lazy `ObjectEmbed` dispatch as every other type.

### project / collection  `/projects/ID`  `/sequences?collection=ID`
- Chip: folder icon + project name.
- Block default `card`: project card, name + color + counts (experiments, notes, sequences, molecules).
- Live: reads the project + its members.

## Pinning (live with a freeze option)

Live is the default, the embed always reflects the current source on disk, so editing the data once updates every note that embeds it. No stale duplicated values.

A user can pin one embed to freeze it as a record of a moment (a figure as it was on the day of an experiment). Pinning adds `&pin=<isoTimestamp>` to the fragment. Rendering resolves the source's state as of that time:

- Types with history / version control (sequence, molecule, note, Data Hub doc) render the historical state through their existing history engine.
- Types without history store a snapshot blob in a per-note sidecar `<note>.ros-embeds.json`, keyed by a short id referenced from the fragment (`pin=s_a1b2`). The raw link stays a valid live link outside the tool, the pin only changes in-tool rendering.

Pinning is a later phase, the v1 ships live-only.

## Insertion UX

The `/` picker (`ReferencePicker`, pull) and the "Send to" picker (`SendReferencePicker`, push) currently insert `[name](/path)`. They gain a light Mention / Embed choice:

- Default by context: inserting on an empty line creates a block Embed with the type's default view, inserting mid-sentence creates an inline Mention.
- A small toggle lets the user override, and for embeds a one-tap view switch (map / features / seq for a sequence, table / summary for a table, and so on).
- The fragment is appended to the link the picker already builds, so the rest of the pipeline is unchanged.

## Robustness

- Name escaping: tighten `objectReferenceMarkdown` so a name with `)`, `]`, `\` (for example `pGEX-3X (U13852)`) always produces a valid link. The destination is URL-encoded, the link text escapes `]` and `\`.
- Broken / deleted refs: an embed whose target is gone renders a calm "this sequence was deleted or moved" card carrying the name, never a crash.
- Performance: heavy renderers (RDKit, sequence maps, plots) stay lazy and cached, embeds below the fold render on scroll, a note with many embeds stays responsive.
- Recursion: depth-guarded so a note that embeds itself or a cycle degrades to chips.

## Phasing (to minimize regressions)

1. **Phase 0, format + parser.** `#ros` fragment grammar, `parseObjectEmbed(href)`, extend the deep-link builders to carry a view, tighten name escaping. Fully backward compatible (no fragment means chip).
2. **Phase 1, preview block embeds + insertion.** `ObjectEmbed` component and the per-type renderers for the highest-value types (sequence, molecule, Data Hub table, Data Hub plot, Data Hub result). The picker gains Mention / Embed. Preview only.
3. **Phase 2, editor live preview.** CodeMirror block + inline widgets so embeds show while editing. This is the heaviest engineering piece and the most of the Notion feel.
4. **Phase 3, remaining types.** method, purchase, inventory, experiment-results, note, file, project.
5. **Phase 4, pin + view switching polish.** Snapshot / pin, the in-place view switcher, hover-card previews on chips.

Each phase lands behind the same additive pipeline, so an existing note with plain links is never affected until the user inserts an embed.

## Open questions for the mockup review

- Card density and chrome, how much border / header each embed card carries vs a borderless inline look.
- Default views per type (is a sequence's default `map` or `features`, is a molecule's default bare `structure` or the identity `card`).
- Whether inline chips should get a hover-card preview in Phase 1 or wait for Phase 4.
