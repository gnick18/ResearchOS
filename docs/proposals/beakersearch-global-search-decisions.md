# BeakerSearch global object search, locked decisions

Decisions on [`beakersearch-global-search.md`](./beakersearch-global-search.md),
signed off by Grant on 2026-06-07. This file is the build contract; where it and
the design doc differ, this file wins. Voice, no em-dashes, no en-dashes, no
emojis, no mid-sentence colons.

## Grant's decisions (asked + answered 2026-06-07)

1. THE v1 CORE SET, APPROVED AS PROPOSED. v1 indexes Tasks, Projects, Methods,
   Sequences, the four types that already have a canonical merged loader and a
   clean deep-link. Notes, notebooks, purchase line items, calendar events, lab
   links, lab members, 1:1s, and artifacts are DEFERRED to v2. v1 adds no new
   loader, no new deep-link param, and edits no page component. The moment a
   candidate would need any of those three, it is v2.

2. INDEXING, EAGER-ONCE PREFETCH. The index is a thin reader over the four
   canonical React Query caches, plus a one-time fire-and-forget
   `prefetchQuery` of the four loaders on app-shell mount, so Cmd-K finds a
   record by name even on a page the user has not visited this session. The cost
   is four local file reads per session, which is cheap on a local-first app and
   buys instant cross-page search. Not pure-lazy.

3. FIRST v2 ENTITY, NOTES. Notes are the locked first v2 addition. The two
   prerequisites are pre-scoped, a `fetchAllNotesIncludingShared` merged loader
   (own + shared notebook notes in one decorated, deduped array) and an
   `?openNote=<key>` deep-link that opens the note on its home page. Calendar
   events and links wait further; they are lower value.

4. RECENT RECORDS MRU, SHIP IT IN v1. The empty-query palette shows a short
   "Recent records" list (the last ~5 globally opened core records), a per-user
   `localStorage` MRU keyed by `currentUser`, pushed whenever a global jump
   fires. Client-only, survives reloads, never touches the data folder, matching
   the Workbench and Methods MRU decisions. It is the only thing the global
   source contributes to the empty view (it never dumps the index).

## Orchestrator decisions (the design doc's remaining open questions, resolved)

These did not need Grant's steer; resolved by the sequence editor master to keep
the build unblocked. Flagged here for visibility, reopen if Grant disagrees.

5. METHODS QUERY-KEY SEAM (doc 3.4 / open Q1). The global index standardizes on
   `["methods", currentUser]` (the `/search` key, the relationship anchor). As a
   tiny v1 follow-up, align the Methods page read from bare `["methods"]` to
   `["methods", currentUser]` so there is ONE method cache, no double-fetch, no
   stale-after-edit split. Do not silently fork the cache. This is the one extra
   in-app touch v1 carries, and it is a cache-key alignment, not a page-internals
   change, so it stays within the "no page component edits" spirit (it is a query
   key, not a deep-link or a loader).

6. `/search` AND THE PALETTE SHARE DATA, NOT RANKING, FOR v1 (doc open Q4). They
   share the four `fetchAll*` loaders and query keys. They deliberately keep
   DISTINCT ranking, `/search` does faceted keyword AND-include filtering, the
   palette does `fuzzyScore` instant ranking. No shared-ranking-module refactor
   in v1. Revisit extracting one ranking module only if v2 grows the index enough
   to make the duplication hurt.

7. TYPE-WEIGHT CONSTANTS, START AT THE DOC'S GUESS (doc open Q6). Ship with Task
   +3 > Project +2 > Sequence +1 > Method +0 as additive nudges on top of the raw
   `fuzzyScore`, recency boost `+min(4, weeksFreshness)`. These are tunable
   constants in one place; tune by feel once the source is live against real data.

8. THE `/search` HANDOFF NEEDS A `?keywords=` READER (doc 6). The "Search
   everything for <query>" row pushes `/search?keywords=<query>`. `/search` gains
   a small on-mount reader that seeds its keyword box from the param and runs the
   search. This is an additive enhancement to `/search`, not a refactor, and it is
   the only `/search` touch the feature requires.

## The build chunks (locked)

Per the design doc's rollout, all four core types land together (they share the
index shape):

1. THE INDEX HOOK, `useGlobalObjectIndex()` + `buildGlobalIndex()` reading the
   four canonical loaders by their existing keys, the one-time shell-mount
   prefetch, the `GlobalIndexEntry` shape. Pure data, unit-tested without
   rendering (mirror the `editor-commands.ts` test posture). Includes the methods
   query-key alignment (decision 5).
2. THE GLOBAL SOURCE, feed the index into the provider as the cross-app NAVIGATE
   contributor, per-type grouping (Tasks / Projects / Methods / Sequences), the
   type-weight + recency ranking (decision 7), the 5-per-type / 12-overall caps,
   the 120 ms debounce, and the on-page de-dup (drop the global group for the
   active page's own type). Reuse `fuzzyScore`. Empty-query shows nothing from the
   index except the MRU.
3. THE HANDOFF, the "Search everything for <query>" row plus the `/search`
   `?keywords=` reader (decision 8).
4. RECENT RECORDS MRU (decision 4), the per-user `localStorage` MRU surfaced in
   the empty global section.

Each chunk is shippable on its own. Build in a worktree off the latest main;
verify with tsc + a unit test for `buildGlobalIndex` and the ranking; merge per
the usual cadence. No build starts before this file is committed.
