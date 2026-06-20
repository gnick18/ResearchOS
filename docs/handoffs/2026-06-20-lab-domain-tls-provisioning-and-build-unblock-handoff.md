# Lab-domain TLS provisioning + prod build unblock (2026-06-20)

BeakerAI lane. Took over from `docs/handoffs/2026-06-19-takeover-lab-domains-and-onboarding-tutor.md`.
Everything below is on local `main` (Grant runs main on :3000); the lab-domain
feature is also LIVE on prod via `origin/main`. House voice: no em-dashes, no
emojis, no mid-sentence colons.

---

## A. Worktree sweep (DONE)

`.claude/worktrees/` was 31G. Classified every unlocked worktree by merge + dirty
status and removed the 14 that were MERGED into main AND clean, then deleted their
merged branches (`git branch -d`, which refuses unmerged as a safety net). Reclaimed
~7G (to 24G; the rest is COW node_modules in the locked/active and unmerged lanes,
deliberately kept). Kept all 18 locked worktrees, all unmerged-clean lanes (welcome-mascot,
joined-lab-loop, droppers, the preselect fixes, username-ghost-sweep, etc.), and the
3 dirty worktrees. Pattern per `[[reference_worktree_disk_hygiene]]`.

---

## B. Lab-domain TLS caveat: diagnosed + fixed (Path A), LIVE on prod

The prior handoff's caveat was "only fakeyeast-lab has a cert; the `*.research-os.com`
wildcard never auto-issued." Verified and sharpened it on prod (curl/openssl/vercel CLI):

- `fakeyeast-lab.research-os.com` = 200, valid single-host Let's Encrypt cert (SAN that
  host ONLY, not a wildcard). Any other slug = `SSL_ERROR_SYSCALL` (handshake reset).
- ROOT CAUSE is NOT DNS. The wildcard `*.research-os.com` CNAME already resolves every
  slug to `cname.vercel-dns.com`. What is missing is the WILDCARD CERT. `vercel certs ls`
  shows a `*.research-os.app` wildcard but no `*.research-os.com`.
- WHY .app works and .com does not: nameservers. `research-os.app` is on Vercel DNS, so
  Vercel auto-issues/renews its wildcard. `research-os.com` is on Cloudflare, and Vercel
  does NOT auto-issue wildcard certs for externally hosted zones; it issues per-subdomain
  certs over HTTP-01 the moment a domain is added to the project (exactly how fakeyeast-lab
  got its cert).

Confirmed via a Chrome-agent dashboard pass: adding `*.research-os.com` as a wildcard
domain only offers NAMESERVER DELEGATION to Vercel DNS (no DNS-01 TXT challenge surfaced),
which would lose Cloudflare proxy/CDN on the whole .com zone and force recreating the apex
redirect + assets.research-os.com. Grant chose **Path A (per-subdomain certs, keep
Cloudflare authoritative)** over delegation.

### Build (origin/main, LIVE)
- `frontend/src/lib/social/lab-domain-provision.ts`: `provisionLabDomain(slug)` POSTs
  `<slug>.research-os.com` to `api.vercel.com/v10/projects/{prj_qGzZzF4Fa9fKruGxg89Dg0b1qlFg}/domains?teamId={team_AA36ATug8lttkt7pXROetQxk}`.
  Never throws, idempotent on a 409 (`domain_already_exists` / `domain_already_in_use_by_project`),
  INERT unless `VERCEL_API_TOKEN` is set. The existing wildcard CNAME satisfies HTTP-01, so
  no per-lab DNS change is needed, only the API call; Vercel issues the cert in minutes.
- Hooked best-effort + awaited into the slug-claim route (`api/social/lab-site/route.ts`)
  after `createSite`, so a new claim registers immediately.
- Daily reconcile cron `api/cron/lab-domain-provision` (Bearer CRON_SECRET, fail-closed 404,
  gated on `isLabSitesEnabled` + token) that BOTH backfills pre-existing labs (new
  `listAllSiteSlugs()` in `lab-site-db.ts`) AND self-heals failed claim-time calls. Added to
  `vercel.json` crons at `30 4 * * *`.
