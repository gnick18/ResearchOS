# Onboarding v2: proposal

> Scope: this proposal redesigns the **first-touch experience** for a
> brand-new ResearchOS account. v1 (merged across 2026-05-14 through
> `92a53221`) shipped the per-user `_onboarding.json` sidecar, the 11-tip
> catalog (10 in `lib/onboarding/tips.ts` + the standalone `lab-mode-picker`
> at the login screen), the cooldown / dwell / roll loop in
> `orchestrator.tsx`, the `<OnboardingWelcomeModal>` with its three-mode
> radio, and the `<OnboardingTutorialSequencer>` for the `?tutorial=1`
> guided walk. The standalone Telegram walkthrough (`?tutorial=telegram`)
> landed at `9a65fc42`. v2 reframes the welcome surface from "pick a tip
> cadence" to "tell me what you want to use ResearchOS for, then I'll
> configure it" — without touching the underlying tip sidecar or the
> tutorial sequencer's mechanics, both of which v1 got right. This
> document does not write code; the manager builds chip briefs after
> Grant locks the open questions in §6.

---

## 1. Current v1 state and pain points

### 1.1 What v1 actually ships

The first-touch flow today, end-to-end, for a brand-new user:

1. User connects a research folder via `<DataSetupScreen>`. The folder
   is empty, so `<UserLoginScreen>` prompts her to create a username.
   Lab Mode is offered here behind a sessionStorage-gated tip
   (`lab-mode-picker`, the 11th tip; rendered inline in
   [UserLoginScreen.tsx:680](frontend/src/components/UserLoginScreen.tsx:680)).
2. After login, [providers.tsx:180](frontend/src/lib/providers.tsx:180)
   mounts `<OnboardingProvider currentUser={...}>` which boots the
   `<OnboardingOrchestrator>`.
3. The orchestrator reads `users/<u>/_onboarding.json`
   ([sidecar.ts:151](frontend/src/lib/onboarding/sidecar.ts:151)),
   gets a default record with `mode: null`, and renders
   `<OnboardingWelcomeModal>` over the home page.
4. The modal presents three buttons:
   - **Walk me through it** → opens `/demo?tutorial=1` in a new tab,
     persists `mode: "tutorial"` in this tab's sidecar.
   - **Show me as I go** (visual default) → persists `mode: "suggestions"`,
     orchestrator's 5-minute roll loop takes over with the random 15%
     per-tick fire probability.
   - **Stay quiet, thanks** → persists `mode: "silenced"`, orchestrator
     never fires anything.
5. The user lands on the home page (`/`), which renders
   [page.tsx:306-329](frontend/src/app/page.tsx:306): a header, a
   `Research Project Overview` count, a `+ New Project` button, and an
   empty grid of project cards (because she has no projects yet).
6. From here it's discovery-by-trial-and-error. The 11 tips drip out
   over the next ~5–60 minutes of active dwell, in random order subject
   to route match (`/`, `/methods`, `/gantt`, `/calendar`, `/workbench`)
   and per-tip DOM targets being present.

The mode choice lands at
[sidecar.ts:215](frontend/src/lib/onboarding/sidecar.ts:215) and is
reflected back in Settings → Tips
([settings/page.tsx:2322](frontend/src/app/settings/page.tsx:2322))
where the user can switch between the three modes plus replay the tip
sequence.

### 1.2 Pain points the v2 redesign must solve

Concrete failures of the v1 experience, ordered roughly by how often
each one bites a brand-new user:

1. **First contact is a non-sequitur.** The welcome modal asks the user
   to pick a tip cadence without telling her what ResearchOS *is* or
   *why* she'd use it. "I can show you around or stay quiet" presumes
   she already knows what "around" means.
2. **The home page is empty.** For a brand-new account with zero
   projects, [page.tsx:306-329](frontend/src/app/page.tsx:306) renders a
   header and a `+ New Project` button against a blank grid. There is
   no in-app cue suggesting where to go next, what features exist, or
   that the wiki documents them.
3. **The "walkthrough" walks demo data, not the user's folder.**
   "Walk me through it" force-opens a `/demo?tutorial=1` tab that runs
   against the seeded demo lab (alex's projects, public methods,
   fixture IDs in `TUTORIAL_DEMO_IDS`
   [OnboardingTutorialSequencer.tsx:83](frontend/src/components/OnboardingTutorialSequencer.tsx:83)).
   The user sees alex's experiments, not her own. Whatever she "learns"
   doesn't carry forward to her own account because no setup happens
   on her real folder.
4. **The tip catalog is feature inventory, not orientation.** The 11
   tips are valuable for niche-feature surfacing (Telegram → task,
   archive vs delete, fullscreen task, goals vs tasks, gantt animation
   variants, AI Helper prompt), but a brand-new user who has not yet
   created a project and has no methods or experiments is not the
   target audience for "Make a method public" or "There's a Notes tab
   too." The tips were designed for a mid-stage user discovering
   non-obvious affordances, not a day-zero user trying to figure out
   what the app is for.
5. **No use-case signal is collected, so every user gets the same
   default.** v1's settings defaults
   ([user-settings.ts:61](frontend/src/lib/settings/user-settings.ts:61))
   give every user all 8 tabs (`/workbench`, `/gantt`, `/methods`,
   `/purchases`, `/calendar`, `/search`, `/links`), the same default
   landing tab (`/`), the same Gantt view (`2week`), the same animation
   (`rock`). A computational researcher who will never use Purchases
   sees a Purchases tab. A lab manager who needs Lab Mode has to
   discover it via the sessionStorage tip at next login. A PhD student
   who lives in Gantt + Methods sees 6 tabs she doesn't need.
6. **Integrations are gated on the user's own discovery.** Telegram
   pairing lives at `/settings#telegram`, calendar feeds at
   `/calendar?addFeed=1`, AI Helper prompt at `/settings#ai-helper`,
   ELN/LabArchives at `/settings`. The 11-tip catalog points at most
   of these (priority 1, 4, 11), but only if the user happens to be on
   the matching route at the right cooldown moment. A user who never
   visits `/calendar` never sees the link-calendars tip.
7. **No "I'm not sure what I want yet" path.** v1's three modes are
   tutorial / suggestions / silenced. None of them are "explain what
   this is first." A user who picks "Stay quiet, thanks" because she's
   skeptical of tutorials gets ZERO orientation and no second chance
   short of opening Settings → Tips.
8. **Existing-user migration was a one-way pick.** The v1 welcome
   modal fires once on `mode: null` and never again
   ([orchestrator.tsx:464](frontend/src/lib/onboarding/orchestrator.tsx:464)).
   A user who clicked through quickly without reading has no in-app
   way to redo the orientation. The Settings → Tips card can flip the
   mode + replay tips, but it cannot replay the welcome modal itself.
9. **Cross-tab tutorial state is fragile.** The walkthrough lives in
   tab B (`/demo?tutorial=1`); the user's real folder lives in tab A.
   The cross-tab BroadcastChannel handshake
   (`subscribeTutorialSignal` / `broadcastTutorialSignal` in
   [tutorial-signal.ts](frontend/src/lib/telegram/tutorial-signal.ts))
   and the 90-second first-photo timeout
   ([OnboardingTutorialSequencer.tsx:165](frontend/src/components/OnboardingTutorialSequencer.tsx:165))
   work, but the architecture is fragile — if the user closes tab A
   the walkthrough's first-photo step hangs. The pain is downstream
   of the design choice "walkthrough doesn't touch real account."

### 1.3 What v1 got right (must preserve)

Before listing what changes in v2, note what doesn't:

- **The `_onboarding.json` sidecar shape works.** Per-user, on disk,
  survives browser changes; mode + active_seconds + per-tip dismissal
  map. v2 extends it, doesn't replace it.
- **The active-time tracker is the right gating signal.**
  [active-time.ts](frontend/src/lib/onboarding/active-time.ts) ticks
  `+1/sec` when document is visible and focused; survives tab close
  via the unmount flush. v2 inherits this without change.
- **`isDemoOrWikiCapture()` exempts demo + screenshot mode.** Wiki
  capture must NEVER trigger the welcome wizard; screenshot fidelity
  depends on it. v2's wizard mount gate keeps this exemption.
- **The tip-card visual language (BeakerBot + the per-tip
  setupAction footer) is good.** v2 reuses the card shell for any new
  wizard step UI that anchors to a DOM target.
