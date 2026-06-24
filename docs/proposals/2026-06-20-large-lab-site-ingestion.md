# Large lab-site ingestion (raising the BYO 50 MB cap)

Status: DESIGN ONLY (no product code in this change). Decision doc for hosting large
BYO ("bring your own") lab sites.
Date: 2026-06-20
Author: large-site design-agent
House style: no em-dashes, no emojis, no mid-sentence colons. The mascot is BeakerBot.

Related code (read, not modified):
- frontend/src/lib/social/lab-byo.ts (caps + validation + manifest)
- frontend/src/lib/social/lab-byo-github.ts (GitHub pull + unzip)
- frontend/src/app/api/social/lab-site/byo/github/route.ts (connect/sync pipeline)
- frontend/src/app/api/social/lab-site/byo/route.ts (zip upload pipeline)
- frontend/src/app/api/social/lab-site/byo/serve/route.ts (public serve path)
- frontend/src/lib/social/lab-site-asset-store.ts (R2 put/read/delete)
- frontend/src/lib/social/lab-repo-classify.ts (site vs tool, pagesEnabled)
- frontend/src/lib/collab/server/db.ts (setHostedAssetBytes metering)

Related docs:
- docs/proposals/2026-06-16-lab-domains-companion-sites.md (origin + companion-site context)
- docs/proposals/2026-06-19-lab-site-network-presence.md (lab-site presence context)

---

## 1. Problem statement

A real lab wants to host its companion site and cannot. The motivating case is
gnick18/FungalICS_Website, a 434 MB repo (a SupVideo1.mov plus Data/ and Images/
directories). The connect flow rejects it. Today every BYO site is capped at 50 MB
of unzipped bytes.

This cap is NOT an R2 storage limit. R2 scales cheaply into the TB range and the
serve path already streams one object at a time (`readByoFile` ->
`Body.transformToByteArray`, lab-site-asset-store.ts:210). The cap is an artifact of
how we INGEST the archive, and the real ceiling is serverless function RAM.

### 1.1 Where the cap lives

`BYO_MAX_TOTAL_BYTES = 50 * 1024 * 1024` (lab-byo.ts:70). It is enforced in three
places, all of which assume the whole archive is in memory:

- `validateByoEntries` sums `entry.bytes.byteLength` across every unzipped entry and
  fails with "too-large" past the cap (lab-byo.ts:567). By the time this runs the
  entire archive is already decompressed into RAM.
- The zip upload route buffers the whole request body with
  `await request.arrayBuffer()` (byo/route.ts:113), then `unzipSync(zipBytes)`
  decompresses every file into a `Record<string, Uint8Array>` held in memory
  (byo/route.ts:127).
- The GitHub connect route does the same, `await res.arrayBuffer()` on the full
  zipball (lab-byo-github.ts:339) then `unzipSync(zipBytes)` (lab-byo-github.ts:351).

### 1.2 Why the memory blows up

The ingestion is fully buffered, twice over.

1. The COMPRESSED archive is held whole. `res.arrayBuffer()` /
   `request.arrayBuffer()` materializes the entire zip into one contiguous buffer.
2. The DECOMPRESSED files are then held whole. `unzipSync` from fflate returns every
   entry's bytes at once in a map, so peak memory is roughly the compressed size PLUS
   the full uncompressed size PLUS a transient copy on each R2 PUT
   (`bytes.slice()`, lab-site-asset-store.ts:189).

For a media-heavy site the uncompressed total dominates and is barely smaller than
the download (a .mov is already compressed). A 434 MB repo would need on the order of
800 MB to 1 GB of live heap, before V8 overhead. A Vercel serverless function has
roughly 1 to 3 GB depending on configuration, so 50 MB is a deliberately conservative
guard against OOM, not a product decision.

### 1.3 The codeload no-Content-Length gap

The early size guard is a Content-Length check before buffering (lab-byo-github.ts:329
for GitHub, byo/route.ts:102 for upload). For a GitHub zipball this guard is
unreliable. `api.github.com/.../zipball/<ref>` 302-redirects to codeload.github.com,
which generates the archive ON THE FLY and streams it with chunked transfer encoding
and NO Content-Length header. So `res.headers.get("content-length")` is usually null
for a real GitHub pull, the early guard is skipped, and the only thing that stops a
giant download is `res.arrayBuffer()` succeeding or the function OOM-ing first. The
post-buffer `zipBytes.byteLength > BYO_MAX_TOTAL_BYTES` check (lab-byo-github.ts:345)
only fires AFTER the whole thing is already in memory, which is exactly the moment we
were trying to avoid. The zip UPLOAD path is better off here because the browser sets
a real Content-Length, so its early guard at byo/route.ts:102 does work.

