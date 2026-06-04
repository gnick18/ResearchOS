# Orchestrator chat handoff, 2026-06-04

You are inheriting the **master orchestrator** chat for ResearchOS. This file is self-contained so you can continue exactly where the prior session left off, even on a different machine or subscription. Read `AGENTS.md` (the timeless how-to-work briefing) and `ARCHITECTURE.md` first. If the memory directory at `/Users/gnickles/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/` is available to you, its `MEMORY.md` index plus the `project_*` and `feedback_*` files hold the full persistent context, this handoff is the session-state layer on top of that.

## Your role and standing permissions

You are the orchestrator ("master bot"). You dispatch sub-bots in isolated git worktrees, cherry-pick their commits onto local `main`, verify, and clean up. Standing permissions established with Grant:
- Spawn well-scoped sub-bots without asking; only direction or destructive decisions need his eye.
- Full power to edit/commit/merge AGENTS.md.
- Commit and merge coherent work to LOCAL `main` as you go. Grant pushes to `origin` deliberately and rarely, NEVER push to origin without his say-so.
- Verify with `tsc` + `vitest` run FROM the `frontend/` directory (the `@` alias lives in `frontend/vitest.config.mts`; running from repo root breaks all tests).
- Direct questions to Grant use the AskUserQuestion tool (clickable options + a recommendation), not free-form prose.

House rules for everything you or your sub-bots write: NO em-dashes, NO emojis, NO mid-sentence colons (label-terminators at line start like "Status:" are fine). Every user-facing icon is a custom inline SVG (no lucide, no emoji). Use the `<Tooltip>` component, never native HTML `title=`. The mascot is always BeakerBot. Flag any persisted-data-shape change BEFORE committing.

Multi-session reality: several chats run in parallel. Worktrees branch off a session-start anchor that drifts from live `main`, so cherry-pick (do not stale-merge), and RE-READ files right before editing, linters and parallel sessions sometimes revert your edits between turns.

## Git state at handoff

- Branch: `main`. Local `main` is at `b503a7a1` and is ~32 commits AHEAD of `origin/main` (`d076509e`). Grant works locally; the sharing work, sequences work, unified-model docs, email-forwarding docs, and Telegram/settings fixes are all committed to local `main` but NOT pushed. Do not push without Grant.

## THE LIVE THREAD (highest priority), Unified Data Model + Collaborate

This is the big active initiative. Read `docs/proposals/UNIFIED_DATA_MODEL.md` (the synthesis design doc) and `docs/proposals/CROSS_BOUNDARY_SHARING_COLLABORATE.md`.

Background: building real-time collaboration (Google-Docs style, live cursors, for notes/methods/experiments/whole project folders) forced a decision to UNIFY the data model so local editing and collaborative editing use ONE CRDT-backed system, not two. A 6-facet deep research pass is DONE and synthesized into the design doc.

