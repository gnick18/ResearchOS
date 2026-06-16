# Department and institution governance tier (offering spec)

> Status: DRAFT, 2026-06-15. Strategic spec for the org governance tier, feeding the master pricing bible. This reframes the org tier from a solidarity storage surcharge into a governance product. House style applies (no em-dashes, no emojis, no mid-sentence colons).

> SCOPE (Grant, 2026-06-15). For launch and beta there are exactly three priced tiers, Solo, Lab, and Department. The institution tier is punted to post-launch. The reason is that the standout offering, the shared Commons of methods, databases, and protocols, is coherent at the department level (related labs in one field that actually share techniques) but does not scale across an institution (chemistry, sociology, and physics share none of it), which leaves the institution tier as a long enterprise sale with no wow, wrong for a beta. The governance plumbing (compliance, SSO, budgets) scales up fine and the institution tier already exists in code behind `INSTITUTION_TIER_ENABLED`, so punting means leaving that flag dark, no deletion. Department is the top tier for now. References to "institution" below read as the eventual post-launch expansion.

## The reframe

The department and institution tier does not sell the same storage at a higher per-lab price out of goodwill. That framing is fragile, because a cost-conscious administrator will eventually notice the department can just have each lab sign up individually for less, and the model collapses the moment someone runs the math. Goodwill is not a business model.

Instead the org tier is a different product. It sells institutional governance, the things that aggregating thirty individual lab subscriptions literally cannot provide. The margin on that governance layer is what funds the free tier for individual researchers. The "it sustains free science" story is the warm narrative on top, never the reason a purchase order gets signed.

The market proof is everywhere. GitHub is free for individuals and GitHub Enterprise sells SSO, audit, and compliance. Nobody at a company asks why pay for Enterprise when the developers could each use free GitHub, because the company needs the controls. Notion, Figma, and Slack run the same split. The org tier is a governance product.

This also de-risks the whole model. The sustainability analysis shows that paid solo and lab users already cover the free base on their own, so the org tier is the margin and growth engine, not a survival dependency. The real sustainability question is paid conversion on a generous free tier, not institutional altruism.

### What this changes about pricing

The earlier working invariant was "dept and inst pay more per lab on storage." Under the governance reframe that should become "the org tier adds a governance fee, and storage is priced at or below standalone." That removes the defection incentive entirely (consolidating is equal or cheaper on storage and you also get the controls), and the margin that funds the free tier comes from the governance layer institutions genuinely want and have budget for. To be confirmed against the live pricing model before the bible locks.

## The honest sales answer to "why not just have my labs sign up individually?"

You can, and for a small informal group that is genuinely fine and we will not upsell you. The department tier exists for when you need one invoice instead of thirty reimbursements, central control over who has access, guaranteed data retention when people leave, a security and compliance review your office can sign off on, and a shared library of standards every lab inherits. If you do not need those, individual is the right call. That honesty self-selects the institutions who actually have governance needs and builds trust instead of reading like a shakedown.

## The offering pillars

The five load-bearing offerings, each impossible to replicate by aggregating individual subscriptions:

1. **Per-lab budget and quota controls.** Carve the shared org pool so one lab cannot drain everyone's AI tokens or storage. Per-lab hard or soft caps, threshold alerts to the admin and the lab head, mid-cycle reallocation between labs, an unallocated reserve labs can request against, and a per-lab spending freeze. This is the direct answer to "one lab should not be able to use the whole pool."
2. **Central admin dashboard.** Cross-lab visibility the institution cannot get otherwise. A usage view (storage, AI, activity per lab and per member, with burn-down projections), a cost view (spend broken down by lab and by grant or fund code, the chargeback report a research office needs to bill costs back to grants), and a governance view (audit log, data inventory, access map, offboarding queue).
3. **SSO and lifecycle management.** SAML or institutional login (Microsoft Entra, Google Workspace, Shibboleth), SCIM directory sync to auto-provision and deprovision, delegated administration (institution admin, then department admins, then lab heads), and an offboarding workflow.
4. **Data governance and continuity.** Covered in detail below (Model B).
5. **Procurement and billing.** A single annual invoice or PO on net terms, per-grant cost allocation, a self-serve plan builder with mid-year amendment, and the vendor onboarding paperwork (W-9, DPA, security packet) that lets the purchase happen.

