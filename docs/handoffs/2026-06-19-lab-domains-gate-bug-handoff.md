# Lab custom-domain / public lab-site rendering bug + wizard permanence, handoff

Date 2026-06-19. Picks up where the CI-green session left off (CI is fully green, see that handoff/memory). Two open threads, both about the lab public companion site at `<slug>.research-os.com`. House style throughout, no em-dashes, no emojis, no mid-sentence colons.

## TL;DR

A lab's public site at `<slug>.research-os.com` currently renders the normal app WELCOME/LOGIN page instead of the lab site. It is NOT Cloudflare and NOT the proxy routing (both work). Root cause is the app's client-side `AppContent` gate in `src/lib/providers.tsx`, which has no exemption for the public lab origin, so it overlays `WelcomePage`/`FolderConnectGate` on the (correctly server-rendered) lab page after hydration. Fix is designed but NOT built. Separately, Grant locked a decision that the lab slug/domain is PERMANENT and wants the claim step in the wizard to say so clearly (also not built).

## 1. THE BUG, lab subdomain shows the login page (NOT built)

Symptom (Grant, live): navigating to `fakeyeast-lab.research-os.com` shows the standard ResearchOS welcome page (Create account / Sign in / Good afternoon), NOT the lab companion site. The browser TAB TITLE is correct ("The Castellanos Lab | ResearchOS") but the BODY is the welcome page.

Diagnosis (confirmed by probing live prod):
- It is NOT Cloudflare. `fakeyeast-lab.research-os.com` is a DNS-only CNAME straight to Vercel (resolves to 76.76.x / 66.33.x, `server: Vercel`, no `cf-ray`). The apex `research-os.com` IS on Cloudflare (`server: cloudflare`) but that is a different host. No Cloudflare worker/route in the repo targets research-os.com.
- The `.com` cutover IS live. Both flags are set in prod (`LAB_SITES_COM_ORIGIN` + `NEXT_PUBLIC_LAB_SITES_COM_ORIGIN`, set ~2:15pm 2026-06-19) and prod redeployed several times after. DNS wildcard points at Vercel.
- The proxy IS routing. Live response carries `x-matched-path: /[labSlug]/[[...path]]`, i.e. `frontend/src/proxy.ts` `resolveLabHostRequest` recognizes the subdomain and rewrites `<slug>.research-os.com/` to the internal `/<slug>` native lab route.
- The SERVER renders the lab site correctly. `curl https://fakeyeast-lab.research-os.com/` returns the lab HTML (title "The Castellanos Lab", FakeYeast/companion content, and ZERO welcome/login markup in the raw bytes).
- The CLIENT overlays the welcome page. After hydration, the app JS renders `WelcomePage` over the lab content. That is why title (server) is right but body (client) is wrong, and why curl sees the lab while the browser sees welcome.

ROOT CAUSE: `AppContent({ children })` in `frontend/src/lib/providers.tsx` (the global client gate wrapped around every page via `<Providers>` in the root `app/layout.tsx`). It calls `usePathname()` and, for any route NOT in its exemption lists, falls through to render `WelcomePage` / `FolderConnectGate` when there is no connected folder. On the cookie-isolated `.com` lab origin there is no folder/session, so it overlays the gate. The exemption lists (`isWikiRoute`, `isOperatorRoute`, `isPublicMarketingRoute` with explicit paths like `/pricing`, `/labs`, `/network`, plus the folderless-session routes) have ZERO awareness of the lab origin. Grep for `labSlug` / `research-os.com` / `hostname` / `location.host` in `providers.tsx` returns NOTHING.

THE FIX (designed, not built):
- Add a lab-origin bypass to `AppContent`, alongside the other public-route bypasses, that renders `{children}` directly (skips the folder/welcome gate) when the request is on a public lab origin.
- DESIGN PRINCIPLE (Grant agreed): drive the bypass off the proxy's lab-origin DECISION, not a hardcoded `hostname.endsWith(".research-os.com")` in the client. `frontend/src/proxy.ts` `resolveLabHostRequest` (in `frontend/src/lib/social/lab-byo.ts`) is the SINGLE source of truth for "is this a lab origin". Have the proxy mark lab-origin requests (e.g. a request header on the rewrite, read by a server component and passed to the client; or another single-source signal) and have `AppContent` bypass on that marker. Reason: it generalizes to custom domains for free, see thread 2.
- Build in an isolated worktree (NOT the shared main tree, that mishap already cost us once this session). Verify: `<slug>.research-os.com` renders the real lab site in a real browser AND `research-os.app` is byte-identically unchanged (the gate still fires for the authed app). Report before merging.

