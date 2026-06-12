# Check-ins, revamped: any-account mentorship trees + group check-ins

Status: proposal, not built. Authored 2026-06-11 by the orchestrator from Grant's direction plus a code map of the current 1:1 surface and web research on 1:1 / team-meeting / academic-mentorship tooling. Supersedes the scope of the 2026-06-07 "1:1 revamp" (which shipped the current Workbench Check-ins tab).

## The idea in one paragraph

Today the Check-ins tab models a single relationship shape, a lab head meeting one member, and only a lab head can create it. But mentorship in a real lab is a tree, not a flat layer. A PI mentors a postdoc, that postdoc mentors a grad student, that grad student mentors an undergrad, and a person is usually a mentor and a mentee at the same time. Meetings also come in two shapes, the one-on-one and the recurring group meeting where five people share goals and split up tasks. So Check-ins should generalize. Any account can start a check-in space with anyone, a space can have two people or many, and tasks can be shared by the whole group or assigned to specific people. On top of that general spine, the thing that makes this built-for-a-lab instead of a re-skinned corporate tool is a layer of academic structure (development plans, expectations agreements, career-stage templates, committee meetings, presenter rotations) that no generic 1:1 product carries.

## What Grant asked for

1. Any account can set up check-in spaces, not just lab heads. Mentorship is an arbitrary tree (PI to postdoc to grad to undergrad), and the same person is both a mentor and a mentee.
2. Group check-ins. A group of five doing a weekly meeting wants a shared space where everyone sees the same board, can mark off shared tasks, and can also assign different tasks to different people.
3. Flesh it out. Build on those ideas and add what is being missed.

This doc designs all three, then adds the research-informed layer, then lists what we should deliberately NOT build, then proposes a build order and the decisions that need Grant's call.

## Where the current implementation stands

From the code map (`WorkbenchOneOnOnePanel.tsx`, `oneOnOneGate.ts`, `lib/one-on-one/`, `local-api.ts` `oneOnOnesApi`, `lib/types.ts`):

