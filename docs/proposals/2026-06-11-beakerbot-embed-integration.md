# BeakerBot x ResearchOS embeds, integration handoff

Audience: the BeakerBot / Beaker AI agent team. Goal: let BeakerBot AUTHOR rich object embeds in the content it writes (notes, experiment results and lab notes, methods), and READ the embeds already in a document as context. Everything below reflects what is built and on `main` as of 2026-06-11, not an aspiration.

Full design rationale lives in `docs/proposals/2026-06-11-markdown-embed-hybrid.md`. This doc is the practical "how do I emit one" summary.

## The one-paragraph mental model

Every ResearchOS object reference is a plain markdown link on disk, so the file stays portable. ResearchOS upgrades certain links to rich visuals at render time. BeakerBot does not call any rendering API. It just writes the right markdown string into the document, and the renderer (and the live editor) turns it into a chip or a block card. So integration on the BeakerBot side is purely "emit the correct markdown."

## Two forms, one rule

There are two visual treatments, chosen by WHERE the link sits, not by a flag:

- Inline mention (a small chip) when the link is part of a sentence.
- Block embed (a rich card, the structure / map / table / plot / result) when the link is ALONE on its own line / paragraph.

So: to drop a figure, put the embed link on its own line. To name-drop an object mid-sentence, write the link inline.

Backward compatible: a link with no `#ros=` fragment renders as a chip everywhere. Nothing renders specially unless the fragment is present (for block embeds) or the link is an in-app object route (for chips).

## How to emit an embed

Two equivalent ways. Prefer the helper if you can call into the app code, otherwise write the raw string.

### Helper (canonical)

From `@/lib/references`:

```ts
// Block embed: a rich card, alone on its own line.
objectEmbedMarkdown(type, id, name, { view })
//   -> "[name](/deeplink#ros=view)"

// Inline mention: a chip, used mid-sentence.
objectReferenceMarkdown(type, id, name)
//   -> "[name](/deeplink)"
```

`view` is optional. If omitted, use `DEFAULT_EMBED_VIEW[type]` (also exported from `@/lib/references`). The link TEXT (`name`) is the caption / title shown on the card, so make it human (the object name, or a short caption like "Welch t-test, A vs B").

### Raw string (if you cannot call the helper)

Just write the same string into the markdown:

```
[Caffeine](/chemistry?molecule=12#ros=card)
```

Block vs inline is still decided by whether it is alone on its line.

## Type catalog

`type` is one of: `sequence`, `collection`, `method`, `note`, `file`, `project`, `molecule`, `datahub`, `task`, `experiment`. The `id` is the object's local id (a string). Use REAL ids from the artifact index, never fabricate them. If you do not have an id, do not emit an embed.

| type | deep link (id substituted) | default view | renders as |
| --- | --- | --- | --- |
| `molecule` | `/chemistry?molecule=ID` | `card` | RDKit 2D structure + formula + MW |
| `sequence` | `/sequences?seq=ID` | `map` | feature ribbon + length, topology, feature count |
| `datahub` | `/datahub?doc=ID` | `table` | data table preview (see Data Hub views) |
| `note` | `/notes/ID` | `card` | title + first-entry excerpt |
| `method` | `/methods/ID` | `card` | name + method-type badge |
| `project` | `/projects/ID` | `card` | name + color dot |
| `collection` | `/sequences?collection=ID` | `card` | name + Collection badge |
| `task` | `/?openTask=ID` | `card` | name + status |
| `experiment` | `/?openTask=ID` | `card` | name + experiment color dot |
| `file` | `/files/ID` | (generic card) | icon + name + Open (no rich renderer) |

Notes:
- `task` and `experiment` share the `/?openTask=ID` link. The `ID` for these is the composite task key (`"self:5"` or `"<owner>:5"`), not a bare number. The artifact index gives you the right key.
- A missing or deleted object degrades to a calm "open it" card, never an error, so a slightly stale id is safe but a wrong type is not.

## Data Hub has three views

A Data Hub document can be embedded as a table, a figure, or an analysis result. Pick the view with `#ros=` and point at the sub-object with an opt:

```
[Growth curve](/datahub?doc=2#ros=table&rows=8)        // table preview
[OD600 over time](/datahub?doc=2#ros=plot&plot=p1)     // the figure p1, rendered as SVG
[Welch t-test, A vs B](/datahub?doc=2#ros=result&analysis=a3)  // analysis a3, verdict + stats
```

- `plot` opt = a PlotSpec id in that document. `analysis` opt = an AnalysisSpec id.
- The result view shows the plain-language verdict + the stat table (the same output as the Results sheet). An analysis that has not been computed degrades to the card.

