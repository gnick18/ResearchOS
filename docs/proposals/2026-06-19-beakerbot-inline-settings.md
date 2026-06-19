# BeakerBot inline settings, design doc

Date 2026-06-19. Status: proposed (design of record for sign-off, no code yet). Related: `[[project_beakerbot_crud_tools]]`, `[[project_notification_preferences]]`, `[[project_settings_redesign]]`.

## The gap

BeakerBot cannot read or change a single app setting. The only settings-shaped tools are `remember_preference` / `forget_preference`, which are BeakerBot's OWN behavioral memory, not the app's `UserSettings`. No AI tool calls `patchUserSettings`. The most it can do is navigate you to the settings page (`go_to_page`) and guide or click (`guide_to_element`, `click_element`), which is exactly the "open the page" friction we want to remove.

The inline-widget rails already exist. The chat renderer detects a "lone embed" (a paragraph whose only child is an object-embed link parsed to an `EmbedDescriptor`) and swaps it for a rich interactive widget. That is how `RecordSetWidget`, `AnalysisPickerWidget`, and `SummaryReportWidget` render today (see `src/components/ai/chat-embed-detect.ts` and `BeakerBotConversation.tsx`). A settings embed is a new descriptor kind plus one control widget on that same path, not a new subsystem.

## Vision

"Turn on dark mode" or "mute task notifications" renders the REAL control inline in the conversation and you tap it, with no navigation. The user flips it in chat, so they stay in the loop and the agent never silently writes. "Cancel my subscription" renders an inline handoff card that walks you to billing, never a silent change.

## The tool layer

Two tools in a new `src/lib/ai/tools/settings-tools.ts`, registered into the general BeakerBot tool set.

- `read_setting` (read): args `{ key: string }`. Returns the current value of any user setting plus its type and, for sensitive keys, a "this one opens the page" marker. Read is broad. Useful on its own ("what is my date format set to").
- `update_setting` (action, consent-gated): args `{ key: string, value: <typed> }`. Writes ONLY a key on the safe write-list (below) via `patchUserSettings`. A key off that list is refused with a handoff message, never written. Even on the safe list, the write surfaces through the chat as an embed the user toggles, so the user action is the commit, not a silent agent write.

Both compose the existing `readUserSettings` / `patchUserSettings` in `src/lib/settings/user-settings.ts`. No new persistence.

## The embed + widget

- Extend the embed descriptor with a `setting` kind carrying the setting key (and, for an enum, its options). `parseObjectEmbed` recognizes a `setting:<key>` embed link.
- A new `SettingControlWidget` renders the right control for the key (toggle for boolean, segmented select for an enum like dateFormat, number stepper for a horizon, color swatch for color), reads the live value, and on change calls the same `patchUserSettings` path. It mirrors how `RecordSetWidget` reads tool output and renders interactively.
- BeakerBot emits the embed when answering a settings request. So "make the sidebar stop showing tasks" returns a one-line answer plus the live `sidebarShowTasks` toggle inline.

## Tiering (the important part)

"Full control over all settings" is the wrong target, and the safety model agrees. Settings split three ways.

### Safe: live inline control (the `update_setting` write-list)

User-facing preferences with no money, security, or membership consequence:

- Views and layout: `visibleTabs`, `defaultLandingTab`, `navLayout`, `defaultGanttViewMode`, `defaultCalendarViewMode`, `showSharedByDefault`, `dashboard_layout`, `lab_overview_layout`, `home_layout`, `sidebarShowTasks`, `sidebarShowCalendarEvents`, `sidebarEventsHorizonDays`.
- Personalization: `displayName`, `color`, `colorSecondary`, `coloredHeader`, `professionalMode`, `animationType`, `beakerBotAnimations`.
- Formats: `dateFormat`, `timeFormat`.
- Editor: `editorWidthPreset`, `spellCheckInEditor`, `editorTypewriterScroll`, `editorFocusDimming`.
- Companion and devices: `showCompanionButton`, `autoPublishSnapshotsToPhones`, `laptopAlarmMode`.
- Notifications: `notificationPreferences` (high value, the canonical "mute X" request).
- Mode and misc: `offlineMode`, `hideGoalsFromLab`, `enabledMethodTypes`.

### Caution: live control, but BeakerBot states the consequence first

- `confirmDestructiveActions`. Turning this OFF removes a safety guard, so the embed renders with an explicit warning and the model says what it does. Still the user's tap, never auto-flipped.

### Sensitive: inline handoff card, never a live toggle

BeakerBot renders a card that explains the setting and links to the page, but does not change it. Matches the rule that an agent does not change billing, security, access control, or standing config on its own.

- Account and membership: `account_type`, `lab_id`, `dept_admin_of`, `institution_admin_of`, `labMembershipAgreement`.
- Money: `purchaseRouting`, plus everything in the billing surface (subscription, plan, payment method) which lives outside `UserSettings`.
- Security and data: 2FA, sign-out, folder disconnect, data and privacy and E2E controls (also outside `UserSettings`).

### Internal: never surfaced

`schemaVersion`, `lastSeenAnnouncementVersion`, `lab_pending_genesis`, `lab_envelope_cache`. Bookkeeping and cache, not user settings.

## Safety and honesty rules

- The user commits the change by tapping the inline control. The agent does not silently write even safe settings; `update_setting` surfaces the control, the tap writes.
- Sensitive keys are never written by the tool. They return a handoff card. This is enforced by the write-list, not by prompt instruction alone.
- `confirmDestructiveActions` and any guard-reducing toggle render with a stated consequence.
- BeakerBot never interprets. It reflects the setting and its current value as fact.

## Integration points (real handles)

- Settings store: `readUserSettings` / `patchUserSettings` in `src/lib/settings/user-settings.ts` (the `UserSettings` interface is the field inventory).
- Embed detection: `src/components/ai/chat-embed-detect.ts`, `parseObjectEmbed` in `src/lib/references`, rendering in `BeakerBotConversation.tsx`.
- Widget precedent: `src/components/ai/RecordSetWidget.tsx`.
- Tool home: new `src/lib/ai/tools/settings-tools.ts`, registered in `src/lib/ai/tools/registry.ts` (`read_setting` read-only, `update_setting` action).

## Decisions for Grant

1. Write-list breadth. Ship the full safe list above (recommended), or start with the three highest-intent groups (notifications, theme/personalization, formats) and expand. Recommendation: full safe list, it is all low-risk.
2. `confirmDestructiveActions`. Treat as caution-with-warning (recommended) or push it to the sensitive handoff tier. Recommendation: caution tier, it is a real user preference.
3. Commit model. Render-and-user-taps (recommended) versus let `update_setting` write immediately and show the control reflecting the new value. Recommendation: render-and-tap, so the user is always the actor.
4. Multi-setting embeds. Single control per embed for v1 (recommended), or a small grouped panel ("notification settings") in one embed. Recommendation: single for v1, grouped panel in phase 2.

## Phasing

- Phase 1: `read_setting` (broad) + `update_setting` (safe write-list) + the `setting` embed + `SettingControlWidget` for boolean and enum keys. Sensitive keys return the handoff card.
- Phase 2: number, color, and multi-select controls; a grouped settings panel embed; the live settings page also reads embeds so a deep link from chat lands on the exact control.
- Phase 3: BeakerBot proactively offers the relevant toggle when a user describes friction ("the calendar always opens on month view") without being asked to change a setting.

## Out of scope

- No billing, security, account-type, or membership changes by the agent, ever. Those are handoff only.
- No new settings or schema fields. This wraps the existing `UserSettings`.
- No change to the settings page itself in phase 1 (it stays the full surface; chat is an additional path).
