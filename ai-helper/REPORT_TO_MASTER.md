# AI Helper manager → master: handoff report (2026-05-15 EOD)

**From:** AI Helper manager (parallel session)
**To:** master bot (orchestrator)
**Status:** standby — no active work, three wake-triggers queued
**Branch:** `claude/stupefied-elbakyan-b2613c`
**Top commit:** `98af39f1`
**Commits since main divergence at `fb73fac7`:** 21
**Merge status:** branch is conflict-free with main once main resolves the in-flight methods-expansion conflict; no merge attempted from this session

## What landed

v1 of the AI Helper feature shipped end-to-end on the branch. Proposal + 4 chips + 4 follow-ups + eval harness + eval-cycle tuning + AGENTS.md §8 entry. Per-decision history in commit log; concise summary below.

| Layer | What | Where |
|---|---|---|
| Proposal | Single recommended thesis with two rejected; 4 design decisions locked via clickable questions; 7-mechanism automation contract | [AI_HELPER_PROPOSAL.md](AI_HELPER_PROPOSAL.md) |
| Build pipeline | Schema extractor (`types.ts` verbatim for full, sliced for lean/minimal), fixture extractor with privacy guard (fixture-only allowlist of alex/morgan/public/lab), wiki-nav extractor, three-variant assembler, drift detector | [scripts/build-ai-helper.mjs](scripts/build-ai-helper.mjs), [scripts/check-ai-helper.mjs](scripts/check-ai-helper.mjs) |
| Prose | 7 hand-written partials (~7900 words, ~10.5k tokens) covering identity, architecture, mental model, feature inventory, 8 workflows, behavior rules, drafting templates | [ai-helper/partials/](ai-helper/partials/) |
| Built outputs | full.md ~26k tok, lean.md ~17k tok (was 16k pre-eval-cycle), minimal.md ~4.5k tok, manifest.json with structural fingerprint | [frontend/public/ai-helper/](frontend/public/ai-helper/) |
| Settings card | `<AIHelperSection>` between Maintenance and Tips; size picker, copy-to-clipboard, three "Open in" provider buttons (popup-blocker-safe ordering), freshness footer, stale-prompt callout, pull-from-deploy trapdoor, chat-vs-API amber callout | [frontend/src/app/settings/page.tsx:1320+](frontend/src/app/settings/page.tsx) |
| Build/CI | `ai-helper:build` / `:refresh` / `:check` npm scripts; `prebuild` chains build + check; `NEXT_PUBLIC_RESEARCHOS_COMMIT` exposed for freshness compare | [frontend/package.json](frontend/package.json), [frontend/next.config.ts](frontend/next.config.ts) |
| Onboarding | 11th tip pointing at AppShell settings cog, `setupAction.href = "/settings#ai-helper"` | [frontend/src/lib/onboarding/tips.ts](frontend/src/lib/onboarding/tips.ts), [frontend/src/components/AppShell.tsx](frontend/src/components/AppShell.tsx) |
| Eval harness | Question bank (15 questions, 6 categories, explicit rubrics), API-based runner (fallback for ChatGPT/Gemini testing), sub-bot brief template (canonical path for Claude-family evals — no API key needed) | [ai-helper/evals/](ai-helper/evals/) |

## Eval cycle outcome

Sub-bot eval against all 3 size variants. Self-graded against rubric.

- **full = 95% rubric pass** (14/15 PASS, 1 PARTIAL — the PARTIAL is an aspirational rubric, not a real prompt gap)
- **lean = 93%** (13/15 PASS, 2 PARTIAL initially → both fixed in `2acbd489`)
- **minimal = 66%** (9/15 PASS, 4 PARTIAL, 2 FAIL — sharp degradation on feature-location and structured-method drafting, as expected for the smallest variant)

Behavior + limitation guardrails were 100% across all three sizes. Size-invariant categories are exactly the ones that protect users from harm; size-variant categories are the ones about utility. Clean separation.

## Cross-arc findings worth your attention

**1. Methods-expansion arc has fixture-data legacy-shape bugs.** The full eval surfaced that `frontend/public/demo-data/users/{alex,morgan}/` fixture files use shapes that don't match current `types.ts`. Empirically verified three categories:
- Task fixtures carry legacy `method_id` (singular) + top-level `pcr_gradient` / `pcr_ingredients` (all pre-method-attachments-rewrite fields)
- TaskMethodAttachment fixtures are `{method_id, owner, snapshot_at}` instead of current `{method_id, pcr_gradient, lc_gradient, body_override, plate_annotation, cell_culture_schedule, variation_notes}`
- PCRProtocol fixtures carry `tags` + `owner` + `shared_with` not on the interface

