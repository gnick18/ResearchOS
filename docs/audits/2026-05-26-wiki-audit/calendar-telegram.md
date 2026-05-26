# Wiki Audit: Calendar + Telegram + External Feeds (2026-05-26)

Sub-bot: wiki audit: calendar + telegram
Anchor: main @ `14ea9892` (Overnight orchestrator handoff doc).

## Scope

Audit current wiki coverage of:
- `frontend/src/app/wiki/features/calendar/page.tsx`
- `frontend/src/app/wiki/integrations/calendar-feeds/page.tsx`
- `frontend/src/app/wiki/integrations/telegram/page.tsx`
- `frontend/src/app/wiki/features/notifications/page.tsx` (Telegram inbox sections)

Compared against:
- `frontend/src/app/calendar/page.tsx`
- `frontend/src/components/CalendarFeedsModal.tsx`, `CalendarFeedsButton.tsx`, `CalendarSidebar.tsx`, `calendar/MonthView.tsx`
- `frontend/src/lib/calendar/external-feeds-store.ts`, `ics-parser.ts`, `calendar-colors.ts`, `use-external-events.ts`, `notification-prefs-store.ts`
- `frontend/src/components/TelegramPairingModal.tsx`, `TelegramStatusBadge.tsx`, `InboxPanel.tsx`, `InboxBadge.tsx`
- `frontend/src/lib/telegram/badge-presentation.ts`, `batch-routing.ts`, `image-router.ts`, `telegram-store.ts`
- `frontend/src/lib/wiki/nav.ts` (`WIKI_NAV`, `APP_ROUTE_TO_WIKI`)
- AGENTS.md section 5

Out of scope (per brief): Home calendar-events-today widget, onboarding.

## Summary

Counts: 0 P0, 2 P1, 4 P2, 5 OK-confirmed.

The wiki is in solid shape post-OAuth retirement. `/wiki/integrations/calendar-oauth` is confirmed deleted, `WIKI_NAV` and `APP_ROUTE_TO_WIKI` carry no orphan references, and the v3 ICS-only schema is correctly described. Telegram pairing flow text matches code byte-for-byte on the bot prompts. Two coverage gaps stand out: the new stale-polling amber-tooltip flip and the opt-in encrypted-backup feature, both shipped without wiki copy. Smaller drift: the features/calendar opener still implies direct Google/Outlook connection.

## Findings

### P1-1: features/calendar opener implies direct OAuth-style connect

`frontend/src/app/wiki/features/calendar/page.tsx:31-34`

> The two buttons on the far right are **Linked Calendars** (connect Google, Outlook, or paste an iCal URL) and **+ New Event**.

The parenthetical "connect Google, Outlook, or paste an iCal URL" is read by a returning user as three connection paths (two named-provider buttons + an iCal fallback). With OAuth retired (2026-05-14), there is only the iCal URL path. The deeper sub-section on the same page (lines 117-167) gets this right ("The same iCal-URL flow works for all four providers"), but the opener primes the wrong mental model.

Suggested rewrite: "...Linked Calendars (subscribe to any Google / Outlook / iCloud calendar via its public iCal URL)...".

### P1-2: Stale-polling amber flip + recovery tooltip undocumented

`frontend/src/lib/telegram/badge-presentation.ts` ships a `STALE_PRESENTATION` state that flips the emerald breathing dot to a flat amber dot when polling has gone quiet. `TelegramStatusBadge.tsx:26-27` adds the hover-only tooltip text: "Send a message in your Telegram app to refresh the stale connection." Wiki integrations/telegram describes the `retrying` / `another tab is polling` / `re-pair needed` states but not the stale state. A user seeing the amber dot today will assume "retrying" (which has a different recovery: wait), not "send a Telegram message to wake it up".

Add a third h3 in the "Telegram pill" section after "The retrying state": brief description of the stale flip + the one-message recovery hint.

### P2-1: Encrypted-backup opt-in is not in the wiki

