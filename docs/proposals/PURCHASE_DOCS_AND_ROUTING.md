# Purchase documents and department routing

Status: DRAFT for sign-off. Captures the workflow Grant described on 2026-06-10.
No code yet. House style: no em-dashes, no emojis, no mid-sentence colons.

## Why this exists

A real lab purchasing workflow, from Grant's PI: a student places an order and has
to hand the PI a PDF (the order form or invoice). The PI then emails that PDF to
the department or HR person who covers the funds, often for approval or
record-keeping. Today that PDF travels by hand, lands in someone's email, and lives
nowhere durable. The lab loses the document, the audit trail, and any record that
the hand-off happened.

ResearchOS already holds the purchase, the grant link, and the PI approval step. So
the PDF and the email hand-off can live on the purchase, where the audit trail
forms itself. This is the same provenance idea as the lab archive (see
LAB_ARCHIVE_CONTINUITY.md), applied to the purchasing workflow.

For academic labs this is grant-audit and fund-accounting hygiene, not taxes
(universities are tax-exempt). State it that way.

## The workflow, in three layers

These stack on the purchase record that already exists (PurchaseItem has vendor,
catalog number, price, the grant link via funding_account_id, and the built PI
approval and flag state).

1. Attach the document. The student attaches the order-form or invoice PDF to the
   purchase. Stored local-first in the folder (the same pattern methods use,
   `methods/<slug>/source-X.pdf`), so `purchases/<id>/doc-<label>.pdf`. The
   receipts stay in the owner's folder, zero cloud cost, and they flow into the lab
   archive for retention.
2. Route to the PI. Nothing new to build. The existing PI approval and flag
   surfaces (PI_CAPABILITY_REVAMP) carry the attached PDF to the approval step, so
   the PI sees the document when they approve.
3. Send to the department. The new affordance. On an approved purchase, the PI gets
   a one-click "send to department" that produces a pre-drafted email, recipient
   and subject and body filled, the PDF attached, for the PI to preview, edit, and
   send. This is the painless part.

## The email-send decision (the crux)

Grant's vision is "sent from his Wisconsin email, he sees the preview, edits, sends,
all from the website." There are two ways to do that and they are very different in
weight.

- Draft-and-hand-off (recommended for v1). We build the fully drafted email,
  recipient, subject, body, with the PDF attached, and hand it to the PI's own mail
  client as a ready-to-send draft (a generated draft they open in Outlook, or a
  pre-filled compose). The PI reviews and sends. It genuinely goes from their real
  UW address because they sent it, with no stored credentials, no impersonation, no
  deliverability risk, and it works without our server send infra. This is most of
  the magic with almost none of the weight.
- In-app send from a linked account (later phase, only if PIs want to skip the last
  click). Truly sending as the PI's UW email means OAuth into Microsoft 365 (UW is
  Outlook) with send scopes, token storage, and refresh, and it only works when our
  server infra is on. Real rabbit hole, real security surface, for a feature a
  minority needs. Not v1.

Note: the existing admin email infra (mailer.ts on Resend) sends from a ResearchOS
address, which is wrong here, the department person needs it from the PI. So this is
not a reuse of that path, it is the draft-handoff path above.

## Managing bloat (the 90 percent who do not need this)

This is a roughly 10 percent workflow. The rule that keeps it from cluttering
everyone: it is a per-lab opt-in module, invisible until the PI turns it on.

- A PI configures "purchasing email routing" once, in lab settings: their department
  or HR contacts, and a default email template.
- Only when that is configured does a "Send to department" affordance appear on
  approved purchases in that lab.
- Every other lab never sees a pixel of it. No default UI, no empty states, no
  nudge.

Niche capabilities survive as PI-configured modules, not as default surface.

## This belongs in a Lab Head settings hub

This feature is a forcing function for something overdue: lab-head UX deserves a
deliberate rethink, not more bolt-ons. The PI capability revamp already produced a
PI hub on Lab Overview and a Lab Mode settings area. That is the natural home for
"the PI configures their lab", which is starting to accumulate real surface:

- department or HR email routing (this doc)
- retention posture and the membership agreement (LAB_ARCHIVE_CONTINUITY.md)
- approvals and flag policy (PI_CAPABILITY_REVAMP)

Design this as one card in a coherent Lab Head settings hub rather than a standalone
bolt-on. A small dedicated design pass on that hub is worth doing before or
alongside this feature.

## Audit and correspondence record (a bonus, not extra work)

Every "send to department" writes a correspondence record on the lab: which PDF, to
whom, when, by whom, for which purchase and grant. That is the grant-audit trail,
the same idea as the archive and the same shape as the LLC email log on the admin
page. The workflow documents itself, which is half the value.

## Data model sketch

- PurchaseItem gains an optional, additive attachments list (label, folder path,
  added-by, added-at, kind: order_form | invoice | receipt | quote | other). Stored
  local-first under `purchases/<id>/`. Additive and optional, old records normalize
  to empty, consistent with every other additive field on PurchaseItem.
- A per-lab routing config (PI-owned, in lab settings): department contacts (name,
  email, what they cover), one or more email templates.
- A per-lab purchasing-correspondence log: one row per send (purchase id, grant,
  document, recipient, subject, sent-by, sent-at). Doubles as the audit trail.

## Phasing

1. Attach a document to a purchase (manual), local-first, surfaced on the purchase
   and carried to the PI approval step. Plus a "missing document" nudge per grant.
   This alone is useful and is shared with the lab-archive receipts story.
2. Lab Head settings hub (small design pass) plus the routing config: PI sets up
   department contacts and a template, gated and invisible until configured.
3. The "send to department" draft-and-hand-off action on approved purchases, with
   the correspondence record. The painless hand-off, no OAuth.
4. Later, only if wanted: in-app send from a linked institutional account (Microsoft
   Graph or Gmail OAuth), so the PI can skip the last click.

## Open questions for Grant

1. Is the draft-and-hand-off model (PI sends from their own client) acceptable as
   the real v1, with in-app send deferred? Recommended yes.
2. Should the document attachment land first as its own small thing (phase 1),
   independent of the routing, since it is also the lab-archive receipts feature?
   Recommended yes, it is the shared foundation.
3. Do you want a dedicated Lab Head settings hub design pass before building the
   routing, or build the routing as a single card and let the hub emerge? The hub
   touches retention, approvals, and routing, so a small upfront pass is probably
   worth it.
4. Who can attach a document, the purchase owner only, or any lab member and the PI?
   Default read: the owner and the PI.
