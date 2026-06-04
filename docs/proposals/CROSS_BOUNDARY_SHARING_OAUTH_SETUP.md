# OAuth Setup Guide (Google + GitHub login)

What Grant provisions so users can sign in with Google or GitHub. You can do this in parallel while the auth layer is built. Same rule as before, put secrets into Vercel's Environment Variables, never into chat.

Auth.js (the library we use) expects these env var names, so use them exactly.

| Variable | From |
|---|---|
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `AUTH_GITHUB_ID` | GitHub OAuth client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth client secret |
| `AUTH_SECRET` | already set |
| `RESEND_API_KEY` | already set (powers the 6-digit email-code fallback) |

The callback path Auth.js uses is `/api/auth/callback/<provider>`, which is why the redirect URLs below end in `/google` and `/github`.

---

## 1. Google login

1. Go to console.cloud.google.com and create a project (name it `ResearchOS`), or reuse one.
2. Open **APIs and Services**, then **OAuth consent screen**.
   - User type, **External**.
   - App name `ResearchOS`, your email as the support and developer contact.
   - Scopes, leave the defaults (email, profile, openid). These are non-sensitive, so there is NO Google verification gauntlet.
   - Save through to the end.
3. Open **Credentials**, then **Create Credentials**, then **OAuth client ID**.
   - Application type, **Web application**.
   - Name, `ResearchOS Web`.
   - **Authorized redirect URIs**, add all three (Google allows multiple, so this covers the branded domain, the current Vercel URL, and local dev):
     - `https://research-os.app/api/auth/callback/google`
     - `https://research-os-xi.vercel.app/api/auth/callback/google`
     - `http://localhost:3000/api/auth/callback/google`
   - Create.
4. Copy the **Client ID** and **Client secret**, and add them to Vercel as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` (Sensitive, Production and Preview).
5. Back on the **OAuth consent screen**, click **Publish app**. While it is in "Testing" only people you add as test users can sign in. Publishing opens it to anyone, and for these non-sensitive scopes it requires no further review.

---

## 2. GitHub login

1. Go to github.com, then **Settings**, **Developer settings**, **OAuth Apps**, **New OAuth App**.
2. Fill in:
   - Application name, `ResearchOS`.
   - Homepage URL, `https://research-os.app`.
   - Authorization callback URL, `https://research-os.app/api/auth/callback/github`.
3. Register, then copy the **Client ID**, and **Generate a new client secret** and copy it.
4. Add them to Vercel as `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` (Sensitive, Production and Preview).

GitHub note. A GitHub OAuth App allows only one callback URL, so the one above is for the deployed site. To also test GitHub login on `localhost`, either create a second OAuth App with the `http://localhost:3000/api/auth/callback/github` callback, or just test GitHub login against the deployed site and use Google or the email link locally. Tell me which you prefer and I will fit the local test to it.

---

## 3. For local testing later

The OAuth secrets are Sensitive, so they will not pull into the local Development environment. When we test locally, you will hand-add the ones you want to exercise to `frontend/.env.local`, plus `AUTH_SECRET` and `AUTH_URL=http://localhost:3000`. I will give you the exact short list when we get there.

---

## What I need from you

Whenever convenient, the Google app (both redirect URIs) and the GitHub app, with their four `AUTH_*` values in Vercel. None of this blocks me from building the auth layer, it only blocks the live login test at the end. Tell me when they are in, or if anything is unclear on a screen, screenshot it and I will walk you through.
