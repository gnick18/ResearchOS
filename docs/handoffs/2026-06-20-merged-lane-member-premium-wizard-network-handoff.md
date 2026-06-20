# Merged lane: member-premium + wizard streamline + network presence (2026-06-20)

One agent took over two prior lanes (Billing/Account + Business). House style
throughout (no em-dashes, no emojis, no mid-sentence colons). Everything below is
on LOCAL main, NOT pushed (Grant pushes; main is volatile this session, see
hazards). The earlier two handoffs (sharing-roundtrip + badges-publish) were the
starting point and are unchanged.

## TL;DR

1. Lab MEMBERS now read as PREMIUM (not Solo), with a Settings panel saying so.
2. Onboarding wizard de-duplicated: one name source, steps merged (solo 5->3,
   lab 6->4, dept 5->4), resume continues instead of restarting, splash fires
   after onboarding, greeting reworded.
3. Network is now a dedicated nav button (own glyph) to the .com network, pulled
   out of the customizable tabs.
4. Real labs now get the full public network presence on their .com page
   (header, collab CTAs, citation, verified-domain badge, member roster), no
   schema change.

## 1. Billing / member entitlement

- Diagnosed why Grant's account showed "Solo plan" / "not on a lab plan" after
  joining Emile's lab: Emile's lab is STAGED not CLAIMED, so nothing can sponsor
  a member yet. The "Solo" was Grant's own gift-comp from the sharing test.
- Grant's rule (saved to memory `feedback_lab_member_is_premium`): a member of a
  paid/comped lab HAS premium and the badge must say so.
- BUILT (local main): `GET /api/billing/model-a/status` returns `sponsoringLab
  {name, tier}` (only when a lab actively sponsors the member AND its PI resolves
  to paid/comped). `ModelABilling.tsx` shows a "Premium, via <Lab>" panel for a
  sponsored member instead of their own plan, no personal card/cap (the lab head
  is billed). New `getLabNameByPiKey` in directory/db.ts. Dev preview state added.

## 2. Onboarding wizard

- One name source: a new `fetchSessionDisplayName` (reads /api/auth/session, the
  app mounts no SessionProvider) prefills Profile display name, the greeting, and
  the PI name. The old bug that prefilled PI name with the @handle slug is gone.
- Step merge (mockup-approved): a new `IdentityStep` merges handle + name +
  greeting + optional profile (behind a "more" disclosure). Solo: Sign in ->
  Identity -> Folder (5->3). Lab: Sign in -> Identity -> Lab setup -> Folder
  (6->4). Dept: name + institution-link folded into one page (5->4). The PI-name
  field was dropped from the lab step (derived). Audit doc:
  docs/proposals/2026-06-20-onboarding-name-capture-streamline-audit.md.
- Resume: `computeResumeStepId` (lib/onboarding/wizard-resume-step.ts) lands a
  re-entry on the first INCOMPLETE step (identity if no handle, else
  lab-setup/folder), so bailing to the demo and coming back no longer restarts.
- Splash: finishing the wizard now forces the launch splash once even if today's
  day-stamp was set (providers.tsx), then reverts to once-per-day.
- Greeting copy: "What do you want BeakerBot to call you?".
- VERIFIED: I rendered the merged Identity + Dept pages via a dev harness
  (prefills, disclosure, dept link all correct). The LIVE prefill-from-real-
  session pass is Grant's, run on :3000 with `NEXT_PUBLIC_ONBOARDING_WIZARD=1`
  in `frontend/.env.local` (or the canonical `NEXT_PUBLIC_ONBOARDING=1`).

## 3. Network button + real-lab network presence

- Dedicated Network nav button (`NetworkNavButton`, trailing slot beside the
  folder pill, non-draggable) opening research-os.com/network. Pulled /network
  OUT of NAV_ITEMS (no longer a customizable tab). New `network` registry glyph
  (hub-and-spoke, even spokes), distinct from `globe`. Gated by
  SOCIAL_LAYER_ENABLED.
- Phase 4 of the lab-site network-presence plan: real LISTED labs get the rich
  page (header + collab CTAs + citation + verified-domain badge + member roster),
  assembled by new `lib/social/lab-public-card.ts` `getLabPublicCard(slug)` with
  NO schema change (directory_labs + account_profiles + directory binding/profile
  + billing roster). Sidesteps the plan's open Q4. See the memory note in
  `[[project_lab_domains_companion_sites]]`.
- NEEDS a listed real lab to live-verify (Emile's once he claims + lists).

## NEXT / open

1. Live verifies (Grant): the wizard prefill pass on :3000; the billing
   "Start Lab" no-card-trial pass (still un-run, needs a fresh Free account); the
   member-premium panel + real-lab network page once Emile's lab is live.
2. Emile signs in + taps "Set up my lab" (staged `fungal-interactions`), then the
   member-coverage chain and his .com network page both light up.
3. Optional network follow-ups: per-paper companion listing, BYO banner, theming,
   nav order (plan Qs 5-8); lab-inbox identity.

## Hazards / coordination

- MAIN IS VOLATILE: it was reset across divergent verify/integ lines repeatedly,
  once back to the session-start commit. A background sub-agent's worktree
  branched off that stale main and was unmergeable (salvaged by hand). LESSON
  (saved `feedback_volatile_main_no_worktree_subbots`): while main churns, build
  inline or pin worktrees to an explicit good SHA, never branch off bare `main`,
  and check `git merge-base --is-ancestor` before merging.
- A pre-existing `OnboardingWizardShell.test.tsx` failure (missing
  FileSystemProvider) was fixed via a spawned chip (uncommitted in the working
  tree at times); it passes when that fix is present.
- Everything this session is on local main, unpushed. Grant pushes to prod.
