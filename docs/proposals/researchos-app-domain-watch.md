# researchos.app domain watch (the hyphen-less domain)

Last updated 2026-06-17.

## The situation

Our canonical domain is **research-os.app** (with a hyphen), registered through Vercel, serving the real ResearchOS site. That is the only domain in our Vercel account.

The hyphen-less **researchos.app** is the address people will most naturally type, and we do not own it. It currently serves a different product titled "Aiona Client," tagline "Your intelligent workspace for autonomous agents." This is a branding and user-misdirection risk, because a visitor who drops the hyphen lands on someone else's sign-in page instead of ours.

## What we know about the current holder (researchos.app)

Pulled 2026-06-17 from RDAP, the live HTML, and the app's JS bundles.

- Registrar Namecheap. Registered 2025-11-22, expires 2026-11-22 (a one-year registration). Status clientTransferProhibited (a standard registrar lock, not a sale signal). `.app` enforces WHOIS privacy, so the registrant is not public.
- The app is an Electron plus Next.js client (the meta description literally reads "Electron + Next.js App").
- Its backend was `aionabackend-production.up.railway.app` on Railway. Every endpoint now returns `{"code":404,"message":"Application not found"}`, so the backend has been deleted or shut down. The app is non-functional.
- The whole bundle exposes a single API route, `/api/agent/query`. No Supabase, Clerk, Firebase, Auth0, Stripe, Sentry, or analytics anywhere. No email, founder name, or company string leaks.
- It does not appear in web search at all. Closest name matches (Aona AI, Aiona Voice) are unrelated companies on different domains.

Read: an abandoned-looking early prototype from a solo developer, not a company with brand equity. Low threat, but it sits on the domain we want.

## Why we cannot just buy it

It is registered and was actively built on, so it is not available to register and there is no sale or parking lander. Acquiring it would require a private approach to an owner shielded by WHOIS privacy, who is unlikely to sell. Not worth chasing now.

## The drop plan (if they let it lapse)

A domain does not become free on its expiration date. The `.app` (gTLD) lifecycle after 2026-11-22 is roughly:

1. Auto-renew grace, ~0 to 45 days. Only the owner can renew, at normal price. Many registrars auto-renew here by default.
2. Redemption grace period, ~30 days. Only the owner, now at a steep restore fee.
3. Pending delete, exactly 5 days. Locked, nobody can act.
4. Drop. First registrant wins, caught in milliseconds by automated drop-catchers.

So the real release is around **early February 2027**, not on the expiry date, and manual refreshing will not win it.

Action: if we still want it, **place a drop-catch backorder before the drop** (Namecheap, DropCatch, or Snapnames). Pay only if the catch succeeds. Target placing the order by **2026-10-15** for buffer. This is tracked as the `researchos-app-drop-watch` deadline in the operator console (Finances, Deadlines), and a scheduled reminder fires in early October 2026.

## Meanwhile

- Treat **research-os.app** as canonical everywhere.
- Never let our own marketing print the hyphen-less `researchos.app`, since that is the live, present-day risk (it sent us to the Aiona page once already). Audit docs and copy for stray hyphen-less references.
