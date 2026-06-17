# BeakerBot for department heads (the dept copilot)

Spec, 2026-06-17. Direction by Dr. Grant Nickles: give BeakerBot a presence on
the department page that helps a department head use the tools they have, answer
questions, and run the department. Parallels the lab-head copilot
(docs/proposals/2026-06-17-beakerbot-lab-head-utilities.md), one level up. House
voice (no em-dashes, no emojis, no mid-sentence colons).

## The premise

A lab head runs one lab. A department head runs a container of labs on one
invoice. The department portal (/department, PortalShell + DeptAdminPanel) is a
deliberately separate surface from the research app shell, with one promise on
it: "we aggregate billing and usage, never their research data." Today the dept
head manages a roster of lab heads, sends invite links, and (Phase 2, approved
and not yet built) reads a usage + cost dashboard. There is no AI on this page,
and the global research-shell BeakerBot does not appear here (the portal is not
the research shell).

The dept head's job is oversight and operations across labs, plus the org admin
work. That is a real second copilot, the same way the lab-head copilot was a
second product surface aimed at the PI.

## Two constraints (the same house rules)

1. BeakerBot never interprets. It surfaces facts (counts, usage, what changed,
   what is over a cap) and the dept head judges. No "this lab is underperforming."
2. The tool owns every number, the model only narrates. Every figure comes from a
   deterministic tool over the dept's own records, never from the model.

## Two tiers, split by one boundary

The department portal's promise ("never their research data") is the exact line
that separates a low-risk first tier from a bigger, governance-gated second tier.

### Tier 1, the admin copilot (within the boundary, ship first)

Lives on the dept portal. Operates only on what the portal already exposes, the
aggregate usage, the billing, and the roster, never research data. It helps the
dept head use the tools they already have:

- `dept_usage_glance`. The usage + cost picture in plain language, by lab and over
  time. "Which lab is driving our storage cost this month", "are we over our seat
  plan", "what changed since last month". Reads the same /api/dept/usage the
  Phase 2 dashboard reads. Numbers from the tool, narration from the model.
- `dept_roster_ops`. Roster questions and actions. "Who is on the plan", "draft an
  invite for a new PI" (composes mintInviteForDeptAdmin), "who has a pending
  invite", "remove a lab head". The invite mint stays a consented, confirmed
  action (the proposePlan pattern), not a silent write.
- `dept_plan_explainer`. Explain the rate breakdown and the invoice in plain
  terms. "Why did the bill go up", "what is the per-seat rate", "what would adding
  a lab cost". Reads deriveDeptRate / plan.ts. The tool owns the math, this is the
  most common dept-head question.
- `dept_report_scaffold`. Assemble a department roster + usage summary into a
  scaffold for the annual or institutional report. Aggregate only, no research
  content. The dept head writes the narrative.

Tier 1 is fully within the current portal boundary, so it adds no new data-access
question. It is the clean, shippable first surface and it is immediately useful.

### Cross-lab research oversight, decided AGAINST (Grant, 2026-06-17)

A second tier that read research data across labs was considered and ruled out. A
department head never gets read access into any lab's research, ever. The portal's
"never their research data" promise is permanent and absolute, not a boundary a
later tier crosses.

The reasoning is clean. Research oversight is the PI's job, and the lab-head
copilot already does it at the lab level (a PI reads their own lab's synced work).
A department head's job is org administration, the plan, the roster, and the bill,
not looking into the science. A PI owns the grant and the records in their lab; a
department head does not, so giving them cross-lab research read would break the
trust the portal promises every PI. Keeping the department admin-only keeps that
promise intact and keeps the two roles cleanly separated.

So there is no department-level research index, no `dept_pulse`, no cross-lab
read. The department copilot is the admin copilot, full stop.

## Where it lives

On the dept portal (PortalShell), a distinct BeakerBot mount from the global
research-shell one. The portal has no research shell, so this is a focused,
role-scoped assistant surface (the dept head's tools), not the full BeakerBot.
This matches the idea that BeakerBot's tools light up by role and place, a lab
head gets lab tools, a dept head gets dept tools.

## Build sequence

The department copilot is the admin copilot, and it is built. There is no second
tier.

- Phase A, the admin copilot. DONE (the four read tools plus the scoped portal
  mount). It reads the same aggregate usage / roster / billing the portal already
  exposes, never research data.
- Follow-ups (optional, not blockers): a dept-scoped system-prompt persona so the
  framing fits a department head, and a consented `dept_invite` action tool
  (drafts and confirms, never a silent write).

## Open decisions

1. Admin copilot actions: do we let it take ACTIONS (mint invites) or stay read +
   draft only. Recommend read + draft + a consented invite, no silent plan
   changes. (Resolved direction, the invite tool is the one optional add.)

The cross-lab access-model question is closed: a department head never reads
research data across labs (see the section above), so there is no dept-scoped
transparency panel to build either.
