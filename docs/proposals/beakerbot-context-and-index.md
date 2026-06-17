# BeakerBot context awareness and the artifact index

Status: Layer 0 in build (2026-06-11), Layers 1 and 2 specced here, not built.
Author: HR (orchestrator), for Grant.
Related: docs/proposals/ai-assistant.md (sections 12 tool catalog, 13 one front door unified search).

House voice applies to this doc and to every string it specifies, no em-dashes, no emojis, no mid-sentence colons, concept first, state the why.

## The problem this solves

BeakerBot can run a t-test and draw a graph, but it cannot yet answer "summarize the t-test result" or "add this to a note" when the result is not something it just produced in the same chat. Two gaps cause that.

1. No way to read back a stored result. We built tools to CREATE an analysis and to LIST tables, but nothing to READ an existing analysis's stored result. So BeakerBot can only summarize work it did this turn.
2. No awareness of what the user has open. The page perception tool sees the buttons on the page, not the content or the selection. So "this" and "the t-test" cannot resolve to what is on the user's screen.

The hard constraint that shapes the whole design: the user's data is local and stays local. We never move the corpus to the cloud. Only small answers (a few names and numbers a tool returns) cross to the inference model. So the design must let BeakerBot LOCATE the right artifact and read only that one, never scan or upload the whole store.

## The architecture already supports this

Two facts from the codebase make this cheaper than it looks.

- BeakerBot's tools run in the browser, against the local folder. The agent loop is browser side. Only the per-turn messages (including the small JSON a tool returns) reach the proxy and the model. We are moving answers, not data.
- The Data Hub already keeps a slim readable `.json` mirror next to each document's full CRDT snapshot, and the table list reads only those mirrors (metadata, no heavy deserialize). That is exactly the "intelligently organized JSON so BeakerBot can find things without querying the whole store" idea, already proven for one type. The index layer generalizes that pattern.

## Three layers

- Layer 0 (in build now): a current-context signal plus by-id read of a stored analysis. Resolves "this" and "the t-test" for the Data Hub, and gives the in-panel "which one?" buttons for free.
- Layer 1 (this spec): a lightweight cross-type artifact index, so BeakerBot can find an artifact the user did not open and did not name precisely, without scanning. This is the backbone of the one-front-door BeakerSearch.
- Layer 2 (this spec): per-type read-by-id tools, so once the index locates an artifact, BeakerBot fetches only that file.

### Layer 0 (for reference, being built in parallel)

- A `context-bridge` (mirrors the existing navigation-bridge): pages publish `{route, pageLabel, selection:{type,id,name,parent?}}`, the panel reads it at send time and injects a fresh, non-persisted system line describing what is open. The Data Hub page publishes its selected table and analysis.
- `read_datahub_analysis(tableId, analysisId)` and `list_datahub_analyses(tableId)`, both read-only, no navigation. They read `content.analyses` and relay the stored `resultCache`, never recompute.
- The model's resolution ladder, stated in the system prompt: the open selection wins, else a clearly named item, else list and ask with buttons, else (rare) guide to the page.

## Layer 1, the cross-type artifact index

### What it is

One lightweight per-user catalog of the user's artifacts across types (notes, experiments, methods, sequences, Data Hub documents, projects, purchases, molecules), each entry a small brief, not the content:

```
ArtifactBrief = {
  type: "note" | "experiment" | "method" | "sequence" | "datahub" | "project" | ...,
  id: string,
  title: string,
  subtitle?: string,        // e.g. a project name, a date range, a table type
  date?: string,            // last edited or created, ISO
  projectIds?: string[],
  deepLink: string,         // from references.ts objectDeepLink(type, id)
  keywords?: string[],      // optional, title tokens plus a few salient terms
}
```

The index never holds the artifact's body. It holds enough to FIND and to LINK. Once BeakerBot picks a brief, a Layer 2 read tool opens that one file for the body.

### How it is built and kept current (three options, with a recommendation)

The artifacts already each have a `list()` API (notesApi.list, methodsApi.list, sequencesApi.list, dataHubApi.list, projectsApi.list, purchasesApi.list, chemistryApi.list). The only question is how to turn those into one queryable index without re-reading everything on every BeakerBot call.