## Data continuity (Model B)

In a local-first app, data continuity is real only when the data lives somewhere the lab or institution controls, not on a departing student's laptop. There are two such places, the shared folder and a cloud copy. The chosen default is Model B, the shared folder.

**Model B (default).** Each lab's shared folder lives on the institution's own managed storage, for example the university OneDrive or SharePoint that every member already gets. The plaintext research data therefore sits on institution infrastructure from the start. There is no ResearchOS cloud copy and no encryption-key escrow to solve. ResearchOS provides the structure, the sync, and the governance layer on top.

Member departure is mostly the lab layer and largely works today. A member's notes, experiments, and methods are in the shared lab folder, so they stay when the person leaves. Offboarding is a transfer of ownership to the PI plus a lab-key rotation to revoke access, machinery already being built in the identity lane. The one real gap is data a member kept only on a personal laptop and never synced, which the storage-compliance tooling below is designed to catch.

Whole-lab or PI departure is the department layer. If the folder was on institutional storage, IT already has it. If it was on a personal drive, the department needs a retained copy, which is the only case where the optional Model A applies.

**Model A (optional).** A ResearchOS-held, end-to-end encrypted cloud archive for labs not on institutional storage, recoverable through the C3 escrow design already in flight. Opt-in, belt and suspenders, not the default.

The marketing claim becomes precise and true. Your institution's research data lives on storage your institution controls, ResearchOS keeps it structured and captured, flags anything trapped on a personal device, and hands you clean ownership and recovery when people leave.

## Storage compliance tooling

The concrete feature that makes Model B enforceable. The department sets a policy that all ResearchOS folders must live on institutional storage. The payroll roster is the master list, and the portal shows every account with a status (compliant, pending setup, local-only, or unknown). Non-compliant users get gentle but persistent reminders through the existing notification system, and a one-click helper guides them to move their folder into OneDrive and re-point ResearchOS at it.

**The hard constraint, stated plainly.** ResearchOS runs in the browser through the File System Access API, which deliberately hides the absolute folder path for privacy. The app can read a folder's name and walk down into it, but cannot read whether it sits inside OneDrive. So this is compliance tooling (policy, visibility, nudges, attestation), which is what real compliance tooling is, not forensic enforcement.

