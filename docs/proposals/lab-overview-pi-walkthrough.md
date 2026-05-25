# Lab Overview (PI) first-visit walkthrough

Author: lab-overview PI walkthrough proposal manager
Date: 2026-05-25
Status: Proposal, awaiting orchestrator direction

## Problem

Mira (Lab Head / PI) lands on `/lab-overview` for the first time and gets dropped straight into the widget canvas: announcements composer, a purchases funding rollup, a burn-rate chart, lab metrics, lab activity, lab experiments, lab notes, and a comment feed, plus a four-tile sidebar rail. No tour, no tooltips, no copy explaining what any of these are or how they relate to each other. Eight canvas tiles is a lot of surface for a first visit.

Reference: [lab-overview-pi-default.png](../../frontend/public/wiki/screenshots/lab-overview-pi-default.png)

## Widget inventory (fresh Mira, default lab_head layout)

Canvas (8 tiles, in default order from [layout-persistence.ts:96](../../frontend/src/lib/lab-overview/layout-persistence.ts)):

1. **Announcements** — lab-wide composer + pinned posts (1 new today). Members see; only PIs post.
2. **Lab purchases** — funding-bars rollup per grant code with $ remaining and pending count. PI-only.
3. **Purchase burn rate** — 4-week approved-spend bar chart. PI-only.
4. **Lab metrics** — cross-lab Gantt overlay, funding, roadmap rollup. PI-only.
5. **Lab activity** — deep paginated feed (comments, tasks, flags, announcements).
6. **Lab experiments** — outcome gallery across every member's experiments.
7. **Lab notes** — every lab note the viewer can read, searchable.
8. **Lab comments** — every thread across the lab, newest first.

Sidebar rail (4 tiles):

1. **Recent lab activity** — newest comments / shares / task creations.
2. **Pending lab head actions** — purchase approvals + flag queue counts.
3. **Member workload** — open + overdue per member.
4. **Today's announcements** — pinned posts, titles only.

Plus the existing global header (Tools launcher, Add widget, Edit layout, Reset) and the AppShell left sidebar (Activity / pending / Workload / pinned / Today). Total first-paint affordances on this surface: 8 canvas tiles + 4 sidebar tiles + 5 left-sidebar items + 4 header controls = 21 distinct things the eye lands on before Mira chooses any of them.

## Three proposals

### (A) Layered explainer tour

A v4-style overlay walks Mira through 4 to 5 of the highest-leverage widgets on first visit: Announcements (here is where you talk to the lab), PI actions sidebar (here is what is waiting for you), Member workload (here is who is overloaded), Lab activity (here is what happened since you last looked), Add widget (here is how to make this yours). Dim background, anchored callout, Next / Skip / Don't show again. Mira-session-scoped: once dismissed, never auto-runs again. Stored as `onboarding.lab_overview_tour_dismissed_at` on the Mira sidecar.

- File scope: new `LabOverviewTour.tsx` mounted from [page.tsx](../../frontend/src/app/lab-overview/page.tsx) (gate on `accountType === "lab_head"` and the onboarding sidecar). Reuses v4 tour primitives in `components/onboarding/v4/`. Sidecar field add in [lib/onboarding/sidecar.ts](../../frontend/src/lib/onboarding/sidecar.ts).
- Build effort: **M** (1 to 2 days). v4 tour scaffolding already exists, the lift is choreographing 5 anchored steps and the sidecar dismiss field.
- Risk of being annoying: **medium**. First-paint dim-overlay is the single most intrusive pattern in the app. PIs who are returning users post-pilot will see it once, but anyone watching over their shoulder (members, demo viewers) sees the dim until dismissed. Mitigation: tight Skip affordance, first step says "Three quick callouts" so the user knows the floor.
- Recommended: **not as the default**. Worth keeping as an opt-in via the help icon ("Show me around"), not as an automatic first-paint gate.

### (B) Inline first-paint tooltips

Each canvas tile gets a small "?" badge in the header (next to the title) using the existing [Tooltip component](../../frontend/src/components/Tooltip.tsx). On first visit for a Mira-session, the tooltip on the *first* widget auto-opens; subsequent widgets are click-only. No dimming, no overlay, no modal. The badge stays after dismiss so the explainer is recoverable. One-shot auto-open recorded as `onboarding.lab_overview_tooltips_seen_at`.

- File scope: each `*Widget.tsx` in [components/lab-overview/widgets/](../../frontend/src/components/lab-overview/widgets/) gets a `<Tooltip>`-wrapped help icon in its tile header. The auto-open-once logic lives in one shared hook (`useFirstPaintHint`) in [lib/lab-overview/](../../frontend/src/lib/lab-overview/). Sidecar field add per (A).
- Build effort: **S to M** (4 to 8 hours). Eleven catalog entries, but the badge + tooltip content is repetitive. Most of the lift is writing good copy for each widget.
- Risk of being annoying: **low**. Tooltips are passive. The one-shot auto-open could startle but only fires once per Mira-session and is dismissable by clicking anywhere.
- Recommended: **yes, as the default**. Discoverable, non-blocking, respects the dense-canvas aesthetic, and reuses the standing `<Tooltip>` pattern Grant has called out as the canonical icon-affordance approach.

### (C) Substrate-first

No tour, no tooltips. Instead, improve the *seeded fixture data* so every tile reads as self-evident on first paint: Announcements gets a pinned welcome from Mira ("This is where you talk to the lab; members see but can't post"), the PI Actions sidebar tile shows a non-zero count with a recent-looking purchase request, Member Workload shows a realistic 4-member spread with one overloaded person, Lab Activity shows three diverse buckets (comment, task, flag). The widgets explain themselves through the data they contain.

- File scope: [lib/file-system/wiki-capture-fixture.ts](../../frontend/src/lib/file-system/wiki-capture-fixture.ts) plus any seed data for first-time lab folders (likely [lib/onboarding/](../../frontend/src/lib/onboarding/) seed paths). No new components, no new sidecar fields.
- Build effort: **S** (2 to 4 hours). Pure data work, no behavior changes.
- Risk of being annoying: **none**. There is no intervention to be annoyed by.
- Recommended: **yes, as a complement to (B)**. On its own it underexplains the PI-only widgets (a PI can't tell from data alone that Members cannot see Lab purchases). But it sharpens (B): a tooltip on a tile with rich seed data is twice as cheap to grok.

## Recommendation

Ship **(B) inline first-paint tooltips + (C) richer fixture seed data** together, skip (A).

The PI dashboard is intentionally dense, and Mira is the type of user (senior, autonomous, low-novelty-tolerance) who reacts badly to dim-overlay tours. The v4 tour is the right pattern for first-app-bootstrap (Grant's walkthrough audit explicitly calls out v4 as the entry-point tour), not for a returning-PI dashboard where the user has already been onboarded. A help-icon-anchored "Show me around" entry to (A) keeps the layered-tour pattern available without making it the default; that part is cheap to add later if (B) under-performs.

(B) leans on `<Tooltip>` which is the standing canonical pattern for icon-only affordances on this codebase (per the [tooltip-component memory](file:///Users/gnickles/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/feedback_tooltip_component.md)). (C) makes the widgets self-evident so the tooltip only has to clarify the *role* of the widget, not its content. The pair gives Mira a discoverable, recoverable, low-friction first visit while preserving the dense dashboard that returning PIs already rely on.