LOCKED decisions:
- On-disk model = **B + graceful-C** (Grant's call). The CRDT (a binary sidecar in a hidden `.researchos/` dir) is the merge/history source of truth; a readable markdown/JSON mirror is always written so the folder stays openable. External edits (file changed outside the app) are ingested as ONE snapshot-commit, with a clean diff where cleanly followable and a FULL-COPY checkpoint + a user warning where not (e.g. JSON reshaped). Concurrent external + in-app edit = keep both as a conflict copy + warn. Formatting marks live in the sidecar (Peritext), never as markdown control chars.
- Substrate = **Loro primary, Automerge fallback, Yjs out** as canonical (Yjs garbage-collects history and records nothing on deletions, an audit-trail killer for the NIH angle). Loro = Automerge-class history + fast text + a native folder tree type, but it is young, hence the prototype gate.
- E2E collab posture = E2E-blind (4a), the relay stays blind (secsync shape).
- VC Phase 1 is PAUSED and folds into this. The dormant Phase 0 VC engine stays put; do NOT extend the old VC engine.
- The collab MVP is GATED on the prototype below. No real build until it clears and Grant signs off.

PROTOTYPE RESULT (completed at handoff): the Loro data-model prototype PASSED all four gates, 75/75 objective checks, committed to `main` under `spikes/unified-model-loro/` (after `npm install` there, run `node gate1-ondisk.mjs` etc.; see its README). Verdict, **Loro clears the bar on data model and history, no Automerge fallback needed.** Highlights, the B + graceful-C external-edit policy works end to end on real Loro APIs (snapshot-commit, clean-diff vs full-copy-with-warning, conflict copy on concurrent edits, marks-in-sidecar with no markdown control chars in the CRDT text, rebuild-from-mirror when the sidecar is gone); version-control-from-native-history is CHEAP (5000 small commits compress to a 22KB snapshot that loads in 1.45ms, versus Automerge's ~1.8s large-doc load); the deterministic seed prevents the fork pitfall (and a non-deterministic seed provably forks, confirming the seed is the fix); a structured record (Map + Counter + Movable Tree + Text in one doc) merges per-field with attribution across types and a recoverable LWW loser.

The ONE thing the run deliberately did NOT cover, the live-editing binding maturity. That is the remaining open substrate risk.

NEXT STEPS (where to pick up):
1. Run the deferred **live-binding spike**, `loro-codemirror` bound to CodeMirror 6, two clients over a local Durable Object relay (reuse the `spikes/collab-yjs/` `wrangler dev` DO), proving live convergence + cursor awareness + offline-then-merge, plus Loro's WASM first-load cost in Chrome/Edge. Keep it LEAN and watchdog-safe, the data-model run stalled once on a live server, so test the binding headlessly first or structure the server step so it streams progress and does not block. This is the last risk because Loro's editor bindings are young (loro-codemirror is months old, single maintainer). If the binding is too immature, that is the only thing that could still tilt the LIVE-TEXT layer back to Yjs (with a custom history layer) while keeping Loro for data + history.
2. If the binding clears, Loro is confirmed as the substrate. Scope the real PHASED build, notes pilot first, per the migration plan in section 9 of the design doc, and get Grant's sign-off on the phasing before building.

The eventual production build needs Grant to provision a Cloudflare Worker + Durable Object deploy target (the one new infra, like R2/Neon were). The local spikes need none.

## Recently shipped this session (do NOT redo)

- Cross-boundary sharing is COMPLETE and on local `main`: all five entity types share (notes, experiments, methods, projects, sequences) via the unified Share button (one button per entity, two tabs "In your lab" + "Outside your lab"), with verified-sender provenance and the branded invite growth loop. Both early fix chips (phantom relay rows, attributed look) are done. Verifier follow-ups done: method Public/Private pills converted from native `title=` to `<Tooltip>`; `notesApi` self-heals legacy `is_shared` notes (materializes the `*` whole-lab sentinel on read); project-import dialog counts tasks by `task_type` (Experiments/Purchases/Lists); user-switcher identity badge + a tested `evaluateUnlockMatch` gate (D1 sign-in-to-unlock).
- Sequences auto-share (Grant wanted BOTH project-bundled and per-sequence): project bundle now carries sequences (`8ca17c19`), bulk multi-select send + receiver project-placement on import (`61e6ae24`), and a probe-edge fix (`089f43bf`). All verified, on `main`.
- Telegram 409 conflict badge is now a quiet amber dot with a click-to-takeover popover (`15f5a623`).
- Settings page dead-scroll-below-footer fixed via `min-h-0` (`f422a002`).
- `support@research-os.app` email forwarding is LIVE and verified (ForwardEmail records on Vercel DNS forward to `gnickles@wisc.edu`; a test landed). See `docs/SUPPORT_EMAIL_SETUP.md`.
- `docs/ROADMAP.md` captures beta feedback from Dylan Duerre as future ideas (reference/citation management, lab equipment manuals, shared instrument calendars, experiment planner), all status `idea`, none started.

## Open and ready (not started)

- **Settings revamp** is the one ready-to-build idle item. Spec is signed off at `docs/proposals/CROSS_BOUNDARY_SHARING_SETTINGS.md` (Personal-tab Sharing-identity + Inbox-and-storage sections at 5 GB / 100 pending, change-password, email-rotate flow, plus an operator-only usage tracker). Requires bumping the relay `RECIPIENT_QUOTA` 50 to 100 and adding an enforced `FREE_STORAGE_BYTES` as shared constants. Grant may ask you to start this in parallel.
- Telegram standby state ("another tab") could get the same quiet-dot + popover treatment as the conflict state, for visual consistency (optional follow-up Grant was offered).
- TOFU transparency-log endpoint for the directory (needs a `KT_LOG_SIGNING_KEY` provisioned).
- Sharing prod housekeeping: add `AUTH_SECRET` to Vercel prod, verify `research-os.app` in Resend as the sending domain, swap CoC/privacy/abuse contacts to `support@research-os.app` (now that it works), confirm prod R2 CORS origins.

## Other active workers handing off in parallel

Grant is also handing off a "sharing worker" chat and a "wiki update worker" chat; each is writing its own handoff. Coordinate through `main` (cherry-pick, never stale-merge; re-read shared files before editing). Sequences-editor and wiki/screenshots surfaces are hot zones touched by multiple chats.
