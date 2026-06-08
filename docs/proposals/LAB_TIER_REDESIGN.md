# Lab tier redesign: delete the shared folder, solo-free vs lab-paid, PI oversight without a shared disk

Status: DRAFT SPINE for sign-off (Grant + sharing/collab manager, 2026-06-07). NO CODE until the model is signed off. A deep-research pass is running in parallel; its findings fold into the Prior Art and the E2E-vs-server-mediated recommendation below. This doc captures the thesis from the 2026-06-07 design conversation.

## Why this exists

The shared-folder model is the fundamental weak link. Today every lab member points at ONE folder, synced between machines via OneDrive / Box / Dropbox. That couples the app to a third-party sync tool we do not control:
- It is slow. Files-on-demand placeholders make every File System Access read block on a cloud fetch, so even reading your own settings.json can hang. No amount of app speed fixes this.
- It is fragile. Sync delays, conflicts, and stuck placeholders break in-lab collaboration in ways we cannot fix from our side.
- It forces full copies. Every member needs the whole folder synced to their disk.

The identity-model-simplification doc already named the underlying truth, only cross-boundary sharing truly needs the cloud, and the shared folder is the weak link. This redesign takes that to its conclusion and deletes the in-lab shared folder entirely.

## The model (the thesis)

1. SOLO accounts are 100% local, free, fully offline, and have NO login. One person, one folder, one machine, nothing to gate. They connect and go.
2. LAB accounts are a PAID tier. A PI (lab head) creates a lab and adds members. Each member still owns their OWN local folder. Shared / lab data flows between folders via the cloud relay + directory, not a shared disk. You only ever hold the shared subset, never full copies of everyone's data.
3. A member's page still LOOKS the same as today, but it is assembled from shared items flowing between folders (a materialized local copy plus live relay updates), not from reading one giant shared folder.
4. Offline is NOT a concern for the lab tier. Solo works anywhere with no network; lab assumes a connection. No degraded-mode gymnastics.

## Why solo-free vs lab-paid makes the whole thing click

This is not just architecture, it is the business model, and the two reinforce each other.

- The cost structure lines up. A solo user costs us essentially nothing to run (no relay, no directory, no stored copies, all on their disk), so the free tier stays cheap to run forever, which is what the AGPLv3 + donations + RISE-fellowship model needs. Every dollar of cloud cost (relay, directory, materialized shared copies, metered storage) exists only for labs, which is exactly where the revenue is. Costs and revenue land on the same accounts.
- The buyer is the right person. In academia the PI holds the grant money and wants the oversight. So PI-pays-for-the-lab, members-do-not, matches reality. A member just needs a free account and an invite, and never sees a paywall.
- We already have the billing side. Stripe is live for the LLC, and the metered-storage cost-recovery model is designed. The add-second-user warning shipped 2026-06-07 is literally the paywall moment in disguise (it can become "creating a lab is a paid feature, here is what your members get").

Pricing (LOCKED, Grant 2026-06-07): METERED on lab usage, built on the EXISTING metered-storage / billing infra, not per-seat or flat. The PI pays for the lab's actual cloud footprint (storage of shared/materialized data + relay), which reuses the metered-storage billing already built ([[project_llc_business_ops]], Stripe live) rather than a new pricing engine and ties price directly to the cost a lab incurs. The paywall MOMENT is creating or joining a lab; members never see a paywall.

## Auth, radically simplified