## 2. CUSTOM lab domains + slug PERMANENCE (Grant decision LOCKED; wizard copy NOT built)

Q&A with Grant that produced the locked decision:
- "Will the fix work for all future labs?" YES, fully generic, zero per-lab work. `labSlugFromHost()` (`frontend/src/lib/social/lab-byo.ts`) matches ANY valid slug label `[a-z0-9][a-z0-9-]{0,62}` under `LAB_SITES_PUBLIC_DOMAIN` (= `research-os.com`, env-overridable). Every native lab is covered automatically.
- "What if a lab uses their own domain (e.g. mylab.edu)?" NOT SUPPORTED anywhere yet. The entire lab-routing layer keys on `<slug>.research-os.com` only. `labSlugFromHost()` REJECTS any non-`research-os.com` host. There is no per-lab registered-domain field and no host->lab lookup. Custom domains are a separate, unbuilt feature (DB domain field + Vercel domain config + host->lab lookup + verification). This is WHY the gate-bypass fix in thread 1 must key off the proxy decision, not a hostname literal, so custom domains come along for free when added.
- Grant's call: "once a lab chooses their domain this is a perma thing. that is fine, we just need to make this super clear on the wizard." DECISION LOCKED, the lab slug/domain is PERMANENT.

Where the slug is actually claimed (so the messaging goes here):
- `frontend/src/components/social/LabSiteDashboard.tsx` (rendered at `/account/lab-site`). It has a "Claim your lab slug" form that previews `<slug>.research-os.com` and POSTs the claim. It shows the resulting URL but says NOTHING about permanence (grep for `permanent`/`cannot change`/`choose carefully` in that file = none). Once a slug is claimed the claim form disappears (no re-claim UI), so it is ALREADY effectively permanent, we just never tell the user before they commit.
- The lab-site route comments confirm the model, "A caller with no site yet (never claimed a slug)" / "The lab must have a site (claimed slug) before any page can be written" (`frontend/src/app/api/social/lab-site/page/route.ts`). The slug is a claimed, namespace-unique handle (shared namespace with @handles + institution slugs, `slug-registry.ts`).
- NOTE the @handle (HandleStep in the onboarding wizard) IS changeable in /settings, but that is the PERSONAL handle, distinct from the lab SITE slug claimed in LabSiteDashboard. Do not conflate them.

TO BUILD (Grant's ask):
- At the claim step in `LabSiteDashboard.tsx`, before the irreversible claim, add clear copy plus a confirm gate, e.g. "This becomes your lab's permanent web address. Choose carefully, it can't be changed later, and changing it would break every saved link, bookmark, and citation pointing to your lab." Plus a confirm (checkbox or one-line dialog showing the exact `myslug.research-os.com`). House style, no em-dashes/emojis/mid-sentence colons.
- While there, verify there is truly no backend rename path; if one exists, lock it so the "permanent" promise holds.

## 3. Context that is already DONE (do not redo)

- CI is FULLY GREEN, all 3 jobs (lint 584->0, vitest with the teardown flake fixed, playwright with the 2 share tests un-skipped via a fixture-seeded identity). Merged `c0b3292c4`. See `[[project_ci_green_initiative]]` and `docs/handoffs/2026-06-19-beakerbot-capabilities-handoff.md` siblings. The orphan branch from a git mishap was cleaned up (Servier work preserved on `fix/ingest-servier`).

## Key files
- `frontend/src/lib/providers.tsx` (the `AppContent` gate, thread 1 fix goes here)
- `frontend/src/proxy.ts` + `frontend/src/lib/social/lab-byo.ts` (`resolveLabHostRequest` / `labSlugFromHost`, the lab-origin source of truth)
- `frontend/src/lib/social/config.ts` (the `LAB_SITES_*` + `LAB_SITES_COM_ORIGIN` flags)
- `frontend/src/components/social/LabSiteDashboard.tsx` (thread 2 claim-step copy goes here)
- `frontend/src/app/[labSlug]/[[...path]]/page.tsx` (the native lab site route)

## Hard reminders
- Build in an ISOLATED worktree, never branch/commit in Grant's shared main tree (cost us a recovery this session). `[[feedback_isolated_worktree_for_shared_trees]]`.
- `main` moves fast (many concurrent lanes), re-verify lint+tsc on the exact HEAD before each push.
- Verify the gate fix in a real browser on the lab origin, and confirm `research-os.app` is unchanged.
