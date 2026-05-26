# Wiki audit: Settings + AI Helper + Streaks

Date: 2026-05-26
Auditor: wiki audit: settings + AI + streaks
Anchor commit: 14ea9892 (main as of fetch)

## Scope

In:

- `/wiki/features/settings` page (`frontend/src/app/wiki/features/settings/page.tsx`)
- AI Helper section coverage (settings page anchor `#ai-helper`)
- Streaks section coverage (settings page anchor `#streaks`, plus PTO subsection)
- WIKI_NAV + APP_ROUTE_TO_WIKI mapping for `/settings`

Out (handled by sibling audits):

- Lab Mode tab specifics (Account type, Lab Head, Lab Roster) -> lab-head audit
- Settings re-run tour cursor demos / onboarding wizard wrap-up -> Stream A audit

## App surfaces audited

- `frontend/src/app/settings/page.tsx` (3872 lines, scanned for section titles + structure)
- `frontend/src/app/settings/StreaksSection.tsx`
- `frontend/src/app/settings/PtoEditor.tsx`
- `frontend/src/app/settings/__tests__/StreaksSection.test.tsx` (behavior intent)
- `scripts/build-ai-helper.mjs`, `scripts/check-ai-helper.mjs`
- `frontend/public/ai-helper/manifest.json` (helper_version 12, schema_hash present, 3 sizes)
- `frontend/src/lib/wiki/nav.ts` (WIKI_NAV + APP_ROUTE_TO_WIKI)
- `frontend/src/lib/streak/*` (sidecar shape)

## Navigation coverage

- APP_ROUTE_TO_WIKI maps `/settings` -> `/wiki/features/settings`. Correct.
- WIKI_NAV exposes a "Settings" leaf under the Features section with blurb "Profile, password, preferences, tab visibility." Functional but stale: leaves out AI Helper, Streaks, Tabs reorg, Lab Mode tab strip, and several other panels added since the blurb was written. Low-impact (blurb only), but worth refreshing during the next nav pass.
- No `/wiki/integrations/ai-helper` page exists. The role brief mentioned that path as documented, but the settings page comment (around line 3532) confirms the link was intentionally removed and the section is meant to be self-explanatory under the Settings page anchor `#ai-helper`. The brief's claim that this path is "documented" is incorrect.

## Findings

Severity levels: H = user-blocking inaccuracy, M = noticeable gap or staleness, L = polish / nice-to-have.

### H1. Data inventory external-calls list is missing destination (e)

Wiki (line 376 of settings wiki) lists four outbound destinations: (a) `api.telegram.org`, (b) `/api/calendar-feed`, (c) `/api/telegram-file`, (d) Vercel analytics. The actual section (page.tsx lines 2441-2484) lists FIVE, adding (e) `research-os-xi.vercel.app` (the AI Helper pull-from-deploy fetch). The wiki even discusses the Pull-latest button in the AI Helper section above, so a curious user reading the privacy section will land on what looks like an undocumented external call. Add destination (e) and the "user-initiated, on-demand" qualifier the actual section uses.

### M1. AI Helper freshness footer wording is incomplete

Wiki says: "A freshness footer below the buttons shows the date the prompt was built and the ResearchOS commit it was generated from." Actual line reads: "Last refreshed: <date> · helper_version N · ResearchOS @ <commit>". The helper_version (currently 12 in `manifest.json`) is the most actionable piece for users who want to confirm they have a recent prompt and is not mentioned. Add helper_version to the description.

### M2. Streaks section title + lock-icon framing missing

Wiki uses heading "Streaks" but the actual section header is "Streaks (private to you)" with a sky-blue lock icon. The wiki opens with "Streak data is stored in a per-user sidecar and is visible only to you", which captures the privacy point in prose, but the visual lock affordance is part of how the section signals privacy at a glance. Either match the section title or call out the lock icon and "(private to you)" suffix so a screenshot does not surprise the reader.

### M3. PTO subsection coverage is one sentence