- Solo = NO login. The entire local login we shipped in identity Phase 1 (password, passkey, recovery code, the whole envelope) only existed to protect switch-user inside a shared folder. Delete the shared folder and that justification evaporates. CONSEQUENCE: most of identity Phase 1 becomes unnecessary for solo and we would retire it. Fine pre-launch, but name it.
- Lab = third-party OAuth (Google / GitHub / ORCID / LinkedIn) as the identity, gating an online session. A lab folder carries a marker ("this account belongs to lab X"); the solo entry point checks for it and, if present, bounces the user to OAuth login first rather than the local path.
- Make "every open" mostly silent. Cache the session with a refresh token so most opens are an invisible re-auth, full Google screen only on expiry or a new device. The real enforcement is the server refusing to hand over the lab's shared data without a valid session; the folder marker is just the redirect.
- This REVERSES a locked decision in the identity doc ("OAuth cannot be the local login"). That was correct under the shared-folder + E2E model. Under this model it may no longer apply, so it is re-opened deliberately.

Clear-eyed framing so we do not over-promise: this gate protects cloud and lab participation and identity. It does NOT encrypt the local files; those stay plaintext on disk, protected by the OS and the machine, exactly like today. The privacy line is "your private solo data is local and yours, shared lab data is in the paid cloud." Do not market it as "the folder is locked."

## Load-bearing simplification: one folder equals one user, always

A direct consequence of deleting the shared folder, and arguably the biggest single simplification of the whole pivot. No folder ever holds more than one user. The multi-user-in-one-folder concept existed ONLY to let a lab share by pointing at a common disk, which is exactly the thing the cloud-sync slowness makes unworkable. Removing it removes the complexity AND the root problem at once. This holds all the way up, the PI's own folder is single-user too; their view of members is assembled from synced copies plus the lab key, never from a multi-user folder.

What this single rule retires:
- Switch-user, the account picker, and the "Continue as X?" quick-confirm. You open the tool, it is your folder, you are you. This is most of what UserLoginScreen does today.
- The `users/<name>/` multi-tenant namespacing and its bookkeeping (`_user_metadata.json`, per-user Main, colors-per-user-in-folder), collapsing to a single-tenant folder.
- `discoverUsers` as a folder scan as the way to find people. A lab's member list comes from the lab membership record (directory + relay), not from scanning a folder.
- In-folder sharing entirely. `canRead` / `canWrite` / `shared_with` between users in the same folder is moot when there is never a second user. ALL sharing becomes cross-folder via the lab key + relay.
- The local login's main reason to exist (no other account in your folder to switch into or protect against), reinforcing the solo = no-login decision.
- The add-second-user warning shipped 2026-06-07 gets superseded, adding a second person stops being "another user in your folder" and becomes "create or join a lab," a different flow.

Be deliberate about: the on-disk structure (fully single-tenant `<folder>/notes/...` vs a thin `users/<me>/` wrapper to ease migrating existing folders), and that the PI capability work (audit, approvals, flags, edit-with-confirm) is REUSED but re-points from "edit another user in this folder" to "edit a member's record cross-folder via the lab key."

## The hard center: PI oversight without a shared folder

Today the PI sees everything as a side effect of reading the same folder. In the new world that has to become a deliberate, by-construction property of how lab data is keyed and stored. The PI being able to get into a student's work must be true by construction, not by convention. This is the whole value of the paid tier and the hardest part of the build.

