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
| `ref` | portable content identity for cross-library resolution (see Portable identity), the path id is only a hint | `ref=ik:LUKBXSAW...` |

Backward compatible: an existing `[name](/path)` with no `#ros` renders as a chip exactly as today. Nothing in existing notes changes.

### Inline chip vs block embed

- **Inline mention**: the link appears mid-sentence, or `ros` is absent / `ros=chip`. Renders the small pill with a richer hover-card preview. Use when you are writing prose that name-drops an object.
- **Block embed**: the link is alone in its paragraph (its own line) and has a non-chip `ros` view. Renders a full card. Use when the object IS the content at that point in the note.

The alone-in-paragraph rule is what Notion and Obsidian use, and it falls out naturally from the markdown AST (a paragraph whose only child is the link).

### Images are the special case, native image syntax

An image is not a link, it is content, and markdown already has a native form for it. So an image embed uses the standard markdown image syntax, not the `#ros` link form:

```
![Colony PCR, lanes 1 to 8, expected 1.2 kb band](Images/gel-pcr-screen.png#w=420)
```

- Outside ResearchOS this renders as a real image (better than a link, the picture actually shows). The alt text is the caption, the `#w=420` fragment is ignored.
- Inside ResearchOS we upgrade the rendered `<img>` to the rich image embed, the same way we upgrade `<a>` object links to chips and embeds. The fragment carries options (`w` resize, later a `pin`), the alt text is the caption.

This already half-exists. `RenderedMarkdown` intercepts the `img` node today and renders it through `AnnotatedImage`, which resolves the file and overlays the `.annot.json` annotations. The work is to add the embed controls (resize, caption, reposition, an Annotate button) and the matching CodeMirror widget. The bonus is that every image already in every note is already `![]()`, so they all gain the controls with no migration. Non-image files (pdf, csv, rmd) have no native markdown form, so those keep the `[name](/files/ID#ros=pdf)` link form.

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
- image (png / jpg / tif / gif): uses the NATIVE markdown image syntax `![caption](path#w=)`, not the `#ros` link form (see "Images are the special case" above), so the picture shows in any viewer. In-app it renders as a figure with what native attachment cannot give. Resize (`w=`), caption (the alt text), reposition (it is a block line, so it moves with the text), and Annotate, which opens the existing photo-annotation editor and renders the `.annot.json` vector overlay on top. Already half-built via `AnnotatedImage`.
- pdf: an inline PDF viewer (a page, or first page plus expand), not a thumbnail card.
- csv / tsv / xlsx: rendered through the Data Hub table view, the same grid plus summary the datahub-table embed uses, so a raw data file reads like a real table.
- rmd / md / ipynb: rendered fully inline as a nested document inside the larger note (the markdown / notebook rendered, not shown as source).
- everything else: a compact open / download card (icon + name + size).
- Live: reads the file from the folder. Heavy renderers (PDF, notebook) lazy-load and render on scroll. The per-extension renderer is the same lazy `ObjectEmbed` dispatch as every other type.

### project / collection  `/projects/ID`  `/sequences?collection=ID`
- Chip: folder icon + project name.
- Block default `card`: project card, name + color + counts (experiments, notes, sequences, molecules).
- Live: reads the project + its members.

## External and literature embeds

Not everything worth embedding lives in your library. A note often needs to cite a paper, point at a compound you have not saved, or reference a gene. These embed too, fetched and rendered, and they stay portable because the raw is still a link to a real external URL:

- DOI / PubMed: a citation card (title, authors, journal, year), the same data the literature companion already fetches for the chemistry papers panel. `[Smith et al. 2024](https://doi.org/10.x#ros=cite)`.
- PubChem CID / a SMILES not in your library: a structure card, rendered by the same RDKit path as a local molecule, with an "Add to my library" action.
- UniProt / NCBI gene or protein accession: a small entity card (name, organism, length).
- a plain URL: a link-preview card (title + favicon + description) as the generic fallback.

These citation embeds are also what feed the bibliography on export (see baking). The point is one consistent embed model whether the thing is in your folder or out on the web.

## Pinning (live with a freeze option)

Live is the default, the embed always reflects the current source on disk, so editing the data once updates every note that embeds it. No stale duplicated values.

A user can pin one embed to freeze it as a record of a moment (a figure as it was on the day of an experiment). Pinning adds `&pin=<isoTimestamp>` to the fragment. Rendering resolves the source's state as of that time:

- Types with history / version control (sequence, molecule, note, Data Hub doc) render the historical state through their existing history engine.
- Types without history store a snapshot blob in a per-note sidecar `<note>.ros-embeds.json`, keyed by a short id referenced from the fragment (`pin=s_a1b2`). The raw link stays a valid live link outside the tool, the pin only changes in-tool rendering.

Pinning is a later phase, the v1 ships live-only.

A pinned embed shows a quiet "source changed since you pinned this" badge when the live source has moved on, with view-current and re-pin actions, so a frozen record never silently rots.

## Captions and numbering

