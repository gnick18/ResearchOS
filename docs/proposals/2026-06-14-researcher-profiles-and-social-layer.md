# Researcher profiles + a lightweight social / discovery layer

Status: PROPOSAL (2026-06-14). Mockup: `docs/mockups/2026-06-14-researcher-profiles-social.html`.
Voice: no em-dashes, no emojis, no mid-sentence colons, state the why.

## Why

We are about to open lab accounts to real PIs and students. Right now a user's
public identity is thin and split across two surfaces, and several things people
expect from an academic profile do not exist at all (bio, links, ResearchGate, a
real verified-affiliation flow, and a way to keep your account when your `.edu`
email goes away). At the same time we already own most of the hard parts of a
researcher social graph (a directory, trigram search, institution aggregates, a
verified-institution badge, ORCID, and an end-to-end "send a share to a
researcher" primitive). This proposal unifies the profile and adds the thin
connective layer that turns those parts into a real product: search every
ResearchOS user, see credible profiles, see who from your institution is already
here, and share to an external collaborator in one click. The profile is the
moat, and seamless external sharing is the payoff.

## What exists today (build on, do not rebuild)

- Two profiles, NOT unified:
  - `account_profiles` (`lib/account/account-profile.ts`): the public `@handle`
    profile at `/u/<handle>`. Holds handle, display name, affiliation, avatar.
    Keyed by the account OWNER KEY (peppered email hash).
  - `directory_profiles` (`lib/sharing/directory/db.ts`): the find-a-researcher
    card shown in `/researchers` + `ProfileCard.tsx`. Holds display name,
    affiliation, `affiliationDomain` (the verified-institution badge), and
    `orcid`. Keyed by the Ed25519 public-key FINGERPRINT.
- Trigram search over name + affiliation (`searchProfiles`, pg_trgm).
- Institution aggregate already computed (`profilesByDomain` -> counts per
  domain).
- Verified-institution badge derived automatically from the OAuth email domain
  (`affiliationDomain.ts`, non-consumer domain -> badge).
- ORCID link table + ORCID login (`directory_orcid_links`, `linkOrcid`).
- The seamless external-share primitive ALREADY exists: `find-and-share.ts`
  searches the directory and `decideDeliveryMethod()` picks `seal` (recipient
  has a published X25519 key) vs `one-time-link` (no key yet / not on ResearchOS).
- `/researchers` + `/researchers/[fingerprint]` routes.

What is MISSING and this proposal adds: a single canonical profile, enriched
fields (bio, links, ResearchGate, ORCID-as-field), a connection graph, the
discovery UX, institution pages, account portability (email/provider rebind),
and the wiring that makes connections + verification trust signals in sharing.

## Locked decisions (Grant, 2026-06-14)

1. **Discoverability: listed by default, granular opt-out.** Claiming an
   `@handle` lists you (searchable by name / handle / institution, public
   profile live). You can go fully unlisted and hide individual fields. Email is
   NEVER exposed; the directory stays email-hash-keyed and cannot be walked to
   harvest accounts.
2. **Connections: mutual connect (request -> accept) + implicit institution
   clustering.** Symmetric "colleague" connections form the trust graph; everyone
   sharing a verified domain forms an automatic institution cluster. A connection
   is a one-click trusted share target.
3. **Institution view: show the listed members (LinkedIn-style).** Anyone sees
   the institution page WITH its member list, not just a count. Because being
   listed is the default (decision 1), in practice the list shows everyone at the
   school; only users who explicitly opted out (`listed=false`) are absent. This
   is the core discovery value: finding other researchers at an institution.
   (Revised 2026-06-14 from the earlier "gated detail" framing, which defeated the
   purpose. Email is still never exposed; reaching someone still goes through the
   share/connect flow.)

## The unified profile model

One canonical profile keyed by the account **owner key**, with the `@handle` as
its public address (`/u/<handle>`). The fingerprint-keyed `directory_profiles`
folds in as the "sharing/key material" join, not a second identity. Fields:

| Field | Source today | Public by default | Notes |
|---|---|---|---|
| `handle` | account_profiles | yes | unique, 3-30, changeable |
| `displayName` | both | yes | |
| `avatarUrl` | account_profiles | yes | capped data-URL thumbnail (keep cap) |
| `affiliation` | both | yes | free text |
| `affiliationDomain` + verified badge | directory | yes | auto from OAuth email domain |
| `departments[]` | NEW | yes | user-entered, MULTI-VALUE (joint appointments); typeahead-normalized per institution; self-asserted, not domain-verified |
| `orcid` | directory | yes (opt) | linked via ORCID; shows auto-pulled works |
| `bio` | NEW | yes (opt) | capped (see open Q on 280 vs 500) |
| `links[]` | NEW | yes (opt) | typed: website, researchgate, github, scholar, x, bluesky, linkedin, other |
| `listed` | NEW | n/a | master discoverability switch |
| `fieldVisibility` | NEW | n/a | per-field show/hide on the public profile |

The public `/u/<handle>` page (redesigned per the mockup) renders avatar, name +
verified badge, handle, affiliation, bio, the links row, the ORCID section with
auto-pulled publications, the connection count, a Connect / Share button when
viewing someone else, and an "N colleagues at <institution>" link. Your own
profile shows an Edit affordance.

### Publications (ORCID works): pinning + self-author highlight

The ORCID works list is not just a dump. Two refinements (Grant, 2026-06-14):

- **Pinned publications.** A researcher can pin ~3 works (a `pinnedPubs` list of
  ORCID put-codes / DOIs on the profile). Pinned works always float to the TOP
  with a pin icon, regardless of date, sorted chronologically among themselves
  (newest pinned first); unpinned works follow in chronological order.
  - Collapsed (default) view shows the pinned works first, then the newest
    unpinned, up to a small cap, with a "Show all N publications" button.
  - Expanded view shows ALL works but STILL keeps the pinned block (chronological)
    above the rest (chronological). Pinning changes order in both states; it never
    hides the rest.
  - Editing: pin/unpin is a control on your own profile's publication rows (a pin
    toggle), capped at a small number (start ~3-5, see open Q).
