# Network discovery + wiki-style institution/department editing (2026-06-16)

Lane: INJEST (social layer). Status: proposal / design coordination. Not built.

This doc proposes two linked improvements to the now-live researcher network:
1. **Network discovery** upgrades (make the institution page a real hub).
2. A **wiki-style, verified-member-curated** public institution/department page.

It is written to build ON the already-locked dept/institution model, not beside
it. Coordinated with the Billing lane (relay 2026-06-16) and the locked specs
below.

## Coordination + the locked model (read first)

This is NOT greenfield. The relevant decisions are already made:

- `2026-06-14-researcher-profiles-and-social-layer.md:321-365` — the
  **claiming + curation** model. **FIRM RULE: free can edit FACTS (reversible);
  only paid can SPEAK and BRAND as the institution.**
- `2026-06-15-dept-inst-governance-tier.md:87-91` — **public dept/institution
  pages are a FREE distribution play** (Google Business Profile style); verified
  `.edu` domain control is the honest blue check; the only page element the paid
  tier earns is a data-stewardship verified mark + official voice/branding.
- `2026-06-13-department-institution-tier.md:52-87` — the **billing** side:
  `billing_dept_members`, `billing_depts` (admin roster, usage, Stripe), dept
  admin invited via signed capability link. Dark behind `DEPT_TIER_ENABLED`.
- `2026-06-15-social-layer-build-plan.md:62-72` — the identity boundary: Popup
  owns `lib/sharing/identity/*` + `lib/sharing/directory/*` schema + new
  `/api/directory/*` routes; this lane consumes them and owns public-surface UX.

### The boundary (what this lane builds vs. does not)

| This lane (social, FREE, public) | Billing lane (paid, authenticated) | Popup (identity) |
|---|---|---|
| Public `/network`, `/researchers/[fp]`, `/u/[handle]`, `/institution/[slug]` UX | Dept/inst **admin control plane** (roster, usage, plan) | `directory_identities`, keypair escrow, OAuth reissue |
| Free **community-curated** dept directory + dept-name registry | `billing_dept_members`, `billing_depts` (Stripe, official status) | `email_hash → ownerKey` binding |
| Reversible, versioned, verified-domain-gated **fact** edits | **Official voice + branding** overlay (logo, banner, announcements) | Authors new `/api/directory/*` routes |
| New tables: `directory_depts`, `directory_dept_members`, `directory_dept_edits` | Joins on `dept_id` (UUID) | — |

**Hard rules:** join on `dept_id`, never merge tables. This lane never writes
ownership/payment/role state. Keyspace stays as-is (email_hash / owner_key /
Ed25519 fingerprint are not reshaped here). New directory endpoints are Popup's
to author; this lane consumes.

---

## Part 1 — Network discovery improvements

Today the network is a read-only, login-free directory: fuzzy name/affiliation
search capped at 20, no pagination/facets/sort; the institution page exists but
its department chips are decorative (`InstitutionPublicProfile.tsx:170`, click
does nothing); profiles have no direct share action.

### Tier 1 — quick wins (low effort, high impact)
1. **Institution page as a real hub.** Make department chips **filter the member
   list**; add **search-within-institution**; add a **Browse by institution**
   entry on `/network`. Serves the #1 real use case ("find colleagues at my
   university") that fuzzy search cannot.
2. **Direct "Share with [name]" CTA** on `/researchers/[fp]` and `/u/[handle]`,
   opening `RecipientShareDialog` inline. Collapses find -> leave -> re-search
   into one click.
3. **Pagination + result counts + sort** on search and the institution member
   list (the hard 20-cap currently has no "showing 1-20 of N").

### Tier 2 — bigger bets
4. **Unify the two profile identities.** `/researchers/[fingerprint]` and
   `/u/[handle]` are disjoint with no cross-links and no handle search. Add
   bidirectional links + exact `@handle` lookup. (Cleanest via a single
   Popup-authored `/api/directory/researcher-public` that joins
   `account_profiles` + `directory_profiles` server-side; this lane consumes.)