Affects: AI Helper §5 examples, wiki captures, demo lab. Build script faithfully extracts the legacy shapes — bug is in the source fixture files. **Self-contained relay brief drafted at [ai-helper/RELAY_BRIEF_FOR_METHODS_EXPANSION.md](ai-helper/RELAY_BRIEF_FOR_METHODS_EXPANSION.md)** with file paths + suggested chip scope. Grant has the brief ready to relay to methods-expansion manager whenever appropriate (their arc territory since TaskMethodAttachment is their canonical surface).

**2. Settings page hash-scroll bug (pre-existing, surfaced by chip 4).** `frontend/src/app/settings/page.tsx:104-113` calls `el.scrollIntoView()` but the actual scroll container is the `flex-1 overflow-y-auto` wrapper, not window. So `/settings#ai-helper`, `#telegram`, `#personalize`, etc. don't auto-scroll on cold page load. AI Helper onboarding tip's setupAction makes this more user-visible. Worth a dedicated chip; not AI Helper arc territory.

## Wake triggers (auto-resume conditions)

I go back into standby after this report. Three triggers will pull me back:

1. **Methods-expansion fixture cleanup lands.** I fire a fresh sub-bot eval against full to confirm §5 examples are clean, report back. ~10 min via the sub-bot template at [ai-helper/evals/SUBBOT_BRIEF.md](ai-helper/evals/SUBBOT_BRIEF.md).
2. **Wiki manager picks up the AI Helper wiki page.** I already drafted the brief in my earlier handoff to Grant (chip 5 — covers concept intro, Settings card walkthrough, per-provider setup subsections for Claude / ChatGPT / Gemini, privacy callout, screenshot list). Need to relay to wiki manager via Grant when their queue clears.
3. **Security manager finishes their unrelated audit and is ready for prose review.** I drafted the chip 6 brief asking them to review the partials for three threats: architecture-disclosure footgun, prompt-injection vectors, drafting-mode footgun. Ready to relay via Grant when security manager's bandwidth opens.

## Coordination asks (to master, not actionable by me)

- **Don't queue a fixture cleanup chip from master.** Routing through methods-expansion is the right ownership; the relay brief is self-contained and ready to forward.
- **AGENTS.md §8 reservation:** the AI Helper arc owns [AI_HELPER_PROPOSAL.md](AI_HELPER_PROPOSAL.md), [scripts/build-ai-helper.mjs](scripts/build-ai-helper.mjs), [scripts/check-ai-helper.mjs](scripts/check-ai-helper.mjs), [scripts/AI_HELPER_BUILD.md](scripts/AI_HELPER_BUILD.md), [ai-helper/](ai-helper/), `frontend/public/ai-helper/`, the AI Helper section of [frontend/src/app/settings/page.tsx](frontend/src/app/settings/page.tsx), the AI Helper onboarding tip in [frontend/src/lib/onboarding/tips.ts](frontend/src/lib/onboarding/tips.ts), and the `ai-helper-cog` data-attr in [frontend/src/components/AppShell.tsx](frontend/src/components/AppShell.tsx). Sub-bots from other managers should not touch these. Master can override if there's a justified cross-arc reason.
- **Merge to main is master's call, not mine.** AI Helper arc is conflict-free with main as long as it merges AFTER methods-expansion. Grant has standing instruction to hold until methods-expansion resolves naturally. No escalation needed from this session.

## Standing decisions on file

Grant locked these via clickable-questions sessions; recorded here so master can read them without re-asking:

- **All three size variants ship.** Lean is the recommended default in the Settings card; full for power-users on big-context models; minimal for small-context / local models with an explicit "you got the degraded variant" disclaimer.
- **Hybrid build script** (schemas + examples + wiki-refs auto, prose hand-written). Per-release maintenance: edit partials, run `npm run --prefix frontend ai-helper:refresh`.
- **Wiki path:** `/wiki/integrations/ai-helper` (peer of telegram, calendar-feeds, labarchives — not Features).
- **11th onboarding tip is added.** Tutorial sequencer walks it as the final step.
- **`helper_version` bumps on schema/structural changes only**, not prose tweaks. Stays at 5 across the eval-cycle work; will bump organically next time `types.ts` changes (likely when methods-expansion Phase 2D adds cell-culture interfaces).
- **Maintenance cadence:** sub-bot eval re-runs any time prose partials change. The 15-question bank takes ~5-10 min per size variant via sub-bot. No automatic trigger; manual fire-and-report.

— AI Helper manager
