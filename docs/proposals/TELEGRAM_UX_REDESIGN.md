# Telegram UX Redesign

Status: proposed, awaiting build sign-off
Author: HR (orchestrator)
Date: 2026-06-06

## Why

The Telegram surface has accreted into something the user has to decode. Two
beta testers already flagged the top nav as busy, and Grant flagged it again
after watching a real pairing.

What exists today:

- The permanent header badge (`TelegramStatusBadge`) renders SIX visual modes,
  a calm green dot, an amber "conflict" dot with a click popover, the gray
  "ANOTHER TAB / Switch to this tab" pill, a stale amber dot with tooltip,
  warn/error colored chips, and the unpaired "Connect Telegram" pill.
- AppShell silently mounts TWO recovery prompts (`TelegramRecoveryPrompt` and
  `TelegramEncryptedRecoveryPrompt`).
- `TelegramPairingModal` is a multi-step wizard mounted from three places
  (header, Settings, onboarding), heavy on amber warning text.

So connection state, multi-tab plumbing, recovery, and pairing are scattered
across the header and several modals. Implementation detail (which tab is
polling) leaks into the permanent top bar, which should be the most selective
real estate in the app.

## Locked decisions (Grant, 2026-06-06)

1. The header gets a single Telegram icon button with a tiny status dot. The
   dot is the only state signal. No labels, no chips, no inline action buttons.
2. Multi-tab coordination is automatic and invisible. The user never sees
   "another tab" or a "switch to this tab" control anywhere.
3. One consolidated Telegram popup owns everything (pairing, status, encrypted
   backup, auto-reconnect, notifications). The Settings Telegram section is
   removed, reduced to a one-line pointer at most.

## The new model

### Header button

One icon button (Telegram paper-plane glyph, inline SVG, no emoji) with a small
status dot overlaid on the corner. The dot is the whole vocabulary:

- green, connected and healthy
- amber, needs attention (stale, retrying, re-pair, or a separate-device conflict)
- hollow or gray, not connected

A short tooltip carries one line of context. Clicking opens the popup. That is
the entire header footprint. The standby pill, the conflict popover, the
takeover buttons, and the uppercase status labels all go away.

### The consolidated popup

Mirrors the researcher profile popup, an anchored popover opened from the icon,
click-outside and Esc to close, openable via a small store so Settings and
onboarding can trigger it too. One popover, three states:

1. Not connected. One line of value ("Send lab-bench photos straight into the
   open experiment") and a single Connect affordance that reveals the condensed
   pairing flow inline: paste the bot token (the @BotFather steps live behind a
   (?) instead of three always-on numbered lines), the calm wait-for-message
   status, and the encrypted backup as a plain toggle. No separate wizard modal.

2. Connected and healthy. "Connected as @bot" with the green dot, then a compact
   management list, notifications on/off, save encrypted backup, auto-reconnect,
   and Disconnect / Re-pair. Helper detail sits behind (?) tooltips, not inline
   paragraphs.

3. Needs attention. A single inline line plus one action, "Connection looks
   stale, send your bot a message" or "Re-pair needed" with a Reconnect button.
   Everything resolves inside the popover.

### Multi-tab is silent

Keep the leader-election lock in `telegram-runtime` and remove all of its UI.
Non-leader tabs still receive messages through the shared local data, so there
is nothing to show and nothing for the user to fix. A genuine separate-device
conflict shows at most a calm line inside the popup ("Also connected on another
device"), never a header alarm and never a takeover button.

### Recovery is silent

Encrypted-backup auto-restore is already silent after the Option B re-key.
Remove the two auto-mounted recovery prompt components from AppShell and keep
the restore as a no-UI effect. At most one unobtrusive toast on a successful
auto-reconnect (lean: skip it).

### Settings and onboarding

Remove the Settings Telegram section. If anything stays, it is a one-line
pointer ("Telegram is managed from the paper-plane button in the top bar"). The
onboarding Telegram step opens the same popup and condensed flow instead of the
old multi-step modal.

## Components

- NEW `TelegramPopup.tsx`, the consolidated popover.
- NEW `telegram-popup-store.ts`, open/close, mirroring `profile-modal-store`.
- Rewrite `TelegramStatusBadge.tsx` into a minimal icon + dot header button (or
  a fresh `TelegramHeaderButton.tsx` and retire the badge).
- Fold `TelegramPairingModal.tsx` pairing logic into the popup, then retire the
  standalone modal and its mounts in Settings and onboarding.
- Remove `TelegramRecoveryPrompt.tsx` and `TelegramEncryptedRecoveryPrompt.tsx`
  header mounts, keep the silent restore logic as a hook.
- Trim `badge-presentation.ts` to ok / attention / none (drop the standby and
  conflict label entries).
- Strip the Settings Telegram section.

## Status dot mapping

- green, `paired && health === ok && !stale`
- amber, `paired && (stale || retrying || auth_error || conflict)`
- hollow/gray, not paired

## What does not change

The `telegram-runtime` leader election, the polling pipeline, the
`telegram-store` pairing file, the encrypted-backup crypto (Option B), and the
inbound-photo to inbox path all stay. This is a UI and interaction redesign, not
a protocol change.

## Phasing

1. Build `TelegramPopup` + store + the header icon/dot, wire pairing and
   management inside, keep the old modal alive behind it during the swap.
2. Remove the standby / conflict / recovery UI and trim `badge-presentation`.
3. Strip the Settings section and repoint onboarding.
4. Retire the dead components and tests, then verify.

## House style

No em-dashes, no emojis, no mid-sentence colons. Every icon is an inline SVG.
Icon-only buttons use the `<Tooltip>` component, not native `title=`. Dot colors
use semantic surface tokens so dark mode comes along for free.

## Open questions

- Exact dot colors in dark mode (reuse the existing semantic tokens).
- Keep a success toast on auto-reconnect? (lean: no.)
- The "not connected" first-run pairing inside a popover may feel cramped, worth
  a look during the build; fall back to a slightly larger anchored panel if so.