## Images are the special case

An image is NOT an object link. It uses native markdown image syntax so it shows as a real picture in any tool:

```
![Colony PCR, lanes 1 to 8, expected 1.2 kb band](Images/gel-pcr-screen.png#w=420)
```

- The alt text becomes the caption. The `#w=<number>` fragment sets the display width in px (optional).
- Use a path relative to the document's folder (e.g. `Images/...`), the same paths the note already uses for its attachments.

## Fragment grammar reference

`#ros=<view>` plus optional `&key=value` pairs, all URL-encoded:

| key | meaning | example |
| --- | --- | --- |
| `ros` | the view / render mode. Absent or `chip` means the inline chip | `ros=map` |
| `region` | sequence base range to focus | `region=1-500` |
| `rows`, `cols` | table-preview size | `rows=8` |
| `w`, `h` | size hints (px) for a map / plot / image | `w=480` |
| `analysis` | Data Hub analysis id (for `ros=result`) | `analysis=a3` |
| `plot` | Data Hub plot id (for `ros=plot`) | `plot=p1` |
| `ref` | portable content identity (cross-library, optional) | `ref=ik:LUKBXSAW` |

Unknown keys are ignored, so the grammar can grow without breaking older content.

## Reading embeds already in a document (context)

To let BeakerBot treat the embeds in a note as context (resolve "this figure", "the t-test"), parse them back with `parseObjectEmbed(href)` from `@/lib/references`:

```ts
parseObjectEmbed("/datahub?doc=2#ros=result&analysis=a3")
// -> { type: "datahub", id: "2", view: "result", isEmbed: true, opts: { analysis: "a3" } }
parseObjectEmbed("/sequences?seq=5")
// -> { type: "sequence", id: "5", view: "chip", isEmbed: false, opts: {} }
parseObjectEmbed("https://example.com")  // -> null (not an in-app object)
```

Walk the document's links, run each href through `parseObjectEmbed`, and you have the structured list of every object the document embeds or mentions. This is the same parse the renderer uses, so it never drifts from what the user sees.

## Rules and gotchas for BeakerBot

- The link text IS the caption. Write a real name / short caption, not a slug.
- Block embed = alone on its own line. If you want a figure, isolate the link in its own paragraph. Mid-sentence links are always chips.
- Only emit an embed when you have a real `id` for the object (from the artifact index). Never fabricate ids. No id means write prose, not a broken embed.
- Embeds render in any surface that uses the ResearchOS markdown renderer (notes, experiment results + lab notes, methods) and live in the editor as you type. They do not render in a plain external markdown viewer (they show as ordinary links there, which is intended).
- Do not duplicate data into the note. An embed is live, it always reflects the current object. Prefer embedding a Data Hub table / result over pasting numbers.
- House style for any prose BeakerBot writes alongside embeds: no em-dashes, no emojis, no mid-sentence colons.

## Worked examples

```
User: add the structure of the compound we dosed (molecule 3)
BeakerBot writes, on its own line:
  [Resveratrol](/chemistry?molecule=3#ros=card)

User: show the growth curve figure from the glucose dataset (doc 2, plot p1)
  [OD600 over time](/datahub?doc=2#ros=plot&plot=p1)

User: summarize the endpoint t-test (doc 2, analysis a3) and embed the result
  The endpoint OD differs between conditions.

  [Welch t-test, endpoint OD](/datahub?doc=2#ros=result&analysis=a3)

User: in a sentence, reference the pUC19 sequence (seq 5)
  We cloned the insert into [pUC19](/sequences?seq=5) and verified by PCR.
```

## Code references

- `frontend/src/lib/references.ts` — `objectReferenceMarkdown`, `objectEmbedMarkdown`, `buildObjectEmbedHref`, `parseObjectEmbed`, `parseObjectDeepLink`, `DEFAULT_EMBED_VIEW`, `EmbedDescriptor`, `EmbedOpts`, the `OBJECT_ROUTES` map (single source of truth for every deep link).
- `frontend/src/components/embeds/ObjectEmbed.tsx` — the block-embed dispatcher + the per-type renderer registry.
- `frontend/src/components/ObjectChip.tsx` — the inline chip (with hover-card preview).
- `frontend/src/components/RenderedMarkdown.tsx` — the Preview renderer (block embed via the `p` override, chip via the `a` override, image via the `img` override).
- `frontend/src/lib/markdown/cm-inline-reveal/` — the live editor widgets (`embed-widget.ts`, `object-chip-widget.ts`, `image-widget.ts`).
