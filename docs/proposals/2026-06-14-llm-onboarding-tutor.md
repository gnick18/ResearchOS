# Proposal — LLM-driven Onboarding (BeakerBot as the guided first-run)

**Date:** 2026-06-14
**Lane:** BeakerAI (chat front door) — composes with the onboarding-wizard lane
**Status:** DESIGN — decisions locked with Grant 2026-06-14, mockup next, build behind `NEXT_PUBLIC_ONBOARDING_TUTOR` (off)

Replaces the retired v4 walkthrough (`[[project_onboarding_tour_retired]]`). This is NOT a tooltip tour — it is a short, personalized, **example-first onboarding** where BeakerBot is the conversational skin over a deterministic step machine, runs live mini-demos against an ephemeral demo layer, and seeds the user's personal memory. Builds on existing seams: `guide_to_element` (perception spotlight), `seed-ephemeral.ts` / `demo/rebase.ts` (throwaway data), `context-bridge.ts`, the AI meter + new-account gift.

---

## Why now (what changed since we last debated this)
- BeakerBot is a real operator: full CRUD on every object, record-set widget, plan cards, `guide_to_element` perception spotlight.
- The AI meter + new-account token gift is built and rate-locked (`[[project_ai_billing_build]]`).
- The old v4 tour is fully torn out — clean slate, no legacy to fight.

## Locked decisions (Grant 2026-06-14)
1. **Name it "onboarding,"** not "walkthrough" — that's what it is.
2. **Account-gated.** Folder-only sole users never see it (no account = no token meter = no onboarding). Fires **right after account creation**, composing *after* the 3-track setup wizard.
3. **Full-screen takeover, skippable but HIGHLY encouraged** — a dedicated onboarding screen right after the setup wizard, with a quiet "Skip for now" in the corner. Highest take rate, still escapable; not a soft-lock (`[[feedback_no_soft_locks]]`).
4. **Branched / tailored, not linear.** Up front, ask which tool areas the user cares about; the experience customizes which surfaces it showcases (a PI sees lab/people first, a bench scientist sees methods/sequences first).
5. **It's a PRESENTATION, not a button-tour (Grant 2026-06-14, the core reframe).** This is NOT watch-then-try, NOT guide-me-through-the-buttons, NOT wait-for-the-user-to-click-then-confirm. **Beaker takes the wheel** and showcases what's *possible* — runs tailored example after tailored example so the user SEES the features exist. The goal is **feature awareness** (if they never learn a capability exists, they never seek it out), NOT teaching where buttons are. Good UI makes button-tours unnecessary; nobody else ships them. Think guided demo reel, personalized to the interests they picked.
6. **Mechanic = Beaker drives the REAL pages, not chat widgets (Grant 2026-06-14).** Beaker NAVIGATES to each actual surface and operates it with a **presenter mouse cursor he controls**, using our existing **move/morph animation** to reveal results in the main screen — for this one onboarding run only. Narration is a floating coach bubble anchored on the page. **The BeakerBot chat panel appears ONLY when the feature being demoed is itself an AI feature** (e.g. "ask Beaker to overlay your data"); every non-AI feature is shown on the page directly. This keeps the showcase about the PRODUCT's surfaces, not about the chat.
6. **Field-personalized demo data.** The ephemeral dataset/sequence/tree matches their stated field (a microbiologist sees MIC/resistance data, etc.) for a "this is for ME" moment.
6. **Funded by a capped slice of the new-account gift** (~10%), metered in its own bucket so a curious user can't drain their real allowance.
7. **Seeds a per-user BeakerBot memory file** during onboarding, and tells the user it exists + that they can say "remember this" anytime for permanent, per-user, cross-chat recall.

---

## Architecture — three load-bearing ideas

### 1. Deterministic step machine, LLM as the presenter (kills soft-locks structurally)
The flow is a data-driven step graph (`welcome → interest-picker → per-surface SHOWCASE steps → memory-intro → invite-in/done`). The **machine owns progression** — Next/Back/Skip always work, the presentation auto-advances on a comfortable beat with the user able to pause/replay/skip. The **LLM owns the presentation within a step**: picks which tailored examples to show for the stated interests, narrates them, and answers "wait, what's a Data Hub?" if asked. It runs the demo itself — the user is the audience, not the operator. The model can never strand the user because it cannot move the machine into a dead end — only the deterministic controls advance. Same "engine computes, model narrates" rule as Smart Data Binding / plan cards. Ends not with a forced task but with an **invitation** ("here's where to start whenever you're ready") so the habit forms on the user's terms.