`TelegramPairingModal.tsx:62-71, 409-504` ships a "Save encrypted backup for auto-reconnect" checkbox (account-password gated, AES-GCM + PBKDF2 to `_telegram-encrypted.json`) that lets users recover pairings after a browser wipe / cloud-sync conflict without re-pasting the BotFather token. Wiki integrations/telegram has zero copy on this. The "Pair with ResearchOS" Steps and the "Disconnecting" / "Keep your bot token private" callouts together imply re-pairing is the only recovery path.

Add a short sub-section under "Pair with ResearchOS" explaining the checkbox, when it shows (only when the user has a Settings password set), and what the encrypted file is.

### P2-2: features/calendar feature page sidebar Manage description is fine, but missing the "Reminders" modal screenshot

`frontend/src/app/wiki/features/calendar/page.tsx:181-203` describes the Reminders modal in prose but does not show a screenshot. The capture list in `scripts/capture-wiki-screenshots.mjs` should probably include `calendar-reminders-modal.png` for parity with the screenshot density on the other sections. Low priority since the prose is accurate; flag for the screenshot pass.

### P2-3: Telegram wiki says "📥 Inbox option at the bottom" but actual label is "📥) Save to Inbox"

`frontend/src/app/wiki/integrations/telegram/page.tsx:153-155`

> a **📥** Inbox option at the bottom.

`frontend/src/lib/telegram/batch-routing.ts:531` emits `📥) Save to Inbox` as the picker option. Substantively correct but the actual user-facing string is "Save to Inbox", not just "Inbox". Minor copy-fidelity gap.

### P2-4: features/calendar feature page intro mentions only month/week/day, missing nuance on day-view location inline

The page intro and the "Switch views" bullets are accurate. Just noting that the Day view also surfaces `location` inline; the wiki captures it correctly on line 56 so this is OK-confirmed, not a finding. Leaving listed for completeness.

## OK-confirmed (no action)

1. `/wiki/integrations/calendar-oauth` page is deleted. No file under `frontend/src/app/wiki/integrations/calendar-oauth/`. No references in `WIKI_NAV`, `APP_ROUTE_TO_WIKI`, or any wiki page body.
2. v3 ICS-only schema in `external-feeds-store.ts:25-101` matches wiki coverage of the four provider dropdowns (iCloud / Google / Outlook / Other). Legacy OAuth `kind: google|outlook` entries are silently filtered (line 89), correctly captured in AGENTS.md section 5.
3. 15-min refresh + 1-hour stale-while-revalidate cache claims in wiki integrations/calendar-feeds lines 178-198 match `app/api/calendar-feed/route.ts:142` (`max-age=900, stale-while-revalidate=3600`) and `lib/calendar/use-external-events.ts:17,43,78` (`FIFTEEN_MIN_MS`, `ONE_HOUR_MS staleTime`).
4. Color palette claims accurate: 10 swatches in the add form, 5-swatch strip on connected-row recolor (`CalendarFeedsModal.tsx:245,386`); palette source `lib/calendar/calendar-colors.ts:11-14`.
5. Telegram bot prompts match code: "Got a {photo,album}. Where should it go?" (`batch-routing.ts:855,884`), "——— Active ———" / "——— No results yet ———" section headers (`batch-routing.ts:502,517`), `📝 Lab Notes` / `📊 Results` sub-tab keyboard (`batch-routing.ts:551,557`), `📥) Save to Inbox` (line 531). The "Pick another" escape hatch on the active-task prompt is real (`batch-routing.ts:458`). `+N` recent-photos counter matches `TelegramStatusBadge.tsx:50-54,117-119`. Cross-tab lock conflict label matches `badge-presentation.ts:42-46`. Disconnect flow (`TelegramPairingModal.tsx:250-262`) matches wiki "Disconnect bot" copy and the `users/<u>/_telegram.json` storage note.

## Notes for downstream chips

- A single fix chip can address P1-1 + P1-2 + P2-3 (all are wiki-only copy edits in two files: `wiki/features/calendar/page.tsx` and `wiki/integrations/telegram/page.tsx`).
- P2-1 (encrypted backup) deserves its own small chip since it adds a new sub-section with security framing; the security wiki page already has groundwork (`wiki/security/page.tsx` mentions `_telegram.json` but not the encrypted sidecar).
- P2-2 (Reminders modal screenshot) is a screenshot-pass task, not a wiki-copy task.
