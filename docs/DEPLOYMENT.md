# Deployment

ResearchOS is a Next.js App Router app with **no backend of its own for the core
product**, all notebook data lives in a folder on the user's disk via the File
System Access API. The only server-side code is the optional accounts /
cross-boundary sharing backend (`/api/directory/*`, `/api/relay/*`, `/api/auth/*`)
plus two thin CORS proxies (`/api/telegram-file`, `/api/calendar-feed`).

So there are two deployment shapes:

1. **Local notebook only.** Deploy with no sharing env vars. `SHARING_ENABLED`
   stays unset, every directory/relay route returns disabled, and the app is a
   pure offline-first notebook. Nothing else is required.
2. **Accounts + sharing enabled.** Set the env vars below. This turns on
   sign-in, the email-keyed identity directory, the encrypted inbox/relay, and
   cross-boundary sharing.

The canonical, copyable list lives in [`frontend/.env.example`](../frontend/.env.example).
This page is the prose guide and the launch checklist.

## Environment variables

Set these in the Vercel project (Settings → Environment Variables), or in
`frontend/.env.local` for local dev. `.env.local` is gitignored;
`frontend/.env.example` is the committed template with placeholders.

### Master gate

| Var | Required | Purpose |
|---|---|---|
| `SHARING_ENABLED` | for sharing | Must be exactly `true`. The kill-switch every `/api/directory/*` and `/api/relay/*` route checks first. If unset, the whole accounts/sharing backend is off and sign-in does nothing. **Most-forgotten var on first deploy.** |

### Auth (Auth.js / NextAuth)

Read internally by the library, so they won't appear in a `process.env` grep.

| Var | Required | Purpose |
|---|---|---|
| `AUTH_SECRET` | yes | Signs the JWT session. `openssl rand -base64 32`. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | per-provider | Google button |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | per-provider | GitHub button |
| `AUTH_LINKEDIN_ID` / `AUTH_LINKEDIN_SECRET` | per-provider | LinkedIn button |
| `AUTH_ORCID_ID` / `AUTH_ORCID_SECRET` / `AUTH_ORCID_ISSUER` | optional | ORCID button (issuer defaults to `https://orcid.org`) |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` | optional | Not surfaced in the UI yet |

Each of the four sign-in buttons needs its matching pair; a provider is only
wired in when its `_ID` is present, so you can ship a subset. In each provider's
console, register the redirect URI:

```
https://<your-domain>/api/auth/callback/<provider>
```

> **ORCID quirk:** ORCID returns no email. Because the sharing directory is
> email-keyed, ORCID sign-ins are routed through the email-OTP step to obtain a
> verified email, so ORCID functionally depends on Resend (below).

### Database — Neon Postgres

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | for sharing | Neon serverless connection string. Backs both the identity directory and the relay inbox. The app creates the `pg_trgm` extension for trigram search. |
| `DIRECTORY_HMAC_PEPPER` | for sharing | Pepper used to hash emails before storage, so the directory holds only keyed hashes, never raw addresses. Generate once (`openssl rand -hex 32`) and **keep it stable forever**, changing it orphans every existing directory entry. |

### Rate limiting — Upstash Redis

| Var | Required | Purpose |
|---|---|---|
| `KV_REST_API_URL` | for sharing | The code reads the `KV_REST_API_*` names (set by the Vercel↔Upstash integration), **not** `UPSTASH_REDIS_REST_*`. |
| `KV_REST_API_TOKEN` | for sharing | Adding the Upstash Redis integration on Vercel populates both automatically. |

### Relay storage — Cloudflare R2

| Var | Required | Purpose |
|---|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | for file sharing | Stores the end-to-end-encrypted shared bundles. Bytes are sealed client-side; R2 never sees plaintext. |

### Email — Resend

| Var | Required | Purpose |
|---|---|---|
| `RESEND_API_KEY` | for sharing | Sends the 6-digit email OTP + share invites (and the ORCID path). |
| `RESEND_INVITE_FROM` | for sharing | `From:` address, must be a verified Resend domain. |
| `RESEND_POSTAL_ADDRESS` | for sharing | Physical address in the email footer (anti-spam compliance). |

### Public + misc

| Var | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_ORIGIN` | for sharing | Production origin (no trailing slash); builds links in OTP/invite emails. |
| `NEXT_PUBLIC_DISABLE_V4_TOUR` | optional | `true` suppresses the onboarding tour. |
| `NEXT_PUBLIC_COLLAB_RELAY_URL` | optional | Real-time collab relay (Phase 3, not launched). Leave unset; when set to a `wss://` origin it is auto-added to the CSP `connect-src`. |

### Auto-set by Vercel — do nothing

`VERCEL_GIT_COMMIT_SHA`, `NEXT_PUBLIC_RESEARCHOS_COMMIT` / `RESEARCHOS_COMMIT_SHA`,
`NODE_ENV`. The welcome-page demo videos load from public Vercel Blob URLs
hardcoded in the page, so they need no runtime env (`BLOB_READ_WRITE_TOKEN` is
only needed to re-upload them).

## Launch checklist

If sign-in or sharing breaks on a fresh deploy, check these first:

- [ ] `SHARING_ENABLED=true`
- [ ] `AUTH_SECRET` set
- [ ] At least one OAuth provider pair set, and its redirect URI registered
- [ ] `DATABASE_URL` reachable, `pg_trgm` available (Neon)
- [ ] `DIRECTORY_HMAC_PEPPER` set (and never rotated)
- [ ] `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Upstash integration added)
- [ ] All four `R2_*`
- [ ] `RESEND_API_KEY` + a verified `RESEND_INVITE_FROM` domain
- [ ] `NEXT_PUBLIC_APP_ORIGIN` matches the deployed origin

## Browser support

ResearchOS requires the File System Access API: **Chrome or Edge only.** Brave
strips the API on purpose, and Firefox/Safari do not implement it. Do not list
Brave/Firefox/Safari as supported.