### 2. Ephemeral demo layer (makes "seamless seed that vanishes" safe)
The presentation NEVER writes to the user's real folder. The field-personalized demo plot, seeded sequence, sample Data Hub table all live in an in-memory ephemeral layer (reuse `seed-ephemeral.ts` + `demo/rebase.ts`). When onboarding ends — or the user bails, or the tab dies — there is nothing to clean up because nothing was persisted. Beaker can use `guide_to_element` to spotlight the live UI it's demoing as it presents, but the user is watching, not driving. Their first REAL object is whatever they choose to make after the invite-in.

### 3. Capped onboarding meter (token safety)
A dedicated `onboarding` bucket draws from the gift with a hard ceiling (~10%; at locked rates the ~1.6M-token gift leaves ~150k for a chatty, example-rich tour). When the bucket is spent, the tour finishes on deterministic rails (canned narration, no live LLM) — it never soft-locks and never eats working tokens. Prompt-caching the static step scaffold keeps cost down (the 5× cost lever).

---

## Presentation running order — the "reel director" (deterministic)

The step machine, not the model, decides what gets shown and for how long — so pacing is predictable and the token cap is enforceable. Given the picked goals + role, the director builds the reel from three tiers:

- **DEEP demo (full on-page cursor + morph, ~30–45s each) — count is ADAPTIVE to picks (Grant 2026-06-14):** length scales to the user instead of a fixed number. **1 pick → 1 deep demo** (go deep on just that) + montage the rest; **2–3 picks → a deep demo each**; **4+ picks → cap at 3** deep (their top 3 by a fixed surface priority) + montage the overflow; **0 picks → role-default set, capped at 3** (PI → Data Hub + Phylo + People; bench → Methods + Sequences + Data Hub). Each is one surface; Beaker navigates there and works it with the presenter cursor. So a focused single-interest user gets a tight ~3.5 min run and a broad user gets ~5.5 min, both honest about the cap.
- **ONE AI showcase (chat panel, ~40s):** regardless of picks, exactly one AI-feature demo so they learn BeakerBot can *act*. The director picks the AI feature tied to their top interest (picked trees → "ask Beaker to overlay your data"; picked analysis → "ask Beaker to plan an analysis"; else → a generic "ask Beaker to make a table"). This is the only beat the chat UI appears.
- **MONTAGE (rapid flash cards, ~3–5s each, ~25s total):** every UN-picked surface gets a quick titled flash (one line + a tiny visual, no cursor) so nothing is invisible — this is the answer to the "everything else" problem. Auto-plays as a fast sequence; "Replay any section" in Help lets them go deep later.

**Role gates:** PI-only surfaces (People/Lab, billing) never appear for students; undergrad never sees billing. **Length math (~5 min):** welcome+picker (~45s) + 3 deep (~2 min) + 1 AI (~40s) + montage (~25s) + memory+recap (~45s). Comfortably inside the ~150k token cap; if the cap is approached, the director drops deep demos to montage first, never cutting the memory/recap.

