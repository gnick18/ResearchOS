# Hover-prefetch layer (intent-scoped data warming)

Status: proposal, not built. Author: perf manager, 2026-06-08.

## What this is

A small layer that warms the heavy data behind a detail popup while the pointer
is resting on its list row, so the popup opens with content already in memory
instead of with a spinner. It is the data-side companion to the idle code-chunk
preloads already shipped (`usePreloadOnIdle`), built on the same philosophy. Warm
on real intent, run best-effort, never block first paint, never pollute caches.

## Why the obvious version does not apply here

The naive React Query pattern is "on hover, `queryClient.prefetchQuery` the row's
detail query". That does not fit ResearchOS, because there are no per-record
detail queries. The data layer is list-centric.

- Lists are fetched once and cached under user-scoped keys (`["notes"]`,
  `["tasks", user]`, `["methods", user]`, etc.), and they are already eagerly
  prefetched at shell mount (`beaker-search/useGlobalObjectIndex.ts:82`).
- Detail popups receive the already-cached record as a prop. `NoteDetailPopup`,
  `TaskDetailPopup`, and `SupplyDetailPanel` do not run a query for the record
  itself.

So the list record is already in memory the moment a row is visible. Prefetching
it again buys nothing. The latency you feel on open is the **secondary heavy
load** the popup kicks off in an effect after it mounts.

## Where the open-time latency actually is

| Surface | Heavy load on open | Call site | Mechanism |
|---|---|---|---|
| Note detail | Loro CRDT doc (markdown body + history) | `openNote(note, owner)` `NoteDetailPopup.tsx:357` | async Loro handle |
| Experiment / task (Lab Notes tab) | Loro doc for `notes` | `openTaskDoc(ref, "notes", user)` `TaskDetailPopup.tsx:3843` | async Loro handle |
| Experiment / task (Results tab) | Loro doc for `results` | `openTaskDoc(ref, "results", user)` `TaskDetailPopup.tsx:4770` | async Loro handle |
| Method (markdown) | `source.md` body read | `filesApi.readFile(sourcePath)` `methods/page.tsx:1655` | direct FSA read |
| Method (PDF) | PDF binary as base64 | `filesApi.readFile(source_path)` `methods/page.tsx:1953` | direct FSA read |
| Method (PCR) | protocol JSON | `pcrApi.get(id, owner)` `methods/page.tsx:2116` | api call |
| Supply detail | none (items/stocks pre-loaded by page) | n/a | nothing to warm |

Two warming targets fall out of this. Loro handle loads (notes, experiments) and
file/api reads (methods). Supplies need nothing.

## Architecture: one delegated listener, not per-row wiring

Every list row across the app already renders a stable identity attribute:

```
data-beaker-target="note:note-<owner>:<id>"
data-beaker-target="experiment:<owner>:<id>"
data-beaker-target="method:<owner>:<id>"
data-beaker-target="project:<owner>:<id>"
data-beaker-target="supply:<key>"
```