Proposed mechanism, a lab key with cloud-resident lab data:
- When a member joins a lab, their lab-relevant data is encrypted to a lab key the PI co-owns (alongside the member's own access) and synced to the paid cloud store, cached locally on both sides.
- That single choice delivers the three things we cannot lose:
  1. The PI can read any member's lab work, always, straight from the cloud, even when that member is offline or asleep.
  2. The PI keeps access when a student graduates, ghosts, or revokes, because the PI co-owns lab data by design rather than by being granted it. A member cannot lock the PI out of the lab's research.
  3. It is comprehensive by default, not opt-in. The student does not choose what the PI can see inside the lab.
- The PI getting into and editing a student's thing is then the cross-folder live-edit already built in external collab, plus the audit trail and confirm-guard built 2026-06-07. The PI's edit propagates to the member's copy over the relay, attributed and logged. So the entire PI capability arc carries over almost intact; it stops being "write to the shared folder" and becomes "write to the cloud-synced member record." This session's PI work is NOT thrown away.

THE pivotal product decision, where is the line between lab data the PI co-owns and the member's own private space:
- Option A. Everything in a lab account is PI-visible. Simplest, and matches the academic reality that the PI owns the lab's research output. A student who wants a truly private space keeps a separate solo account.
- Option B. A lab member has a private partition the PI cannot see, plus a lab partition the PI co-owns. More humane, more complex, and the boundary must be defined and defended so nothing leaks across it.
This choice ripples into pricing, the offline story, the crypto, and the marketing claim about who can see what. It should be reasoned through with the storage, crypto, and trust implications laid out, not answered casually.

## The crypto fork (the one real risk), pending the deep research

"Only the third-party login" and "PI comprehensive access" both run into the same wall, OAuth proves your email to our cloud, it does not unwrap a private key the cloud cannot see. So the question underneath is about E2E. Two honest branches:
- (a) Lab shared data stays end-to-end with a PI co-owned team key (we genuinely cannot read it). Then OAuth alone is not enough; a member still needs exactly one key-unwrap factor (recovery code or passkey) to get back in on a new device, and the team-key model must handle member departure (key rotation, retained access, re-encryption). Stronger trust story, more complexity.
- (b) Lab shared data is server-mediated / PI-readable (we can help unwrap and in principle read shared content). Then OAuth really is the only login and the whole thing gets dramatically simpler. Fits everything else, since lab data already flows through our relay, directory, and metered storage.

The natural privacy line almost draws itself, your private solo data is 100% yours, local, never touches our cloud, full stop; shared lab data lives in the paid cloud, which means it is in our system, and most lab-software users already assume exactly that.

RECOMMENDATION LEAN (from the prior art above): option (a), E2E with a PI co-owned team key. It is the shipped industry pattern for "org owns the data, admin always gets in, server stays blind" (1Password Recovery Group, Keybase PTK, Google CSE), and it keeps the local-first / NIH trust story strongest. It is more crypto to build than (b), but the patterns are well-documented, not novel. The required pieces are concrete: the lab key as a recipient on all member lab data so the PI reads everything by construction, rotation of the lab key when a member leaves (skipping this is the LastPass failure), seed-chaining so historical data stays readable after rotation, a signed membership/key log that doubles as the audit trail, and a recovery design that avoids the all-recoverers-locked-out bootstrap trap. Option (b) server-mediated stays the fallback if the team-key build proves too heavy for v1, since lab data already transits our cloud anyway. Decide deliberately, but the evidence favors (a).

## Prior art (deep research 2026-06-07)

RESEARCH CAVEAT. The deep-research harness had a tooling failure on this run. The adversarial-verification phase and roughly half the source fetches errored (subagents failed to return structured output), so the harness auto-reported "all claims refuted / inconclusive." That verdict is FALSE. The killed claims have vote 0-0 (the verifiers never voted, they abstained on error), not genuine refutations, and the surviving claims come from authoritative PRIMARY sources. The crypto angle (the most decision-relevant) came through well. The academic-data-ownership, local-first-precedent, and per-seat-pricing angles failed to fetch and still need a re-run or targeted follow-up. Findings below are treated as credible primary-source claims, not independently re-verified.

The crypto prior art strongly supports option (a), E2E lab data with a PI co-owned team key. The "org owns the data, the admin can always get in, and the server stays blind" pattern is shipped at scale by multiple products:

- 1Password Recovery Group (primary, agilebits security-design + support). Vault keys are encrypted to a group's public key. A designated group can re-encrypt a vault key to a member's new key after they lose credentials, so recovery and access are performed by people inside the org, never the vendor, and the server has zero knowledge of passwords or secret keys. This is almost exactly the PI-co-owned-lab-key shape. Two cautions it surfaces. It separates recovery capability from comprehensive read (a recovery group can recover a key but is server-policy-gated from silently reading vaults), and it has a hard lockout mode (if every recovery-capable person is locked out simultaneously, no one can restore; even an Owner cannot self-recover, recovery always needs a second person).
- Keybase teams, per-team key (primary, book.keybase.io). A per-team key (PTK) is shared by encrypting the team seed to each member's per-user public key, available on all their devices, server-blind. On member leave / removal / device revoke the PTK ROTATES and is re-encrypted only for remaining members. Old data stays readable via seed-chaining (each previous seed encrypted under the next generation). Membership and the public halves of every key generation are committed to a public signed sigchain, an auditable record of roster and key changes. This is the canonical "team key plus rotation on departure plus audit log," which maps directly onto lab membership and dovetails with the PI audit trail.
- Tresorit (blog). Shared-folder master key rotated on membership change, so a removed member cannot decrypt content added after removal (they retain pre-removal data), distributed via per-user asymmetric keys. Plus the LastPass cautionary tale, WITHOUT rotation a former member's later-cracked old password can decrypt newly-encrypted data even after all org passwords were changed, because the keys themselves were never rotated. Rotation-on-departure is not optional.
- Google Workspace Client-Side Encryption (primary). The ORGANIZATION holds the keys (its own KMS), Google cannot decrypt, and the org controls the identity provider that gates access to those keys. This is the enterprise "org owns the keys, server blind, identity-gated" model, and it validates pairing OAuth-identity-gating with org-held keys.
- Matrix Megolm (primary). Group session crypto with only partial forward secrecy; rotation on membership change is deferred to the application layer. Less directly applicable (messaging, not documents) but reinforces that rotate-on-membership-change is the app's responsibility.

Net read. A PI-co-owned team key, E2E, server-blind, rotated when a member leaves, with seed-chaining for historical continuity and a signed membership log, is the industry-standard answer to exactly our problem and preserves the local-first / NIH "you own your data" story better than a server-readable model. The known pitfalls to design against are the lockout / recovery bootstrap (1Password) and skipping rotation (the LastPass failure Tresorit documents).

ACADEMIC DATA OWNERSHIP (direct fetch 2026-06-07, Stanford + NYU research-data policies). This strongly validates the PI-oversight design, with one refinement. The INSTITUTION owns research data, not the PI and not the student. Stanford, "tangible research property, including the scientific data... conducted under the auspices of Stanford University, belongs to Stanford." NYU, "the PI is the custodian for the University of Research Data... holds original Research Data in trust for the University." The PI is the custodian with access rights, not the owner. The PI legitimately accesses members' data, NYU, "Research data must be available to [associated] investigators when such access is appropriate," and the University maintains "unfettered access." On departure, the member may take COPIES but the originals stay, Stanford, "Original data, however, must be retained at Stanford by the PI." So "the PI can always access a lab member's research data and retains access when they leave" matches real norms almost exactly. The refinement, members ALSO have a protected right to access the data they participated in (Stanford explicitly protects students'/postdocs' "rights to access to data from research in which they participated"), so the model must not lock a member out of their own work, which the local-first per-member copy already guarantees.

LOCAL-FIRST + CENTRAL AUTHORITY (direct fetch 2026-06-07, Ink&Switch local-first essay). Local-first does not forbid servers, it reframes them, your local copy is the primary copy, servers hold secondary copies as "cloud peers" for sync, backup, and discovery, not as gatekeepers. The one real tension, the essay's user-ownership ideal frames it as "no company should restrict what you do with your data," which reads as incompatible with centralized oversight of a user's data. The resolution for us is the solo-vs-lab split itself. SOLO honors all seven local-first ideals fully, the data is purely the user's. LAB is a different ownership regime, institution-owned research data under PI custody, which is exactly what the academic norms above describe. We are not a company surveilling personal data, we are giving a lab custodial access to the lab's own research data. So the split is not a compromise of local-first, it is two honest ownership models for two honest account types.

CONSEQUENCE for the private-vs-lab boundary (decision #2). The academic norm leans toward Option A, everything in a LAB account is the lab's research data and is PI-accessible, while a member who wants genuinely private work keeps a separate SOLO account (their own, fully local, no PI). That matches "lab research data is custodially accessible, your personal work is yours." Still confirm with Grant, but the norm points at Option A plus solo-as-the-private-escape-hatch.

STILL THIN (lower priority): per-seat PI-pays pricing norms (well-understood pattern, confirm later), and deeper local-first-with-central-sync implementation references (Anytype any-sync) if we want them.

## What this pivot reframes elsewhere

- Identity Phase 1 (local login envelope) becomes largely unnecessary for solo; retire it.
- Identity Phase 2 (account_type collapse): solo-vs-lab is a real, billable capability line again, not just a hint. The isLabHead work holds, but "is this a lab" now also gates paid features.
- The unified data model / canWrite + shared_with: today folder-and-username based; under this model, lab access derives from lab membership + the lab key, cross-folder.
- In-lab collab Phase 3 (pubkey membership): subsumed; there is no in-lab shared folder anymore, a lab IS the cross-folder graph.
- The PI capability arc (edit member records, audit, approvals, flags, workload): carries over, re-pointed from folder writes to cloud-synced cross-folder writes.

## Non-goals / out of scope (v1)

- Not changing the solo experience (stays local-first, free, offline, no login).
- Not building anything until the model is signed off.

## Locked decisions (Grant, 2026-06-07)

1. CRYPTO: E2E with a PI co-owned TEAM KEY (option a). Lab data is end-to-end encrypted to a key the PI co-owns; our server stays blind. Build the proven pattern, lab key as a recipient on all member lab data (PI reads everything by construction), ROTATE the key when a member leaves, seed-chain so historical data stays readable, a signed membership/key log that doubles as the audit trail, and a recovery design that avoids the all-recoverers-locked-out bootstrap trap.
2. VISIBILITY (private-vs-lab boundary): Option A. EVERYTHING in a lab account is the lab's research data and is PI-accessible. A member who wants genuinely private work keeps a SEPARATE SOLO account (fully local, no PI). Matches the academic norm exactly, simplest boundary.
3. PRICING: METERED on lab usage, built on the EXISTING metered-storage / billing infra (see [[project_llc_business_ops]] / [[project_stripe_setup]]), NOT per-seat or flat. The PI pays for the lab's actual cloud footprint (storage of shared/materialized data + relay). The paywall MOMENT is creating or joining a lab; members never see a paywall. This reuses already-built billing rather than a new pricing engine.
4. RETIRE identity Phase 1's local-login envelope for solo. Locked by implication of solo = no login (no second account in a folder to switch into, nothing to gate). The keypair/crypto primitives that the lab team-key reuses stay; the password/passkey/recovery LOGIN gate is retired for solo. (Grant to give the final nod, but it follows directly.)
5. MIGRATION: BUILD a real conversion path, NOT wipe-and-re-establish. Convert an existing multi-user shared folder into per-user folders plus a lab record, preserving data in place. This is now a real workstream, not a footnote, it has to split a shared folder's data by owner, stand up each person's own folder, create the lab membership + team key, and materialize the shared subset. The on-disk structure choice (single-tenant vs a thin users/<me>/ wrapper) should be made to make this converter tractable, the wrapper likely eases it since today's layout is already users/<name>/.

## Open decisions still to settle (smaller, during build design)

- On-disk folder structure (fully single-tenant `<folder>/notes/...` vs a thin `users/<me>/` wrapper), chosen to ease the migration converter.
- Lab membership record location + format (the directory holds it; exact shape, signing, and how invites/joins work).
- Recovery design specifics for the team key (PI recovery, member recovery, the lockout-bootstrap guard).

## Voice

No em-dashes, no emojis, no mid-sentence colons.
