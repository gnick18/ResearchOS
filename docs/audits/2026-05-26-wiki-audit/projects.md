# Wiki audit: Project Surface

**Auditor:** wiki audit: projects
**Date:** 2026-05-26
**Scope:** `/workbench/projects/[id]` route + home-page project cards + (now-deleted) ProjectDetailPopup. Cross-checks against PROJECT_SURFACE_PROPOSAL.md phases P0-P9.
**Wiki page audited:** `frontend/src/app/wiki/features/projects/page.tsx` (Project Surface)
**App code audited:**
- `frontend/src/app/workbench/projects/[id]/page.tsx`
- `frontend/src/components/project-surface/ProjectRoute.tsx`
- `frontend/src/components/project-surface/ResultsGallery.tsx`
- `frontend/src/components/project-surface/MethodsInventory.tsx`
- `frontend/src/components/project-surface/GoalsSection.tsx`
- `frontend/src/components/project-surface/ActivityFeed.tsx`
- `frontend/src/components/project-surface/ProjectCardKebab.tsx`
- `frontend/src/app/page.tsx` (home card click + drag handle)
- `frontend/src/lib/project-activity/event-log.ts`
- `frontend/src/lib/local-api.ts` (projectsApi.getOverview/setOverview/listHostedTasks)
- `frontend/src/lib/wiki/nav.ts` (Features sub-nav)

---

## Summary

The Project Surface wiki page is in **good** shape overall. The post-P7 "card click goes straight to route, no popup intermediate" architecture is described accurately. Sidecar paths, owner-routing, the anchor strip, archived behavior, hosted-experiment chips, and the Goals opt-in gate all match implementation. Three real bugs surfaced (one P0, one P1, one P2), plus minor wording polish in Notes.

The single largest divergence is that the wiki claims the route **hides Overview / Results / Methods for Miscellaneous**, but the code renders all sections unconditionally for Miscellaneous; only the four top-bar CRUD icons are suppressed.

**Counts:** 1 P0, 1 P1, 1 P2, 4 Notes.

---

## P0 (factually wrong, must fix)

### P0-1. Miscellaneous claim about hidden sections is fabricated

**Wiki text** (Miscellaneous bucket section, third bullet):
> There is **no Overview, Results, or Methods** section because Miscellaneous has no hypothesis, no experiments, and no protocol inventory worth deduplicating.

**Reality** (`ProjectRoute.tsx:365-376`):

```tsx
<OverviewSection project={project} ... />
<ResultsGallery project={project} />
<MethodsInventory project={project} />
{goalsEnabled && <GoalsSection project={project} />}
<ActivityFeed project={project} />
```

All five sections render for every project including Miscellaneous. The `isMiscellaneousProject` guard only suppresses the four top-bar action icons (Edit / Share / Archive / Delete) and the kebab on the home card; it has no effect on the section body. The Overview textarea, Results gallery (showing 'No results yet'), Methods inventory (showing 'No methods linked yet'), and Activity feed all appear under Miscellaneous.

**Fix:** Either describe the actual behavior ("Overview, Results, and Methods all render but typically stay empty for Miscellaneous because it has no experiments to aggregate from") or drop the bullet entirely.

---

## P1 (misleading, should fix)

### P1-1. Overview "opt in later from Settings" misrepresents the only path

**Wiki text** (Goals section):
> If you skipped Goals during the wizard, the section is hidden entirely (no empty placeholder, no marketing CTA). You can opt in later from [Settings](/wiki/features/settings).

**Reality:** Settings has no Goals toggle. The only opt-in path is the **Rerun welcome wizard** button (`settings/page.tsx:3603` `handleRerunWizard`), which clears `feature_picks` entirely and forces the user back through Phase 1 of onboarding from scratch. The current copy implies a one-click toggle exists.

**Fix:** Reword to "You can opt in later by re-running the welcome wizard from Settings" or similar. Optionally flag to the master that a direct Goals toggle in Settings would be a worthwhile follow-up (the gate is a single field on a sidecar; toggling it shouldn't require wiping the whole wizard state).

---

## P2 (minor wording, optional)

### P2-1. "Second segment" mis-describes a query parameter

**Wiki text** (Home page card anatomy callout "Where the URL points"):
> `/workbench/projects/3?owner=morgan`. That **second segment** is how ResearchOS picks the right per-user file path when ids collide across labmates.

**Reality:** `?owner=morgan` is a query parameter, not a path segment. The route under `app/workbench/projects/[id]` has exactly one dynamic segment (`[id]`); the owner hint travels via `useSearchParams().get("owner")` (`ProjectRoute.tsx:14`).

**Fix:** Change "second segment" -> "`owner` query parameter".

---

## Notes (small accuracy / completeness items, not blocking)

- **N1. Methods pill list is incomplete.** Wiki names "Markdown, PDF, PCR" as the type pill labels (Methods section). The method-type registry (`method-type-registry.ts`) ships Markdown, PDF, PCR, LC Gradient, Plate Layout, Cell culture passaging, Mass spec, Compound method (kit). Either say "(Markdown, PDF, PCR, plus the structured types like LC Gradient and PCR Plate Layout)" or drop the parenthetical entirely and say "a type pill" generically.
- **N2. Goals row status pill omitted.** Wiki lists "color dot, name, date range, and SMART sub-goal progress" in the Goals row. The actual row also renders an Active / Complete pill (`GoalsSection.tsx:122-131`). One sentence about that would round out the description.
- **N3. Overview editor reverted from spec, wiki correct.** L5 / P2-follow-up in the proposal locked LiveMarkdownEditor with image/file drop + ImageStrip. The code today uses a bare `<textarea>` (`ProjectRoute.tsx:620`). The wiki accurately describes the bare textarea ("a plain resizable textarea with no toolbar, no image-paste, and no drag-drop file attachment"). No wiki change needed, but worth flagging upstream that the spec and code diverged at some point. This is a spec/code drift, not a wiki/code drift.
- **N4. Sidebar nav (L4 / P9) never shipped, wiki correctly omits it.** AppShell's NAV_ITEMS (`lib/nav.ts:11`) has Home / Workbench / GANTT / Methods / Purchases / Calendar / Search / Lab Links - no Projects entry. The wiki makes no claim about a Projects sidebar entry, so this is consistent.

---

## Coverage check

| Proposal scope | Wiki coverage | Status |
|---|---|---|
| P1 route scaffold + sticky top bar + anchor strip | Covered (Workspace route section) | OK |
| P2 Overview sidecar + autosave | Covered (Overview heading + sidecar path callout) | OK |
| P3 Results gallery by experiment + collapsible | Covered (Results section, hosted chip note included) | OK |
| P4 Methods inventory + usage badge + link out | Covered (Methods section) | minor N1 |
| P5 Activity event log + 90d prune | Covered (Activity section, sidecar path + prune note) | OK |
| P6 `/gantt?project=` link out | Covered ("View timeline ->" link) | OK |
| P7 slim popup | N/A; popup was deleted entirely. Wiki accurately reflects the no-popup state ("There is no popup intermediate step") | OK |
| P8 Goals conditional surface | Covered (Goals opt-in section) | minor P1-1 + N2 |
| P9 sidebar nav | Not shipped; wiki correctly omits | OK |
| Sharing & permissions on the surface | Covered (Sharing section, view vs edit) | OK |
| Miscellaneous behavior | Partially wrong (P0-1) | needs fix |

---

Signed: **wiki audit: projects**
