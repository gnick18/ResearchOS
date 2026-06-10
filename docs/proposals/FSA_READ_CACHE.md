# FSA Read Cache

**Status:** Design — awaiting sign-off before build  
**Problem:** Slow initial connect and per-read latency on OneDrive folders  
**Scope:** `file-service.ts`, `indexeddb-store.ts` only — transparent to all callers above

---

## 1. Why it's slow

Every `readJson` / `readText` call in `file-service.ts` does this:

```
getHandleByPath(path)          ← walk the directory tree
  → getFile()                  ← materialise a File object
    → file.text()              ← read bytes off disk
      → JSON.parse()
```

On a local NVMe folder this takes ~1ms. On OneDrive, the FSA goes through
OneDrive's FUSE-like sync layer, and any file not already resident in the
local OneDrive cache triggers a cloud download before bytes are returned.
A lab folder with ~200 JSON files (tasks, projects, notes, methods, goals,
sidecars) can therefore take 5–30 seconds to fully populate on reconnect.
`staleTime: 0` in `query-client.ts` means React Query considers every
cached query stale on mount, so every component re-read on reconnect fires
a real FSA read. The problem compounds on every tab reload.

The file-system level is the right place to fix this, not the React Query
layer, because:
- It's transparent: no query key changes, no API surface changes, no
  component changes.
- It catches reads that happen outside React Query (the loading-screen
  pass, per-entity normalize helpers, etc.).
- It survives a full `invalidateQueries()` correctly: the query is
  invalidated, the `queryFn` fires, but the actual FSA read is served from
  cache because the file hasn't changed.

---

## 2. Solution overview: three layers

```
React Query (staleTime: 0, refetchOnWindowFocus: false)
        │  ← unchanged
        ▼
fileService.readJson / readText
        │
        ├─ [1] Metadata check: getFile().lastModified ← cheap FSA call
        │         hit → serve from IndexedDB cache (zero byte read)
        │         miss → read bytes, store in cache, return
        │
        ├─ [2] Write-through: atomicWrite() stores content in cache after
        │       every successful write (no extra FSA round-trip needed)
        │
        └─ [3] Reconnect sweep: on connect/reconnect, walk known entity
                dirs in the background, invalidate cache entries whose
                lastModified has advanced (catches external edits from
                another machine or another app)

                Fast-path: a single _cache_sentinel file stores the
                folder's highest-seen write mtime. If it hasn't changed,
                the sweep is skipped entirely (O(1) reconnect).
```

---

## 3. IndexedDB schema

The existing `research-os-fsa` DB is at version 1 with one object store
(`handles`). We bump to version 2 and add a second store: `file-cache`.

```ts
// Object store: "file-cache"
// keyPath: "key"
// indexes: none needed (all lookups are by exact key)

interface CacheEntry {
  key: string;          // "${folderName}::${path}"  e.g. "LabFolder::users/alex/tasks/1.json"
  lastModified: number; // File.lastModified at the time of the last read
  data: unknown;        // parsed JSON (for readJson) or string (for readText)
  kind: "json" | "text";
}
```

Scoping by `folderName` (from `directoryHandle.name`) means folder-switches
are automatic cache misses. No explicit clearing on switch needed, though
we do clear on explicit disconnect (see §7).

Why not `idb-keyval`? The keyval store is backed by a shared generic
object store; mixing file-cache entries with it risks key collisions and
forces sequential access. A dedicated object store gives us bulk operations
(batch reads in a single transaction) and clear isolation.

---

## 4. Layer 1 — Read-through cache in FileService

### 4a. The hot path

Replace the current body of `readJson` and `readText` with:

```
readJson(path):
  1. resolve the file handle (existing getHandleByPath)
  2. call handle.getFile()               ← returns File with .lastModified
                                           does NOT read bytes (metadata only)
  3. build key = "${folderName}::${path}"
  4. look up key in file-cache IDB store
  5. if entry exists AND entry.lastModified === file.lastModified:
       return entry.data as T            ← CACHE HIT, zero byte read
  6. read file.text() + JSON.parse()     ← CACHE MISS, normal read
  7. store { key, lastModified: file.lastModified, data, kind: "json" }
  8. return data
```

Step 2 is the key insight. `handle.getFile()` returns a `File` object
synchronously from the browser's file-system layer; `.lastModified` is
a metadata field that does NOT require reading the file's bytes. On
OneDrive, the FSA gives you the mtime from the local OneDrive metadata
store without downloading the file. This is why the metadata check is
cheap even on a cloud folder.

### 4b. Cache warmth in practice