**Worked example (the mockup's user — PI, microbiologist, picked: track experiments / analyze data / build trees):**
1. DEEP — Data Hub: table → publication plot (page, cursor+morph)
2. DEEP — Bench/experiments: log an experiment + checklist (page, cursor)
3. DEEP — Phylo: build a tree from sequences (page, cursor)
4. AI — Phylo: "ask Beaker to overlay your MIC data" (chat panel)
5. MONTAGE — Sequences · Chemistry · Inventory · People (flash cards)
6. memory propose → recap → invite-in

## NEW SURFACE — per-user BeakerBot memory (mirror of the orchestrator's own memory, turned outward)

A personal memory document BeakerBot maintains **for each end user**, read into context each chat so it personalizes across sessions.

**Seeded during onboarding** from the interest-picker + a few light questions (role, field, what they're working on, naming conventions). BeakerBot tells the user the doc exists and that **anytime they say "remember this" / "save to memory," it persists permanently — for them only, across all their chats.**

### Recommended defaults for the open decisions (locked unless Grant says otherwise)
- **Scope = per-user, NEVER shared.** Even inside a shared lab folder, a user's memory is theirs alone and never surfaces to labmates. This is a hard privacy invariant and must read that way in the UI (big trust point).
- **Storage = follows the USER, not the folder.** Account-scoped, in the E2E vault so it syncs across the user's devices (consistent with `[[project_cloud_accounts_local_data]]`). A user switching folders keeps their memory.
- **Bounded + cached.** Size-capped like the orchestrator's `MEMORY.md` (one fact per entry, index line); injected with prompt-caching so per-turn cost stays flat.
- **Full user control, no soft-lock.** A Settings surface to view / edit / delete any memory entry. Deletion is real and immediate.
- **Write = propose-then-confirm (locked Grant 2026-06-14).** BeakerBot offers "want me to remember that?" at natural moments AND the user can say "remember this" anytime; either way the user confirms before anything persists. Gated own-only tool (`remember_for_user` or similar), same posture as the other BeakerBot writes — never a silent write.
- **Onboarding ends by writing a recap into the fresh memory** ("here's what I learned about you and what I showed you") so the very first thing the memory feature ever does is visibly useful — that teaches the user it's real. (Proposed; Grant to confirm.)

---

## Composition with existing lanes
- Runs **after** the setup wizard (`docs/proposals/2026-06-14-onboarding-wizard.md`, `NEXT_PUBLIC_ONBOARDING_WIZARD`): wizard provisions the account/workspace, THEN onboarding teaches it. Distinct flag `NEXT_PUBLIC_ONBOARDING_TUTOR`.
- Reuses `guide_to_element`, `seed-ephemeral.ts`, `demo/rebase.ts`, `context-bridge.ts`, the AI meter.
- Old tour narration (`docs/proposals/BEAKERBOT_TOUR_SCRIPT*`) is salvageable copy for the per-surface steps.

## Open questions for Grant (mockup will make these concrete)
- Exact interest-picker taxonomy — top-level branches. Proposed: the nav surfaces (Methods, Sequences, Data Hub/analysis, Phylo, Chemistry, Inventory/Supplies, Lab/People) + a role tag (PI / grad / postdoc / undergrad / industry).
- Length target — tight 3–5 min headline showcase vs. fuller ~10 min "see everything" (sets the token cap).
- The "win" — Grant's reframe says success = **feature awareness** (they know a capability exists), NOT a forced completed action. Confirm we measure/aim for awareness, ending on an invitation rather than a required task.
- Onboarding meter percentage — lock the exact cap (10% placeholder).
- Confirm the end-of-onboarding memory recap.

## The real app-level mount — architecture (decided with Grant 2026-06-15)

How "Beaker drives the real pages" actually works, once the tour leaves the stand-in stage:

- **Q1 Navigation — app-shell persistent overlay, NOT an iframe.** The tour mounts at the app-shell level (above the route outlet in `providers.tsx`/root layout) so it survives `router.push`. It drives the REAL Next router; the route content swaps underneath while the tour's cursor + coach bubble + ring stay on a fixed top layer. Same architecture as Shepherd/Intro.js/Appcues. An iframe is rejected (separate document, can't resolve real elements, auth/styling pain). Consequence: the deep-demo + AI-demo beats go mostly TRANSPARENT (real page shows through); welcome/picker/montage/memory/recap stay opaque takeovers.
- **Q2 Seeding — the tour is a guided walk through DEMO MODE.** The app already renders every surface on in-memory fixtures with no folder and zero writes (demo mode). The tour enters a tour-scoped demo-data mode pointed at a field-personalized fixture set, drives the REAL surface components showing real-looking data, then exits → the user lands in their own clean empty workspace. Ideal *because* they just made an account (no folder, no data to collide with). Maximum reuse, near-zero new data plumbing.
- **Q3 Spotlight — SOFT RING, NO DIM (Grant pick B, 2026-06-15).** Show the full real page with real chrome (recognition = the awareness goal), with a soft glow ring on the element Beaker is acting on. NO dimming scrim (rejected option A as too modal/wizard-y, and dimming hides the surfaces we want them to notice). Beaker's moving cursor provides the direction; the ring confirms the target. Optional B+ hybrid (ring + ~20% dim) only if plain B tests undirected.

**AI demo = scripted multi-step agentic showcase (the centerpiece).** Because we are on the real surfaces in demo mode, the AI beat becomes Beaker performing a real multi-step run: propose a PLAN CARD (the resumable live-ticking one), then work it across surfaces — create a table from the resistance data → run the t-test → plot it → overlay onto the tree — cursor moving Data Hub → Phylo, panels appearing, narrated. Reuses the real plan-card + CRUD tools + `suggest_tree_overlays`. **Scripted/deterministic replay, NOT a live model call:** free (does not spend the gift to *show* the feature), reliable, fast, identical every run. The capped meter then funds the user's first REAL turn *after* the tour, not the demo.

**Build posture:** touches `providers.tsx` + demo mode + every surface (`data-tutor-target` tags) — the spread-out, shared-checkout-risky work. Do it in an isolated WORKTREE, merge when whole.

## Per-surface demo scripts
The builder-facing choreography for each on-page DEEP demo (ARRIVE → SEED → ACT → REVEAL → HANDOFF, presenter-cursor beats, narration, the one AI demo, montage cards, field-personalization seed table) lives in `docs/proposals/2026-06-14-onboarding-demo-scripts.md`.

## Next step
Light-default mockup, dark only as a toggle (`[[feedback_mockups_light_default]]`): welcome → interest-picker → a SHOWCASE page (Beaker presenting a field-personalized demo with the seeded plot appearing + spotlight, auto-advancing) → propose-to-remember moment → memory-recap + invite-in. Then Grant marks it up, then build behind the flag.