- Option A, on-demand union. Build the index in memory by calling each type's `list()` when BeakerBot needs to search, then rank. Simplest, zero new storage, always fresh. Cost is N list calls per search, each already cheap (metadata reads). Risk is the per-type lists vary in cost and one slow type drags the search.
- Option B, persisted index file with write-through. Maintain a single `users/<owner>/_artifact_index.json` updated whenever any artifact is saved or deleted. Fastest to query, but adds a write-path coupling to every save site and a rebuild/repair path when it drifts. This is the heaviest to get right.
- Option C, persisted index with lazy rebuild. Keep the `_artifact_index.json`, but rebuild it from the per-type `list()` calls on a cheap trigger (folder connect, or a staleness timestamp), not write-through. Drift is self-healing on the next rebuild, no coupling to every save site.

Recommendation: start with Option A (on-demand union of the existing `list()` APIs), because it is the least new machinery, always correct, and the per-type lists are already the cheap metadata reads BeakerBot would otherwise call one by one. Promote to Option C only if a real corpus makes the union too slow, and only then add the persisted file with a lazy rebuild. Avoid Option B's write-through coupling unless measured need forces it. This mirrors the Data Hub mirror pattern (a derivable cache, never the source of truth), which is the pattern that has worked.

### How BeakerBot uses it

One read-only tool, `search_my_work(query, types?, limit?)`:
- Builds (or reads) the index, ranks briefs against the query by title and keyword match (a simple local scorer, not an embedding model in v1), filters by `types` when given, returns the top `limit` briefs.
- Returns `{count, results: ArtifactBrief[]}`. Small. Only matched briefs cross to the model, never the corpus.
- The model uses a returned brief's `type` and `id` to call the matching Layer 2 read tool, and its `deepLink` to navigate or to write a reference into a note.

This is the same machine as the one-front-door BeakerSearch in ai-assistant.md section 13. The instant, free, keystroke search and the AI escalation read the SAME index. We build the index once and both surfaces use it.

### Privacy and locality

The index is derived on the device from local data, and only the small matched briefs (titles, ids, dates) reach the model, and only when a search runs. The bodies never leave the device unless the user asks BeakerBot to read a specific one, at which point only that one artifact's content is in play. State this in the wiki and in BILLING_FACTS-adjacent copy, it is a trust point, not a footnote.

## Layer 2, per-type read-by-id tools

Once the index locates an artifact, BeakerBot reads only that one. One small read-only tool per type, each returning a compact, model-friendly projection (not the raw store object):

- `read_note(id)` -> title, entries (title, date, a trimmed content body).
- `read_method(id)` -> name, summary, steps.
- `read_sequence(id)` -> name, type, length, a short feature summary, not the full base string unless asked.
- `read_experiment(id)` -> title, status, linked artifacts.
- `read_datahub_analysis(tableId, analysisId)` -> already built in Layer 0.

Each reuses its type's existing `get`/`load` API and trims to what the model needs, so a large artifact does not blow the context window. Each is read-only and never navigates.

## Decisions (locked 2026-06-11 by Grant)

1. Index strategy: Option A, on-demand union of the existing per-type `list()` APIs, built in memory per search, no persisted index file in v1. Option C (persisted file, lazy rebuild) is the documented upgrade path, taken only if a real corpus proves the union too slow. Option B (write-through) is rejected.
2. Ranking: local title plus keyword scorer for v1, no embeddings. Embeddings are a later, separate decision tied to the paid tier.
3. Type coverage: ALL types in the first index, notes, experiments, methods, sequences, Data Hub, projects, purchases, molecules. Each type needs its own Layer 2 read-by-id tool and a verified deep-link. The build is larger, but the user wanted complete coverage from the first ship rather than a follow-up.
4. Read-tool trimming: read tools return trimmed projections (not full bodies) by default, with the model able to ask for more, to protect the context window.

### Implication of full coverage (decision 3)

Two pieces of pre-work the build must verify, because not every type is as clean as notes and Data Hub today:
- Deep links. references.ts supports sequence, datahub, method, note, project. collection, file, and molecule are marked reserved or partial. Molecules ship in this index, so the molecule deep link must be made real (or the brief must carry a working route) before molecule entries are useful.
- Per-type list shape. Each type's `list()` returns a different record. The build needs one small adapter per type that maps its record to ArtifactBrief, and one read-by-id projector per type. Experiments and purchases need their list and get APIs confirmed (notes, methods, sequences, Data Hub, projects are confirmed).

## Sequence

Layer 0 lands first (in build). Then Layers 1 and 2 land together as the BeakerSearch backbone, now unblocked (decisions locked above). The search box UI (the one-front-door GUI Grant is marking up) consumes the same index, so the index work and the GUI work meet here.
