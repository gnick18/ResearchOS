# Handoff: business lane + sequence-editor bottom-bar (2026-06-19)

Master-bot session that ran the business lane while four other agents worked the codebase, plus one code lane and a small admin-tracker addition. Business specifics live OUTSIDE this repo (agent memory + `~/Documents/ResearchOS_LLC/`), per the no-business-info-in-repo rule; only non-sensitive pointers appear here.

## 1. Sequence-editor bottom-bar consolidation (CODE, in flight, NOT merged)

The `/sequences` editor stacks three layers at the bottom (the `SequenceDisplayStrip` overlay-toggle row, the `SequenceTabBar` panel row, and a floating "Search your work" pill), which eats a thick band. A sub-bot is building a one-bar consolidation.

- **Branch / worktree:** `feat/seq-bottom-bar-v2` in `.claude/worktrees/seq-bottom-bar` (sub-bot owns it).
- **Flag:** `NEXT_PUBLIC_SEQ_BOTTOM_BAR_V2`, default OFF (byte-identical when off). New layout only when on.
- **Design (the "after"):** one slim bar = panel tabs (Sequence / Map / Features / Primers / History) on the left; on the right a Circular/Linear segmented toggle (stays visible), a single **Display** popover holding the overlay toggles (Features, Primers, Enzyme sites, Translation, ORFs, Ruler/index, Wrapped) with a count badge, and the compact zoom. Caret readout + Extract move into a contextual selection chip that shows on the canvas only when there is a selection. The floating "Search your work" pill is removed on the editor route (Cmd+K and the top-right BeakerSearch pill already cover it).
- **Files in scope:** `frontend/src/components/sequences/SequenceDisplayStrip.tsx`, `SequenceTabBar.tsx`, `SequenceSelectionReadout.tsx`, `SequenceEditView.tsx` (Find ~5956-5977, Extract ~6004-6023, BeakerSearch ~5305-5329), plus whatever mounts the persistent floating search pill.
- **Status:** sub-bot running at handoff time (its dev server verifies on `:3099` via `/demo`). It reports back to the orchestrator with files, tsc/test results, and screenshots, and does NOT self-merge.
- **Next:** read the sub-bot report, have Grant eyeball on `:3000` with the flag on, then the orchestrator merges. House rules to confirm in review: no inline `<svg>`/emoji (icon-guard), reuse `<Icon name=...>` registry glyphs (flag any new glyph for Grant), raised-shadow popover primitive (`ros-popover`), sentence case.

## 2. Admin business-tracker reminder (CODE, UNCOMMITTED in working tree)

Added a one-off deadline watcher so the @research-os.app email send-as does not get forgotten when the inbound block lifts (see business pointer below).

- `frontend/src/lib/business/calc.ts`: new `researchosAppEmailSendAsWatch()` + `RESEARCH_OS_APP_EMAIL_SENDAS_TARGET = "2026-08-27"`, mirrors `researchosAppDropWatch` / `vercelOssApplicationDeadline`. Drops off after 2026-10-15.
- Wired into `frontend/src/components/admin/OperatorShell.tsx` (both deadline arrays) and `BusinessTracker.tsx` (the deadline strip), with imports.
- `tsc --noEmit` clean. Shows on `/admin` and `/admin/business`, climbing toward the top as late August nears.
- UNCOMMITTED on purpose (commit only when Grant asks). Three explicit files: `calc.ts`, `OperatorShell.tsx`, `BusinessTracker.tsx`.

## 3. Business lane (NOT in repo, pointers only)

- **Spendlab partnership.** Researched + drafted an intro email to Robin Stewart (Spendlab / Math Easel, grant-budget planning, no-VC, complementary to ResearchOS). Brief + email at `~/Documents/ResearchOS_LLC/08_Contracts_and_IP/2026-06-19-Spendlab-partnership-brief.md`. Memory `[[project_labspend_partnership]]`. Grant sends from the plain Gmail. (Lab Spend / P212121 was an initial mis-ID, kept on file as a possible second partner.)
- **Email infra.** Mapped research-os.app email: Resend handles outbound (works), ForwardEmail forwards inbound to the LLC Gmail but is BLOCKED until ~2026-08-26 by a 90-day new-domain abuse hold (domain registered 2026-05-28). Gmail "send mail as" for grant@/founders@ is half-set-up (SMTP verified via a dedicated Resend key, confirmation link bounced on the inbound block); a pending inert entry is left in Gmail to finish later. Decided NOT to migrate DNS to Cloudflare (the 90-day block self-clears). Full detail in memory `[[reference_email_infra]]`.
- **Reminder wiring.** One-time scheduled task `finish-research-os-app-email-sendas` fires 2026-08-27 09:00 CT, plus the admin-tracker deadline in section 2.

## Open items / next session

1. Land the seq-editor bottom-bar lane once the sub-bot reports and Grant approves on `:3000`.
2. Commit the three admin-tracker files when Grant gives the word.
3. Finish the @research-os.app email send-as after ~2026-08-26 (scheduled task + admin deadline both fire).
4. Grant sends the Spendlab intro email when ready.
