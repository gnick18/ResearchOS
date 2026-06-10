# Lab Head hub (the lab-head UX consolidation)

Status: DRAFT for sign-off. The convergence point for three feature threads plus
the lab-head UX rethink Grant flagged on 2026-06-10. No code yet. House style: no
em-dashes, no emojis, no mid-sentence colons.

## Why this exists

Lab-head capability has grown feature by feature, and it now lives in five
different places. Three more configuration surfaces are about to land (retention,
purchasing routing, membership agreement). Without a deliberate pass, the PI
experience becomes a scavenger hunt and every new lab feature gets bolted on
wherever there is room. Grant called this out directly: lab-head UX needs a rethink,
not more bolt-ons.

This doc does that rethink. It is mostly an organizing pass, not a big build, and it
gives the incoming modules a coherent home instead of scattering them.

## Current state (the real scatter)

Lab-head surface today, verified in the code:

- Settings, Lab Mode tab (`app/settings/page.tsx`): account type switch, Lab Roster
  (archive and restore members), Lab Membership panel, the audit-trail viewer,
  Roadmap tab visibility.
- `/lab-overview` page: a PI tools quick-access card plus an embedded roster (a live
  dashboard).
- Inline on records: the PI kebab, approve, flag, edit-as-lab-head, view audit (from
  PI_CAPABILITY_REVAMP). These are correct where they are, the action happens on the
  record.
- `/purchases`: purchase approvals.
- `/lab-inbox`: the flag queue.

The actions on records are fine inline. The problem is the configuration and
oversight surface, which is split between the Lab Mode settings tab and the
lab-overview page with no clear line between them, and has no room reserved for what
is coming.

## The organizing principle

Two distinct lab-head surfaces, each with a clear job. Stop blurring them.

- Lab Overview = the live dashboard. What is happening right now: pending approvals,
  flagged items, recent activity, the roster at a glance. You visit it to see state.
- Lab Head hub (the Lab Mode settings area) = configuration and oversight. How the
  lab is set up and the durable records: roster and membership, approval and flag
  policy, audit trail, retention posture, purchasing routing. You visit it to set
  things up and to prove things to an auditor.

Actions stay inline on the records where the work happens (approve on the purchase,
flag on the note, send-to-department on the approved purchase). The hub is where you
configure and oversee, never the only place to act.

Optional modules follow the opt-in rule from the purchasing doc: a module is
invisible until the PI turns it on, so a lab that does not need purchasing routing
or cloud retention never sees those cards.

## Proposed hub structure

The Lab Mode settings tab becomes the Lab Head hub, organized into clear cards
rather than a flat stack. Cards, grouped:

People
- Roster and membership: who is in the lab, archive and restore, the membership
  agreement and its acceptance record (LAB_ARCHIVE_CONTINUITY.md).

Oversight
- Approvals and flags: the lab's approval and flag policy, and links into the live
  queues on Lab Overview and lab-inbox. Policy here, queues on the dashboard.
- Audit trail: the existing per-member audit viewer. The compliance record.

Data and retention (optional module)
- Storage posture and retention: the lab's storage posture (ResearchOS cloud,
  institutional drive, mixed), the retention registry and dashboard, per-member
  export. From LAB_ARCHIVE_CONTINUITY.md. Hidden until the PI engages retention.

Purchasing (optional module)
- Department routing: department and HR contacts, email templates, the purchasing
  correspondence log. From PURCHASE_DOCS_AND_ROUTING.md. Hidden until the PI
  configures routing.

Account
- Account type and role, the existing switch.

The first build is the reorganization plus reserving the two optional-module slots,
even before those modules are built, so they land as planned cards instead of
bolt-ons.

## Relationship to Lab Overview

Keep them separate and make the split legible. Lab Overview answers "what needs me
today" (approvals, flags, activity). The hub answers "how is my lab set up and what
is the record." Cross-link them: a queue count on the dashboard deep-links to the
record, a policy in the hub links to its live queue. Do not duplicate the roster as
two unrelated widgets, have one roster component surfaced in both with the right
mode (glance on the dashboard, manage in the hub).

## Phasing

1. Reorganize the existing Lab Mode tab into the grouped card structure above
   (People, Oversight, Account), no new capability, just coherence. Reserve the two
   optional-module slots as hidden-until-enabled placeholders. Low risk, pure UX.
2. Clarify the Lab Overview versus hub split and the cross-links, de-duplicate the
   roster surfacing.
3. The optional modules land into their reserved slots as they are built (retention
   from the archive doc, purchasing routing from the purchase-docs doc).

## Open questions for Grant

1. Is "Lab Overview = live dashboard, Lab Head hub = config and oversight" the right
   split, or do you want one combined lab-head surface? Recommended split.
2. Should phase 1 (pure reorganization of the existing Lab Mode tab) ship on its own
   as a quick coherence win, independent of the new modules? Recommended yes.
3. Naming: "Lab Head hub", "Lab Mode", or something else for the settings surface.
   The tab is "Lab Mode" today.
4. Anything lab-head that exists today and is NOT in the inventory above that should
   have a home here.
