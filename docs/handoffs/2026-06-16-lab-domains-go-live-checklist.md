# Lab-domains go-live + verification checklist (2026-06-16)

Everything in the lab-domains epic (Phases 1-4b + BYO upload + BYO GitHub-connect
slice A) is on origin/main, flag-gated OFF / byte-identical. This is the exact
sequence to turn it on in a deploy and verify it live. Nothing here is destructive;
flipping the flags back off makes it inert again instantly.

## 0. Entitlement — RESOLVED (not a blocker)
Every publish/host path is gated on `isLabPublishEntitled(labOwnerKey)` (true only
for an ACTIVE PAID lab subscription). Per the canonical docs/branding/PRICING.md
(Model A): there are NO free labs — Lab is a PAID tier ($25/mo flat + usage), and
the Free tier is the network audience (receive-only, no produce). So the gate is
CORRECT as-is. Run the live test with a PAID lab account; free/network users
correctly get a 403 / upgrade state on the write APIs. (An earlier draft flagged a
"free lab" blocker — that was a stale GA-free assumption that Model A supersedes.)

## 1. Env vars (Vercel production)
- `LAB_SITES_ENABLED=true`            (server gate; must be exactly "true")
- `NEXT_PUBLIC_LAB_SITES=1`           (client gate; "1" or "true")
- `LAB_BYO_SITES=true`                (server; enables BYO upload + GitHub-connect)
- `NEXT_PUBLIC_LAB_BYO_SITES=1`       (client)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  (the social-lane R2 client reuses these; they already exist in prod for the relay.
   Confirm R2_BUCKET is the bucket you want lab assets in.)
- `DATABASE_URL` (Neon, already set) — the new tables (lab_sites, lab_site_pages,
  lab_byo_sites, lab_byo_github, slug_registry, lab_hosted_assets) self-create via
  idempotent ensureSchema on first request. No migration step.
- `CRON_SECRET` (already set; the asset-GC cron uses `Authorization: Bearer $CRON_SECRET`,
  same as the cost-breaker / business-reminders crons).
- Optional: `GITHUB_TOKEN` (raises GitHub rate limit for connect/sync; not required
  for public repos). Optional: `LAB_BYO_ASSETS_DOMAIN` (defaults research-os.com).
- Env changes require a REDEPLOY to take effect.

## 2. Domain / DNS
- NATIVE lab pages serve at `research-os.app/<labSlug>` — already on the app domain,
  no DNS needed; works once flags are on.
- BYO sites serve at `<labSlug>.research-os.com`. Add a WILDCARD domain
  `*.research-os.com` (or per-lab subdomains) to the Vercel project so those
  subdomains reach this app + the byo/serve route.
- CONFIRM there is no wildcard `*.research-os.com -> research-os.app` redirect that
  would catch the lab subdomains (the apex/www redirect is fine; assets.research-os.com
  already serves, which is the proof subdomains aren't blanket-redirected).
- INVARIANT: never serve the authed app / set app cookies on research-os.com.
- Until the wildcard DNS exists, BYO serving is testable via the `?slug=<labSlug>`
  fallback on the byo/serve route.

## 3. Deploy
Redeploy prod from origin/main after setting the env (a CLI `vercel --prod` from a
clean origin/main checkout, then `vercel promote`, or a git push that auto-promotes;
the prod alias may need an explicit promote — see the 2026-06-16 security-incident
notes about the alias lag + x-vercel-cache).

## 4. Verify (as an entitled lab account — see section 0)
1. Native page: /account/lab-site -> claim a slug -> add a markdown page -> insert a
   figure block (the "/" picker) -> Save and publish -> visit
   research-os.app/<slug>/<path> -> the page + a baked figure render.
2. Live dataset: insert a Data Hub dataset block -> publish -> the public page shows
   a LIVE interactive table (DuckDB streaming the Parquet from R2). Then confirm the
   baked fallback by checking it still renders if the dataset is absent.
3. BYO upload: upload a zip of a static site -> visit <slug>.research-os.com (or the
   ?slug= fallback) -> the site renders; confirm the response has NO Set-Cookie and
   `x-content-type-options: nosniff`.
4. BYO GitHub: connect a PUBLIC repo (the 2023 paper-site repo) -> Sync now -> visit
   <slug>.research-os.com -> the repo's site renders.
5. Security smoke: research-os.app/dev/pricing-finalize -> still 404; a BYO response
   sets no app cookie; an unentitled / signed-out user gets 403/401 on the write APIs.

## 5. Rollback
Flip `LAB_SITES_ENABLED` / `LAB_BYO_SITES` (and the NEXT_PUBLIC_*) back to off and
redeploy -> the whole feature is inert again, byte-identical to before.

## What needs more work AFTER this passes
- GitHub-connect slice B: private repos (a GitHub App you register) + webhook
  auto-sync-on-push.
- Custom domains (Phase 5): a lab's own data.yourlab.org via CNAME + verify + TLS +
  301 from research-os.app/<slug>. Needs Vercel domain-API access.
- The prepaid permanent-archive Stripe CHARGE (Billing, at billing-live; the
  archived flag the GC honors already exists).
