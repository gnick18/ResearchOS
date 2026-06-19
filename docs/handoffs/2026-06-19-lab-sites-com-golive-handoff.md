# Handoff: lab-sites .com origin GO-LIVE (2026-06-19, DEBUG session)

Continues the lab-sites `.com` migration. The cutover code shipped AND the prod go-live was executed this session. One confirmed blocker remains (a browser-only gate bug, already documented separately) plus one unexplained 301 discrepancy. House style throughout.

## What shipped + went live this session

- **Migration code** (origin/main, merges `10fbeb72f` + 301 fix `21fa0c090`): native lab sites serve from `<slug>.research-os.com`, behind `LAB_SITES_COM_ORIGIN` (server) + `NEXT_PUBLIC_LAB_SITES_COM_ORIGIN` (client). `proxy.ts` host-router (`resolveLabHostRequest` in `lib/social/lab-byo.ts`) rewrites native paths to the existing `/<slug>` route, routes `/_site/...` to the BYO serve, allows only `/api/social/lab-site/asset/read`, 404s every other `/api/*`. The `[labSlug]` route 301s old `research-os.app/<slug>` links to the subdomain. Full detail in `docs/handoffs/2026-06-16-lab-domains-go-live-checklist.md` + `[[project_lab_domains_companion_sites]]`.

- **GO-LIVE executed on prod (Vercel, project `research-os`):**
  - Cloudflare DNS: Grant added `*.research-os.com` CNAME -> `cname.vercel-dns.com`, DNS-only (grey). The apex/www 301-to-`.app` redirect is exact-host-match (does NOT catch subdomains); `assets.research-os.com` R2 record left intact.
  - Vercel domains: added `*.research-os.com` AND the specific `fakeyeast-lab.research-os.com` to the project.
  - Env (prod): `LAB_SITES_COM_ORIGIN=true`, `NEXT_PUBLIC_LAB_SITES_COM_ORIGIN=1`, and `NEXT_PUBLIC_APP_ORIGIN=https://research-os.app` (was UNSET; setting it is a no-op for the email/invite fallbacks which already default to that exact value).
  - Redeployed prod several times (`vercel redeploy ... --scope grant-nickles-projects`; auto-promote on git push appears OFF for this project, so production was promoted via redeploy).

- **Verified at the SERVER/curl level (all good):** `fakeyeast-lab.research-os.com/` returns the lab HTML ("The Castellanos Lab"), `/_site` returns the BYO bundle ("FakeYeast paper companion"), `/api/auth/session` -> 404 (blocked), no `Set-Cookie`, `X-Frame-Options: DENY`. `x-matched-path: /[labSlug]/[[...path]]` confirms the proxy rewrite.

## BLOCKER 1: lab subdomain shows the WELCOME/LOGIN page in a real browser (CONFIRMED live, NOT built)

Same bug as `docs/handoffs/2026-06-19-lab-domains-gate-bug-handoff.md` (read that for the full diagnosis + designed fix). CONFIRMED this session by driving Claude-in-Chrome to `fakeyeast-lab.research-os.com/`: the page body is the welcome screen (Create account / Sign in / See the tour / Open the live demo), tab title correct. Curl-only verification cannot catch this (server HTML is right; the client `AppContent` gate in `frontend/src/lib/providers.tsx` overlays `WelcomePage` after hydration because it has no lab-origin exemption).

FIX (Grant-locked, designed, NOT built): add a lab-origin bypass to `AppContent` driven off the proxy's `resolveLabHostRequest` decision (mark lab-origin requests via a request header on the rewrite, read server-side, pass to the client), NOT a hardcoded hostname (so custom domains come for free). Build in an ISOLATED worktree, browser-verify the lab renders AND `research-os.app` is unchanged. ALSO pending: the slug-permanence warning + confirm gate at the `LabSiteDashboard.tsx` claim step (Grant locked the slug is PERMANENT). Both in the gate-bug handoff's TO BUILD.

This was about to be picked up (Grant was asked: build both / just the bypass / a parallel session has it) when the session ran low on tokens. NEXT SESSION: confirm no parallel session owns it, then build the AppContent bypass first (the show-stopper), then the permanence copy.

## BLOCKER 2: research-os.app/<slug> does NOT 301 to the subdomain (unexplained, SECONDARY)

The `[labSlug]` route has a runtime-only 301 (`if (isLabSitesComOriginEnabled() && !onSubdomain) permanentRedirect(labSiteOrigin(slug)+tail)`), verified present in origin/main HEAD and in the deployed commit (`vercel inspect` shows the prod deployment is aliased to `research-os.app` + `*.research-os.com` + `fakeyeast-lab.research-os.com` and is the `git-main` deployment = HEAD). The flag is on (the subdomain serving proves middleware sees it true). YET `curl https://research-os.app/fakeyeast-lab` returns 200 + the lab HTML, no redirect. Could not root-cause remotely (the route renders the lab, so it skipped the redirect, implying `isLabSitesComOriginEnabled()` read false in the page function while middleware read it true on the same deployment, or a stale compiled route in the build). A fresh redeploy (`research-3ls04iwvi`) was triggered to test and may still be building.

IMPORTANT: this 301 is moot until Blocker 1 is fixed (redirecting to a page that shows the login screen is worse). Leave it; revisit after the gate fix. Earlier the 301 was wrongly gated on the build-inlined `NEXT_PUBLIC_APP_ORIGIN` (a cached redeploy never re-inlined it); that was fixed to runtime-only (`21fa0c090`).

## Infra caveats for next session
- The `*.research-os.com` WILDCARD cert did NOT auto-issue (wildcard certs need an `_acme-challenge` DNS-01 TXT that Vercel cannot auto-create on the Cloudflare-managed zone). Only the SPECIFIC `fakeyeast-lab.research-os.com` has a working cert (Vercel auto-issued it). For real labs later: either add each subdomain individually, or set up the wildcard TXT. Not a blocker for the demo.
- Auto-promote to production appears OFF: git pushes build a deployment but do not promote to `research-os.app`; promote via `vercel redeploy <url> --scope grant-nickles-projects` or the dashboard. Worth confirming with Grant whether that is intentional (his recent pushes may not be live).
- `vercel` CLI commands need `--scope grant-nickles-projects` for deployment-level ops (the linked-project auto-scope only covers `vercel ls`/`domains ls`).

## Files
- `frontend/src/proxy.ts`, `frontend/src/lib/social/lab-byo.ts` (`resolveLabHostRequest`/`labSlugFromHost`/`LAB_SITES_PUBLIC_DOMAIN`)
- `frontend/src/app/[labSlug]/[[...path]]/page.tsx` (the 301)
- `frontend/src/lib/social/config.ts` (the `LAB_SITES_COM_ORIGIN` flags)
- `frontend/src/lib/providers.tsx` (AppContent gate, Blocker 1 fix goes here)
- `frontend/src/components/social/LabSiteDashboard.tsx` (permanence copy)