Every figure or table embed carries an optional caption, and the link text doubles as it. `[Welch t-test of endpoint OD, YPD vs glucose](/datahub?doc=2&analysis=a3#ros=result)` renders the card with that line as its caption, and the same text is what shows as a plain link outside the tool, so no new syntax is needed. For an image the caption is the native alt text. Captions are what bake into a published figure or table caption.

Embeds can auto-number in document order (Figure 1, Table 2), and an inline mention can reference the number ("see Figure 1"), recomputed as the note changes. This is what makes a note read like a paper draft. Numbering is OPT-IN per document, not global, an experiment has two linked docs (lab notes and results) and you may want the results figures numbered but not the lab notes.

## Export and publish baking

In the app an embed is live. The moment a note leaves the app, exported to PDF, published to `/transparency`, deposited to Zenodo, sent as a static copy, every embed must bake to a self-contained rendering so the artifact keeps its figures with no app and no data folder:

- maps, plots, and structures bake to SVG / PNG, tables and CSV views to real tables, results to a static stat block, images to embedded image data with annotations flattened in.
- the caption and figure number travel with the baked figure.
- the original live link is preserved as a small source line ("source: /sequences?seq=2") so a reader still inside ResearchOS can jump to the live object.

The note on disk stays live markdown, baking produces a separate output and never rewrites the source. This is essential because publishing and reproducibility are core to ResearchOS, a published note that lost its figures would defeat the point.

Baking targets where researchers actually publish, not just PDF:
- **Word (.docx)** and **LaTeX** with real figure and table environments, numbered captions, and cross-references that resolve ("see Figure 1"). This is the payoff of writing the note in ResearchOS, the draft and its figures come out as a journal-ready document.
- A **bibliography** assembled from the citation embeds (the DOI / PubMed cards), so the references section writes itself.
- Each baked figure carries a provenance stamp (object identity, pinned timestamp, "generated by ResearchOS") so a published figure is traceable back to its data, the reproducibility story end to end.
- Pagination keeps a figure with its caption (no orphaned captions across a page break).

## Backlinks (Referenced in)

Every object gets a "Referenced in" list, the notes, experiments, and methods that embed or mention it. This generalizes the existing `scanMoleculeBacklinks` into one scanner that understands every embed form (object links and native images). It answers "which of my notes use this construct", "where is this result cited", and it is the reverse of the embed graph, embeds point forward, backlinks walk back.

## Sharing a note that contains embeds

Embeds create dependencies, so sharing has to be dependency-aware:

- **Share-time warning.** When a note is shared, if it embeds objects the recipient will not be able to see, warn the sharer ("this note links to N items the recipient cannot access") before sending.
- **Share with dependencies, as one package.** Optionally bundle the note plus everything it embeds, sequences, molecules, tables, files, into a single package sent over the existing cross-boundary relay (end to end, ephemeral, never stored). The recipient accepts the package and chooses, per item or in bulk, which collection on their own machine each thing lands in.
- **Permission-aware rendering.** In a shared note an embed of an object the viewer cannot access renders a calm "shared by X, no access" placeholder carrying only the name and type, never the underlying data.
- **Request access.** That placeholder carries a Request access button, the same affordance Google and Microsoft show when you open something you cannot see. It sends a request to the object's owner (over the existing relay and identity directory), who gets a notification to approve or deny. On approve the item is delivered through the same dependency package, and the embed resolves on its own the moment it lands (see Portable identity below). The owner can optionally remember a grant ("always let X see what I share with them"), so repeat requests are not needed.
- **Inbound shares are project-less.** A shared individual item does not inherit the sharer's project. It arrives project-less, grouped under "shared by X" (the received-from view), and the user files it into their own collections later. A project travels with the share only when the WHOLE project is shared, then its membership comes along. The cross-boundary transfer path already drops the sender's project_ids and lands items Unfiled or recipient-chosen, so it already matches this rule, the change is the same-folder share case where a shared item currently shows under its owner's project.

## Portable identity and seamless resolution

This is what makes a received embed light up on its own. An embed must resolve by a stable, content-portable identity, not the sender's local id, which is meaningless in another person's library (their copy gets its own id).

- Molecules resolve by InChIKey (already canonical and content-derived). Sequences by a content hash of the record, or the NCBI accession when present. Files by content hash. Notes, methods, tables, and experiments by an origin uuid that travels with every copy of the object.
- The embed link carries this stable ref in the fragment (`...#ros=map&ref=ik:LUKBXSAW...`), the local id in the path stays only as a fast-path hint. Plain markdown still ignores the fragment, so portability is unchanged.
- The resolver matches the stable ref against the recipient's WHOLE library. The moment the object exists anywhere in their local ResearchOS, received through a share, granted through request-access, or created or imported independently, every embed that references it resolves and renders, with no manual re-linking. Until then it shows the placeholder and Request access.

The same mechanism is why one embed renders correctly for both the sender and the recipient even though their local ids differ, and why moving or re-importing an object never breaks an embed that points at it.

## Transclusion (section embeds)

Beyond whole-object embeds, a note can transclude a SECTION of another note, `![[note#heading]]`-style, rendered live. A standard protocol snippet or a shared methods paragraph is written once and reused everywhere, edit the source and every transclusion updates. Depth-guarded like the note embed.

