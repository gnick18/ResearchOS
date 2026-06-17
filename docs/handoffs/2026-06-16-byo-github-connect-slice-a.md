# BYO GitHub-connect, Slice A (lab-domains, social lane)

Date: 2026-06-16
Branch: `social/byo-github-connect` (committed, NOT pushed)
Flag-gated: `LAB_SITES_ENABLED` + `LAB_BYO_SITES` (server) / `NEXT_PUBLIC_LAB_SITES` +
`NEXT_PUBLIC_LAB_BYO_SITES` (client), all default OFF. App byte-identical when off.

## What this adds

BYO ("bring your own") lab static sites already let a lab upload a ZIP of its own
static site, which we unzip, sanitize, store to R2, and serve at
`<labSlug>.research-os.com`. This slice adds a SECOND source for the exact same
pipeline: connecting a PUBLIC GitHub repo (the lab's paper-companion repo) so the
repo becomes the hosted site, with a manual "Sync now" to re-pull.

Slice A is maximally autonomous: PUBLIC repos only, no GitHub App / OAuth, no
webhook. A public repo's zipball downloads without auth.

## How it reuses the BYO upload path

The whole point is that a connected repo is held to the SAME security + validation
bar as a manual upload. The only thing that differs is the SOURCE of the file
entries:

- Manual upload: `unzipSync(requestBody)` -> entries.
- GitHub connect: download the repo ZIPBALL
  (`https://api.github.com/repos/{owner}/{repo}/zipball/{ref}`, which 302s to
  codeload.github.com) -> `unzipSync` -> STRIP GitHub's single top-level
  `{repo}-{sha}/` wrapper folder (+ an optional configured subdir) -> entries.

From there BOTH sources converge on the identical tail:
`validateByoEntries(entries)` (zip-slip sanitize every path + caps + require a root
`index.html`) -> `deleteByoSite(fragment)` (replace prior) -> `putByoFile` each file
to the lab's R2 BYO prefix -> `upsertByoSite` manifest -> `setHostedAssetBytes`
(billing, read-only). A single bad entry hard-fails the whole sync, so nothing is
partially stored. Serving is UNCHANGED: the existing `byo/serve` route serves
whatever is in the lab's BYO R2 prefix + manifest.

## Files

New:
- `frontend/src/lib/social/lab-byo-github.ts` — the source client. SSRF charset
  validation (`isSafeOwner/Repo/Ref`, `normalizeSubdir`, `parseGithubConnection`),
  `zipballUrl` (hard-coded host), the PURE `stripZipballPrefix` (wrapper folder +
  subdir strip, unit-testable), and the IO edge `pullGithubZipball`
  (download + unzip + strip, with caps + optional `GITHUB_TOKEN`).
- `frontend/src/app/api/social/lab-site/byo/github/route.ts` — `POST` with
  `action: connect | sync | disconnect`, and `GET` to read the recorded connection.
  Fail-closed Phase-3a authz IDENTICAL to the upload route (flag -> session ->
  authorizeWrite(target===caller) -> entitled -> site exists -> R2 configured).
- `frontend/src/lib/social/__tests__/lab-byo-github.test.ts` (pure: strip + SSRF).
- `frontend/src/lib/social/__tests__/lab-byo-github-route.test.ts` (route authz +
  the pulled-set-runs-through-validateByoEntries proof; mocks fetch/R2/Billing/db).

Changed:
- `frontend/src/lib/social/lab-byo-db.ts` — new `lab_byo_github` table
  (owner/repo/ref/subdir + last-synced sha/at, one row per lab) with
  `ensureLabByoGithubSchema`, `getByoGithubByOwner`, `upsertByoGithub`,
  `recordByoGithubSync`, `deleteByoGithubRow`. Existing `lab_byo_sites` untouched.
- `frontend/src/components/social/LabSiteDashboard.tsx` — a flag-gated
  "Connect a GitHub repo" section (owner/repo + branch + optional subdir +
  Connect/Sync now/Disconnect), alongside the existing zip-upload section.
- `frontend/.env.example` — registered the lab-sites + BYO flags (slice 1 never
  did) and the new optional `GITHUB_TOKEN`.

## Security

- SSRF: the ONLY hosts ever fetched are `api.github.com` (hard-coded) and the
  `codeload.github.com` redirect it issues. owner/repo/ref are charset-validated
  BEFORE interpolation (`isSafeOwner/Repo/Ref`), so `../`, a slash-injected segment,
  or a full `https://evil/` URL can never redirect the fetch off GitHub. The
  connection is re-validated in `pullGithubZipball` (defense in depth) and again on
  every `sync` from the stored row.
- Zip-slip: every pulled entry goes through the SAME `sanitizeZipEntryPath` /
  `validateByoEntries` the upload uses. A traversal entry in a malicious repo
  hard-fails the whole sync (tested: `bad-entry` reason, nothing stored).
- Caps: reuses `BYO_MAX_TOTAL_BYTES` / `BYO_MAX_ENTRY_COUNT`. A Content-Length over
  the cap short-circuits before buffering; the unzipped total is the real gate.
- Never partial: store happens only after validation passes; `deleteByoSite`
  replaces the prior site before storing the fresh pull.
- `GITHUB_TOKEN` is OPTIONAL. Present -> sent as a Bearer token (raises the 60/hr
  unauth rate limit; private-repo hook later). Absent -> public repos still work.

## Deferred (NOT in this slice)

- GitHub App install + OAuth (needed for PRIVATE repos).
- Webhook auto-sync on push (Slice A sync is MANUAL "Sync now").
- Any per-file diffing / incremental sync (we replace-then-store the whole site).

## Gates run

- `pnpm install --frozen-lockfile --prefer-offline` clean.
- `pnpm exec tsc --noEmit` -> 0 errors.
- New tests: 37 passing (2 files). Full social suite: 239 passing (18 files).

## How Grant tests with a public repo link

1. Set in `.env.local`: `LAB_SITES_ENABLED=true`, `NEXT_PUBLIC_LAB_SITES=1`,
   `LAB_BYO_SITES=true`, `NEXT_PUBLIC_LAB_BYO_SITES=1`. R2_* + DATABASE_URL must be
   configured (same as the upload flow). `GITHUB_TOKEN` optional.
2. Sign in as a paid-lab account, claim a slug on the lab-site dashboard.
3. In "Connect a GitHub repo", enter a PUBLIC repo that has an `index.html` at its
   root (or in a subfolder you put in the subfolder box), branch `main`, and click
   "Connect and pull". A good test repo is any small static-site repo, e.g. one with
   a top-level `index.html`. The card shows files synced + the resolved short sha.
4. Push a change to that repo, then click "Sync now" to re-pull.
5. Visit `<slug>.research-os.com` (or the serve route with `?slug=` locally) to see
   the hosted site. Disconnect forgets the connection but leaves the live files.