Net: for the GitHub path there is effectively no pre-buffer ceiling today other than
the function dying.

---

## 2. Approach A, stream-unzip directly to R2

Goal: never hold the whole archive in memory. Decompress entry by entry from the
response stream and pipe each file straight to R2 as it is read, so peak memory is
one entry plus a small window, not the whole site.

### 2.1 The honest complication, zip has its index at the end

A ZIP file's authoritative directory (the central directory) lives at the END of the
file. A pure forward stream sees each local file header inline before its data, so
naive forward streaming IS possible, but it cannot trust the central directory for
sizes or detect entries that use a data descriptor (sizes written AFTER the
compressed data) without buffering. fflate's `unzipSync` sidesteps this by having the
whole buffer. A streaming reader has to commit to the local-header path and handle
data-descriptor entries carefully. This is a real constraint, not a footnote.

Three workable shapes, in rough order of preference:

OPTION A1, stream the TARBALL instead of the zipball (preferred for GitHub).
GitHub also serves `/repos/{owner}/{repo}/tarball/{ref}` from codeload. A gzipped tar
is a forward-only format by design, member header then member bytes, no end index.
This is the natural streaming source. Pipe the response through a gunzip transform
(Node `zlib.createGunzip` or Web `DecompressionStream("gzip")`), then through a tar
entry parser (for example `tar-stream` in Node), and for each entry pipe its bytes
straight into an R2 PutObject. fflate also exposes a streaming gunzip if we want to
stay on the existing dependency. This only helps the GitHub path, but that is the
motivating case (FungalICS_Website is a GitHub repo).

OPTION A2, streaming ZIP entry parser for the upload path. For the manual zip upload
(no tarball available) use a forward streaming unzip such as fflate's `Unzip` /
`AsyncUnzip` push API, or an `unzip-stream` style parser, which emits entries as the
bytes arrive and lets us pipe each entry to R2. We accept the central-directory
caveat above and rely on local headers, which is the same trust model the current
`unzipSync` already implicitly extends to a single uploaded archive.

OPTION A3, two-pass HTTP Range. Fetch only the tail of the zip with a Range request
to read the central directory, then issue per-entry Range fetches for each file's
compressed bytes and inflate them one at a time. This keeps zip semantics and bounded
memory but needs the source to support Range and Content-Length. codeload does NOT
(no Content-Length, on-the-fly generation), so A3 is viable for an uploaded-to-R2
zip we control, not for the live GitHub pull. Lower priority.

Recommendation within A, do A1 for GitHub (tarball stream) and A2 for upload
(streaming zip parser). They share the same downstream "per-entry to R2" sink.

### 2.2 The per-entry pipeline

For each decompressed entry, as it streams:

1. Sanitize the path with `sanitizeZipEntryPath` (lab-byo.ts:102) BEFORE any byte is
   written. A rejected path aborts the whole ingest (no partial site).
2. Skip benign noise with `isBenignSkippableEntry` (lab-byo.ts:593).
3. Enforce per-entry and running-total caps as the bytes flow (sections 2.4, 6).
4. Stream the entry body into an R2 PutObject for `byoFileKey(fragment, relPath)`. The
   AWS SDK PutObject accepts a stream Body, so we never hold the full file. For very
   large single files we use the S3 multipart upload API so one file never needs to
   be fully buffered either.
5. Accumulate the manifest entry (path + byte count) in memory. The manifest is
   metadata only and already capped at `BYO_MAX_MANIFEST_BYTES` (lab-byo.ts:434), so
   it stays small even for thousands of files.

After the stream completes, write the manifest (`upsertByoSite`) and report bytes
(`setHostedAssetBytes`), exactly as the current routes do at byo/route.ts:172 and
:184. The "delete old site first" step (`deleteByoSite`, lab-site-asset-store.ts:235)
still runs up front so a re-sync never leaves orphans, unchanged.

### 2.3 Where the new ceiling sits

With streaming, peak RAM is bounded by the largest in-flight entry plus a small
buffer window, not the site total. The new ceiling becomes:

- FUNCTION EXECUTION TIME. Vercel functions default to a 300 s max on the relevant
  plan. At a realistic 20 to 50 MB/s R2 PUT throughput, 300 s comfortably covers
  multiple GB. The FungalICS 434 MB case finishes in tens of seconds.