5. **Richer, searchable profiles.** Surface bio (exists on `/u`, not on directory
   cards) + a small **research-interests/keywords** field -> enables topic-based
   discovery, not just name match.

---

## Part 2 — Wiki-style institution/department editor (the FREE tier)

Today "departments" are just the distinct free-text `affiliation` strings of
members, de-duped per request (`db.ts:585`). No institution/department entity
exists. This replaces the derived mess with a **community-curated factual layer**,
exactly as the locked spec calls for.

### What verified-domain members can edit (FREE, factual, reversible)
- A real **department taxonomy** (canonical names + aliases) instead of free-text.
- An institution/department **blurb / about** (markdown).
- **Merge duplicates** (human-approved only; no LLM auto-merge) and correct names.
- **Flag** issues.
- Members **self-select a structured department** from the curated list (cleans up
  the free-text affiliation).
- Every edit is **signed, versioned, and one-click revertible**, attributed to a
  verified member. The verified-domain gate is the anti-vandalism wall that open
  wikis lack; reversibility + audit make the bad-actor risk negligible.

### What is the PAID overlay (Billing's domain, NOT built here)
- Official logo / banner / accent / "about as the org" voice.
- Announcements posted **as** the institution; featured/pinned content.
- The exclusive **"official" / data-stewardship verified** badge (auto via Stripe
  webhook -> `billing_depts.official = true`), rendered as a conditional overlay
  on the same free public page.

### Data model (this lane)
- `directory_depts` (`dept_id` UUID PK, institution_domain, canonical_name,
  aliases[], blurb_md, created_by_fingerprint, updated_at).
- `directory_dept_members` (`dept_id`, member_fingerprint, listed bool) — public
  discovery join; reads existing `directory_profiles` for card data.
- `directory_dept_edits` (append-only: edit_id, dept_id, actor_fingerprint,
  before/after, signature, created_at) — version history + revert source.
- Joins Billing's `billing_depts` / `billing_dept_members` **on `dept_id`**; never
  merges. Canonical institution **name** still comes from the ROR registry shipped
  this session (precedence: live endpoint > ROR registry > humanized slug).

### Reuse (already in the repo — no new infra)
- `InlineMarkdownEditor` (byte-for-byte markdown roundtrip) for the blurb.
- The `ProfileEditorCard` edit/save pattern (`SharingSection.tsx:946-1276`).
- The signed `upsertProfile` write path + Ed25519 signing + verified-domain
  gating (mirror it for `upsert*` on the new tables).
- ROR registry resolver (`institution-registry.ts`) for canonical names +
  `clusterDomainsFor` (subdomain folding).

### Design decisions to settle
1. **Who edits the free tier** — any verified-domain member (true wiki + full
   history/revert) vs. stewards. *Recommend: any verified member; the verified
   gate + reversibility is the spam wall, matching the locked rule.*
2. **Realtime vs. async** — Loro collaborative editing vs. simple signed-save +
   version history. *Recommend: signed-save + history for v1; curation is
   low-frequency and async; realtime is overkill.*
3. **v1 scope** — blurb + department taxonomy + per-member structured dept pick,
   vs. going wider (labs, links, logos — much of which is the paid overlay).
   *Recommend: the narrow three; leave branding to the paid overlay.*
4. **Endpoint ownership** — the new `directory_dept*` read/write routes are under
   `/api/directory/*`, which is Popup's tree. Confirm he authors them (this lane
   consumes), or that this lane may add social-only routes under a separate path.

## Open coordination
- Billing (relayed 2026-06-16): confirm `dept_id` join model + that the public
  curated page is the agreed free funnel under their paid governance overlay.
- Popup: confirm authorship of the new `directory_dept*` endpoints + the unified
  `researcher-public` search endpoint.