**The verification ladder.**
1. Attestation plus reminders, ships first, works for every institution, trust based.
2. Heuristic confidence, best-effort signals that raise confidence without proving (folder-name patterns, whether the same data is synced across the user's devices).
3. Provider hard-verify through a pluggable storage-provider connector. The department selects its institution's cloud provider, and ResearchOS verifies through that provider's API where one exists, Microsoft Graph for Microsoft 365, the Google Drive and Admin SDK for Google Workspace, plus Box and Dropbox Business, confirming the user has the storage provisioned and the ResearchOS folder present. Attestation stays the universal baseline for any provider we have not integrated, so the feature works everywhere and gets stronger where an API exists.

The storage substrate is already provider-agnostic, because ResearchOS connects to a synced folder on disk and does not care which cloud syncs it (OneDrive, Google Drive, Box, Dropbox, and iCloud all present the same way). Only the verification is provider-specific, so it lives behind a StorageProvider connector seam, the same registry pattern as the existing FigureSource and AssetSource seams, and the policy, the move helper, and the reminder copy are all parameterized by the chosen provider.

Division of labor. ResearchOS owns the roster, policy, per-user status, nudges, and the move helper. Institutional IT owns the provider's admin console (OneDrive, Google Workspace, Box, or Dropbox) and, when connected, the provider verification. We are the layer that maps ResearchOS folders specifically onto the institution's storage and makes the gaps visible and self-healing.

## The Department Commons (the standout offering)

The single most unique thing the org tier can provide. A curated, governed shared library that sits one level above the labs in the sharing hierarchy. Every lab inherits it and can search it, and the department owns and curates it.

**The line that keeps it ours.** A department can already dump files in a shared OneDrive folder, so the trap is becoming a file share. Our value is that the shared resources are structured, searchable, embeddable, and version-controlled. A plasmid you search by sequence and drop into an experiment, a reference table you run the validated stats engine against, a protocol that auto-fills into a method and updates everywhere when the department revises it. Not a folder of PDFs.

**Resource types, strongest first.** These map onto object types ResearchOS already has.
1. Standardized methods and protocols. The department's official SOPs, versioned, embedded into experiments, updated across every lab on revision.
2. Reference databases (Data Hub tables). A strain table, a controls dataset, an antibody-validation database, queryable by every lab and analyzable with the validated stats engine.
3. Sequence, plasmid, and strain repository. A searchable structured in-house collection, a mini internal Addgene, that drops straight into a cloning experiment. Uniquely ours because nobody else holds the sequence layer.
4. Compound and molecule library, via the chemistry workbench.
5. Department-standard calculators, published from the Calculator Builder.
6. Templates for projects, experiments, ELN, and data-management plans.
7. Controls, standards, and QC reference data every lab validates against.
8. Validated analysis pipelines, so results are comparable across the department.
9. Shared inventory and core-facility catalog with equipment booking.
10. Literature collections and safety or compliance documents.

**Why it is legitimately paid org-tier and not free sharing.** The governance is the paid part. Curation control and an approval workflow, versioning and deprecation, an official department standard designation, mandatory versus optional resources, new-lab inheritance (spin up a lab pre-loaded with the department's standards), and usage analytics that show which protocols are actually used and which are stale. Free labs can share peer to peer. Only a department can run a governed, authoritative, inherited library.

Lead with methods and protocols, reference databases, and the sequence and plasmid repository. The rest is reinforcement.

## Public department and institution pages

Public pages are a free distribution play, not a paid perk. Gating them behind the paywall hurts the funnel, because the SEO and network effects feed free-tier growth, which drives the solo and lab conversion that actually sustains the company. So the claimable directory is free, in the style of a Google Business Profile, and verification of control over the .edu domain is the honest version of a blue check.

The useful page content is the living research substance a hand-maintained faculty site cannot keep current. An always-fresh people and expertise directory, an open protocols showcase drawn from the Commons, and a reproducible outputs showcase tied to the transparency work. The only page element the paid tier earns is a data-stewardship verified mark, backed by the storage-compliance system, a trust signal a funder or collaborator actually values because it cannot be faked. The directory work folds into the researcher social-layer lane, not the billing lane.

## Decisions locked 2026-06-15

- Compliance verification builds a provider-agnostic verification seam into the beta from the start, not deferred. The department selects its institution's cloud provider (Microsoft 365, Google Workspace, Box, Dropbox), and ResearchOS hard-verifies through that provider's API where one exists, needing tenant-admin consent to activate. Attestation is the universal fallback for any provider we have not integrated. Marking a member exempt requires a reason and an expiry, so an exemption cannot become a permanent silent bypass.
- Commons revision behavior. When the department updates a resource, a lab gets an explicit accept-changes prompt, not a silent swap, and can either accept the new version or fork it into a personal or lab copy using the existing fork system, so a lab can deliberately diverge from the department standard. This protects an in-progress experiment from a method changing underneath it.
- The Commons includes labs-contribute-upward (the approval queue in the approved mockup), built on top of the read-only foundation.
- The dept portal mockup is approved.

## Open decisions

1. Confirm the pricing shift from "more per lab on storage" to a governance fee with storage at or below standalone, against the live model.
2. Build phasing for the Commons, read-only top-down first and then labs-contribute-upward as phase two, per the architecture sketch.

## Companion artifacts

- Interactive mockup of the dept portal (compliance view plus Commons), `docs/mockups/2026-06-15-dept-portal-commons-and-compliance.html`.
- Commons architecture sketch, `docs/proposals/2026-06-15-department-commons-architecture.md`.
- Memory, `project_dept_inst_governance_tier`, `project_dept_institution_tier`, `project_pricing_finalize_2026_06`.
