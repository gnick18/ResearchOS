# ORCID Login Build Plan (section 18.7)

A ready-to-execute implementation brief for the ORCID hybrid login. Written by the orchestrator (Opus) with full codebase context so a fast (Sonnet) sub-bot can build it without re-deriving the design. Locked design is section 18.7 of `CROSS_BOUNDARY_SHARING_PROPOSAL.md`.

## 0. One correction to section 18.7 (verified against ORCID's live OIDC config)

ORCID's OpenID Connect discovery (`https://orcid.org/.well-known/openid-configuration`) advertises:

- **scopes_supported: `openid` only.** No `email` scope.
- **claims_supported: `sub, name, given_name, family_name, auth_time, iss`.** There is no `email` claim.
- issuer `https://orcid.org`, authorization `https://orcid.org/oauth/authorize`, token `https://orcid.org/oauth/token`, userinfo `https://orcid.org/oauth/userinfo`, jwks `https://orcid.org/oauth/jwks`.
- id_token signing alg RS256, subject type public, `token_endpoint_auth_methods_supported: client_secret_post`.
- PKCE not advertised (`code_challenge_methods_supported` absent). grant types authorization_code, implicit, refresh_token.

So ORCID OIDC **never returns an email**, even if the user made their ORCID email public (public email is a member-API thing, not an OIDC claim). This simplifies the flow: an ORCID sign-in ALWAYS routes through the email-OTP step. Drop the "skip OTP if email is public" branch from 18.7. The `sub` claim is the ORCID iD (for example `0000-0002-1825-0097`).

## 1. Branch + sequencing

- Branch from `main` at `59c18fb0` or later (this includes the Recovery Kit, which already modified `SharingSetupWizard.tsx` and `SharingSection.tsx`). PRESERVE the Recovery Kit download button and the kit-restore path already in those files. Do not revert them.
- Standard worktree discipline: `git merge main --no-edit` first, symlink node_modules (never install), never `git stash`, `git add` only your paths, one commit on your branch, do not merge or push.

## 2. The flow, end to end

**First-time claim with ORCID (the only ORCID claim path, since no email comes back):**
1. User clicks "Sign in with ORCID" in the wizard ChooseStep. ORCID proves the iD; the Auth.js session now carries `orcidId` (the `sub`) and no email.
2. The wizard resume detects an ORCID session with no email and routes to the existing email-enter step, with a banner "Signed in with ORCID. Confirm your email so people can reach you."
3. User proves an email via the existing 6-digit OTP (signup then verify). The `verify` route binds the keys to the email AND, reading the still-active ORCID session server-side, records the `orcid_id -> email_hash` link.
4. Done. The email is the directory primary key; ORCID rides alongside.