- R2 PUT THROUGHPUT and request count, not memory. Many tiny files cost request
  overhead, so the existing `BYO_MAX_ENTRY_COUNT = 2000` (lab-byo.ts:73) still
  matters and should stay.

So Approach A raises the practical ceiling from 50 MB to low-single-digit GB, gated
by the function timeout rather than RAM. We set a new explicit byte cap well under
the time budget (proposed 2 GB, section 6) so a runaway never silently consumes the
whole 300 s.

### 2.4 Security holds per entry

Every guarantee the pure core gives today must hold DURING the stream, not after.

- Zip-slip, `sanitizeZipEntryPath` runs per entry before the R2 write
  (lab-byo.ts:102). A single bad entry aborts the whole ingest, matching the current
  "one bad entry fails the whole upload" rule (validateByoEntries, lab-byo.ts:559).
  Because we now write incrementally, an abort must DELETE anything already written
  for this ingest, so reuse `deleteByoSite(fragment)` on failure (we already call it
  up front, call it again on abort).
- SSRF, the tarball/zipball fetch still goes only to the hard-coded GitHub hosts via
  the existing `isSafeOwner` / `isSafeRepo` / `isSafeRef` validation and
  `zipballUrl`-style URL building (lab-byo-github.ts:62 to 170). The new tarball URL
  uses the identical guard, just `/tarball/` instead of `/zipball/`.
- Content-Type, still chosen per extension by `contentTypeForPath` (lab-byo.ts:174),
  and the serve route keeps `nosniff` (serve/route.ts:55), so the streaming change
  never alters how bytes are served.
- A streamed entry whose declared size and actual bytes disagree must be rejected, so
  the cap is enforced on bytes ACTUALLY read, not on a header-declared size.

### 2.5 Cost and effort

This is the heaviest lift. It touches the IO edge of both routes and adds a streaming
tar/zip dependency. It does not change the pure core (lab-byo.ts), the manifest, the
serve route, or the security model, which is the point. It is Phase 2, not Phase 1.

---

## 3. Approach B, GitHub Pages zero-copy proxy

Goal: for repos that already publish via GitHub Pages, do not copy anything. Point
`<slug>.research-os.com` at the live Pages site.

We already detect this. `classifyRepo` short-circuits to "site" when
`pagesEnabled` is true (lab-repo-classify.ts:121), and `fetchPagesEnabled`
(lab-byo-github.ts:452) tells us at connect time. So the connect route can branch a
third way, "pages", alongside "site" and "tool" (route.ts:288).

### 3.1 Two sub-shapes

B1, REDIRECT. The serve route 302/308s `<slug>.research-os.com/<path>` to
`https://<owner>.github.io/<repo>/<path>`. Cheapest, but the public URL changes in
the address bar, which loses the lab-branded domain and the citation-stable URL that
the whole lab-domains arc is built around (docs/proposals/2026-06-16). Weak.

B2, REVERSE PROXY. The serve route fetches the Pages URL server-side and streams the
response back under the lab subdomain, so the URL stays `<slug>.research-os.com`. This
preserves branding and citation stability. It is a true zero-copy hot path, always in
sync with the repo, no size limit at all.

### 3.2 Tradeoffs

- Uptime dependency. The lab site is now only as available as GitHub Pages. Our other
  BYO sites survive a GitHub outage because the bytes are in R2. A proxied site does
  not.
- Cert and custom-domain story. Pages can itself hold a custom CNAME. Proxying our
  subdomain in front of Pages is fine for the default `*.github.io`, but a repo with
  its own CNAME set (a strong site signal we even classify on, the "cname" marker at
  lab-repo-classify.ts:84) may redirect or mismatch certs. Needs handling.
- Loss of sandbox isolation. Today BYO bytes live on research-os.com, a DIFFERENT
  registrable domain from the app (lab-byo.ts:8), so untrusted lab JS is cookie
  isolated by construction. A reverse proxy serving github.io content under OUR
  subdomain reintroduces "untrusted third-party HTML served from our origin" unless
  we keep the same nosniff / no-cookie / X-Frame-Options DENY response posture the
  serve route already sets (serve/route.ts:48). The proxy MUST strip any Set-Cookie
  from the upstream and never forward app cookies, same rule as the serve route
  header note (serve/route.ts:15).
- Metering. A proxied site stores zero bytes in R2, so `setHostedAssetBytes` would
  report 0 and the lab pays nothing for hosting. That may be correct (we are not
  storing it) or may want a flat "hosted site" line. A pricing call (section 6).
