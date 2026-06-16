# ROR canonical institution registry (social layer)

Date: 2026-06-16
Branch: `social/institution-registry-ror` (off `origin/main`, NOT pushed, NOT merged)
Lane: INJEST / social layer. Scope-isolated from Popup Unifier's directory tree.

## What this solves

`/institution/[slug]` was derived purely on the fly from verified email domains.
The slug IS the verified domain (e.g. `wisc.edu`), so the page heading showed a
raw/humanized slug rather than the real institution name, and sibling domains
(`cals.wisc.edu`, `g.wisc.edu`, `wisc.edu`) were treated as separate
institutions. This adds a pre-seeded canonical registry, derived from ROR, that
gives (1) clean display names and (2) domain -> canonical clustering. Lazy
reveal is unchanged: a page still only shows members who actually listed that
domain (that logic lives in Popup's directory read, untouched here).

## Source + license (ROR, CC0)

- Data: Research Organization Registry (ROR), <https://ror.org>.
- License: CC0 1.0 Universal (public domain dedication). Free to redistribute;
  we still credit ROR as the source in the build script header, the asset
  `meta`, and this doc.
- Distribution: versioned zip of one large JSON array on Zenodo, concept DOI
  `10.5281/zenodo.6347574` (always redirects to the latest release).
- Release ingested: **v2.8-2026-06-02** (resolved live from the concept DOI on
  2026-06-16).

## Files added / changed

Added:
- `frontend/scripts/build-institution-registry.mjs` - build/normalization
  pipeline (download + parse + cluster + emit). Node, no deps.
- `frontend/scripts/upload-institution-registry.mjs` - gzips the built asset and
  PUTs it to R2 (the prod hosting path; see Ops below).
- `frontend/src/lib/social/institution-registry.ts` - the async resolver
  (fetches the registry from R2 once, caches in module scope).
- `frontend/src/lib/social/__tests__/institution-registry.test.ts` - unit tests.
- `docs/handoffs/2026-06-16-ror-institution-registry.md` - this doc.

HOSTING (changed from the first draft): the ~28 MB asset is NOT committed to git
and NOT served from `public/` (Vercel functions cannot fs-read `public/`, and a
28 MB blob would bloat git history forever). It lives on Cloudflare R2 (the same
bucket + `R2_*` creds the relay already uses) at key
`institution-registry/current.json.gz` (~5.9 MB gzipped). The resolver fetches +
gunzips + caches it server-side. The build script still writes the raw JSON to
`public/institution-registry.json` locally as the build artifact, but that path
is gitignored and only used as the upload source.

Changed (social lane only):
- `frontend/src/app/institution/[slug]/page.tsx` - server component now resolves
  the canonical name for `<title>` + passes it to the client profile as a prop.
- `frontend/src/components/social/InstitutionPublicProfile.tsx` - accepts a
  `registryName` prop and uses it in the name fallback chain.

NOT touched (Popup Unifier's tree, by hard scope boundary):
`frontend/src/lib/sharing/**`, `frontend/src/app/api/directory/**`,
`frontend/src/lib/account/**`.

## Registry schema

`public/institution-registry.json`:

```jsonc
{
  "meta": {
    "source": "Research Organization Registry (ROR), https://ror.org",
    "license": "CC0 1.0 Universal (public domain dedication)",
    "rorRelease": "v2.8-2026-06-02",
    "generatedAt": "2026-06-16T...Z",
    "orgCountInDump": 127138,
    "activeOrgs": 124575,
    "orgsWithDomain": 121619,
    "orgsSkippedNoDomain": 2956,
    "domainCount": 116153,
    "cap": null            // null = FULL run, no cap
  },
  "byDomain": {
    "wisc.edu": {
      "domain": "wisc.edu",
      "canonicalName": "University of Wisconsin-Madison",
      "rorId": "https://ror.org/01y2jtd41",
      "country": "United States",
      "aliases": ["UW", "UW-Madison", ...],
      "clusterDomains": ["cimss.ssec.wisc.edu", "ssec.wisc.edu", "wgnhs.wisc.edu", "wisc.edu", "wisconsin.edu", ...]
    }
  }
}
```

`clusterDomains` = the org's own domains UNION the domains of each one-hop
parent/child/related org from ROR relationships, plus the registrable reduction
of subdomains. So one institution page can aggregate all its verified
subdomains.

## Ingested counts (FULL, no cap)

- 127,138 organizations in the dump.
- 124,575 active organizations indexed.
- **121,619 active orgs with at least one website domain -> 116,153 unique
  domain keys** in the registry.
- 2,956 active orgs skipped (no domain or website link).

The FULL dump was downloaded and processed in-sandbox (33 MB zip / 285 MB JSON),
so there is **no cap** on this run (`meta.cap` is `null`). The `--limit N` flag
exists for testing and would set `meta.cap`; it was not used for the committed
asset.

### Domain keying + collision policy (how names stay correct)

Each org contributes its curated `domains[]` and the hosts of its `website`
links, plus the registrable reduction of each (academic multi-suffix aware, so
`cs.ox.ac.uk` -> `ox.ac.uk`, not `ac.uk`). On a domain-key collision the winner
is deterministic by score (lower wins):
`score = tier*100 + parentPenalty*10 + typeRank`
- tier: 0 = exact literal host, 1 = registrable-derived from a subdomain.
- parentPenalty: 0 = top of its ROR hierarchy, 1 = has a parent org.
- typeRank: education 0, facility/archive 1, else 2.

This makes the parent University win the bare `wisc.edu`/`mit.edu`/`cam.ac.uk`
key over sub-institutes that merely link or sub-domain it. Verified across
wisc/mit/stanford/cam/ox/harvard/berkeley.

## Regenerating (full set)

```sh
# Auto-resolve + download the latest ROR release from Zenodo, then build:
node frontend/scripts/build-institution-registry.mjs --download

# Or build from an already-extracted dump:
node frontend/scripts/build-institution-registry.mjs --in /path/to/ror-data.json

# Optional flags:
#   --limit N   cap orgs processed (testing); sets meta.cap
#   --out PATH  write somewhere other than public/institution-registry.json
```

Node may need `--max-old-space-size=4096` for the full 285 MB JSON.

## Resolver API (`@/lib/social/institution-registry`)

Pure, server-side only. Reads the static asset once via `node:fs`, caches it in
module scope. No DB, no network at request time. Importing it from a client
component fails the build (the `node:fs` guard), which is intended.

- `resolveInstitution(slugOrDomain: string): InstitutionRecord | null`
  - Unknown domain -> `null` (caller falls back to `humanizeInstitutionSlug`).
- `normalizeInstitutionSlug(input: string): string`
  - Lowercase/trim, strips scheme/www/path/query/port, keys on the domain of an
    email-shaped input. Returns `""` for junk.
- `clusterDomainsFor(domain: string): string[]`
  - All domains for the same org incl. the queried one, sorted+deduped. Unknown
    domain -> `[normalized(domain)]`; empty input -> `[]`. Always safe to
    `IN()`-filter against.
- `__setRegistryForTests(reg | null)` - test seam (inject a fixture / reset).

`InstitutionRecord = { domain, canonicalName, rorId, country, aliases[], clusterDomains[] }`.

## Social-lane wiring + name precedence

Name precedence at render is preserved as **endpoint name > registry name >
humanized slug**:
- `page.tsx` (server) resolves `resolveInstitution(slug)?.canonicalName` for the
  `<title>`/metadata and passes it to the client profile as `registryName`.
- `InstitutionPublicProfile.tsx` (client) computes
  `displayName = inst?.name ?? registryName ?? humanizeInstitutionSlug(slug)`.
  `inst?.name` is the live endpoint name (wins when Popup returns one).

The registry asset is server-only, so the resolver is NOT imported into the
client component; the resolved name is passed down as a prop. The public-search
result chips intentionally still show the raw `verifiedDomain` (a verification
trust signal, not an institution-name display) and were left unchanged.

Flag gating is byte-identical: the page still `notFound()`s when
`NEXT_PUBLIC_SOCIAL_LAYER` is off, so the registry only enriches names when the
social pages render.

## Popup Unifier contract (the ONE change for cluster aggregation)

Popup owns `frontend/src/lib/sharing/directory/db.ts`. To make a single
institution page aggregate all its verified subdomains, expand
`getInstitutionByDomain(domain)` from `= $domain` to
`= ANY(await clusterDomainsFor($domain))` by importing the resolver. No schema
change. The resolver is ASYNC now (it fetches the registry from R2 and caches
it in module scope), and `getInstitutionByDomain` is already async, so this is
one `await`. Exact contract:

- Import: `import { clusterDomainsFor } from "@/lib/social/institution-registry";`
- Signature: `clusterDomainsFor(domain: string): Promise<string[]>`
  - Returns the queried domain plus every sibling/parent/child domain for the
    same ROR org, sorted + deduped, all lowercased. Unknown domain OR R2
    unreachable -> `[domain]` (so behavior is unchanged for domains ROR does not
    know, and it degrades safely if R2 is down).

Sketch (inside `getInstitutionByDomain`, replacing the single-domain filter):

```ts
const domains = await clusterDomainsFor(domain); // ["cals.wisc.edu","wisc.edu",...]
const rows = (await sql`
  SELECT p.fingerprint, p.display_name, p.affiliation, p.affiliation_domain, p.orcid
  FROM directory_profiles p
  WHERE p.unlisted = false
    AND lower(p.affiliation_domain) = ANY(${domains})
  ORDER BY lower(p.display_name)
`) as Array<{ ... }>;
```

Notes for Popup:
- `clusterDomainsFor` already lowercases, so compare against
  `lower(affiliation_domain)`. Postgres `= ANY($array)` is the clean expansion
  of `IN (...)` for a JS string array (the project uses the `postgres` tagged
  template, which binds arrays for `ANY`).
- The resolver is async + server-side; it fetches the registry from R2 once and
  caches it, never touches the DB, so importing it introduces no cycle into the
  directory layer. The optional `resolveInstitution(domain)` for the canonical
  name is likewise async (`(await resolveInstitution(domain))?.canonicalName`).
- The current canonical-name pick in `getInstitutionByDomain`
  (`name = canonicalDomain`) can optionally be upgraded to
  `resolveInstitution(domain)?.canonicalName ?? canonicalDomain`, but that is
  optional - the social page already prefers the registry name client-side, and
  the endpoint name still wins when present.

## Ops: building + uploading the asset to R2

The resolver reads `institution-registry/current.json.gz` from R2. To populate or
refresh it (e.g. on a new ROR release), run with the prod `R2_*` creds present:

```sh
cd frontend
# 1. Build the asset from the latest ROR dump (writes public/institution-registry.json, gitignored)
node scripts/build-institution-registry.mjs --download
# 2. Gzip + upload it to R2 (key: institution-registry/current.json.gz)
node scripts/upload-institution-registry.mjs
```

(If the built JSON is already on disk, step 2 alone is enough.) The resolver
swaps to the new data on its next cache load; no redeploy required. Env needed:
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Quality gates

- `pnpm install --frozen-lockfile --prefer-offline` - clean.
- `pnpm exec tsc --noEmit` - **0 errors**.
- `pnpm exec vitest run src/lib/social/__tests__/institution-registry.test.ts` -
  **13 passed** (async resolver tests; existing social suites green).
- Client-bundle safety: only `page.tsx` (server) + the module itself + its test
  import the resolver; no `"use client"` file does.
- Pre-existing unrelated failure: `src/lib/sharing/__tests__/note-dependencies.test.ts`
  has 2 failures on clean `origin/main` too (not caused by this branch, and that
  file is untouched here).

## Notes / follow-ups

- ROR's curated subdomain coverage is partial. E.g. `cals.wisc.edu` is NOT in
  ROR, so it resolves to `null` (-> humanize fallback) even though `wisc.edu`
  resolves. That is correct/expected: the registry only knows domains ROR
  published. Member verification + lazy reveal are unaffected.
- The asset is ~28 MB raw / ~5.9 MB gzipped, hosted on R2 (not git, not the
  function bundle), fetched + cached once per server process. Cold starts pay one
  ~6 MB R2 GET; every request after is served from the in-memory cache. A failed
  fetch (e.g. before the asset is uploaded) is NOT cached, so the next lookup
  retries and picks the asset up without waiting for an instance recycle.
