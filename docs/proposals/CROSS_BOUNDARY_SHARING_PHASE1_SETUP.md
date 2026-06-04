# Phase 1 Setup Checklist (cross-boundary sharing)

What Grant needs to provision so Phase 1 (identity) can run. All free-tier. The build cannot wire the live directory, email, and rate-limiting until these exist.

Security note up front. Put every secret value straight into `frontend/.env.local` (gitignored, never committed) and into the Vercel project's Environment Variables. Do not paste secret values into chat, they would land in the transcript. Once they are set, just say they are done, the code references them by name and the orchestrator never needs to see them.

---

## Accounts to provision (Phase 1)

Provision all three through Vercel's Marketplace, not their own dashboards. ResearchOS already has a Vercel project, and adding these from the Vercel side auto-injects their env vars into the project, so you never copy a secret by hand. Neon's own dashboard blocks direct project creation for Vercel-managed accounts, which is expected, that is why the "New project" button is greyed out there.

### 1. Neon, the directory database
- In vercel.com, open the ResearchOS project, go to the Storage tab.
- Create Database, choose Neon (Serverless Postgres), region US East, name it `researchos-directory`, connect it to the project.
- Vercel auto-adds `DATABASE_URL` (and a few related Postgres vars). Nothing to copy.
- Free tier (100 compute-hours, 0.5 GB) is far more than enough.

### 2. Upstash, rate-limiting and anti-abuse
- Same Storage tab, Create Database, choose Upstash for Redis, region US East.
- Vercel auto-adds `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- Free tier is 500,000 commands per month.

### 3. Resend, the signup verification email
- In the Vercel project, open the Integrations or Marketplace area and add Resend (it is an email service, not a database, so it lives under Integrations rather than Storage).
- It provisions `RESEND_API_KEY`. For real-email delivery you also verify a sending domain (a few DNS records), which can come slightly later, testing works with Resend's built-in sender first.
- Free tier is 3,000 emails per month.

That is the entire provisioning list for Phase 1.

---

## Not needed yet (Phase 2)

### Cloudflare R2, the relay storage
Only the relay (Phase 2) uses this, so you can skip it for now or set it up early if you feel like it. When the time comes, create an R2 bucket plus an S3-compatible API token, which yields `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`.

---

## Generated secrets (the orchestrator handles these)

These are just random strings, not accounts, so you do not create them. They will be generated into `.env.local` when Phase 1 starts, never printed to chat.
- `AUTH_SECRET`, for Auth.js session signing.
- `DIRECTORY_HMAC_PEPPER`, the secret that makes leaked directory hashes resistant to dictionary attack.
- A server signing key for the trust-on-first-use transparency log.

---

## Where the values go

Because you provisioned through Vercel, the production env vars are already set on the project automatically. For local development, pull them down with the Vercel CLI rather than copying by hand.
- `npm i -g vercel` once, then from the repo root `vercel link` once (links this folder to the ResearchOS project), then `vercel env pull frontend/.env.local`.
- That writes all the provisioned values into `frontend/.env.local` (gitignored) securely.

The random app secrets (Auth.js secret, directory pepper, TOFU signing key) are generated locally when Phase 1 starts and added to the same files.

---

## How verification will work

The build and its unit tests run in isolation and need none of your secrets. The live checks (did the verification email actually arrive, did the account row write to Neon) run in your own environment with your real keys, because a sandboxed sub-bot should not hold your secrets. So expect a short hands-on verification pass from you once each server piece is wired.

---

## Handoff

When the three accounts exist and their values are in `.env.local` and Vercel, say the word and the server side of Phase 1 begins. The client side (key generation, recovery phrase, backup) is greenfield and can start before any of this is ready.