(added for BeakerSearch's object index, see `useGlobalObjectIndex.ts`). That means
we do not need to thread an `onMouseEnter` into every row component. A single
delegated `pointerover` listener on a container reads `event.target.closest(
"[data-beaker-target]")`, parses the `kind:owner:id`, and dispatches to the right
warm function. One mount point, zero row churn, and it automatically covers any
future surface that uses the same attribute.

Proposed mounting: a `usePrefetchOnHover()` hook called once in AppShell (or a
thin `<PrefetchScope>` wrapper around the main content). It attaches the listener,
debounces, dedupes, and routes.

### Routing table

```ts
// kind -> warm(owner, id)
{
  "note":       (owner, id) => warmNote(id, owner),        // openNote(...), no collab connect
  "experiment": (owner, id) => warmTaskDoc(owner, id, "notes"), // default tab only
  "method":     (owner, id) => warmMethod(owner, id),      // depends on read cache, see Phase 2
  // project/supply: no-op in v1
}
```

### Guards (so warming stays cheap and safe)

- **Dwell debounce.** Only warm after the pointer rests ~120ms on a row, so a
  fast scan across a long list does not fire dozens of loads.
- **Once per key per session.** Keep an in-memory `Set` of warmed `kind:owner:id`
  keys; skip repeats. A hover after the popup has been opened is also a no-op.
- **Concurrency cap.** At most ~2 warms in flight; queue the rest. Hovering should
  never contend with a load the user actually triggered.
- **Best-effort.** Swallow errors. A failed warm just means the real open loads
  it, same as today.
- **Respect Save-Data / coarse pointer.** Skip entirely when
  `navigator.connection.saveData` is true, and on touch devices (no hover intent
  exists there, and we do not want to warm on tap-scroll).

## The two warm paths

### Loro handles (notes, experiments) — pays off immediately

`openNote` / `openTaskDoc` return a **stable, idempotent, one-per-record handle**
keyed on id+owner. Calling it on hover loads the doc from disk; the later real
open reuses the exact same handle, so the doc is already resident. Important
detail confirmed in the code: the collab relay auto-connect lives in the popup
effect (`NoteDetailPopup.tsx:434`), not inside `openNote`, so **warming a handle
does not open a network connection**. We get the expensive disk + parse work for
free without any premature relay traffic. That keeps hover-warming local-first and
side-effect-free.

Memory note. Each warmed handle holds a Loro doc in memory. Hovering hundreds of
rows in one session could accumulate. Mitigation: an LRU that `close()`s the
least-recently-warmed handle once more than N (say 8) are warmed-but-never-opened.
A handle the user actually opened is owned by the popup and excluded from the LRU.

This path needs no new infrastructure and is the recommended **Phase 1**.

### File / api reads (methods) — gated on a read cache

Method bodies and PDFs are `filesApi.readFile(path)` direct reads with no caching
today. Warming one on hover only helps if the result is still around when the user
clicks. Two ways to make that true:

1. The **FSA read cache** (`docs/proposals/FSA_READ_CACHE.md`, also still a
   proposal). If that lands, a hover read populates it and the open is instant.
   This is the clean answer and the reason the two proposals are linked.
2. A tiny dedicated short-TTL prefetch cache (an in-flight + recently-resolved
   `Map<path, Promise>`), scoped to this layer. Cheaper to build but duplicates
   what the FSA read cache would do properly.

Recommendation: make the method path **Phase 2, dependent on FSA_READ_CACHE**, and
do not build the throwaway cache. Notes and experiments deliver most of the felt
win and need nothing new.

## Interaction with the caches (the question that prompted this)

- **React Query.** Untouched in Phase 1. The Loro warm is a direct async call, not
  a query, so it cannot seed or invalidate any query entry. No pollution.
- **Loro store.** The warm uses the same stable-handle API the popup uses, so it is
  deduped by construction. Worst case is the LRU closing an unused handle, which
  the next hover simply re-opens.
- **FSA read cache.** Phase 2 deliberately routes method reads through it rather
  than inventing a parallel cache, so there is one source of truth for file reads.
- **Browser/HTTP cache.** Not involved (these are local folder reads, not network
  fetches).

## Scope

In:
- `usePrefetchOnHover()` delegated listener + router + guards (Phase 1).
- `warmNote` / `warmTaskDoc` wrappers around the existing Loro store calls, plus
  the warmed-handle LRU.

Out (explicitly):
- Supplies, projects (nothing heavy to warm).
- Results tab of experiments (warm only the default Lab Notes tab; results warms on
  tab switch as it does now).
- Methods (Phase 2, after FSA_READ_CACHE).
- Sibling prefetch in open popups and `router.prefetch()` on nav. Separate, smaller
  follow-ups, not part of this layer.

## Rollout

1. Flag-gate behind `HOVER_PREFETCH_ENABLED` (default off), mirroring how other
   perf/experimental layers ship here.
2. Land Phase 1 (notes + experiments), dogfood in Grant's tree.
3. Verify there is no relay connection on hover (network tab stays quiet until a
   real open) and that the handle LRU caps memory.
4. Phase 2 (methods) only after FSA_READ_CACHE merges.

## Open questions for sign-off

1. Mount as a hook in AppShell, or as a `<PrefetchScope>` wrapper? (Hook is less
   markup; wrapper is more explicit about the boundary.)
2. LRU size for warmed-but-unopened Loro handles. 8 is a guess; happy to tune.
3. Phase 2 ordering. Wait for FSA_READ_CACHE, or pull that proposal forward so the
   method surfaces get the same treatment sooner?