What exists and is reusable.
- The four sub-tabs already gesture at the right primitive (Weekly goals, Meeting notes, Notes, Agenda/action items). The "agenda item carries a done flag" and "weekly goals grouped by week" are the seed of a rolling agenda and a task board.
- The `Notebook` model is ALREADY N-member capable (`members: string[]`, 1 = private, 2+ = shared) and ships today. `membersSharedWith(members)` already generalizes sharing to any number of people, all at edit.
- Notes scope to a relationship via a foreign key (`one_on_one_id` on a Note, mutually exclusive with `notebook_id`). The `labApi` aggregation pattern (walk every member's folder, filter by id + permission, dedupe) already works for multi-member reads.
- Permissions run through the unified `shared_with` primitive, so multi-member visibility is a solved problem.

What is load-bearing and blocks generalization.
- `OneOnOne` hardcodes exactly two participants as two named fields, `labHead` and `member`, instead of a `members[]` array. The label, the sharing, and the create dialog all assume the binary.
- Creation is gated behind `requireLabHead()`. The member is passive, the lab head owns the record, and the tab visibility/label logic conflate "is a lab head" with "is the mentor."
- There is no mentorship-edge concept (no parent/child), no per-item assignee on a weekly goal (contrast `Task.assignee`, which exists), and no private-vs-shared notion inside a check-in (everything is shared between the two).

The headline: the data plumbing (sharing, aggregation, N-member notebooks) is ready. The 1:1 record shape and the lab-head gate are what we rewrite.

## Part 1, the generalized model

Replace the two-field `OneOnOne` with a single space type that covers 1:1 and group, created by anyone.

A check-in space.
- `id`, `created_by`, `created_at`, `owner` (the creator), `title?`, `color?`, `icon?` (reuse the notebook appearance fields so spaces look like notebooks).
- `members: string[]`, two or more. A two-member space renders as a 1:1, a 3+ space renders as a group. One shape, one code path.
- `kind: "pair" | "group"`, derived from member count but stored so the UI and templates can branch without guessing.
- `cadence?: { every: "week" | "2weeks" | "month" | "none"; weekday? }`, optional, drives the "your check-in is coming up, add agenda items" prompt.
- It is its own record (not folded into `Notebook`) because it carries structured content (goals, action items, cadence, optional IDP) that a plain notebook deliberately does not. But it reuses the notebook sharing + appearance + multi-folder-mirror conventions so we are not inventing storage.

Creation, opened to everyone.
- Drop `requireLabHead()`. Any user picks one or more people and starts a space. The creator becomes `members[0]` and `owner`.
- The tab gate becomes "show Check-ins when you are in at least one space," for every account type. A lab head no longer needs a special case because starting a space is now a universal action. (Open question D1 on whether lab heads still get an always-on tab.)

Mentorship as a tree, layered on top of spaces.
- A space optionally records a direction, `mentor?: string` (a member who is the mentor for that space). A pair space with a mentor is a mentoring relationship, a pair space with no mentor is a peer check-in, a group space with a mentor is a team a PI runs, a group space with no mentor is a peer group.
- The lab's mentorship tree is then just the set of mentor-directed edges across all spaces. PI to postdoc, postdoc to grad, grad to undergrad each becomes one pair space with a mentor set. The tree is a VIEW over data we already have, not a separate structure to maintain.
- Because direction lives per space, the same person is naturally a mentor in one space and a mentee in another, which is exactly the postdoc case.

Naming and labels.
- The tab stays "Check-ins" for everyone (retire the role-flipped "Mentoring" tab label, it breaks once anyone can mentor). Inside, a space is named by its people and an optional title ("Mira, weekly" or "Aim 2 team"). A mentor viewing a mentee's space can still see a quiet "you mentor Mira here" cue, but the relationship is shown, not hardcoded into the tab name.

## Part 2, group check-ins with shared and assigned tasks

The group ask is mostly an assignee and a couple of views on top of the goal/action-item model that already exists.

- Add `assignee?: string | null` to the weekly-goal / action-item shape (mirror `Task.assignee`, which already exists). No assignee means a shared item the whole group owns and anyone can check off. An assignee means "this one is for Sam," shown with a small person chip.
- Add `assignees?: string[]` only if Grant wants one item shared by a subset (open question D3). Default to single-assignee, it covers the stated need and stays simple.
- Views on the group board: "Everyone" (the full board grouped by assignee, with a Shared band for unassigned), and "Mine" (just my items across this space). Reuse the dense-row + colored-band pattern we just built for the explorers, so a group check-in board reads like the rest of the app.
- Who can check off what: keep it permissive (any member can check any item) because policing completion in a 5-person lab is friction, but only the assignee or creator can delete. (Open question D2.)
- Carry-forward: an unchecked item stays on the board and, at the next cadence, shows a quiet "carried over from <date>." This is the single most-loved feature in every tool surveyed and we already store a done flag, so it is mostly a query.

## Part 3, the academic layer (the part generic tools miss)

This is the differentiator and it leans on patterns we already use (static-JSON templates like the method catalog, the NIH-compliance positioning, the GANTT and notes we already have). Ordered roughly by leverage.

Career-stage-aware templates (Core). The check-in template adapts to the mentee's stage. Undergrad (skills, course balance, is research for me), grad student (prelim, aims progress, committee timeline), postdoc (independence, the job market, first grant), staff. Ship about six seed templates, not a 500-template marketplace. This is how six templates feel like fifty, and it is what makes the surface read as built for a lab. Source pattern, AAMC stage-specific compacts and CIMER career-stage tailoring.

Individual Development Plan (Core differentiator). A living IDP per mentee (skills self-assessment, career goals, yearly goals) that the mentor reviews and that auto-pulls into the annual check-in. This is the highest-leverage academic feature because NIH progress reports now expect an IDP, so it is a compliance hook that ties straight into our existing NIH-compliance story, not just a nicety. Sources, AAAS myIDP, the UW-Madison Grad School IDP (our own institution), NIH RPPR.

Mentoring compact / expectations agreement (Core or strong nice-to-have). A one-time structured "expectations" doc per relationship (working hours, authorship norms, communication cadence, vacation policy) that both acknowledge and can revisit. Mentoring research (CIMER) finds misaligned expectations is the number one cause of mentoring breakdowns. Seed from the AAMC compact templates, and pair it with onboarding below.

New-member onboarding checklist (strong nice-to-have). When someone joins, spin up a first-check-in space with an onboarding checklist (access and keys, safety training, data-management practices, the lab norms doc, set the check-in cadence). Most labs have no formal onboarding, and this dovetails with the compact and with our data-management story (the UW research-data onboarding checklist literally exists). Low effort, it is a checklist.

Mentorship-tree visualization (lab tree Core and cheap, personal map nice-to-have). Two flavors. The lab hierarchy tree (who checks in with whom) falls almost free out of the spaces + mentor-edge data, render it as a tree. The mentee's personal "mentoring map" (the NCFDD constellation model, a mentee at the center with multiple mentors by support type, research mentor, career mentor, peer mentor) is a reflective tool the mentee fills in, novel and well-liked, but optional.

Rotating presenter / journal-club schedule (nice-to-have, delightful). In a group space, an auto-rotating schedule of who presents data and who leads journal club, visible to all, with the upcoming presenter prompted to prep. Labs track this today in a spreadsheet or on a whiteboard. It is the one group feature that is unmistakably for a lab. Sources, PLOS "Running Laboratory Meetings" and the lab-meeting "ten simple rules."

Thesis/dissertation committee support (nice-to-have, leaning core for grad-heavy labs). A committee is a group space whose members are not the PI, on an annual cadence, with a "pre-circulate the progress report and Specific Aims" prompt, a recorded next-meeting date, and the private-session structure (student steps out, advisor steps out) handled by private notes. It is mostly a template + cadence + private notes, so it reuses the spine. No corporate tool can serve this, and the artifacts (annual progress, Gantt) connect to features we already have.

Skip-level check-ins (nice-to-have, nearly free). A PI checking in with a grad student who reports to a postdoc. The any-account model already supports it structurally, the value-add is a contextual cue (surface the direct mentor in the tree so it is clearly a skip-level) and naming it in the UI so PIs think to do it. It catches the student quietly struggling under a postdoc who will not say so.

Cross-cutting spine features worth stealing directly (Core, table stakes from the corporate tools).
- Rolling agenda that carries unfinished items forward (Fellow, Lattice, Hypercontext).
- Either party adds talking points before the meeting, with authorship shown (Fellow, Hypercontext).
- Action items with an owner and due date that roll up into that person's existing task surface, living next to their other lab work, not siloed in the check-in tab (Fellow, Lattice).
- Private notes beside shared notes in the same view (Hypercontext, Lattice). Academically vital, a mentor's candid assessment is often not yet shareable.
- A recurring cadence with an in-app pre-meeting prompt (Fellow, 15Five). Local-first means this is a dashboard badge, not a server email.
- A per-relationship meeting history / timeline (Fellow, Lattice). In academia this IS the paper trail for annual reviews and committee reports.
- Optional "decision" tag on a note ("we are dropping Aim 2"), searchable later. Cheap, and unusually valuable in research where "why did we decide X two years ago" recurs.

## What we should deliberately NOT build

The research was adversarial about corporate-tool features that become bloat at lab scale. Recommended out of scope unless a user asks.
- Mood / sentiment traffic lights and engagement scorecards. In a three-person lab, asking your one grad student to rate their mood red/yellow/green to the person who controls their funding is awkward and gameable. The honest signal comes from the IDP and the private 1:1. If anything, a private-to-self wellbeing note is the academically appropriate version.
- A standalone praise / recognition wall. A six-person lab celebrates in person. Fold genuine milestones (paper accepted, candidacy passed) into the timeline as career-record entries instead.
- Daily async standups. That cadence is built for software sprints. A wet lab does not have daily shippable progress. Default to weekly and frame prompts as "what I am working on / where I am stuck," not "what I shipped yesterday."
- A 500-template marketplace. Ship about six career-stage templates from static JSON, the way the method catalog works.
- Heavy notification infrastructure and cascading OKR trees. At lab scale "goals" means IDP goals and aims progress, not a company-wide OKR cascade.

Global constraint: ResearchOS is local-first, so every reminder / notification / analytics idea must take a passive in-app form (a dashboard badge, a "last met" date) rather than a server-pushed email or Slack message. Treat that as a hard design rule for this feature.

## Suggested build order

1. Generalize the spine. Replace `OneOnOne` (two fields) with the member-array space type, drop the lab-head create gate, keep the four sub-tabs working for two-member spaces. Add carry-forward to the agenda. This is mostly a refactor of code that exists, and it ships the "any account, any pair" win.
2. Group check-ins. Add `assignee` to goals/action-items, the Everyone / Mine board views (reusing the dense-row + band pattern), and a member-picker that accepts more than one person. Ships Grant's group ask.
3. The academic moat. Career-stage templates + IDP + compact/onboarding, built on the static-JSON template pattern. This is what makes it feel like a lab tool.
4. Structure and visualization. Mentor edges + the lab mentorship tree view, skip-level cue, presenter rotation, committee template. Mostly views and templates over the spine.
5. Hold the bloat list. Revisit only on real user demand.

## Decisions, LOCKED 2026-06-11 (Grant, all per recommendation)

- D1, tab gate. ALWAYS show the Check-ins tab for every account, with a friendly empty state + a "Start a check-in" button, so creating your first space is always reachable.
- D2, group completion permission. ANYONE can check off any item in a group space. The assignee is a label showing who it is for, not a lock.
- D3, assignees. SINGLE assignee per item. Shared items (no assignee) already mean "everyone." Keeps the chip UI and done-semantics simple.
- D4, action-item to task sync. YES, a check-in action item with a due date syncs into that person's main task list / GANTT, so it lives next to their other lab work. Accept that this touches the task model.
- D5, IDP. BUILD IT FOR REAL, sequenced. A first-class structured IDP in the academic-layer phase (phase 3), after the spine refactor + group tasks land. It is the differentiator and an NIH progress-report requirement.
- D6, naming. "Check-ins" is the umbrella for EVERYONE. Retire the role-flipped "Mentoring" tab label; relationship/direction is shown inside each space.

## Sources

Corporate tools: Fellow (1:1 agendas, action items, templates), Lattice (1:1 log, carry-forward talking points, action items, analytics), 15Five (weekly rhythm, sentiment), Hypercontext/SoapBox (shared agenda, private notes), Range and Geekbot (async standups, mood, flags), skip-level meeting literature (Lighthouse, Radical Candor).

Academic practice: AAAS myIDP and UW-Madison Grad School IDP and NIH RPPR (development plans), AAMC mentoring compacts and CIMER Entering Mentoring (expectations alignment), NCFDD Mentoring Map (constellation model), PLOS and the "ten simple rules" lab-meeting guides (presenter rotation), eLife and UW research-data onboarding checklists, and the UPenn/MIT committee-meeting guidelines (annual cadence, pre-circulated progress report, private sessions).