- Interaction with the serve route. The route resolves the lab by slug then reads the
  manifest (serve/route.ts:84 to 103). A proxied lab has no manifest, so the route
  needs a "this lab is proxy-backed" branch that reads the recorded Pages target
  instead of R2.

### 3.3 Verdict

B2 is an attractive FAST PATH for the subset of labs already on Pages (and it is the
always-in-sync dream), but it is a different operational risk profile (external
uptime, proxy hardening) and should land AFTER the streaming path, not instead of it.
Not every large site uses Pages (FungalICS_Website itself may or may not). Phase 3.

---

## 4. Approach C, lean-site guidance and exclusions

Goal: even with streaming, a 200 MB video committed into a website repo is an
anti-pattern. Keep sites lean, and make the failure legible instead of silent.

This is the cheapest and most user-respecting change, and it is independent of A and B.

### 4.1 What it does

- DETECT oversized binaries during validation. Today `validateByoEntries` only knows
  "too-large" as a single aggregate verdict (lab-byo.ts:567). Add a per-entry
  size-class so the response can say "your site is mostly SupVideo1.mov (180 MB) and
  Data/ (90 MB), here is what we excluded" rather than a blank "too-large".
- WARN AND EXCLUDE rather than hard-fail. Optionally, host the web assets (HTML, CSS,
  JS, images under a sane per-file cap) and SKIP the huge media, with a clear message
  listing what was dropped and why, plus a suggestion (host the video on a video host
  and embed it, or move it out of the site folder).
- EXCLUDE GLOBS / SUBFOLDER. Let the lab specify exclude patterns (for example
  `Data/**`, `*.mov`) or, even simpler, lean on the EXISTING subdir feature. The
  GitHub connection already supports a `subdir` (lab-byo-github.ts:97,
  stripZipballPrefix re-roots to it, lab-byo-github.ts:227), so a lab whose site is in
  `site/` while datasets sit in `Data/` can point the connection at `site/` and never
  pull the data at all. This works TODAY with zero new code, it is just undiscovered.
  The UI win is surfacing it.

### 4.2 UI message

A connect/upload that trips the size guard should return a structured reason the
dashboard renders as guidance, not an error wall. Concretely, extend the 422 reason
beyond the current bare string (route.ts:123) to include the offending large entries
and a "set a subdir" or "exclude these" call to action. This satisfies the no-soft-
locks rule (agent memory feedback-no-soft-locks), the lab always has a visible way
forward.

### 4.3 Cost and effort

Cheap. The detection is a small addition to the pure core (a per-entry size list in
the validate result) plus dashboard copy. No streaming, no proxy, no infra. It is the
right Phase 1 companion to the graceful too-large error already in flight.

---

## 5. Recommendation, phased

Opinionated plan. Ship value early, raise the ceiling once, add the fast path last.

PHASE 1 (cheap, ship now). Graceful too-large handling plus lean-site guidance
(Approach C). Turn the bare "too-large" into structured guidance that names the big
files and points the lab at the subdir feature and exclude globs. Fix the codeload
no-Content-Length gap defensively by capping bytes-read during the stream even before
Phase 2 (a running counter on `res.body` that aborts past the cap, so a giant GitHub
pull fails fast instead of OOM-ing). Low risk, immediately better UX, and it makes
the current 50 MB limit honest instead of silent.

PHASE 2 (the real fix). Stream-unzip to R2 (Approach A), tarball stream for GitHub
(A1) and streaming zip parser for upload (A2), raising the ceiling to low-GB gated by
function time. This is where FungalICS_Website and friends actually become hostable.
Keep the pure core, manifest, serve route, and security model unchanged, only the IO
edge of the two routes changes.

PHASE 3 (fast path, optional). GitHub Pages reverse proxy (Approach B2) for the
subset of labs already on Pages, always in sync and zero storage. Land only after
Phase 2 and only with the proxy hardening in section 3.2.

Rationale, Phase 1 is days, helps every lab, and is reversible. Phase 2 is the
structural change that the motivating case needs. Phase 3 is a nice-to-have for a
specific subset and carries external-uptime risk, so it is last.

---

## 6. Caps and tiers

### 6.1 Should the bigger ceiling be tier-gated

Yes, propose gating the GB-scale ceiling, but keep a generous free-of-extra-charge
floor so normal sites just work.

- A modest bump (say 50 MB -> 250 MB) on the existing Lab plan, no extra charge. This
  covers the vast majority of real companion sites once a lab uses a subdir to keep
  datasets out.
