# BeakerBot for lab heads (the PI copilot)

Brainstorm + spec, 2026-06-17. Decisions by Dr. Grant Nickles: PI role grants read
over all lab data; flesh out all six categories. House voice (no em-dashes, no
emojis, no mid-sentence colons).

## The premise

Every BeakerBot tool we have is bench-first, scoped to the user's own work. A lab
head's job is different: oversight, mentorship, grants, operations, stewardship,
and writing, across the whole lab. This is a second product surface aimed at the
PI, built on the engines we already have, pointed at lab scope instead of self
scope.

## Two constraints that shape everything

1. BeakerBot never interprets. Every tool here SURFACES the lab's own facts
   (counts, what changed, what is stalled, what is missing) and the PI judges.
   "Stalled" is deterministic (no activity in N days, overdue by the due date),
   never "this trainee is struggling." This is what keeps it a useful instrument
   instead of a wrong or creepy one. The tool owns every number, the model only
   narrates.

2. Access scope: PI role grants read over all lab data (Grant, 2026-06-17), with
   the trust machinery that requires. Concretely "all lab data" is all data in the
   lab workspace, the experiments, notes, results, methods, tasks, inventory, and
   purchases that members sync to the lab through the collab model. Data a member
   keeps purely local and never syncs is not reachable by definition (it is not in
   the lab). So the PI governs the LAB'S synced data, which is defensible (the PI
   owns the grant and the records), and it composes with the existing lab collab
   workspace rather than reaching into private disks.

   The trust machinery (required, not optional, since this is role-based not
   opt-in):
   - Transparency. Members can see what the PI's tools surface about them (a
     "what your PI's lab view shows" panel), so it never feels like a back room.
   - Audit. Every lab-scoped read by a PI tool is logged (who, what, when), the
     same audited-writes pattern the PI capability revamp uses for edits.
   - No-interpretation still holds, so the PI sees facts about shared work, not a
     verdict about a person.

## The new capability under all of it

A LAB-SCOPED READ. Today the CRUD + summary tools are own-only (they read the
signed-in user's objects). The PI tools need a lab-scoped reader that, gated on the
PI role, enumerates and reads every member's synced lab objects through the collab
workspace, emitting an audit record per access. This is the one genuinely new piece
of infrastructure. Everything else reuses an existing engine pointed at the wider
set.

## The six categories

### 1. Oversight, the PI's morning glance
- `lab_pulse`. The daily or weekly digest: per-member activity (experiments run,
  notes and results added, tasks done and overdue), what is NEW since the last
  glance, what is STALLED (deterministic: no activity in N days). Extends
  `lab_digest`. No ranking, no "who is behind", just the counts the PI reads.
- `find_across_lab`. `search_full_text` over the whole lab ("every experiment that
  used reagent X", "every protocol that mentions Y"), with the owning member shown.
- `lab_throughput`. The lab's outputs over a period (experiments, results,
  deposits, methods written) aggregated, for the PI's own reporting.

### 2. Mentorship and one-on-ones
Builds on the shipped check-in, IDP, lab-meeting-rotation, and mentorship-tree
features.
- `prep_one_on_one`. A trainee's recent shared work plus their open items plus what
  changed since the last check-in, assembled into a one-on-one agenda DRAFT (their
  work and the PI's own notes, condensed, never a read on how they are doing).
- `lab_meeting_prep`. The presenter from the rotation plus their recent work into a
  meeting outline.
- `onboard_member`. A starter checklist plus assigned starter protocols plus a
  workspace for a new member, in one consented setup (the `setup_*` composite
  pattern).

### 3. Grants and compliance, where a PI saves the most time
- `progress_report_scaffold`. Aggregate the lab's outputs over a grant period into
  an NIH RPPR or renewal SCAFFOLD, sectioned, with the underlying records linked.
  The PI writes the narrative; the tool never claims significance.
- `dmsp_compliance`. Which datasets and results are deposited (Zenodo) versus not,
  which carry version history, the data-management-plan gaps. Ties into the NIH
  sharing + Zenodo work.
- `grant_tagged_rollup`. Everything tagged to grant G across the lab, aggregated
  for reporting.

### 4. Operations, inventory, ordering, budget
Billed to the PI, so the PI lens is the right one.
- `reorder_digest`. What is low across the lab plus the reorder queue, surfaced.
- `spend_summary`. Purchases aggregated by period, vendor, or grant, the PI's
  billing lens (extends the purchases summary to lab scope).
- `inventory_audit`. What is expiring, out of stock, or unlocated across the lab.

### 5. Quality and reproducibility, the PI's stewardship
- `method_drift`. Find divergent protocol variants across members (the same method
  run slightly differently). LIST the differences, never judge which is right.
- `reproduce_member_result`. Rerun and validate a member's analysis with the
  PDF-reproduce / analysis-rerun engine, on shared lab work, verifying the numbers.
- `protocol_gaps`. Methods referenced in experiments but never written up;
  experiments lacking a protocol.

### 6. Synthesis, the PI's output
- `methods_section`. Assemble a paper's methods section from the lab's actual run
  protocols (condensed, the PDF-reproduce + summary pattern).
- `lab_figure`. Pull members' plots into a figure via the figure composer + Data
  Hub.

## Build sequence (since "everything" still needs an order)

Dependencies and leverage set the order:

- Phase 0, the lab-scoped read + audit + the member transparency panel. Everything
  depends on it, and it carries the trust contract, so it is first and it is the
  one piece that needs care, not just plumbing.
- Phase 1, Oversight (`lab_pulse`, `find_across_lab`, `lab_throughput`). Highest
  daily use, smallest reach past the read layer, proves the pattern.
- Phase 2, Mentorship (`prep_one_on_one`, `lab_meeting_prep`, `onboard_member`).
  Concrete, builds on shipped features.
- Phase 3, Grants + compliance (`progress_report_scaffold`, `dmsp_compliance`,
  `grant_tagged_rollup`). Highest time-saved per use, ties into NIH + Zenodo.
- Phase 4, Operations (`reorder_digest`, `spend_summary`, `inventory_audit`).
- Phase 5, Quality + Synthesis (`method_drift`, `reproduce_member_result`,
  `protocol_gaps`, `methods_section`, `lab_figure`).

Each tool follows the house rule: deterministic aggregation in the tool, the model
narrates, results render in the existing summary / record-set / analysis widgets.

## Open decisions

1. Member transparency surface: a passive "here is what your PI's lab view shows"
   panel, or an active notification when a PI tool reads your work? Passive is
   lighter; active is more trust-building but noisier.
2. Audit visibility: PI-only, member-visible, or lab-admin-visible?
3. Where the PI tools live: the same BeakerBot chat (role-gated tools that only
   appear for a lab head), or a distinct "Lab" mode of BeakerBot. Same-chat is
   simpler; a Lab mode signals the different scope.
4. Off-by-default: should the lab-scoped read be a setting the PI turns on (and
   members are told), even though the role grants it, as an extra trust step?