**Re-authentication (returning user):**
- Signing in with ORCID gives a session with `orcidId`. Routes that need identity resolve the account by `getEmailHashByOrcid(orcidId)`.
- ORCID re-auth is allowed for: profile read/write/delete, and search. NOT for key recovery (recover route stays email-OTP only, locked decision 18.7 #2).

## 3. File-by-file changes

### 3.1 `frontend/src/lib/sharing/auth.ts` — add the ORCID provider + session threading

Add an ORCID OIDC provider, gated on env presence like Microsoft. Concrete config (do not guess, this matches ORCID's live discovery):

```ts
const orcidProvider = process.env.AUTH_ORCID_ID
  ? [
      {
        id: "orcid",
        name: "ORCID",
        type: "oidc" as const,
        // Defaults to production; set AUTH_ORCID_ISSUER=https://sandbox.orcid.org for local/dev testing.
        issuer: process.env.AUTH_ORCID_ISSUER || "https://orcid.org",
        clientId: process.env.AUTH_ORCID_ID,
        clientSecret: process.env.AUTH_ORCID_SECRET,
        authorization: { params: { scope: "openid" } },
        client: { token_endpoint_auth_method: "client_secret_post" as const },
        // ORCID does not advertise PKCE. If the callback fails with an
        // invalid-request/PKCE error in the sandbox, this is the first knob:
        // try checks: ["state"] (drop pkce) and/or ["state", "nonce"].
        checks: ["state"] as ("state" | "pkce" | "nonce")[],
        idToken: true,
        profile(profile: { sub: string; name?: string; given_name?: string; family_name?: string }) {
          const name =
            profile.name ||
            [profile.given_name, profile.family_name].filter(Boolean).join(" ") ||
            profile.sub;
          return { id: profile.sub, name, email: null };
        },
      },
    ]
  : [];
```

Add it to the providers array: `providers: [Google, GitHub, LinkedIn, ...microsoftEntra, ...orcidProvider]`.

Thread the ORCID iD and provider into the JWT session so routes can read it:

```ts
callbacks: {
  async jwt({ token, account, profile }) {
    if (account?.provider) token.provider = account.provider;
    if (account?.provider === "orcid" && profile?.sub) {
      token.orcidId = profile.sub as string;
    }
    return token;
  },
  async session({ session, token }) {
    if (token.provider) (session as { provider?: string }).provider = token.provider as string;
    if (token.orcidId) (session as { orcidId?: string }).orcidId = token.orcidId as string;
    return session;
  },
},
```

Add a module augmentation so `session.orcidId` / `session.provider` are typed (avoid `any`):

```ts
declare module "next-auth" {
  interface Session { orcidId?: string; provider?: string; }
}
declare module "next-auth/jwt" {
  interface JWT { orcidId?: string; provider?: string; }
}
```

Update the env-doc comment block at the top to list AUTH_ORCID_ID / AUTH_ORCID_SECRET / AUTH_ORCID_ISSUER (optional, defaults to production).

**Main integration risk, flagged:** ORCID + Auth.js OIDC handshake. ORCID uses `client_secret_post` and does not advertise PKCE. Auth.js v5 defaults to PKCE for OIDC. If the sandbox callback returns an invalid-request or PKCE error, adjust `checks` (drop `pkce`, keep `state`, optionally add `nonce`). This must be verified against the ORCID sandbox; it cannot be unit-tested.

### 3.2 `frontend/src/lib/sharing/directory/db.ts` — the ORCID mapping

Add to `ensureProfileSchema()` (or a new `ensureOrcidSchema()` called by the routes that need it):

```sql
CREATE TABLE IF NOT EXISTS directory_orcid_links (
  orcid_id   text primary key,
  email_hash text not null,
  created_at timestamptz default now()
);
CREATE INDEX IF NOT EXISTS idx_orcid_links_email_hash ON directory_orcid_links(email_hash);
```

Add functions:

```ts
export async function linkOrcid(orcidId: string, emailHash: string): Promise<void> {
  // INSERT ... ON CONFLICT (orcid_id) DO UPDATE SET email_hash = EXCLUDED.email_hash
}
export async function getEmailHashByOrcid(orcidId: string): Promise<string | null> {
  // SELECT email_hash FROM directory_orcid_links WHERE orcid_id = $1 LIMIT 1
}
```

The ORCID iD is a public identifier, stored as-is. The table never holds an email, only the peppered email hash, so it is consistent with the privacy posture.

### 3.3 `frontend/src/app/api/directory/verify/route.ts` — link ORCID on email-bind

After the existing successful OTP verify + key bind (after `upsertBinding`), add a best-effort ORCID link:

```ts
import { auth } from "@/lib/sharing/auth";
import { linkOrcid } from "@/lib/sharing/directory/db";
// ...
const session = await auth();
if (session?.orcidId) {
  try { await linkOrcid(session.orcidId, emailHash); } catch { /* link is best-effort; never fail the bind on it */ }
}
```

`emailHash` is already computed in that route. Do not change anything else about verify.

### 3.4 `frontend/src/app/api/directory/oauth-bind/route.ts` — defensive ORCID link (optional)

ORCID never reaches oauth-bind (no email), so this is purely defensive. Optional: after `upsertBinding`, `if (session.orcidId) await linkOrcid(...)`. Low priority; skip if it adds risk.

### 3.5 `frontend/src/app/api/directory/profile/route.ts` — accept an ORCID session

Today these handlers derive the email hash from `session.user.email`. Generalize the derivation so an ORCID-only session resolves via the mapping. Add a small helper used by GET, POST, and DELETE:

```ts
async function resolveEmailHash(session): Promise<string | null> {
  if (session?.user?.email) return hashEmail(canonicalizeEmail(session.user.email), getPepper());
  if (session?.orcidId) return await getEmailHashByOrcid(session.orcidId);
  return null;
}
```

Replace the current `session.user.email` checks with `const emailHash = await resolveEmailHash(session); if (!emailHash) return json(401, ...)`. The Ed25519 signature check is UNCHANGED (still required). For POST, the verified-domain badge logic that reads the email domain only applies when there is a session email; for an ORCID-only session there is no email domain, so `affiliationDomain` stays null (the user can still type an affiliation, it is just unverified). Keep that behavior.

### 3.6 `frontend/src/app/api/directory/search/route.ts` — accept an ORCID session

Change the gate from `if (!session?.user?.email) return 401` to `if (!session?.user?.email && !session?.orcidId) return 401`. Nothing else changes.

### 3.7 `frontend/src/app/api/directory/recover/route.ts` — UNCHANGED

Do not touch. Key recovery stays email-OTP only (locked decision 18.7 #2). A compromised ORCID account must not be able to reach the backup blob.

### 3.8 `frontend/src/components/sharing/SharingSetupWizard.tsx` — the hybrid claim branch

PRESERVE the existing Recovery Kit download button and all current behavior. Changes:

- Add `"orcid"` to the `OAuthProvider` union type.
- Add an "Sign in with ORCID" button to `ChooseStep` (calls `onOAuth("orcid")`). Use an ORCID green pill (`#A6CE39`) and an `OrcidIcon` (add a simple inline SVG to `components/sharing/icons.tsx`, the ORCID iD circle mark, fill `#A6CE39`). Place it near the top with the other identity providers since ORCID is the most academic.
- Extend the OAuth-resume effect: it currently fetches `/api/auth/session` and reads `user.email`. Also read `orcidId` and `provider` from the session JSON. Logic:
  - If `sessionEmail` is present: existing behavior (go to `generate`, oauth path). Unchanged.
  - Else if `orcidId` is present (ORCID with no email): set a new state `orcidLinked = true`, route to the `email-enter` step (NOT generate), and strip the resume flag. The user now proves an email via the existing OTP flow; `verifiedVia` becomes `"email"` when they request the code (existing `requestCode` already sets that). The server links the ORCID automatically from the still-active session in step 3.3, so the client does not need to send the orcidId.
- On the `email-enter` step, when `orcidLinked` is true, show a short banner: "Signed in with ORCID. Confirm your email so collaborators can reach you." (No em-dashes, no emojis, no mid-sentence colons.)
- Everything else (keygen, recovery words, kit download, publish via the verify route) is unchanged.

### 3.9 `frontend/src/components/sharing/icons.tsx` — add `OrcidIcon`

A small inline SVG of the ORCID mark (a circle with "iD"), fill `#A6CE39`. Keep the house style (no external library).

## 4. Tests

`frontend/src/lib/sharing/directory/__tests__/orcid.test.ts`:
- `linkOrcid` / `getEmailHashByOrcid` round-trip and not-found, against a mocked neon `getSql` (mirror the existing mocked-DB pattern in `profile.test.ts`).
- A pure test of the `resolveEmailHash` helper if you extract it as an exported pure function (recommended): email-session path, orcid-session path (mock `getEmailHashByOrcid`), neither (returns null).

Cannot be unit-tested (note in the report, requires live sandbox): the ORCID OAuth redirect handshake, the session-callback threading, the end-to-end claim. These are verified manually against the ORCID sandbox.

## 5. Provisioning + manual verification (operator, not the bot)

- Production ORCID credentials are already set in Vercel (`AUTH_ORCID_ID`, `AUTH_ORCID_SECRET`, https redirect `https://research-os.app/api/auth/callback/orcid`).
- For local/sandbox testing: register a separate app at `sandbox.orcid.org/developer-tools` (sandbox allows `http://localhost` redirects), then in `frontend/.env.local` set `AUTH_ORCID_ISSUER=https://sandbox.orcid.org`, `AUTH_ORCID_ID=<sandbox APP id>`, `AUTH_ORCID_SECRET=<sandbox secret>`, plus the existing `AUTH_SECRET`, `SHARING_ENABLED=true`, `DIRECTORY_HMAC_PEPPER`, and the Neon/Upstash vars. Sandbox redirect `http://localhost:3000/api/auth/callback/orcid`.
- Manual end-to-end check: sign in with ORCID (sandbox account) at the wizard, confirm it routes to the email step, complete the OTP, confirm the bind succeeds and a `directory_orcid_links` row appears, then sign out and sign in with ORCID again and confirm a profile write resolves to the account.

## 6. Gates

- `cd frontend && npx tsc --noEmit` exits 0 (run with `> /tmp/x.log 2>&1; echo EXIT=$?`, never pipe to tail).
- `npx eslint` clean on all files you create/modify (ignore the known pre-existing `setShowDevDock` error in AppShell.tsx, which you must not touch).
- `npx vitest run src/lib/sharing/directory/__tests__/orcid.test.ts` passes.
- No `setState` synchronously in an effect body. Use `&apos;` for apostrophes in JSX text. Icon-only buttons use `<Tooltip>`. No emojis, em-dashes, or mid-sentence colons in user-facing copy.

## 7. Scope guards (do NOT touch)

- The recover route (stays email-only).
- The relay, the bundle engine, the crypto primitives (backup.ts/setup.ts/keys.ts), the on-disk sidecar shape.
- The Recovery Kit code just landed (preserve the wizard download button and the kit-restore path).
- `package.json` / lockfile (no new deps; Auth.js, noble, neon are all present).
- AppShell.tsx, the loro/* files (another session owns those).