- **The 30-second route dwell + 5-minute cooldown for `suggestions`
  mode is the right rhythm.** Day-after-tomorrow tips firing every
  five minutes is "ambient hint", not "interruption". v2 keeps this
  for whatever survives of the tip catalog after the wizard absorbs
  some content.
- **Settings → Tips is the right re-entry surface.** A user who flips
  her mind has a place to go. v2 just expands what that surface can do.

---

## 2. Proposed redesign options

Five distinct theses (A–E) plus one minority-report alternative (F)
that the manager should consider. Each option captures the FIRST-TOUCH
experience end-to-end for a brand-new user; how the existing tip
catalog interacts; effort cost; and a small set of pros / cons.

### 2.1 Option A: Multi-step welcome wizard (modal)

**Thesis.** Replace the current three-button welcome modal with a
multi-step modal wizard. Steps (initial cut, refinable in §6):

1. **Welcome card.** BeakerBot + one paragraph: "Hi, I'm ResearchOS.
   Here's what I do (one sentence each: experiments, methods,
   purchases, calendar). Let's set you up — should take 2 minutes."
   Buttons: Continue / Skip setup.
2. **Use case picker.** Multi-select: "What do you want to use
   ResearchOS for?" with 5-6 options (PhD experiments, lab manager,
   teaching / course planning, computational research, postdoc /
   publishing, one-off project tracking). Carries forward into tab
   filtering.
3. **Tab confirmation.** "Based on what you picked, here's what your
   sidebar will look like." Renders the proposed tab list with
   per-tab on/off toggles, user can override.
4. **Telegram integration.** "Want to text photos to your experiments?
   Set up Telegram now (2 min) / Skip, I'll do this later."
   Yes → navigates to `/settings#telegram`, marks step complete on
   return. No → marks step skipped + adds a "Telegram setup" entry to
   a follow-up tip (see §5).
5. **Calendar feeds.** "Want to see your Google / Apple / Outlook
   calendars next to your experiments? Add a feed now / Skip." Same
   shape as step 4.
6. **AI Helper.** "Want to teach your ChatGPT / Claude / Gemini about
   ResearchOS? Copy a prompt now / Skip."
7. **Tour offer.** "Want a guided tour of the core features? (5 min)
   Take the tour / Skip, I'll learn as I go." Yes → opens
   `/demo?tutorial=1` (the existing sequencer, no changes). No →
   exits the wizard.

**Mechanism.** Net-new `<OnboardingWizard>` component (rough budget
600-900 LOC) replacing `<OnboardingWelcomeModal>`. Sequencer pattern
mirrors `<OnboardingTutorialSequencer>` (phase enum + per-phase
render branch). Persistence: extend `_onboarding.json` with
`useCases: string[]`, `wizardCompletedAt: string | null`,
`wizardStepsCompleted: Record<string, boolean>`. Tab filtering writes
through to `settings.json`'s `visibleTabs` field (existing field, no
schema change needed).

**Pros.** Comprehensive; lands the user on their real folder fully
configured. The use-case multi-select gives the tip catalog a
priority-weighting signal so post-wizard tips are filtered to the
user's stated focus. Single decisive moment ("I'm setting this up")
rather than ambient discovery.

**Cons.** Heaviest design + impl surface in this proposal (M-L). The
"single modal stack" feels interruption-heavy if the user just wants
to explore. Browser back/forward in the middle of a 7-step modal is
ambiguous unless we lock the URL; if we DON'T lock the URL, a
mid-wizard refresh blows the state. Wizard-skipped state is a real
shape (some steps completed, others skipped) and the data model has
to encode it.

**Effort.** **M-L.** Component impl 14-20h. Data shape 4-7h. Tab
filtering + integration gating 6-10h. Migration of existing users
4-6h. Total ~30-45h.

### 2.2 Option B: Home-screen anchored onboarding panel

**Thesis.** Don't use a modal at all. When `_onboarding.json` has no
`wizardCompletedAt` value, the home page (`/`) renders an
onboarding *panel* at the top above the project grid. The panel
walks the user through the same 7 steps as Option A, but inline on
the home page. After the wizard completes, the panel collapses to a
small "Onboarding complete" banner that the user can dismiss
permanently, after which `/` renders normally.

**Mechanism.** Net-new `<OnboardingHomePanel>` component (~400-600
LOC). Mounted inside [page.tsx:306](frontend/src/app/page.tsx:306)
conditional on the sidecar's wizard-completed flag. Sequencer logic
is similar to Option A but spatially anchored, so there's no portal,
no backdrop, no z-index war with task popups. Persistence: same as
Option A.