- **Self-author highlight.** In every paper's author list, the profile owner's
  own name is visually highlighted (bold / brand color) so a viewer can see at a
  glance which author position they held (first, middle, last/corresponding).
  - Matching: prefer ORCID's per-contributor iD when the work record carries it
    (exact, no false positives). Fall back to a normalized name match against the
    owner's display name + known variants (handle initials, "Last, F.M." forms);
    keep the matcher conservative so it never highlights the wrong author. Store a
    small set of name variants on the profile to improve the fallback.

## Connections (the trust graph)

- Symmetric `connections` table in Neon, keyed by the two owner keys, with a
  status (`pending` / `accepted`) and the requester. Mutual accept required.
  This is profile-metadata, server-side, NOT E2E (it is not research content).
- A connection request is a directory action, gated by the recipient's
  discoverability (an unlisted user is not requestable by strangers, only by
  people they share a folder/lab with).
- Connections power: a "Colleagues" count on the profile, a one-click trusted
  share target in the share picker, and a "mutual colleagues" hint on cold search
  results.
- Implicit clusters (no accept needed): everyone with the same
  `affiliationDomain` is an institution cluster member; co-members of a shared
  folder/lab are implicit connections for sharing purposes.
- **Connections list ON the profile (not just a count).** The Connect button is a
  dead end without a visible list, so the profile shows a connections section:
  avatar + name + handle rows, with a "see all" expand. On your own profile this
  is also where you manage pending requests. (Note: distinguish the two counts the
  mockup currently both labels "colleagues" - one is total connections, the other
  is "N at <your institution>"; relabel so they read distinctly, e.g.
  "42 connections" vs "14 other colleagues at UW-Madison" (Grant 2026-06-14, the
  "other colleagues at <institution>" form is clearer than a bare count).)