On first connect after this ships: all cache misses, full read speed.
After the first full load, the cache is warm. On every subsequent
reconnect, step 2-5 above returns a hit for any file not externally
modified. For a typical lab folder (~200 JSON files, ~5ms per file on
OneDrive in a cold sync state), warm reconnect drops from ~1s to ~50ms
(200 metadata checks at ~0.25ms each, served from IDB).

For files that HAVE changed (e.g. another lab member committed new tasks
to the shared OneDrive folder overnight), the cache miss path fires
normally. Those files pay the full read cost once, then re-warm the cache.

### 4c. IDB transaction batching

`readJson` is currently called one file at a time. The IDB lookup in step
4 opens a transaction per call by default, which is fine for sequential
reads. We can batch the IDB lookups in `listFiles`-adjacent patterns
(e.g. loading all tasks for a user) by opening a single read transaction
for the batch. This is a Phase 2 optimization -- Phase 1 just does per-
call lookups, which still eliminates the expensive FSA byte reads.

---

## 5. Layer 2 — Write-through invalidation

After a successful `atomicWrite`, we already know the new content. We can
update the cache without an extra FSA round-trip by storing the content
immediately with a sentinel lastModified that will match the next
`getFile()` call.

The problem: we don't know the exact `lastModified` the OS will assign
until we read the file back. Writing a sentinel (e.g. `-1`) would cause
the very next read to be a cache miss, then re-warm -- not a bug, but
wasteful.

Better approach: after the atomic rename (`tmpHandle.move()`), immediately
call `getFile().lastModified` on the final file handle. This is one cheap
metadata call (no byte read). Store the result in cache along with the
content we just wrote. Cost: one extra IDB write + one FSA metadata call
per write. Result: write-then-read is a cache hit.

```
atomicWrite(path, payload):
  ... existing tmp-write + move() ...
  // NEW: re-read metadata + update cache
  const finalHandle = await currentHandle.getFileHandle(fileName)
  const file = await finalHandle.getFile()
  await cacheStore.put({
    key: `${folderName}::${path}`,
    lastModified: file.lastModified,
    data: parsedPayload,   // JSON.parse(payload) if string, null if Blob
    kind: "json"
  })
```

Blob writes (images, attachments) are NOT cached -- this proposal covers
only JSON and text entities. `writeFileFromBlob` does not update the cache.

`notifyFileWritten(path)` already fires after every write (for streak
tracking). The cache update above runs in the same post-write hook chain.

---

## 6. Layer 3 — Reconnect sweep + manifest fast-path

### 6a. The manifest fast-path

Every `atomicWrite` call in `FileService` (debounced 500ms, decision
2026-06-07) touches a tiny sentinel file at the data folder root:
`_cache_manifest.json`. Content is irrelevant; only its `lastModified`
timestamp from the FSA matters.

The IDB stores one value per folder, added to `indexeddb-store.ts` as a
simple keyval pair (can use `idb-keyval` `get`/`set`):

```ts
// key: `cache-manifest-mtime::${folderName}`
// value: number (the File.lastModified timestamp of _cache_manifest.json)
export async function getManifestMtime(folderName: string): Promise<number | null>
export async function setManifestMtime(folderName: string, mtime: number): Promise<void>
```

On every connect/reconnect, before the sweep:

```
1. try to get the file handle for _cache_manifest.json
2. if it doesn't exist (fresh folder, never written to by this app):
     → skip to full sweep
3. manifestFile = await handle.getFile()   ← metadata only, zero bytes read
4. stored = await getManifestMtime(folderName)
5. if stored === manifestFile.lastModified:
     → FAST PATH: nothing this app wrote has changed; skip sweep entirely
6. else:
     → run the full sweep (§6b)
     → await setManifestMtime(folderName, manifestFile.lastModified)
```