- The GB-scale ceiling (proposed hard cap 2 GB) sits behind hosted-asset metering. We
  already meter BYO bytes as one asset via `setHostedAssetBytes(byoAssetId(ownerKey),
  ownerKey, totalBytes)` (route.ts:184, byoAssetId at lab-byo.ts:61), summed per lab
  by `getLabHostedBytes` (db.ts:269). So a large site is already PRICED by the
  existing pass-through storage meter, no new tier primitive needed. The decision is
  only where the FREE-included threshold sits before metered bytes kick in, which is
  a PRICING.md / assumptions.ts call for Grant, not a code default.

### 6.2 R2 cost at scale

R2 storage is cheap (roughly cost, the deliberate trust play, per the Model A pricing
note in AGENTS.md) and there are no egress fees, which is why the serve path is fine
streaming whole files publicly. The real cost levers are PUT request count (many
small files) and total stored bytes, both already captured, request count by
`BYO_MAX_ENTRY_COUNT` and bytes by the meter. A 2 GB hard cap plus the existing
30-day lapse-reclaim GC (referenced in AGENTS.md and lab-site-asset-store.ts:130
deleteAsset / Phase 4b) bounds the downside.

---

## 7. Security, no regressions

The streaming redesign must preserve every existing guarantee. None of these may
weaken.

- Zip-slip. `sanitizeZipEntryPath` (lab-byo.ts:102) runs per entry BEFORE any R2
  write, and a single rejected non-benign entry aborts the whole ingest (current rule
  at lab-byo.ts:559). Streaming makes "abort" require cleanup of partial writes, use
  `deleteByoSite` on abort.
- Serve-path probe guard. The serve route still requires the resolved path to be in
  the stored manifest (serve/route.ts:102), so a crafted `?path=` cannot read outside
  the lab's set. Unchanged.
- SSRF. The fetch still targets only hard-coded GitHub hosts with charset-validated
  owner/repo/ref (lab-byo-github.ts:62 to 170, 296 to 305). The tarball URL reuses the
  identical guard.
- Cookie isolation. Bytes still serve from research-os.com with no Set-Cookie, nosniff
  and X-Frame-Options DENY (serve/route.ts:48). A Phase 3 proxy MUST strip upstream
  Set-Cookie and keep the same posture.
- Cap enforcement on real bytes. With streaming, enforce caps on bytes ACTUALLY read
  from the decompressor, never on a self-declared header size, so a lying archive
  cannot bypass the cap.
- Decompression bomb. A small zip can expand enormously. The running-total byte cap
  during the stream (Phase 1 defensive counter, Phase 2 proper) is the bomb guard,
  abort the moment the running total crosses the cap, before the rest is read.

---

## 8. Open questions for Grant

1. FREE-INCLUDED SITE SIZE. Where does the no-extra-charge BYO site threshold sit
   (proposal, 250 MB included on Lab), and what is the hard ceiling (proposal, 2 GB
   metered)? This is an assumptions.ts / PRICING.md call, not a code default.

2. PHASE 1 BEHAVIOR ON OVERSIZE. When a site exceeds the included size, do we
   WARN-AND-EXCLUDE the huge files and host the rest (lean-site auto-trim), or
   HARD-FAIL with guidance and let the lab fix it (subdir / exclude globs)? Auto-trim
   is friendlier but silently changes their site, hard-fail is honest but more
   friction. Recommendation, hard-fail with named files plus a one-click "host
   anyway, excluding these" option.

3. PAGES PROXY (Phase 3) AT ALL. Do we want the GitHub Pages reverse proxy as a fast
   path, accepting the external-uptime dependency, or keep everything copied-to-R2 so
   a site survives a GitHub outage? Recommendation, build it, but last, and only B2
   (subdomain-preserving proxy), never B1 (redirect).

4. METERING A PROXIED SITE. If we do Phase 3, a proxied site stores 0 bytes in R2.
   Bill it as 0 (we store nothing) or attach a flat hosted-site line? Recommendation,
   bill 0, it matches the actual cost.

5. SUBDIR DISCOVERY UX. The subdir feature already solves most large-site cases for
   free (point at `site/`, skip `Data/`). Is surfacing it in the connect UI enough
   for Phase 1, or do we also want explicit exclude-glob input now? Recommendation,
   surface subdir in Phase 1, defer exclude globs.

6. FUNCTION TIMEOUT BUDGET. Confirm the Vercel plan's function max duration (300 s
   assumed). The GB ceiling is derived from it, so if the budget is lower the hard cap
   drops accordingly.