## Mobile and accessibility

- Mobile and the companion render embeds read-only at least, so a shared note reads correctly on a phone.
- Every embed carries alt / aria text and is keyboard-focusable, and the baked output keeps figure / table semantics for screen readers and for the published PDF.

## Collaboration and version control come for free

Because an embed is just markdown text, the systems that already operate on a note's text get embeds for nothing:
- Real-time collaboration (the Loro notes pilot) merges embed edits like any other text, two people can add embeds to the same note at once.
- Note version control diffs an embed change as a text diff (a changed view or pin shows up), and restore / undo / redo all work on it unchanged.
- Search matches an embed by its caption and the surrounding note text, and backlinks connect it to its object.

This is a direct benefit of the "raw stays portable markdown" contract, no embed-specific merge, diff, or history code is needed.

## Insertion UX

The `/` picker (`ReferencePicker`, pull) and the "Send to" picker (`SendReferencePicker`, push) currently insert `[name](/path)`. They gain a light Mention / Embed choice:

- Default by context: inserting on an empty line creates a block Embed with the type's default view, inserting mid-sentence creates an inline Mention.
- A small toggle lets the user override, and for embeds a one-tap view switch (map / features / seq for a sequence, table / summary for a table, and so on).
- The fragment is appended to the link the picker already builds, so the rest of the pipeline is unchanged.
- Beyond the picker: drag an object from its library onto the editor to embed it, paste a deep link to upgrade it to an embed, paste a SMILES to create a molecule embed.
- BeakerBot can author embeds ("add the endpoint t-test here") and read the embeds already in a note as context, reusing the artifact index it already builds.

## Robustness

- Name escaping: tighten `objectReferenceMarkdown` so a name with `)`, `]`, `\` (for example `pGEX-3X (U13852)`) always produces a valid link. The destination is URL-encoded, the link text escapes `]` and `\`.
- Broken / deleted refs: an embed whose target is gone renders a calm "this sequence was deleted or moved" card carrying the name, never a crash. The states are distinct, deleted vs no-access (see sharing) vs failed-to-render (corrupt or unreadable data), each its own calm placeholder, none a crash.
- Performance: heavy renderers (RDKit, sequence maps, plots) stay lazy and cached, embeds below the fold render on scroll, a note with many embeds stays responsive.
- Recursion: depth-guarded so a note that embeds itself or a cycle degrades to chips.

## Phasing (to minimize regressions)

1. **Phase 0, format + parser.** `#ros` fragment grammar, `parseObjectEmbed(href)`, extend the deep-link builders to carry a view, tighten name escaping, captions via link text. Fully backward compatible (no fragment means chip).
2. **Phase 1, preview block embeds + insertion.** `ObjectEmbed` component and the per-type renderers for the highest-value types (sequence, molecule, Data Hub table, Data Hub plot, Data Hub result, image). The picker gains Mention / Embed, plus drag and paste. Captions + auto-numbering. Preview only.
3. **Phase 2, editor live preview.** CodeMirror block + inline widgets so embeds show while editing. This is the heaviest engineering piece and the most of the Notion feel.
4. **Phase 3, remaining types.** method, purchase, inventory, experiment-results, note, file (pdf / csv / notebook), project, and external / literature embeds (DOI, PubChem, accession, URL).
5. **Phase 4, backlinks + share safety.** The system-wide "Referenced in" scanner, permission-aware rendering in shared notes, and the share-time dependency warning.
6. **Phase 5, export and publish baking.** Freeze embeds to self-contained figures / tables for PDF, Word, and LaTeX export and for the publish / Zenodo / transparency paths, with captions, numbers, a bibliography from citation embeds, and provenance stamps.
7. **Phase 6, share with dependencies + request access.** Bundle a note plus its embedded objects into one cross-boundary package, recipient chooses where each lands. The portable-identity resolver (received objects light up their embeds anywhere in the local library), the Request-access button plus the approve / deny handshake over the relay, and the same-folder project-less reconcile.
8. **Phase 7, polish.** Pin + staleness badge, transclusion, in-place view switching, chip hover-card previews, BeakerBot authoring, mobile + accessibility passes.

Each phase lands behind the same additive pipeline, so an existing note with plain links is never affected until the user inserts an embed. Phases 0 to 3 are the embed system itself, 4 to 7 are what make it safe to share, publish, and reuse.

## Decisions locked (2026-06-11)

- Caption = the link text doubles as the caption (no new syntax). Images use the native alt text.
- Auto-numbering = opt-in PER DOCUMENT, not global (an experiment's results doc can be numbered while its lab notes are not).
- Default block views = sequence `map`, molecule identity `card`.
- Inline chip hover-card previews land in Phase 1.

## Still open

- Card density and chrome, how much border / header each embed card carries vs a borderless inline look (a Phase 1 visual call).
- Share-with-dependencies default, does the share-time warning offer to bundle in one click, and does a bundle default to including all dependencies or let the sharer pick.
- Side-by-side layout, do we support two embeds in a row (compare two plots / two maps) via a column option, or keep the single-column markdown flow.
