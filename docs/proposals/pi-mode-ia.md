# PI Mode, a lab-first experience across every surface

Status: design, mockup in progress. Owner: UI/PI-experience lane. Date: 2026-06-12.

## The problem
A PI's job in ResearchOS is not a bench researcher's. PIs manage people, approve spending, review and comment on members' work, mentor, watch lab-wide activity, and steward funding and compliance. Most PIs never run their own experiments and never build personal project folders. Yet a PI account today lands in the researcher UI with a different home page bolted on. The Workbench defaults to personal Projects/Experiments/Lists the PI never uses, and the genuinely PI-shaped surfaces (lab experiments/notes browse, approvals, roster, mentoring, audit) are scattered across separate routes reached by stray links.

We already built the hard part. The 2026-06-07 PI capability revamp shipped lab-wide browse (`/lab-experiments`, `/lab-notes`), edit-as-lab-head (once-per-session confirm, owner-routed write, audit trail), purchase + supplies approvals, the roster, the flag queue, and mentoring via Check-ins. What is missing is a coherent information architecture that puts those in front of the PI as their default experience.

## The principle
PI Mode shows the lab, not the self. Every surface defaults to its lab-wide / oversight lens for a PI. A persistent "My work" toggle drops to the personal researcher view for the PIs who still bench, so we honor both the manager-only PI and the still-pipetting PI.

## Locked decisions (Grant, 2026-06-12)
1. Lab-lens is the default everywhere; the personal workspace stays reachable via one clear "My work" toggle (not removed).
2. The global nav adapts to a PI-specific tab set and order; researcher-only tabs the PI never uses drop to More or out of the primary lineup.
3. v1 covers the full PI-Mode IA across every page (one comprehensive review mockup), not just the landing.

## The PI nav lineup (primary, in order)
1. Lab Overview (home) — the "what needs me" command center
2. People — roster, member workload, mentoring/Check-ins, IDP-on-file status
3. Lab Work — browse every member's experiments and notes (read-only, edit-as-lab-head)
4. Approvals — purchase requests + supplies orders + the flag queue, one queue
5. Activity — the lab-wide feed of experiments, notes, tasks
6. Funding — grants/funding accounts, spend vs budget (PIs care; today it is buried)

Secondary / More: Methods (lab protocol library), Calendar (lab-wide), Gantt (lab rollup), Inventory (lab), Data Hub, Sequences, Chemistry, Links, Compliance, Settings.

A persistent "My work" control switches to the researcher tab set (personal Workbench, Gantt, etc.) for PIs who bench. Switching back returns to PI Mode. The mode is remembered.

## Per-surface treatment (before -> after)
- Nav: researcher tabs -> PI-first lineup above + My-work toggle.
- Lab Overview: a vertical stack of uniform cards -> a command center. A "Needs you" hero (pending approvals, flagged records, @-mentions, blocked/overdue), a compact lab stat strip, then the activity feed + a people snapshot. Leads with what needs the PI (Grant's call).
- Workbench -> "Lab Work": personal Projects/Experiments/Lists/Notes/Check-ins -> People/Roster, Lab experiments (all members), Lab notes, Mentoring. Personal tabs move under My work.
- Purchases: personal purchase list -> approvals queue first (pending requests across the lab), then lab spend.
- Supplies / Inventory: personal -> lab inventory + the order-approvals lens by default.
- Methods: personal protocols -> the lab protocol library (public + members'), with who-is-using-what.
- Gantt: personal timeline -> lab-wide rollup of members' projects and milestones.
- Calendar: personal -> lab-wide events (lab meetings, members' key dates).
- Funding: elevate the funding-accounts data into a real PI surface, spend vs budget per grant.
- Methods / Data Hub / Sequences / Chemistry: still tools a PI may open; reachable, not PI-primary, unchanged content.
- Settings: surface the lab-head section; otherwise unchanged.

## Open questions for the mockup review
- Does "Lab Work" fully replace the Workbench label for a PI, or is Workbench kept and re-tabbed?
- Should Approvals and the flag queue be one unified inbox or stay split?
- Is Funding a new top-level surface or a panel inside Lab Overview?
- Exact "My work" toggle placement (header chip vs in the More menu vs an account-menu switch).

## Deliverable
A comprehensive interactive before/after mockup (our standard harness: surface-by-surface, comment pins, per-change approve/disapprove, export) so Grant reviews each change. Then build the approved surfaces, lab-lens-default with the My-work toggle, reusing the existing PI capability layer.

House style: no em-dashes, no emojis, no mid-sentence colons.