Wiki: "Below the reset button is a PTO subsection for configuring planned days off so the streak counter skips them." The actual editor (PtoEditor.tsx) ships:

- Future-dates-only constraint with explicit error "Past dates can't be added here. Add future dates only."
- An amber soft-cap warning at N entries ("You have N PTO days. That's a lot, double check the list.")
- Empty-state placeholder ("No PTO days yet.")
- Removable-row list with per-entry remove buttons
- Header subtitle that says PTO dates affect BOTH streak counting AND "projects that skip weekends" (not only streaks)

Worth a short paragraph or three bullets so users know how to add/remove entries and that PTO has the secondary effect on weekend-skipping projects.

### M4. AI Helper section omits "View prompt source" link and chat-tier amber callout

Two pieces of AI Helper UX the wiki does not mention:

- A `View prompt source` link at the bottom that opens the raw markdown file (`/ai-helper/<size>.md`) in a new tab. Useful for the user who wants to read the prompt before pasting it.
- An amber "Heads up" callout (page.tsx lines 3471-3477) clarifying that the affordance is for the chat interface (claude.ai / chatgpt.com / gemini.google.com), that a Max/Plus/Advanced subscription works, and that no API key is needed. This is a real support-ticket-prevention message and should be in the wiki, especially since "Open in Claude/ChatGPT/Gemini" buttons read as "API integration" to a non-technical user.

### L1. Wiki blurb in WIKI_NAV is stale

`frontend/src/lib/wiki/nav.ts` line ~303 lists Settings blurb as "Profile, password, preferences, tab visibility." Settings now has 14 panels (Personal tab) plus the Lab Mode tab. Refresh to something like "Profile, tabs, AI Helper, streaks, data tools, security." Low-impact (blurb only).

### L2. AI Helper section is a Settings sub-anchor only

The role brief expected `/wiki/integrations/ai-helper` to exist. It does not, and the in-app section is the canonical wiki entry. If AI Helper grows, consider promoting it to its own page under `/wiki/integrations/` and adding a WIKI_NAV entry. Today the Settings section is sufficient.

### L3. Streaks visibility scope claim is correct but could be sharper

Wiki says "visible only to you". The streak sidecar is per-user, on disk, so technically anyone with raw filesystem access to the shared lab folder could read it (the same caveat the Security panel makes about password not encrypting files). Worth a one-line callout, parallel to the password caveat, that "visible only to you" means "not surfaced in the app to other users" rather than "encrypted at rest".

## Coverage summary

- Settings panels documented: 14 of 14 personal-tab panels (Profile, Tabs, LabArchives, AI Helper, Sidebar, View defaults, Animation, Notifications & behavior, Streaks, Data inventory, Data maintenance, Onboarding, Security, Offline mode). Full top-level coverage.
- Search bar: documented (substring match across headings + body text). Accurate.
- Personal vs Lab Mode tab strip: documented. Lab Mode tab content out of scope for this audit.
- Settings re-run tour from Onboarding panel: documented at a level consistent with the in-page UI. Cursor-demo specifics out of scope for this audit.
- AI Helper full pipeline: section exists at `#ai-helper` with size picker, copy button, open-in-provider buttons, stale callout, pull-from-deploy. Two surfaces (View prompt source link, chat-tier amber callout) and the helper_version freshness detail are missing or under-described (M1, M4).
- Streaks S0-S6: enable toggle + stat trio + reset modal + PTO subsection all present in wiki. Lock-icon/private-suffix visual and the PTO editor mechanics are under-described (M2, M3).

## Finding counts

- High (H): 1
- Medium (M): 4
- Low (L): 3
- Total: 8

## Next actions for tip manager

H1 should be queued immediately; it is a one-paragraph fix in the Data inventory section and resolves an apparent privacy contradiction with the AI Helper section above. M1-M4 are all single-paragraph or single-bullet additions to the existing Settings wiki page and can be batched into a single touch-up chip. L1 is a one-line edit in `nav.ts`. L2-L3 are direction questions for Grant rather than self-contained fixes.