## Discovery + institution pages

- Extend `searchProfiles` (already trigram) to filter by institution domain,
  has-ORCID, and connection status, and to respect `listed`. Redesign
  `/researchers` into the discovery page (search + filter rail + result cards
  with trust signals), per the mockup.
- New `/institution/<slug>` page: header + a big count ("47 researchers on
  ResearchOS") + a few aggregate stats (ORCID count, labs sharing data), then the
  **full member directory** of everyone at that institution who is listed
  (searchable/filterable within the page, with Connect + Share on each row). Only
  users who opted out are absent. Counts come from `profilesByDomain`; the slug
  maps to a verified domain. This is the "find researchers at my school" surface,
  so the list is the feature, not a teaser.
- **Departments (a finer grain than institution).** Capture each user's
  department(s) and offer a dept facet of the institution page (filter "47 at
  UW-Madison" down to "8 in Bacteriology") plus dept-level density. Key data
  difference from institution: dept CANNOT be auto-derived from the email domain
  (most schools use one domain for everyone, and there is no clean global
  department registry, ROR is org-level only). So department is:
  - **User-entered and multi-value** (joint appointments / affiliate faculty span
    multiple depts).
  - **Self-asserted, not domain-verified** (the institution badge stays the
    verified signal; dept is a softer, LinkedIn-style claim).
  - **Normalized via a self-building per-institution typeahead** to fight
    fragmentation ("Dept of Bacteriology" vs "Bacteriology" vs "Microbiology"):
    the first user at a domain types it, it becomes a suggestion for the next, with
    light fuzzy-merge of near-duplicates. There is no clean pre-seedable global
    dept dataset, so the registry grows organically per institution (optionally
    primed from IPEDS/CIP program data where it helps).

#### Department deduplication (mostly non-LLM)

Layered defense, LLM is the last ~1% not the workhorse:
1. **Entry guidance (a nudge, not a guarantee).** Clear instruction to type the
   OFFICIAL full department name, not an abbreviation: "Department of Microbiology"
   (caps are fixed automatically), NOT "Dept. of Microbiology" / "Microbiology" /
   "Dept. of Micro". A "Department of ___" placeholder + right-vs-wrong examples.
   If a user types a bare "Microbiology", the typeahead auto-suggests the canonical
   "Department of Microbiology" form to click.
2. **Typeahead (pick existing > create new).** Institution-scoped, so the
   candidate set is small. Most dupes never get created.
3. **Deterministic normalization before matching:** lowercase, trim, strip
   punctuation, then expand a PRE-CURATED abbreviation/synonym map
   (dept->department, micro->microbiology, bact->bacteriology, path->pathology,
   mol->molecular, bme->biomedical engineering, ...), then trigram fuzzy-match
   against existing depts at that institution. Case-insensitive throughout. CAVEAT:
   ambiguous stems (Bio -> Biology/Biochemistry/Biomedical, Path ->
   Pathology/Plant Pathology) must NOT blind-expand; for those, defer to the
   typeahead full names + the LLM tail.
4. **Monthly sweep, non-LLM auto-merge:** normalized + high trigram similarity ->
   auto-merge the clear duplicates ("Department of Microbiology" vs "DEPT of
   Microbiology").
5. **Thin LLM tail, human-approved:** the genuinely ambiguous residue (uncommon
   abbreviations, reorderings, semantic equivalence) gets LLM-SUGGESTED merges that
   a human approves in the operator console. NEVER auto-merge on LLM judgment
   (false merges are destructive; "Biology" != "Molecular Biology"). This rarely
   fires given layers 1-4. Good fit for the Maintainer standing-role
   (`[[project_standing_roles]]`).
6. **Merges are reversible:** a merge repoints users to a canonical dept id and
   keeps the old name as an ALIAS, so future entries of the alias resolve too and a
   bad merge can be undone.

#### Community curation (wiki-style, the open-source way)

Empower users to fix the registry themselves, not just report to us (Grant
2026-06-14). The principle is Wikipedia's: 99% are good actors, so make good edits
FRICTIONLESS and bad edits CHEAP TO REVERT and fully VISIBLE, rather than
gatekeeping. Fits the open-source ethos and reuses the existing ResearchOS wiki +
the Maintainer standing-role. Tiered rights:
- **Anyone** can flag: "these two departments are the same" / "this name is wrong /
  misspelled". A flag is a lightweight report, not a destructive action.
- **Verified members of THAT institution** (domain-verified badge) can directly act:
  merge duplicates, rename to the canonical official form, fix metadata. This scopes
  edit power naturally (a `wisc.edu` person curates UW-Madison depts, not a random
  outsider) AND puts curation in the hands of the people who actually know their
  school's departments. Every edit is versioned.
- **Operator / Maintainer** handles escalations: contested merges, cross-institution
  cases, abuse, and changes to the SEEDED institution data (more conservative than
  the organically-grown dept data, since it is canonical ROR-sourced).

Guardrails for the 1%:
- **Full edit history + one-click revert** on every dept/registry change (the core
  wiki safety, vandalism is trivial to undo and attributable).
- **Reversible merges** (canonical id + alias, per the dedup design above); a merge
  preserves every affected user's membership (repoint, never delete).
- **Destructive ops need a real signal:** a merge fires on a verified-member action,
  OR N concurring community flags, OR high deterministic similarity; anything
  contested escalates to the operator queue instead of auto-applying.
- **Rate limits + an audit log** (who changed what, when), and community flags become
  high-signal input to the monthly Maintainer sweep.

This same flag-and-fix model can later extend to other shared/community data
(institution metadata, link types, etc.).

### How institution pages get created (provisioning)

Decision (Grant leaning + my rec, 2026-06-14): **pre-seed a canonical institution
registry, but lazily REVEAL pages** (do not generate empty ghost pages, and do not
build purely on the fly).

The institution identity is fundamentally keyed by the verified email DOMAIN. The
real reason to pre-seed is NOT the empty pages, it is the **domain -> canonical
institution mapping**, which solves two problems an on-the-fly approach cannot:
- **Subdomains / multi-domain:** `wisc.edu`, `cals.wisc.edu`, `g.wisc.edu` must all
  cluster into ONE "University of Wisconsin-Madison" page, not fragment into three.
- **Canonical display name + metadata:** a clean name (and later logo/location)
  instead of a raw domain string.

Recommended source: **ROR (Research Organization Registry)** rather than US News.
ROR is purpose-built for research institutions, global, free/open (CC0), and
carries org names + domains + stable IDs. US News is US-only, ranking-focused, and
its data is proprietary/paywalled. Optionally supplement with the US Dept of
Education IPEDS / College Scorecard (free) for US teaching colleges ROR may miss.
Ship the registry as a static JSON the app reads (the method-catalog pattern), so
there is no runtime dependency on an external API.

Mechanics:
- Build a `domain -> { canonicalName, slug, rorId }` registry at build time.
- An institution page is **hidden until its first verified member enrolls**, then
  revealed. So pages are pre-mapped, lazily activated. No thousands of empty pages.
- **On-the-fly fallback:** a verified domain NOT in the registry still gets a page
  (titled by the domain) so coverage is total; it can be reconciled into the
  canonical registry later. No researcher is ever stranded without an institution.

### Future: institutional go-to-market (adoption as lead-gen)

Idea (Grant, 2026-06-14): use the institution registry to seed future B2B
outreach. The honest scope:
- Auto-harvesting named contract/procurement contacts AT SEED TIME is not viable.
  ROR / IPEDS / US News carry org metadata (name, domain, location), never the
  person who signs software contracts. Bulk-scraping + cold-emailing them is also a
  legal/brand minefield (CAN-SPAM, GDPR, and it contradicts the trust-flip
  positioning).
- The buyer for a research-data tool is almost always the University LIBRARY's
  research-data-services group (how LabArchives lands campus deals), with the
  Office of Research / Research Computing as the compliance driver (NIH DMSP) and
  procurement executing once a champion exists.
- BETTER model: adoption IS the lead-gen. (1) Add a nullable
  `dataServicesContact` / `procurementContact` field on the institution record,
  enriched LATER, not at seed. (2) The institution page's "N researchers here"
  density is the sales signal; crossing a threshold triggers outreach, and the
  existing users are warm champions who can name the right buyer. (3) Surface an
  in-app "ask your library to sponsor a department plan" nudge to those users.
  (4) Optionally a later, careful enrichment pass (LLM + web search for the
  school's research-data-services librarian) that pre-fills a SUGGESTED,
  human-reviewed contact, never blind bulk outreach.
- This plugs into the already-built dept/institution tier: the "contract" is the
  Stripe procurement-invoice billing (Phase 3). Parked as a future GTM layer, not
  part of the profile/social build.

**Land-and-expand: leverage existing users to land institutional contracts**
(Grant 2026-06-14, the strategic pillar). The bottom-up adoption IS the sales
engine, the classic PLG-to-enterprise motion (Benchling / Notion / Slack). The
researcher, not us, drives the institutional ask, which is more credible and
sidesteps cold-outreach entirely:
- **Researcher-sent "sponsor us" nudge.** When a school crosses an adoption
  threshold, surface an in-app prompt to its power users / PIs: "12 labs at
  UW-Madison already use ResearchOS, ask your library to sponsor a department
  plan." One click DRAFTS an email FROM the researcher to their library /
  research office (researcher is the sender), reusing the existing
  draft-and-hand-off pattern from `[[project_purchase_docs_routing]]` (PI
  one-click "send to department", no OAuth, no us-as-spammer).
- **Operator warm-lead view.** An institution dashboard keyed on density (active
  users, labs sharing, growth rate) flags schools ripe for an institutional
  conversation, WITH the named existing users who can warm-intro the right buyer.
  Adoption density replaces a purchased contact list.
- **Champion identification.** The institution page already tells a prospective
  buyer "your colleagues are here"; internally it tells us who the champions are.
- Outcome: every institutional deal starts from a real on-campus user base, so the
  pitch is "your researchers already chose this" rather than a cold vendor email.
- **Department-level triggers (often the faster close).** Mirror the institution
  trigger at dept grain: "8 labs in Bacteriology at UW-Madison use ResearchOS, ask
  your department to sponsor a plan." The dept buyer (chair / department business
  office / administrator) is closer and more reachable than central
  library/procurement, and the dept tier already exists as a sponsorable billing
  entity (Inst -> Dept -> Lab -> Member). So a dept can sign before, or instead of,
  the whole institution, and several sponsored depts become the evidence for the
  institution-wide conversation. Dept density comes from the user-entered
  `departments[]` (self-asserted), so treat it as a softer signal than the
  domain-verified institution count.

## Claiming + official management of an institution / dept page

Today the discovery pages are auto-seeded + community-curated and OWNED BY NOBODY;
the org tier has admins but they are not linked to the page. This section closes
that gap (Grant 2026-06-14).

**Who can claim, and how it is verified.** "Official" status is tied to the ORG-TIER
sponsor relationship (payment), not a bare email domain (any `wisc.edu` person is not
authorized to represent UW-Madison). Payment is the authority proof, so it needs no
default manual step; an operator backstop exists only for rare disputes. An
institution official can delegate dept admins down the existing Inst -> Dept -> Lab
-> Member hierarchy. (See the verification reasoning below for why free does NOT
grant official status.)

**The verification problem and how we dissolve it (Grant 2026-06-14).** Authority to
REPRESENT an org is a social fact, not a cryptographic one. There is no fully
automated way to prove "you may manage UW-Madison's page" short of money, manual
review, or a DNS/role-email domain-control proof the real official (a librarian, a
chair) usually cannot perform. A solo-dev LLC cannot field manual review. So we do
NOT grant "official representation" for free. Instead we UNBUNDLE two powers that
were wrongly lumped under one word "claim":

- **Factual curation = FREE, non-exclusive, reversible, NO authority check needed.**
  Any verified-domain member can fix the dept list, merge dupes, correct names. This
  is just the community-curation tier. Nothing exclusive or authoritative to grab,
  ten people can curate, every edit is versioned and one-click revertible, so a bad
  actor cannot do real damage and no verification is required.
- **Official voice + branding + affiliate badge = PAID (sponsor-gated), and payment
  IS the check.** The powers where impersonation would matter (posting announcements
  AS the institution, the logo/banner slot, the "Sponsors ResearchOS" badge) require
  sponsorship. Nobody runs an institutional invoice / PO / dept-business-office card
  for an org they do not represent, so the procurement payment through Stripe is the
  authority proof, and it is 100% automatic, no review, no calls, no contracts to
  field. The affiliate badge auto-appears on payment, on the page AND on member
  profiles at that domain ("your institution sponsors ResearchOS"), as social proof +
  a GTM flywheel.

THE FIRM RULE: free can edit FACTS (reversible); only paid can SPEAK and BRAND as the
institution. This keeps the on-ramp while removing the verification burden entirely.
Bad actors have no incentive at the free tier (nothing exclusive to seize); disputes
vanish (free curation is non-exclusive; if two want "official," the payer wins
automatically); ops stay near-zero (community revert + Stripe + an operator backstop
for rare edges). DECIDED (Grant 2026-06-14): do NOT build member-vouching for a free
"official" designation, not enough benefit to justify it at this stage. Payment is
the clean line for "official". Revisit only if a concrete need emerges later.

**Powers of a claimed page:**
- Branding: custom logo/avatar, banner, accent color, official "about".
- Badges: a verified "Official" badge on the page + the auto "Sponsors ResearchOS"
  affiliate badge on payment.
- Featured content: pin/feature labs, researchers, announcements; post resources
  (e.g. the library data-services contact, ties straight to the GTM champion).
- Top-tier curation authority: the official is the final say on their dept list,
  sitting ABOVE the community-curation tier (community flags still feed them).
- Analytics dashboard: researcher count, growth, engagement, value for them and a
  renewal hook.
- Hierarchy management: organize/claim depts, delegate dept admins.
- Later: custom landing for arrivals from their domain, SSO / bulk onboarding.

**Flywheel:** discover -> adopt -> official claims (free) -> sees analytics + wants
branding -> sponsors (paid) -> affiliate badge becomes social proof that drives more
adoption. Plugs into the dept/institution tier billing (Phase 3) and the
land-and-expand GTM above.

## Seamless external-collaborator sharing (the payoff)

Tie the existing `find-and-share` primitive into the social layer. The
"Share with..." picker is TIERED, fastest-path first (Grant, 2026-06-14):

1. **Lab mates first**, grouped nicely (your lab(s) / shared-folder co-members).
   These are the most common recipients and need zero search.
2. **Connections next** (your accepted colleagues), as one-click recipients.
3. **An open field** that does double duty: search by `@handle` / name across the
   directory, OR type an **email address**.
   - If the email IS associated with a ResearchOS account, it resolves to that
     recipient and the share sends to them (sealed if they have a published key).
   - If the email is NOT on ResearchOS, we send the existing "you have something
     shared, make an account to open it" invite email (the `email_invite`
     non-user path already built in `find-and-share` / the directory; reuse it,
     do not rebuild).

Throughout, the trust signal (lab mate / connected / same institution / verified)
is visible on each option, and `decideDeliveryMethod()` decides sealed share vs
one-time secure link vs account-invite email. A connection becomes a saved,
one-click recipient, so sharing to a colleague at another institution stops being
a chore.

## Account portability: change sign-in email / provider (the graduating student)

This is the highest-impact gap and the trickiest, because identity is keyed by a
peppered hash of the OAuth email, so naively changing the email changes the owner
key and orphans the profile, connections, and (worse) the data keypair.

Proposed model: introduce a STABLE internal account id decoupled from the email
hash, and treat the bound email/provider as a re-bindable credential rather than
the identity itself.
- A re-bind flow: while still signed in with the old provider, the user adds and
  verifies the new provider/email; the account id, `@handle`, connections,
  profile, and keypair all carry over; the old email binding is retired (with an
  optional grace window, see open Q). The verified-institution badge updates to
  the new domain (or clears if the new email is consumer).
- This needs care with the directory owner-key join and the relay/sharing key
  material. It is a meaningful sub-design and should be its own phase with its
  own review (crypto + data migration). It does NOT block the profile redesign,
  but it IS the thing that makes academic accounts durable, so it should land
  before broad PI launch.

## Privacy + security model (be explicit)

- Public, server-side (directory metadata, not E2E): handle, display name,
  avatar, affiliation, verified domain, bio, links, ORCID, connection counts.
  This is intentionally public profile data, like any academic profile.
- Never exposed: the user's email (directory stays email-hash-keyed and
  un-walkable), and all research content (stays local + E2E).
- `listed=false` removes you from search + institution lists + cold connection
  requests; your `/u/<handle>` can still resolve for someone you hand the link to
  (decision point, see open Q).
- Every discoverability control has a visible off switch (no soft-locks).

## Phasing

- **P1 Unified, enriched profile.** Merge the two profile models, add bio + typed
  links + ORCID-as-field, surface the verified badge + ORCID on the public
  `/u/<handle>`, redesign that page + the editor (incl. the discoverability
  panel). Highest value, no graph yet.
- **P2 Discovery redesign.** `/researchers` search + filters respecting `listed`,
  institution pages with public counts + gated detail.
- **P3 Connections graph.** Mutual connect requests/accept, colleague counts,
  connections as share targets, mutual-colleague hints.
- **P4 Sharing integration + portability.** Connections + verification as trust
  signals in the share picker; the email/provider re-bind flow (own review).

Each phase is shippable on its own. P1 alone makes PIs land on a real profile.

## Open questions for Grant

1. ORCID sync: public ORCID API (auto, ~80% coverage) vs OAuth-connect (manual,
   100%)? Mockup assumes public API as the default.
2. Bio cap: 280 chars (terse) vs 500 (a real intro paragraph)?
3. Connection label: "Colleague" vs "Collaborator"?
4. Institution listing control: per-person only, or can a PI suppress the whole
   lab from the institution page?
5. Email/provider switch: a grace period (both providers work ~30 days) vs an
   atomic swap?
6. One-time secure-link TTL for non-members: 7 days / 30 days / sender-set?
7. Unlisted users: should `/u/<handle>` still resolve via a direct link, or 404
   when `listed=false`?
8. Pinned-pubs cap: 3 vs 5? And the collapsed-view total before "Show all"
   (e.g. pinned + newest-2)?
9. Self-author highlight fallback when ORCID gives no per-contributor iD: rely on
   the conservative name-variant match, or let the user manually confirm their
   author position per pinned paper?

## Relevant code

`lib/account/account-profile.ts`, `lib/sharing/directory/db.ts`,
`lib/sharing/directory/affiliationDomain.ts`, `lib/account/find-and-share.ts`,
`app/u/[handle]/page.tsx`, `app/researchers/page.tsx` + `[fingerprint]`,
`components/researchers/ProfileCard.tsx`, `components/account/AccountHome.tsx`,
`components/settings/SharingSection.tsx`. Memory: `[[project_cloud_accounts_local_data]]`,
`[[project_cross_boundary_sharing]]`, `[[project_nih_sharing_initiative]]`.