Why this works: the manifest is updated on every write FROM THIS BROWSER.
If `lastModified` matches what's stored in IDB, nothing has changed since
the last session (no external writes either -- OneDrive would bump the
manifest's mtime if it synced a new version). If it differs, something
changed and the sweep runs.

The common case (user closes tab, reopens later, no OneDrive sync
activity in between) is O(1): one FSA metadata call + one IDB lookup.
Total added latency: ~2ms.

### 6b. The manifest write (debounced, no recursion)

Add to `FileService`:

```ts
private _manifestWritePending = false;
private _manifestDebounceTimer: ReturnType<typeof setTimeout> | null = null;

private scheduleManifestTouch(): void {
  if (this._manifestDebounceTimer) clearTimeout(this._manifestDebounceTimer);
  this._manifestDebounceTimer = setTimeout(() => {
    this._manifestDebounceTimer = null;
    this.touchManifest();
  }, 500);
}

private touchManifest(): void {
  if (!this.directoryHandle || this._manifestWritePending) return;
  this._manifestWritePending = true;
  this.atomicWrite(
    "_cache_manifest.json",
    JSON.stringify({ lastWrite: Date.now() })
  )
    .catch(() => { /* best-effort */ })
    .finally(() => { this._manifestWritePending = false; });
}
```

The recursion guard is `_manifestWritePending`. In `atomicWrite`, call
`scheduleManifestTouch()` only when `!this._manifestWritePending` and the
path being written is not `_cache_manifest.json`:

```ts
// at the very end of atomicWrite, after notifyFileWritten(path):
if (!this._manifestWritePending && path !== "_cache_manifest.json") {
  this.scheduleManifestTouch();
}
```

### 6c. The full sweep

Runs when the manifest mtime has changed (or no manifest exists).
Lives as a method on `FileService` so it has access to `directoryHandle`
and `getFolderName()`. Operates only on metadata (no byte reads).

```ts
async sweepAndInvalidate(knownUsers: string[]): Promise<void>
```

`knownUsers` is passed in from `finishConnect` (already computed by
`discoverUsers()`), avoiding a second scan.

**Entity directories swept per user:**

```ts
const ENTITY_DIRS = [
  "projects", "tasks", "notes", "methods", "dependencies",
  "goals", "pcr_protocols", "purchase_items", "sequences",
];
```

**Singleton files swept per user:**

```ts
const USER_SINGLETONS = [
  "_counters.json", "_auth.json", "_shared_with_me.json",
  "_notifications.json", "_calendar-feeds.json",
  "_schema_migrations.json", "_shifted-alerts.json",
  "_seen-shift-alerts.json",
];
```

**Root-level singletons:**

```ts
const ROOT_SINGLETONS = ["_user_metadata.json", "_global_counters.json"];
```

**Sweep algorithm:**

```
for each user in knownUsers:
  for each dir in ENTITY_DIRS:
    dirHandle = try getDirectory(`users/${user}/${dir}`)
    if (!dirHandle) continue
    for await (entry of dirHandle.values()):
      if (entry.kind !== "file") continue
      file = await entry.getFile()
      key = `${folderName}::users/${user}/${dir}/${entry.name}`
      cached = await getCacheEntry(key)
      if (cached && cached.lastModified !== file.lastModified):
        await deleteCacheEntry(key)

  for each singleton in USER_SINGLETONS:
    path = `users/${user}/${singleton}`
    handle = try getFileHandle(path)
    if (!handle) continue
    file = await handle.getFile()
    key = `${folderName}::${path}`
    cached = await getCacheEntry(key)
    if (cached && cached.lastModified !== file.lastModified):
      await deleteCacheEntry(key)

for each singleton in ROOT_SINGLETONS:
  // same pattern
```

Note: `results/task-{id}/` text files (notes.md, results.md) are NOT
swept -- they're in nested subdirectories and the added complexity isn't
worth it. The hot-path metadata check (§4a) self-corrects them on the
next read. This can be added in a follow-up if note loading lag becomes
noticeable.

### 6d. Hook into finishConnect

`finishConnect` in `file-system-context.tsx` is the single shared path for
both `connect()` (OS picker) and `reconnectWithStoredHandle()`. The sweep
hooks in after `discoverUsers()` and before `setState({ isConnected: true })`.

A new `LoadingStage` value:

```ts
export type LoadingStage =
  | null
  | "opening-picker"
  | "connecting"
  | "verifying-permission"
  | "validating-folder"
  | "discovering-users"
  | "warming-cache"   // NEW
  | "preparing";
```

In `finishConnect`, right after the `discoverUsers()` call and before
`scheduleConnectMaintenance(users)`:

```ts
setState((prev) => ({ ...prev, loadingStage: "warming-cache" }));
try {
  await fileService.runConnectSweep(users);
} catch (err) {
  // best-effort — a sweep failure is never fatal
  console.warn("[FileSystemProvider] cache sweep failed:", err);
}
```

`runConnectSweep` does the manifest fast-path check (§6a) and calls
`sweepAndInvalidate` (§6c) if needed. The loading screen is still showing
at this point; users see "warming-cache" briefly in the loading indicator.

For the fast-path case (no external changes), this adds ~2ms to connect
time -- invisible in practice. For the sweep case on a large folder (~400
entity files), worst case is ~200ms of FSA metadata calls. Acceptable on
a loading screen.

---

## 7. Demo / fixture isolation

Same gate as `indexeddb-store.ts`:

```ts
if (isDemoTab()) {
  // skip all cache reads and writes
  // proceed to normal FSA read
  return this.rawReadJson(path)
}
```

The fixture's in-memory mock never touches the real IndexedDB. This also
means fixture reads don't pollute the real cache.

---

## 8. Folder disconnect / switch

On `clearDirectoryHandle()`, evict the cache for the disconnected folder:

```ts
const folderName = directoryHandle.name
await cacheStore.clearByPrefix(`${folderName}::`)
```

This requires either iterating and deleting matching keys, or storing a
set of keys per folder in a separate IDB entry. The simpler approach:
don't evict on disconnect at all. Each entry's key is scoped to the folder
name; a different folder (even a new folder with the same name, e.g.
after deleting and recreating the OneDrive folder) will have different file
contents and different `lastModified` values, so cache misses fire
naturally. The old entries are dead weight in IDB but never served.

We can add a periodic prune (on connect, delete entries older than 30
days by `cachedAt` field) in Phase 2 if IDB size becomes an issue.
For JSON entities this is unlikely -- a large lab folder is ~5MB of JSON.

---

## 9. Implementation plan

### Phase 1 — Read-through cache (high impact, low risk)
Files changed:
- `frontend/src/lib/file-system/indexeddb-store.ts` — version bump to 2,
  add `file-cache` store, export `CacheStore` class with `get`, `put`,
  `delete` methods
- `frontend/src/lib/file-system/file-service.ts` — modify `readJson` and
  `readText` to check cache before reading bytes; modify `atomicWrite` to
  update cache after write

No changes needed to `file-system-context.tsx`, `local-api.ts`, any API,
or any component.

Verification: the read count displayed on the loading screen drops
dramatically on second connect. Add a log line: `[file-cache] HIT/MISS
for ${path}` behind a `NEXT_PUBLIC_DEBUG_FILE_CACHE=1` flag.

### Phase 2 — Reconnect sweep + manifest fast-path (medium impact)

**Prerequisite:** Phase 1 on main and validated in Grant's real folder.

Files changed:
- `frontend/src/lib/file-system/indexeddb-store.ts` — add
  `getManifestMtime(folderName)` + `setManifestMtime(folderName, mtime)`
  using `idb-keyval` (simple keyval pair, no schema change needed since
  IDB version bump already happened in Phase 1; the keyval store is
  separate from the raw IDB object stores)
- `frontend/src/lib/file-system/file-service.ts` — add
  `_manifestWritePending`, `_manifestDebounceTimer`, `scheduleManifestTouch()`,
  `touchManifest()`, `sweepAndInvalidate(knownUsers: string[])`, and
  `runConnectSweep(knownUsers: string[])` (the fast-path check + optional
  sweep driver); modify `atomicWrite` to call `scheduleManifestTouch()`
- `frontend/src/lib/file-system/file-system-context.tsx` — add
  `"warming-cache"` to the `LoadingStage` type; add three lines to
  `finishConnect`: `setState warming-cache`, `await fileService.runConnectSweep(users)`,
  error swallow

This is the most invasive phase (touches `file-system-context.tsx`).
Build in an isolated worktree. Verify TypeScript gate passes.
The loading screen must still show + advance stages correctly after the
change -- manual verification required (connect a real OneDrive folder
and watch the loading stages progress through "warming-cache" to connected).

### Phase 3 — Batch IDB reads for list operations (low impact)
Batch the per-file IDB lookups in `listFiles`-driven patterns (e.g. loading
all 80 tasks) into a single read transaction. Likely 5-10ms savings on a
warm cache; deprioritized until Phases 1 and 2 are measured.

### Phase 4 — Blob / image cache (medium impact, size-managed)
Files changed:
- `frontend/src/lib/file-system/indexeddb-store.ts` — add `image-cache`
  and `image-cache-budget` stores (DB version 3)
- `frontend/src/lib/file-system/file-service.ts` — modify `readFileAsBlob`
  and `writeFileFromBlob` to check/update IDB blob cache
- `frontend/src/lib/utils/blob-url-resolver.ts` — modify `getBlobUrl` to
  check IDB before calling `readFileAsBlob`; modify `revokePath` /
  `revokeAll` to evict from IDB too

---

## 10. Blob / image cache (Phase 4)

Images are included in this proposal but handled separately from JSON
because they need size management that JSON does not.

### The problem

`blobUrlResolver.getBlobUrl(path)` in `lib/utils/blob-url-resolver.ts`
has an in-memory `cache: { [path]: blobUrl }`. This is fast within a
session but resets on every tab reload -- every image on the page fires a
fresh `readFileAsBlob` FSA call on reload. On OneDrive, that's a potential
cloud download per image.

### How blob URLs work

`URL.createObjectURL(blob)` returns a session-scoped URL (e.g.
`blob:http://localhost:3000/uuid`). The URL is revoked when the page
closes or `URL.revokeObjectURL` is called. You cannot serialize blob URLs
to IDB -- you must store the raw `Blob` and create a new URL each session.

### The IDB blob cache

A third object store `image-cache` in the same DB:

```ts
interface BlobCacheEntry {
  key: string;          // "${folderName}::${path}"
  lastModified: number; // File.lastModified at cache time
  blob: Blob;           // the raw bytes (structured clone supports Blob)
  size: number;         // blob.size, for eviction budget tracking
  cachedAt: number;     // Date.now(), for LRU eviction
}
```

One companion entry tracks the total cached bytes per folder:

```ts
// key: "image-cache-budget::${folderName}"
interface BudgetEntry { totalBytes: number }
```

### Modified getBlobUrl path

```
getBlobUrl(path):
  1. check in-memory cache (existing fast path, unchanged)
  2. if miss: resolve FSA file handle, call getFile() for lastModified
  3. look up IDB image-cache entry by key
  4. if entry exists AND entry.lastModified === file.lastModified:
       blob = entry.blob                ← CACHE HIT, no FSA byte read
       update entry.cachedAt = now()    ← refresh LRU timestamp
  5. else: blob = fileService.readFileAsBlob(path)  ← CACHE MISS
       store blob in IDB (see eviction below)
  6. url = URL.createObjectURL(blob)
  7. store url in in-memory cache (existing behavior)
  8. return url
```

### Eviction policy

Max total: **150 MB** per folder. Individual file limit: **30 MB** (avoids
caching huge exports or video files). If adding a new blob would exceed
the 150 MB budget, evict the oldest entries by `cachedAt` until there's
room, then store the new entry.

The 7-day idea fits here naturally: entries with `cachedAt` older than
7 days are candidates for eviction first, before touching recently-accessed
entries. So the effective behavior is: images you opened in the last 7 days
are cached; older ones get evicted under budget pressure.

### Write-through for new images

After a successful `writeFileFromBlob` (Telegram inbox arrivals, drag-drop
uploads), update the blob cache the same way as JSON: re-read `lastModified`
after the atomic rename, store the blob in IDB. This means a freshly
uploaded image is in cache immediately -- the next render skips the FSA read.

### Integration with revokePath / revokeAll

When `blobUrlResolver.revokePath(path)` is called (e.g. after a file is
deleted), also evict the corresponding IDB entry and decrement the budget.
`revokeAll()` clears the budget entry too.

### What we are NOT doing

- **Service Worker cache.** No FSA API in service workers; not applicable.
- **React Query staleTime increase.** Bumping `staleTime` would hide
  collaborator changes. The file-service cache is the right answer.
- **JSON eviction.** JSON entities are tiny (~5 MB for a large folder).
  No LRU or TTL for JSON; keep everything.

---

## 11. Open questions

1. **`_cache_manifest.json` write amplification.** Every write to any file
   also writes `_cache_manifest.json`. On a high-frequency write path
   (e.g. Loro CRDT updates), this doubles writes. **Decision (2026-06-07):
   debounce at 500ms.** A 500ms window where the fast-path falsely skips
   the sweep is acceptable; the per-file metadata check in the hot path
   still catches any stragglers.

2. **IDB version bump coordination.** The existing `initDB()` opens
   `research-os-fsa` at version 1. Adding the `file-cache` store requires
   bumping to version 2 in `onupgradeneeded`. This is a one-time migration;
   existing users won't lose anything (the old `handles` store is preserved).
   Just needs careful handling of the upgrade callback.

3. **`directoryHandle.name` is not globally unique.** Two users with
   OneDrive folders both named "ResearchOS" would share a cache key
   namespace. In practice this only matters if the same browser profile is
   used with two different OneDrive accounts and two same-named folders
   (rare). If it becomes a real problem, we can scope by
   `folderName + grantedAt` (stored in the existing `-meta` key).

4. **Cache coherence on the Loro / CRDT write path.** Loro writes binary
   blobs to disk (`.bin` files), not JSON. Those go through `writeFileFromBlob`,
   which is excluded from Phase 1. The Loro JSON sidecars that do exist
   (the notes store) go through `writeJson` and ARE cached. No coherence
   issue expected.