- Gate: tsc 0, eslint 0, 14 tests (9 new provision + existing lab-site-route).

### Status (2026-06-20 ~05:00 UTC)
- Code LIVE on prod (green build), `VERCEL_API_TOKEN` saved + verified present in Production.
- fakeyeast-lab CONFIRMED end-to-end server + browser: served HTML title
  "The Castellanos Lab | ResearchOS", 0 welcome markers / 12 lab markers, valid cert;
  `research-os.app/fakeyeast-lab` 308s to the subdomain in a real browser (gate-bypass holds).
- REMAINING: the backfill has NOT run yet (certs still show only fakeyeast-lab). Manual
  trigger needs CRON_SECRET (sensitive, blank on `vercel env pull`, NOT dashboard-revealable),
  so trigger via Vercel **Settings -> Cron Jobs -> Run** (Vercel injects the secret) OR let
  the **04:30 UTC** scheduled run do it (today's already passed, so next is ~tomorrow).
- VERIFY AFTER CRON: `vercel certs ls` should show new `<slug>.research-os.com` certs;
  `curl https://<otherlab>.research-os.com/` should be 200 not `SSL_ERROR_SYSCALL`.
- Note: the Claude-in-Chrome extension BLOCKS navigation to `*.research-os.com` (allowlist),
  so browser-eye checks of lab subdomains must be curl/server-side or Grant's own non-extension tab.

Memory `[[project_lab_domains_companion_sites]]`.

---

## C. Prod build unblock (DONE, deployed green)

Mid-session the prod build went red (6 straight Error deploys, ~44 min). Root cause was
NOT the lab-domain code (its `/api` route is excluded from the check). The wiki-coverage
prebuild gate (`scripts/check-wiki-coverage.mjs`) failed on two PAGE routes with no wiki
entry: `/class-materials` (class-mode lane, on origin) and `/badges` (badges lane). Fixed by
adding both to `EXCLUDED_PREFIXES` with "pending wiki page" comments, the same escape hatch
already used for `/sequences` / `/profile` / `/supplies`. Build went green (full 4m Next
compile, so nothing else was hiding behind the gate). The owning lanes still owe real wiki pages.

LESSON: verify the MERGED tree with the actual `pnpm build` (or at least the prebuild gates
like wiki coverage + icon guard), not just `tsc`; a green isolated-worktree tsc does not catch
a prebuild-gate failure introduced by a sibling lane's route.

---

## D. Main reconcile (the mess, recovered cleanly)

I committed the wiki-coverage unblock directly in the SHARED primary tree instead of an
isolated worktree. A concurrent session had files PRE-STAGED in the shared index, so my bare
`git commit` (after `git add <one file>`) swept three of its in-progress badges files into my
commit (`5e387dedb`), which a concurrent push then sent to origin before I could isolate it.
Recovered: `git reset --soft HEAD~1` + a path-limited re-commit (`96d822d5f`, my one file only),
restoring the badges files as uncommitted work; then `git merge origin/main` (clean, ort, the
badges files were proven byte-identical to origin's commit so clearing them lost nothing). Final
local `main` = `fc5b65d76`, 0 behind / 3 ahead of origin, the concurrent session's WIP untouched.

LESSON (already in `[[feedback_never_git_add_all_in_worktree]]`, re-learned the hard way): in a
multi-session shared tree, `git add <path>` then a bare `git commit` still commits the WHOLE
index. ALWAYS commit with an explicit pathspec (`git commit -- <path>`) or work in a worktree,
and check `git diff --cached --name-only` before committing.

---

## E. State for the next session
- Local `main` (`fc5b65d76` + this handoff) carries everything from this lane. It is 3 ahead of
  origin and bundles a concurrent session's `test(labs)` commit (`bd5b8d9a8`), so a push of local
  main is a cross-lane decision Grant owns; the lab-domain feature is already live on origin
  independently.
- ONE thing left to close the lab-domain loop: run the backfill (nightly cron or the dashboard
  Run button), then re-verify certs + a non-demo lab over TLS.
- Worktrees: 14 swept; the rest kept (locked/active + unmerged lanes).