**Pros.** Less interruption-feeling than a modal — the user can
ignore the panel and create a project right away. Survives browser
back/forward naturally (it's just part of the page). Easier to make
it look "friendly" because it's not sitting on top of a blurred
backdrop. Empty home page no longer feels empty.

**Cons.** Easy to ignore — a user who wants the orientation actively
might dismiss the panel and miss the wizard entirely. Mobile / narrow
viewports get worse because the panel competes with project cards
for vertical real estate. Tab confirmation step (step 3 in Option A)
is awkward inline because the user is looking at the home page
inside the very sidebar she's about to reshape. The wizard step
"want a tour?" still needs the modal-style end-screen because the
tour itself runs in a new tab.

**Effort.** **M.** Component impl 10-14h, data shape 4-7h, tab
filtering 4-6h, migration 4-6h. Total ~22-33h. Cheaper than Option A
mostly because there's no portal + no backdrop wrangling.

### 2.3 Option C: Dedicated `/welcome` route

**Thesis.** Move the wizard to a full-page dedicated route at
`/welcome`. On first connect with no `wizardCompletedAt`, the
provider router (`page.tsx` first-render check) redirects to
`/welcome`. `/welcome` is a bookmarkable + re-runnable route — a
"Run setup again" link in Settings → Tips drops the user back here.
The wizard itself is the same 7 steps; UI is full-page (no modal,
no inline panel). After completion, redirect to `/`.

**Mechanism.** Net-new `app/welcome/page.tsx` route (~500-700 LOC).
Redirect logic in [page.tsx:71](frontend/src/app/page.tsx:71)'s
default-landing useEffect (already does a one-shot redirect on first
mount, so the hook point exists). Persistence: same as Option A.

**Pros.** Full-page real estate means each wizard step can have
proper breathing room, screenshots, illustrations. Browser
back/forward works naturally because each step is a real route or
query param. Re-runnable from Settings without weird re-mount
patterns. Doesn't compete with home-page content. Onboarding feels
like a "place" you go to once and then leave, not an overlay that
sits on top of your work.

**Cons.** A redirect on first connect feels heavier than a modal that
the user can quickly dismiss. The user can't peek at "what does this
app look like" before committing to setup — every brand-new user
sees the wizard before the home page. Manual URL paste of `/welcome`
post-completion lands the user on the wizard's "Run again" state,
which needs a UI affordance to skip back to home. Bookmarking is
unhelpful (no reason to bookmark a one-time-use route).

**Effort.** **M.** Route page 12-16h, redirect logic 2-4h, data shape
4-7h, integration steps 6-10h, migration 4-6h. Total ~28-43h.

### 2.4 Option D: Progressive disclosure on home (no wizard)

**Thesis.** Skip the wizard entirely. Replace the welcome modal with
a single inline banner at the top of `/` that asks one question:
"What brings you to ResearchOS?" with 5-6 chip-style buttons (the
same use-case list as A/B/C). User picks one. The banner is
replaced by a tailored "Next 3 steps" panel: "Create your first
project", "Pair Telegram", "Add a calendar feed" — three small cards
that each open the relevant flow. After each card is acted on (or
dismissed), it collapses. After all three are done, the panel
collapses entirely.

**Mechanism.** Net-new `<OnboardingNudgePanel>` component (~250-400
LOC). Mounted inside `page.tsx` above the project grid. Persistence:
extend `_onboarding.json` with `useCase: string | null` (single-pick,
not multi-select, because the next-3-steps shape only cares about
the primary intent) and `nudgesCompleted: Record<string, boolean>`.
Tab filtering becomes a single-shot rule applied at use-case-pick
time, NOT user-confirmable — too much UI weight for what's supposed
to be the lightest option. (Or skip tab filtering entirely, see
cons.)

**Pros.** Lightest-touch surface in the proposal. Zero interruption
— a user who ignores it sees a slightly fuller home page, not a
roadblock. No multi-step state machine. Trivial to migrate existing
users (banner just doesn't render for users who already have a
non-null `mode` from v1). The tip catalog handles everything else
ambiently after the user picks.

**Cons.** Doesn't actually answer "what is ResearchOS." The use-case
chip is "what do you want to do" but the user has to know what the
app does to answer. No place for the introductory copy that's
arguably the most important fix (pain point #1). Tab filtering is
either hard-coded behind the scenes (silently surprises the user
when she clicks Settings → Tabs) or skipped entirely (no
configuration benefit). Integration gating reduces to "card opens
that page" which is what tips do today.

**Effort.** **S.** Component impl 6-10h, data shape 2-4h, migration
2-3h. Total ~10-17h. Cheapest by far.

### 2.5 Option E: One-question modal + opt-in deep tour

**Thesis.** Hybrid of A and D. First-touch is a SINGLE-question modal
that's still recognizably a modal — backdrop, BeakerBot, mascot
voice — but only one decision. The question: "What brings you to
ResearchOS?" multi-select chips (PhD experiments / lab manager /
teaching / computational research / postdoc / just exploring). At
the bottom: a single primary "Continue" button + a small "Take the
full walkthrough" secondary link.

After Continue, the modal closes. The user lands on `/` with her
sidebar tabs already filtered based on what she picked. Integration
gating (Telegram, calendar, AI Helper) is NOT in the modal — it's
in a post-modal home-screen panel (the Option D "Next 3 steps" idea,
but driven by use case rather than by hard-coded ordering). Tour is
opt-in via the secondary link, which opens `/demo?tutorial=1` (same
as v1 today).

If the user picks "just exploring" / leaves the multi-select empty,
the wizard's default is "show all tabs, generic next-steps panel" —
not a roadblock.

**Mechanism.** Modified `<OnboardingWelcomeModal>` (re-use the
existing shell, swap the buttons for a chip-select). Net-new
`<OnboardingNextStepsPanel>` (~150-300 LOC) on `/`. Persistence:
`useCases: string[]`, `wizardCompletedAt: string | null`,
`nudgesCompleted: Record<string, boolean>`. Tab filtering applied
at modal-submit time, with NO user confirmation step (Grant can
flip his Tabs Settings anytime).

**Pros.** Captures the use-case signal (the critical missing input)
in a single moment without a 7-step gauntlet. Tab filtering still
fires. Integration gating moves to a smaller, lighter inline panel
on home. Existing tour code unchanged (just one of the post-modal
opt-in links). Settings → Tips already has a re-entry surface; v2
just adds "Re-run welcome" to it.

**Cons.** The introduction text is bounded by modal real estate — no
multi-paragraph "what ResearchOS is" copy. Multi-select + chip UI
needs care to look friendly and not survey-shaped. Splits
configuration across two surfaces (modal does tabs, home panel does
integrations) which adds two places for state to drift.

**Effort.** **S-M.** Modal redesign 4-7h, next-steps panel 6-10h,
data shape 3-5h, tab filtering 4-6h, migration 3-5h. Total ~20-33h.

### 2.6 Option F: No welcome modal at all (minority report)

**Thesis.** Skip the explicit welcome surface entirely. The home
page renders a real "Welcome to ResearchOS" hero card (not a tip,
not a wizard — actual home-page content) for users with zero
projects. The hero card explains the app in 2-3 paragraphs and has
big call-to-action buttons: "Create your first project", "Try the
demo", "Pair Telegram", "Add a calendar feed". The card disappears
once the user has at least one project. No use-case picker, no tab
filtering, no integration gating — the user discovers naturally.

**Mechanism.** Net-new `<EmptyHomeHero>` component (~200-300 LOC).
Mounted in `page.tsx` conditional on `projects.length === 0` (or
`hasCompletedFirstProject` flag if Grant wants the hero to survive
project-delete). No new sidecar state. Modal-based welcome surface
is deleted entirely.

**Pros.** Architecturally cheapest. Naturally self-removing (no
"dismiss forever" UX). Doesn't pretend to know who the user is
before she's shown that. Plays well with the existing tip catalog
(tips fire as the user discovers each surface).

**Cons.** No configuration happens, ever. The pain points around
tab filtering and use-case-driven tip prioritization remain
unfixed. Existing users with projects already see nothing — the
"re-onboard me" affordance is gone. Loses the user-typing signal
that A/B/C/D/E all collect. Grant's brief specifically called for
"configures their account based on their answers", which F
explicitly does not do.

**Effort.** **S.** Hero card 6-10h, delete welcome modal 1-2h.
Total ~7-12h. By far the cheapest, but it's cheap because it does
the least.

---

## 3. Recommended thesis

**Recommendation: Option E (one-question modal + opt-in deep tour).**

Reasoning:

1. **It captures the load-bearing signal (use case) without making
   the user sit through a survey.** A multi-select chip prompt is
   the minimum viable input for tab filtering + tip prioritization,
   which is what unlocks every other configuration in this proposal.
   Options A/B/C all also collect this signal, but charge the user
   3-7 additional decision moments to do it. The marginal value of
   those extra steps is low (the user has not yet seen any of the
   surfaces she's being asked to configure).
2. **It moves integration gating to where the user can actually
   evaluate it.** Asking "want to set up Telegram?" in a modal,
   before the user has even seen the home page, is asking her to
   commit to something whose value she can't assess. The home-screen
   "Next 3 steps" panel renders AFTER she's seen the app, has a
   project (or is about to create one), and can make a meaningful
   choice. This also dovetails with the existing tip catalog's
   `setupAction` footer pattern — same "navigate to setup" mechanism,
   just hoisted into a more visible surface.
3. **It preserves the existing tutorial sequencer as-is.** The
   `/demo?tutorial=1` flow already works and is a perfectly good
   "deep walkthrough" affordance for users who want it. Wiring it
   in as an opt-in secondary link costs nothing because the
   sequencer code doesn't change.
4. **It's the smallest delta from v1.** v1 already ships a welcome
   modal; v2 swaps its three-button body for a chip-select body.
   The orchestrator, sidecar, tutorial sequencer, and 11-tip
   catalog all carry forward with minor edits. Lower-risk migration
   for existing users.
5. **Effort is bounded.** ~20-33h vs Option A's 30-45h. The
   integration gating that A puts in the wizard moves to a smaller
   home panel that v2 ships in a follow-up phase, not as a wizard
   prerequisite.

### 3.1 Runners-up and why they ranked lower

- **Option A (full wizard, modal).** Right answer if Grant wants the
  most comprehensive setup experience. Loses on the "interruption
  cost vs marginal value of extra steps" trade-off. The use case
  multi-select alone gets most of the configuration benefit; the
  extra 4-5 steps after it add weight without unlocking much more.
  Reconsider if Grant says "yes I do want the full configuration in
  a single decisive moment" — then A is the right pick.
- **Option B (home-screen panel).** Architecturally clean but the
  "easy to ignore" property cuts both ways. A user who ignores the
  panel and creates a project right away never picks her use case,
  so tab filtering never fires. Recommend reconsider if Option E's
  modal feels too interruption-heavy in design review.
- **Option C (dedicated route).** Cleanest for re-running setup but
  worst for first impressions — a redirect to a setup route before
  the user has seen the app is a heavy first move. Reconsider if
  the team wants to invest in a richer setup experience (videos,
  illustrations) than a modal can hold.
- **Option D (progressive disclosure, no wizard).** Closest to
  E's spirit but skips the "what is this app" introduction
  entirely. Pain point #1 is not solved by D — the user still
  doesn't know what ResearchOS is when she picks her use case.
  E pays a small modal cost to fix that.
- **Option F (no welcome).** Fast and pragmatic but explicitly
  doesn't do what Grant asked for. Useful as a fallback if
  every other option fails design review, not as a primary
  recommendation.

### 3.2 What "Option E" looks like end-to-end

Walking through the experience under the recommended thesis:

1. **User connects folder + creates username.** Same as v1.
2. **User sees the welcome modal.** Same shell as v1's modal —
   BeakerBot on the left, copy + controls on the right. Body
   changes:
   - Heading: "Welcome to ResearchOS"
   - Sub: 2-sentence elevator pitch ("ResearchOS is a research
     notebook for biologists, chemists, and engineers. Track
     projects, store protocols, plan experiments, talk to your
     bot via Telegram.").
   - Question: "What brings you here? (Pick any that apply.)"
   - 5-6 use-case chips (multi-select). Default: none selected.
   - Continue button (primary). Secondary link: "Take a guided
     tour (5 min)" → opens `/demo?tutorial=1`.
   - Bottom small text: "You can change this any time in
     Settings → Tips."
3. **On Continue:** orchestrator writes `useCases` to sidecar,
   resolves the use-case-to-tab mapping (see §4.2), writes the
   resulting tab list to `settings.json`'s `visibleTabs`, and
   sets `wizardCompletedAt`. Modal closes. User lands on home.
4. **Home renders the Next Steps panel.** Inline above the
   project grid: 2-4 small cards driven by the use case picks.
   Examples:
   - "Create your first project" (always shown if no projects)
   - "Pair Telegram" (always shown if `_telegram.json` absent)
   - "Add a calendar feed" (shown if `_calendar-feeds.json`
     empty AND use case includes anything where calendar is
     useful — PhD, lab manager, postdoc)
   - "Set up AI Helper" (shown if use case includes
     computational or postdoc)
   - Each card has a dismiss-x and a primary CTA that
     navigates to the relevant setup. Dismissed cards stay
     gone (persisted in `nudgesCompleted`).
5. **Tips continue to fire ambiently.** The 11-tip catalog
   (filtered by use case — see §5.1) runs the v1
   `suggestions`-mode 5-minute cadence on routes the user
   visits.
6. **Settings → Tips gets a "Re-run welcome" button.**
   Re-fires the modal + resets `wizardCompletedAt` so the
   user can change her use cases at will. Tab filtering
   re-applies on each re-run.

This is the experience the proposal scopes from §4 onward.

---

## 4. Data model and persistence shape

### 4.1 Sidecar fields (additive to `_onboarding.json`)

The recommended thesis (Option E) extends the existing
`OnboardingSidecar` interface at
[sidecar.ts:46](frontend/src/lib/onboarding/sidecar.ts:46) with three
new fields:

```ts
export interface OnboardingSidecar {
  // ...existing v2 fields (version, first_seen_at, active_seconds,
  // last_tip_at, tips, tips_off, shown_count, mode)...

  /** Use cases the user selected in the welcome wizard. Empty array
   *  is a valid value (user picked "just exploring" / submitted with
   *  nothing checked); we use it to mean "show all tabs, generic
   *  next-steps". `null` is also valid and means the user hasn't
   *  gone through the wizard yet — distinguished from `[]` (went
   *  through, picked nothing) by `wizardCompletedAt`. */
  use_cases: string[] | null;

  /** ISO timestamp the wizard was completed (Continue button click).
   *  Null = wizard hasn't run yet, orchestrator should mount it.
   *  Non-null = wizard done, skip on subsequent mounts unless the
   *  user explicitly re-runs from Settings. */
  wizard_completed_at: string | null;

  /** Per-nudge dismissal state for the home-screen Next Steps panel.
   *  Keyed by nudge id (e.g. `"create-project"`, `"pair-telegram"`).
   *  Value `true` = dismissed permanently. Absent = still showing.
   *  Mirrors the `tips` map shape. */
  nudges_completed: Record<string, boolean>;
}
```

**Schema version bumps to 3.** The existing v1 → v2 normalization
path at [sidecar.ts:89](frontend/src/lib/onboarding/sidecar.ts:89)
handles the additive shape — `normalize()` defaults the new fields
when reading a v2 record. Backwards-compat for an existing-user's
record:

- `use_cases: null` (user never saw the v2 wizard)
- `wizard_completed_at: null` (will trigger one-time re-onboard
  prompt, see §4.4)
- `nudges_completed: {}` (no nudges dismissed)

**On the question of where to put `use_cases`** — there are three
candidate homes:
1. `_onboarding.json` (proposed). Pros: lives next to the other
   onboarding state; orchestrator already owns the file; sidecar
   is per-user and survives browser changes. Cons: feature
   coupling — if onboarding ever becomes a per-account vs
   per-folder concern, the field is in the wrong place.
2. `_user_metadata.json` (the per-folder shared file at
   [user-metadata.ts:3](frontend/src/lib/file-system/user-metadata.ts:3)).
   Pros: it's the canonical "per-user identity" file. Cons: it's
   small and mostly machine-managed (color, created_at, tombstone)
   — a feature-specific field doesn't belong here. Also the file
   is per-folder-shared so every user can read every other user's
   use cases, which is mildly weird.
3. `settings.json` (the per-user settings file at
   [user-settings.ts:11](frontend/src/lib/settings/user-settings.ts:11)).
   Pros: it's where `visibleTabs` already lives. Cons: settings.json
   is the "user-edited via UI" file; onboarding-state has a
   different lifecycle (write-once via wizard, never user-edited
   directly).

**Recommendation: `_onboarding.json`.** Onboarding state should live
with onboarding state. If we ever need cross-feature visibility
into use cases (e.g. tip prioritization, see §5.1), the orchestrator
can expose a read helper.

### 4.2 Use case taxonomy (proposed list)

Six candidate use cases. Multi-select; default none.

| Id                | Label                          | Maps to tabs                                                          | Maps to nudges                                |
|-------------------|--------------------------------|-----------------------------------------------------------------------|------------------------------------------------|
| `phd_experiments` | PhD student, running experiments | `/`, `/workbench`, `/gantt`, `/methods`, `/purchases`, `/calendar`   | Telegram, calendar, AI Helper                  |
| `lab_manager`     | Lab manager / PI               | `/`, `/workbench`, `/gantt`, `/methods`, `/purchases`, `/calendar`, `/links` | Telegram, calendar, lab mode discovery     |
| `teaching`        | Teaching / course planning     | `/`, `/gantt`, `/calendar`, `/links`                                  | Calendar                                       |
| `computational`   | Computational research         | `/`, `/workbench`, `/gantt`, `/methods`, `/search`                    | AI Helper                                      |
| `postdoc`         | Postdoc / publishing           | `/`, `/workbench`, `/gantt`, `/methods`, `/purchases`, `/calendar`, `/links` | Telegram, calendar, AI Helper, lab mode |
| `exploring`       | Just exploring / not sure yet  | (all tabs, no filtering)                                              | (none — defer)                                |

**Use case → tabs mapping rule.** If the user picks multiple use
cases, the resulting `visibleTabs` is the UNION of all selected
mappings. Always includes `/` (Home is non-hideable per
[nav.ts:22](frontend/src/lib/nav.ts:22)). If `exploring` is picked
at all, the union is `ALL_TAB_HREFS` (any other picks are ignored).
If NO use cases are picked but the wizard is submitted, the union
is `ALL_TAB_HREFS` (no filtering applied).

**Mapping lives where?** A static mapping table in a new
`lib/onboarding/use-case-mapping.ts` (proposed). Single source of
truth, easy to test, easy to update.

**Why these six?** Grant's vision named "experiments" and "lab
management" explicitly; the others fill out the most common research
roles that ResearchOS targets (computational researchers using the
methods catalog, teaching faculty using Gantt + calendar, postdocs
who span experiment + write-up). `exploring` is the explicit "don't
know yet" path that defaults to non-filtering — important so the
wizard doesn't lock the user out of features she hasn't yet
discovered.

Q-O2 (§6) gives Grant a chance to refine this list before it gets
implemented.

### 4.3 Settings persistence (`settings.json` write-through)

When the wizard's Continue button fires:

1. Compute `visibleTabs` from `use_cases` via the mapping table.
2. Call existing `patchUserSettings(currentUser, { visibleTabs })`
   helper at [user-settings.ts](frontend/src/lib/settings/user-settings.ts).
3. The store's `hydrateFromSettings` will re-fire on the next load
   (or via an explicit invalidate); the user's sidebar reflects
   the new tab list on the next route render.

`defaultLandingTab` is NOT overridden by the wizard. v1 defaults it
to `/` and that's still the right default — even if the user is a
PhD experiments user, they should land on Home (with the Next Steps
panel) the first time.

**Migration concern: clobbering existing user settings.** Existing
users who have already customized their `visibleTabs` should NOT
have their list overwritten. v2's migration rule: if `_onboarding.json`
already has a non-null `mode` (set by v1's welcome modal), the v2
wizard is NOT re-triggered automatically. The user sees a "Re-run
welcome" affordance in Settings → Tips (see §5.4) and can opt in.

### 4.4 Nudge state shape (Next Steps panel)

`nudges_completed` keyed by nudge id, value true = permanently
dismissed (the x button). Proposed nudges (Phase 5 chip, not Phase
1):

| Id              | Title                       | Show when                                              | CTA                              |
|-----------------|-----------------------------|--------------------------------------------------------|----------------------------------|
| `create-project`| Create your first project   | No active projects                                     | "+ New Project" (inline form)    |
| `pair-telegram` | Pair Telegram               | `_telegram.json` absent + use case wants Telegram      | Open `/settings#telegram`        |
| `add-calendar`  | Add a calendar feed         | `_calendar-feeds.json` empty + use case wants calendar | Open `/calendar?addFeed=1`       |
| `ai-helper`     | Set up your AI Helper       | Use case wants AI Helper                               | Open `/settings#ai-helper`       |
| `lab-mode`      | Enable Lab Mode             | Use case is `lab_manager`                              | Open `/lab` / wiki page          |

Show-rule logic is per-nudge: the panel renders only nudges where
(a) the use case wants it, (b) the underlying state is "not yet
set up", and (c) the nudge isn't in `nudges_completed`. Panel
collapses entirely when all eligible nudges are dismissed or done.

The "Create your first project" nudge is a special case — it shows
regardless of use case (every user needs a first project), and its
CTA can open the inline create-project form directly in
`page.tsx:331` rather than navigating elsewhere.

### 4.5 Existing user migration

Three concrete states a v2 launch finds:

- **Brand-new user (never saw v1 welcome modal):** No `_onboarding.json`,
  or `mode === null`. Wizard fires on first connect post-v2. Tab
  filtering applies. Default behavior.
- **v1 user who picked a mode (tutorial/suggestions/silenced):**
  `_onboarding.json` exists, `mode !== null`. v2 does NOT re-fire the
  wizard automatically. Settings → Tips shows a one-time "We've
  updated onboarding — want to re-run it?" banner (see §5.4) so the
  user can opt in. Tab list is left untouched.
- **v1 user mid-flow (e.g. tutorial in progress, never picked
  silenced):** `_onboarding.json` has `mode === "tutorial"` but
  `wizard_completed_at === null`. v2 treats this like the brand-new
  case — wizard fires, mode is preserved through the re-onboard, tab
  list is filtered post-wizard. Edge case, low frequency; the
  "tutorial in progress" state doesn't really exist long-term in v1
  since the tour runs in a separate tab.

The migration is **additive, not overwriting** — for the v1-user
case, no field on `settings.json` is touched until the user
explicitly clicks Re-run welcome.

---

## 5. Relationship to existing systems

### 5.1 Tip catalog (`lib/onboarding/tips.ts`)

The 11-tip catalog stays. Three shifts:

1. **`telegram-send-to-task`, `link-calendars`, `ai-helper-prompt`
   become low-priority duplicates** of the home-screen Next Steps
   nudges. The Next Steps panel covers the introduction; the tip
   catalog covers the discovery moment. Concretely: if a user
   dismisses the `pair-telegram` nudge, the `telegram-send-to-task`
   tip can still fire later (5-min cooldown, route match, etc.) —
   they're not deduplicated. The tip catches users who skipped the
   nudge; the nudge catches users who never see the tip.
2. **Use case-driven tip prioritization.** Net-new logic in
   `tipsForRoute()`: the orchestrator reads `use_cases` from the
   sidecar and re-sorts candidates so use-case-relevant tips fire
   first. Example: a `computational` user gets `ai-helper-prompt`
   bumped up; `link-calendars` and `archive-projects` drop. No
   tips are *hidden* — just re-ordered — so the v1 "every user
   sees every tip eventually" property is preserved.
3. **No tips are deleted in v2.** All 11 tips remain. The catalog
   may be pruned in a follow-up if the Next Steps panel proves to
   absorb enough of the introduction surface that some tips become
   redundant; that's a v2.1 call, not a v2 chip.

### 5.2 Tutorial sequencer (`OnboardingTutorialSequencer.tsx`)

No changes in v2. The `/demo?tutorial=1` full tour and the
`/demo?tutorial=telegram` standalone walkthrough both keep working.
The welcome modal's "Take a guided tour" secondary link wires to
`/demo?tutorial=1` (same as the v1 modal's "Walk me through it"
button). Settings → Tips already exposes a "Walk through it" mode
toggle that opens `/demo?tutorial=1`; v2 leaves that alone.

The tour's mechanism (cross-tab broadcast for first-photo, demo lab
fixtures for popup-gated tips) carries forward unchanged. The
fragility issue noted in pain point #9 is not addressed by v2 —
it's a separate scope.

### 5.3 Demo mode (`/demo`)

v2 doesn't change demo mode. It's still the place users go to "try
ResearchOS without committing" — the public demo is reachable via
the wiki nav and is unchanged.

The wizard modal's secondary link "Take a guided tour" opens
`/demo?tutorial=1` which mounts the existing sequencer against the
seeded fixture. Nothing demo-side changes.

### 5.4 Settings → Tips card

v1's Tips card at
[settings/page.tsx:2322](frontend/src/app/settings/page.tsx:2322)
already has the three-mode radio + Replay button. v2 extends it
with:

- **"Re-run welcome" button.** Clears `wizard_completed_at`, fires
  the welcome modal on the next navigation to `/`. Lives next to
  the existing Replay button.
- **One-time migration banner for v1 users.** If `mode !== null`
  AND `wizard_completed_at === null`, render a soft banner at the
  top of the Tips card: "We've updated onboarding to ask what
  you're using ResearchOS for — want to take the new welcome
  flow?" with a "Take it now" button + a "Skip, my tips are
  fine" dismiss. The dismiss sets `wizard_completed_at` to a
  sentinel ISO ("dismissed" string is fine since we type-guard the
  field as "ISO or null") — recommend setting it to `new Date(0)`
  (1970) as the "migrated, declined" sentinel.

### 5.5 AI Helper Settings card

The AI Helper prompt is one of the wizard's potential branches but
NOT a wizard step — it lives as a Next Steps nudge per §4.4, and as
the `ai-helper-prompt` tip in the catalog. The Settings card itself
([settings/page.tsx:2146](frontend/src/app/settings/page.tsx:2146))
doesn't change.

### 5.6 Standalone Telegram walkthrough (`?tutorial=telegram`)

The standalone walkthrough at `/demo?tutorial=telegram`, added on
`9a65fc42`, is the right destination for the `pair-telegram` nudge's
"want help?" branch. Nudge flow:

1. User clicks "Pair Telegram" on the Next Steps panel.
2. Lands on `/settings#telegram`.
3. The Settings → Telegram section already has a "Set up Telegram"
   button that opens `/demo?tutorial=telegram` in a new tab
   ([settings/page.tsx:644](frontend/src/app/settings/page.tsx:644)).
4. User completes the walkthrough; cross-tab handshake completes the
   nudge.

No new wiring needed beyond marking the `pair-telegram` nudge as
`nudges_completed[pair-telegram] = true` after the user pairs
successfully (the polling tab already knows when pairing succeeds
via `_telegram.json` write).

### 5.7 Lab Mode picker (the 11th standalone tip)

The `lab-mode-picker` tip at
[UserLoginScreen.tsx:680](frontend/src/components/UserLoginScreen.tsx:680)
is a pre-login affordance — it fires BEFORE the user even has an
`_onboarding.json` sidecar. v2 doesn't change it. The
`lab-mode` Next Steps nudge (§4.4) is the post-login surface for
users who didn't engage with the pre-login picker, gated on the
`lab_manager` use case.

---

## 6. Design questions for Grant

Lock these before phase chips fire. Phrased clickably (2-4 concrete
options, multi-select called out) so master can route them via
AskUserQuestion.

### Q-O1 — Which redesign thesis?

The five primary options plus the minority report:
- **A.** Multi-step wizard modal (7 steps)
- **B.** Home-screen anchored onboarding panel
- **C.** Dedicated `/welcome` route
- **D.** Progressive disclosure on home (no wizard)
- **E.** One-question modal + opt-in deep tour *(planning bot
  recommendation)*
- **F.** No welcome modal at all (minority report)

### Q-O2 — Use case taxonomy

The proposed list is: PhD experiments, Lab manager / PI, Teaching /
course planning, Computational research, Postdoc / publishing, Just
exploring. Three sub-questions:

- **Q-O2a.** Lock this list, or refine?
  - Lock as-is
  - Refine — add: (Grant fills in)
  - Refine — remove: (Grant fills in)
- **Q-O2b.** Multi-select or exclusive single-pick?
  - Multi-select (union of mappings)
  - Single-pick (cleaner, but loses dual-role users)
- **Q-O2c.** What's the default if the user submits with no picks?
  - "Show all tabs, no filtering" (proposed)
  - Re-prompt until they pick at least one
  - Block continue until at least one is picked

### Q-O3 — Wizard placement (depends on Q-O1)

If Q-O1 is A, this collapses to "modal stack". If E, this is moot
(modal). For B/C: confirm anchor surface. For D/F: skip.

### Q-O4 — Wizard trigger conditions

When does the wizard fire?
- First connect for a new user only (proposed)
- First connect + explicit "Re-run" affordance in Settings
- First connect + auto-re-trigger if the user has zero projects
  after N days

### Q-O5 — Tab filtering rule

If the user picks a use case that maps to N visible tabs, what
happens to the other 8-N?
- Hide them (proposed; user can re-enable via Settings → Tabs)
- Show them but at lower visual weight
- Show all tabs regardless (use case only drives tip
  prioritization, not tab visibility)

### Q-O6 — Existing-user behavior

What do users who already picked a v1 mode see at v2 launch?
- Soft banner in Settings → Tips offering re-onboarding (proposed)
- Auto-fire the new wizard once on next login
- Nothing — only brand-new users see v2

### Q-O7 — Integration gating placement

Where does Telegram / calendar / AI Helper setup live in v2?
- Home Next Steps panel post-modal (proposed)
- Inline wizard steps inside the welcome modal
- Settings → Tips card (current default; no v2 change)
- Both panel + tip catalog (max redundancy)

### Q-O8 — Walkthrough depth and entry point

The existing `/demo?tutorial=1` full tour walks all 10 catalog tips
(~10-15 minutes). What's its v2 framing?
- Opt-in secondary link in the welcome modal (proposed)
- No primary surface — users discover via Settings → Tips
- Inline wizard step "want a tour?" (Option A shape)

### Q-O9 — AI Helper placement

The AI Helper prompt today is a tip + a Settings card. v2 adds a
Next Steps nudge gated on use case. What's the right surface mix?
- Tip + Settings card + Next Steps nudge (proposed; one of each)
- Tip + Settings card (current; no nudge)
- Wizard step (move the discovery moment into the modal)

### Q-O10 — Tip catalog post-v2

What does the catalog look like after v2 ships?
- Keep all 11 + add use-case-conditional sorting (proposed)
- Prune to niche-only (delete the 4-5 tips that overlap with
  wizard/nudge surfaces)
- Rebuild entirely with use-case-conditional logic from the start

### Q-O11 — Wizard copy: how introductory should it be?

The proposed welcome modal body is:

> "ResearchOS is a research notebook for biologists, chemists,
> and engineers. Track projects, store protocols, plan
> experiments, talk to your bot via Telegram."

- That's about right (1-2 sentences)
- Go longer: 3-4 sentences with a "what's in it for me" angle
- Go shorter: cut the elevator pitch, just ask the question

### Q-O12 — Modal interruption tone

The welcome modal interrupts the user before they can see anything.
Acceptable cost?
- Yes — first-touch needs the moment of attention (proposed)
- No — switch to Option B (home-screen panel, dismissable)
- Compromise — modal but with a "Skip setup, just let me in" link
  that closes without any picks

---

## 7. Implementation scoping

Recommended thesis (Option E) decomposed into phase chips. Phases
are sequenced — Phase 0 (data model) is the load-bearing dependency
for every other phase. Phases 2-5 can run in parallel after Phase 1.

### Phase 0 — Data model + persistence (S, ~6-9h)

- Extend `OnboardingSidecar` in
  [sidecar.ts](frontend/src/lib/onboarding/sidecar.ts) with
  `use_cases`, `wizard_completed_at`, `nudges_completed`.
- Bump schema version to 3.
- Update `normalize()` to default the new fields.
- Update `replayOnboarding()` — should it also clear `nudges_completed`?
  Recommend YES, since replay is "start fresh" and the user expects
  the nudges to reappear too. Does NOT clear `wizard_completed_at`
  (separate Re-run button for that).
- Add `lib/onboarding/use-case-mapping.ts` with the use-case →
  tabs + nudges mapping.
- Tests: normalize + use-case-mapping round-trip.

**Surfaces touched:** `lib/onboarding/sidecar.ts`,
`lib/onboarding/use-case-mapping.ts` (new),
`lib/onboarding/__tests__/`.

### Phase 1 — Welcome modal redesign (M, ~10-14h)

- Replace `<OnboardingWelcomeModal>`'s three-button body with a
  chip-select body driven by the use case taxonomy + Continue
  button.
- Wire Continue → write `use_cases` + `wizard_completed_at` to
  sidecar; compute `visibleTabs` via use-case-mapping; write
  through to `settings.json`.
- Wire secondary "Take a guided tour" link → opens
  `/demo?tutorial=1` (existing wiring; no sequencer changes).
- Default `mode` to `"suggestions"` on wizard submit (v1 default;
  user can flip in Settings → Tips later).
- Visual polish: BeakerBot pose, copy, chip styling.

**Blocked by:** Phase 0.

**Surfaces touched:**
`components/OnboardingWelcomeModal.tsx`,
`lib/onboarding/orchestrator.tsx` (welcome-mount logic),
`lib/settings/user-settings.ts` (write-through helper).

### Phase 2 — Home Next Steps panel (M, ~10-14h)

- Net-new `<OnboardingNextStepsPanel>` component at
  `components/OnboardingNextStepsPanel.tsx`.
- Mounted on `/` above the project grid in
  [page.tsx:306](frontend/src/app/page.tsx:306) conditional on
  `wizard_completed_at` non-null AND `nudges_completed` map has
  open nudges.
- Renders the 4-5 nudges per §4.4 with show-rule logic driven by
  use cases + sidecar state.
- Per-nudge CTAs navigate to the relevant setup; per-nudge x
  button writes to `nudges_completed`.
- Tests: render fixtures per use case.

**Blocked by:** Phase 0. Parallel with Phase 3-5.

**Surfaces touched:**
`components/OnboardingNextStepsPanel.tsx` (new),
`app/page.tsx`.

### Phase 3 — Tip catalog prioritization (S, ~4-7h)

- Add use case-aware re-sort to `tipsForRoute()` in
  [tips.ts:215](frontend/src/lib/onboarding/tips.ts:215). Reads
  `use_cases` from sidecar (passed as arg) and re-orders so
  use-case-relevant tips fire first.
- Per-tip metadata: add an optional `useCases?: string[]` field
  on `OnboardingTip` indicating which use cases the tip is most
  relevant to. Tips without the field are "any use case" (sort
  position unchanged).
- Tests: sorting fixture per use case.

**Blocked by:** Phase 0. Parallel with Phase 2.

**Surfaces touched:** `lib/onboarding/tips.ts`,
`lib/onboarding/orchestrator.tsx` (pass `use_cases` into
`tipsForRoute`).

### Phase 4 — Settings → Tips card extensions (S, ~4-7h)

- Add "Re-run welcome" button in
  [settings/page.tsx:2322](frontend/src/app/settings/page.tsx:2322).
  Clicking clears `wizard_completed_at` and bounces the user to
  `/` where the modal re-fires.
- Add one-time migration banner for v1 users (`mode !== null`,
  `wizard_completed_at === null`).
- Settings card UI mirrors the existing Replay tips button.

**Blocked by:** Phase 1. Parallel with Phase 2-3.

**Surfaces touched:** `app/settings/page.tsx`.

### Phase 5 — Home-screen empty-state polish (S, ~3-5h)

- When the home page has zero active projects AND no open nudges,
  render a small inline "Get started — create your first project"
  CTA instead of the bare empty grid. Lightweight; doesn't
  duplicate the Phase 2 panel.
- Mostly copy + visual polish.

**Blocked by:** Phase 2.

**Surfaces touched:** `app/page.tsx`.

### Phase 6 — Integration test pass (S, ~3-5h)

- Playwright fixture: brand-new user flow end-to-end.
- Playwright fixture: v1 user migration flow (existing
  `_onboarding.json` with mode set, sees banner).
- Tab-filtering test: pick `computational`, verify
  `visibleTabs` ends up `["/", "/workbench", "/gantt",
  "/methods", "/search"]`.
- Tip-prioritization smoke test.

**Blocked by:** Phases 1-4. Should run as the final integration
gate before the proposal merges to main.

**Surfaces touched:** `tests/onboarding/` (new fixtures).

### Phase 7 (optional) — Wiki updates

- Wiki page covering the new welcome flow + use-case mapping
  + re-run affordance.
- Annotated screenshots (use `?wikiCapture=1`, NOT real data).

**Blocked by:** Phases 1-6 merged.

**Surfaces touched:** `app/wiki/features/onboarding/page.tsx` (new
or revision). Wiki manager territory — flag for handoff, do NOT
own from the onboarding sub-bot side.

### Total cost estimate

- Phase 0: 6-9h
- Phase 1: 10-14h
- Phase 2: 10-14h
- Phase 3: 4-7h
- Phase 4: 4-7h
- Phase 5: 3-5h
- Phase 6: 3-5h
- Phase 7: 6-10h (wiki manager handoff)

**Implementation total: ~40-61h** for Phases 0-6 (the sub-bot scope).
Plus ~6-10h for the wiki handoff in Phase 7. Significantly cheaper
than Methods v2's 70-105h because the v2 onboarding redesign reuses
v1's sidecar, orchestrator, and tutorial sequencer — only the
welcome modal body + home panel + tip sorter are net-new code.

---

## 8. Risk analysis and migration concerns

### 8.1 Settings clobber on existing users (HIGH)

**Risk.** A user who has carefully curated `visibleTabs` to a
specific subset gets her settings overwritten when the wizard
applies use-case-driven tab filtering.

**Mitigation.** The wizard does NOT fire automatically for v1 users
(mode is already set). They see the Settings → Tips banner
("We've updated onboarding") which is opt-in. Only users who
click "Re-run welcome" get their tabs re-filtered, and at that
point they've consented to a fresh setup.

**Open question.** When a user clicks Re-run welcome, should we
snapshot her current `visibleTabs` first so she can recover the
pre-wizard list? Recommend YES — write a `pre_wizard_visible_tabs`
field to the sidecar before the wizard fires, expose a "Restore
my previous tabs" button if the user is unhappy with the post-
wizard set.

### 8.2 Wizard skip → user has no use cases (MEDIUM)

**Risk.** User submits the wizard with no chips selected. What's
the default `visibleTabs`?

**Mitigation.** Per Q-O2c, the proposed default is "show all tabs,
no filtering". This matches v1 behavior and is safe — the user can
hide tabs later via Settings → Tabs.

### 8.3 A/B regression risk (HIGH)

**Risk.** The welcome modal is a critical first-impression surface.
A broken wizard (chips don't render, Continue doesn't persist,
modal won't close) is worse than the current "no welcome" state.

**Mitigation.** Phase 6's integration test pass MUST cover the
happy path end-to-end (brand-new user → modal → use case pick →
Continue → settings written → modal closes → home renders). Manual
QA before merge — the master orchestrator should personally smoke-
test the modal before merging Phase 1.

### 8.4 Browser back/forward mid-wizard (LOW for Option E, HIGH for A)

**Risk.** Modal wizards that span multiple URL changes lose state on
back. Browser back inside a modal generally closes the modal in
React; if the wizard's state is in the modal component, it's lost.

**Mitigation for Option E.** Option E is single-step, so there's no
mid-wizard back. Back closes the modal entirely; the user re-fires
via Settings → Tips. Acceptable.

**Mitigation for Option A.** If Grant picks Option A in Q-O1, the
wizard needs URL-backed state (e.g. `?wizard=step3`) so back works.
Adds ~4-7h to Phase 1.

### 8.5 Lab Mode interaction (MEDIUM)

**Risk.** A user who logs in as "lab" (Lab Mode sentinel) is
redirected to `/lab` by [page.tsx:61](frontend/src/app/page.tsx:61).
Should the wizard fire for the Lab Mode account?

**Mitigation.** No. Lab Mode is a shared receiver account, not a
personal first-touch surface. The wizard mount gate in the
orchestrator already excludes `currentUser === "lab"` via the
`/lab` redirect (the user never sees `/` in Lab Mode). v2's wizard
mount should explicitly check `currentUser.toLowerCase() !== "lab"`
as belt-and-suspenders.

### 8.6 Shared / Lab Mode receivers (MEDIUM)

**Risk.** If alex (use case: `phd_experiments`) shares a project
with morgan (use case: `lab_manager`), does morgan see alex's tab
filtering? Should her tabs change based on the share?

**Mitigation.** No. `visibleTabs` lives in morgan's `settings.json`,
independent of alex's. Sharing affects project visibility, not tab
visibility. The wizard fires once per user per folder; receivers
have their own wizard pass.

### 8.7 AI Helper artifact regen if use_cases lands in `types.ts`
(LOW)

**Risk.** Grant's brief notes that if `useCases` is added to a
canonical types file the AI Helper schema artifact needs regen.

**Mitigation.** `use_cases` lives on `OnboardingSidecar` in
[sidecar.ts](frontend/src/lib/onboarding/sidecar.ts), NOT in
`lib/types.ts`. The AI Helper prebuild extracts `lib/types.ts`
shapes for its prompt; sidecar shapes are out of scope. No regen
needed.

If the use case taxonomy ever moves to `lib/types.ts` (e.g. for
cross-feature consumers), flag the AI Helper bot to regen.

### 8.8 Cross-tab tutorial state during wizard (LOW)

**Risk.** A v1 user mid-tutorial-tour sees the v2 banner. What
happens if she clicks "Take it now" while a tour tab is open?

**Mitigation.** The wizard runs in the polling tab (real folder).
The tutorial sequencer runs in tab B. They're decoupled by the
BroadcastChannel pattern. Worst case: the user starts the new
wizard in tab A while the tour is still active in tab B. Both
finish independently. Tab filtering applies on wizard submit;
tour proceeds normally in tab B.

### 8.9 Empty-state on home if user submits + has no projects (LOW)

**Risk.** Post-wizard, the home page has a Next Steps panel AND an
empty project grid. Visual collision: panel takes top space, grid
is empty.

**Mitigation.** Phase 5 adds an empty-state CTA on the project
grid that mentions the panel above it ("Or pick a next step from
the panel above"). Single, deliberate empty-state experience.

### 8.10 Migration banner spam (LOW)

**Risk.** The Settings → Tips migration banner shows EVERY time a
v1 user opens Settings until she dismisses it.

**Mitigation.** Single dismiss flag (`wizard_completed_at = epoch(0)`
sentinel) handled in Phase 4. After dismiss, banner never fires
again.

---

## 9. Out-of-scope reminders

The manager should explicitly carve these out of v2 chip scope. They
are NOT part of any v2 phase chip.

- **The hybrid markdown editor.** A separate planning bot is in
  flight for that on a different branch (HYBRID_EDITOR_V2_PROPOSAL.md,
  merged on `49c2626b`). The onboarding wizard does NOT touch the
  editor.
- **Methods / experiments / purchases / calendar surface redesigns.**
  v2 onboarding configures access to these tabs (via tab filtering),
  it does not redesign the tabs themselves. METHODS_EXPANSION_V2,
  PURCHASES_PAGE_PROPOSAL, RESULTS_PAGE_PROPOSAL, and
  LISTS_TAB_PROPOSAL are separate scopes.
- **Wiki content restructuring.** The wizard's secondary "Take a
  tour" link may invoke a wiki page entry point eventually, but
  v2 doesn't restructure the wiki — that's wiki manager territory.
  v2 may reference `/wiki/features/onboarding` if Phase 7 fires;
  the wiki manager owns the actual content.
- **The AI Helper feature itself.** v2 adds a Next Steps nudge that
  points at the AI Helper Settings card; it doesn't change the
  card or the prompt generator. AI_HELPER_PROPOSAL is the
  authoritative scope for that surface.
- **The standalone Telegram walkthrough.**
  `/demo?tutorial=telegram` exists (merged at `9a65fc42`) and the
  `pair-telegram` nudge links to it. v2 doesn't redesign the
  walkthrough itself — only consumes it.
- **The 11-tip catalog content.** Tip copy + targets stay as-is in
  v2. Phase 3 only adds use-case-conditional ordering. Tip-content
  changes (delete tips, add new tips, rephrase copy) are v2.1
  candidates.
- **Lab Mode UX.** Lab Mode has its own first-touch (login screen
  picker tip) and its own wiki page. v2 adds a `lab-mode` nudge
  gated on the `lab_manager` use case; it doesn't restructure
  Lab Mode itself.
- **Repair scripts for `_onboarding.json`.** The Phase 0 schema bump
  to v3 is additive; existing v1/v2 records are forward-compatible
  via `normalize()`. No repair script needed.
- **Multi-folder onboarding state.** Today onboarding is per-user-
  per-folder. If we ever want "carry the wizard answer across
  folders for the same user" that's a cross-folder identity
  problem. Out of scope for v2.
- **Wizard analytics / telemetry.** Tracking which use cases get
  picked, drop-off rates, etc. ResearchOS is local-first and
  doesn't ship analytics; v2 doesn't add any. If we ever want
  this, the user must opt in explicitly (privacy posture is
  unchanged).

---

## Appendix A: files referenced

- [frontend/src/lib/onboarding/tips.ts](frontend/src/lib/onboarding/tips.ts):
  the 10-entry catalog (priority 1-11, `lab-mode-picker` is the
  11th tip rendered separately in `<UserLoginScreen>`)
- [frontend/src/lib/onboarding/orchestrator.tsx:130-480](frontend/src/lib/onboarding/orchestrator.tsx:130):
  the `<OnboardingOrchestrator>` — sidecar load, active-time, mode
  setter, roll loop, welcome modal mount
- [frontend/src/lib/onboarding/sidecar.ts:46-68](frontend/src/lib/onboarding/sidecar.ts:46):
  `OnboardingSidecar` interface (v2 extends this in §4.1)
- [frontend/src/lib/onboarding/sidecar.ts:215-225](frontend/src/lib/onboarding/sidecar.ts:215):
  `setOnboardingMode` (the welcome modal's persist path)
- [frontend/src/components/OnboardingWelcomeModal.tsx](frontend/src/components/OnboardingWelcomeModal.tsx):
  v1 welcome modal (Phase 1 replaces this body)
- [frontend/src/components/OnboardingTutorialSequencer.tsx](frontend/src/components/OnboardingTutorialSequencer.tsx):
  the demo-tab full + Telegram-only tutorial sequencer (unchanged
  in v2)
- [frontend/src/components/AppShell.tsx:91-216](frontend/src/components/AppShell.tsx:91):
  the shell that filters tabs by `visibleTabs`
- [frontend/src/app/page.tsx:306-329](frontend/src/app/page.tsx:306):
  home page that Phase 2's Next Steps panel mounts into
- [frontend/src/app/page.tsx:61-80](frontend/src/app/page.tsx:61):
  lab-mode redirect + default-landing redirect (the wizard mount
  gate sits here)
- [frontend/src/app/settings/page.tsx:2322-2473](frontend/src/app/settings/page.tsx:2322):
  Settings → Tips card (Phase 4 extends this)
- [frontend/src/app/settings/page.tsx:644](frontend/src/app/settings/page.tsx:644):
  the `/demo?tutorial=telegram` link (consumed by the
  `pair-telegram` nudge)
- [frontend/src/lib/settings/user-settings.ts:11-82](frontend/src/lib/settings/user-settings.ts:11):
  `UserSettings` + `DEFAULT_SETTINGS` (Phase 1 writes
  `visibleTabs` through here)
- [frontend/src/lib/nav.ts:11-31](frontend/src/lib/nav.ts:11):
  `NAV_ITEMS` (the canonical tab list the wizard filters from)
- [frontend/src/lib/store.ts:21-33](frontend/src/lib/store.ts:21):
  `SettingsHydration` (in-memory mirror of settings.json)
- [frontend/src/lib/providers.tsx:79-92](frontend/src/lib/providers.tsx:79):
  `<OnboardingProvider>` mount in providers (Phase 1 may extend
  the mount gate)
- [frontend/src/components/UserLoginScreen.tsx:680](frontend/src/components/UserLoginScreen.tsx:680):
  `lab-mode-picker` tip (pre-login, unchanged in v2)
- ONBOARDING_TIPS_PROPOSAL.md (v1 proposal at repo root):
  the v1 spec this proposal extends
- TELEGRAM_ONBOARDING_PROPOSAL.md (related, at repo root):
  the standalone Telegram walkthrough spec
- AGENTS.md §6: known traps and merge discipline notes for
  parallel chips
- METHODS_EXPANSION_V2_PROPOSAL.md, HYBRID_EDITOR_V2_PROPOSAL.md
  (repo root): voice + shape precedents this proposal mirrors

## Appendix B: source-code findings worth flagging

Things I noticed while reading the existing onboarding code end-to-
end that are NOT load-bearing for the proposal but matter for the
implementer:

1. **The welcome modal's "Walk me through it" button opens the
   tutorial in a NEW tab.** The user's real folder stays in the
   original tab; the tour runs against `/demo` in tab B. This is
   why the cross-tab BroadcastChannel handshake exists. v2's
   secondary "Take a guided tour" link inherits this pattern — it
   needs the same `window.open` (synchronous, popup-blocker-safe)
   call from the click handler.

2. **`setOnboardingMode()` uses a -999_999 sentinel for cooldown
   bypass.** When the user picks a mode, the orchestrator wants
   the first tip to fire within one roll tick (~5s) instead of
   waiting a full 5-minute cooldown. The sentinel
   ([sidecar.ts:222](frontend/src/lib/onboarding/sidecar.ts:222))
   makes `now - last_tip_at` always satisfy the gate. v2's wizard
   completion should use the same pattern if it wants the first
   tip / nudge to fire immediately post-wizard. Or skip the
   sentinel entirely — the home page Next Steps panel is the
   primary post-wizard surface, not a tip.

3. **The orchestrator's roll loop checks `pathname.startsWith(tip.route)`
   for route eligibility.** Tips with `route: "/"` match every
   route, not just the home page. v2's tip prioritization (Phase
   3) needs to know this — a tip with `route: "/"` and use case
   `computational` is eligible on `/methods`, not just `/`.

4. **`tips_off` flag is a global kill switch separate from `mode`.**
   The "stop" outcome on a tip sets `tips_off: true`
   ([orchestrator.tsx:441](frontend/src/lib/onboarding/orchestrator.tsx:441));
   this is checked AFTER the mode check. Subtle: a user with
   `mode: "suggestions"` and `tips_off: true` gets no tips. v2's
   wizard should NOT clear `tips_off` automatically — it's a user
   intent flag that's separate from mode.

5. **Active-time tracker survives tab close via an unmount flush.**
   [active-time.ts](frontend/src/lib/onboarding/active-time.ts) writes
   `active_seconds` to the sidecar on visibility-hidden AND on
   `stopActiveTime()` (called from the orchestrator's unmount).
   v2's wizard mount should NOT race with this — the wizard's
   first sidecar read happens AFTER `initActiveTime` resolves
   ([orchestrator.tsx:152](frontend/src/lib/onboarding/orchestrator.tsx:152)),
   which means the wizard always sees a normalized sidecar.

6. **The `lab-mode-picker` is the 11th tip but lives outside the
   catalog.** It's in `<UserLoginScreen>` with its own
   sessionStorage gate. The proposal text refers to "11 tips" out
   of respect for the v1 framing; the actual `ONBOARDING_TIPS`
   array has 10 entries, plus this standalone. v2 does not move
   `lab-mode-picker` into the catalog — that would conflict with
   the pre-login mount surface.

7. **The `_onboarding.json` sidecar is per-user-per-folder, not
   per-human.** A user who opens the same folder on a second
   machine inherits her dismissal history; a user who joins a
   shared lab account ("alex") on her own folder gets her own
   sidecar. This shape matters for v2: `use_cases` is per-user-
   per-folder. A user who logs into two different folders sees
   two independent wizard prompts. Acceptable per v1's
   "What 'brand-new' means here" framing in the v1 proposal.

8. **`isDemoOrWikiCapture()` is the universal exemption gate.**
   It's checked in `OnboardingProvider`, in the orchestrator's
   mount effect, in `setMode`, and in `cancelTip`. v2's wizard
   mount must inherit this check — `?wikiCapture=1` MUST NOT
   trigger the welcome modal, or every wiki screenshot gets
   photobombed. Phase 1 must add the same `if (isDemoOrWikiCapture()) return;`
   guard.

9. **Settings → Tips `effectiveMode` collapses null to
   "suggestions".** The settings card treats `mode === null` as
   visually "suggestions" because the welcome modal blocks the
   surface from being useful before the user picks
   ([settings/page.tsx:2395](frontend/src/app/settings/page.tsx:2395)).
   v2's settings card extension (Phase 4) should follow the same
   pattern for `wizard_completed_at === null`.

10. **`replayOnboarding()` does NOT reset mode.** v1's Replay
    button clears the tips map but leaves `mode` and
    `first_seen_at` alone
    ([sidecar.ts:191](frontend/src/lib/onboarding/sidecar.ts:191)).
    v2's Phase 0 should decide whether to also clear
    `nudges_completed` on replay — recommend YES, since the
    Next Steps panel is the new "first tip equivalent" and
    replay should reset all introductory surfaces.

---

planning bot (onboarding v2)
