# Handoff: Companion toggles in main Settings Companion section

Date: 2026-06-13
Branch: `companion-settings-toggles` (commit `e472ca9f1`, built off main `24b82568e`)
Worktree: `../ResearchOS-companion-toggles`
Author: Companion settings manager

## What this does

Surfaces the two Companion preferences in the main Settings -> Companion
section. They previously lived only in the Companion popover Settings tab
(`frontend/src/components/CompanionHub.tsx`, `SettingsPanel`).

The two toggles:

- Show Companion button on Home (`UserSettings.showCompanionButton`)
- Auto-publish snapshots to paired phones (`UserSettings.autoPublishSnapshotsToPhones`)

Both read and write the same `UserSettings` fields, so toggling in either
surface stays in sync.

## How sync works (no extra wiring needed)

The new toggles call the page-level `update()` helper in
`frontend/src/app/settings/page.tsx`. `update()`:

1. persists through `patchUserSettings(currentUser, patch)`, and
2. calls `hydrateFromSettings(...)` which already pushes
   `showCompanionButton` into the Zustand store.

So the header Companion button reacts instantly, and the popover Settings tab
(which reads `useAppStore(s => s.showCompanionButton)` and re-reads
`autoPublishSnapshotsToPhones` from `readUserSettings` on open) reflects the
change. Same labels/descriptions and the same `ToggleRow` component the rest
of the settings page uses.

## Files changed

- `frontend/src/app/settings/page.tsx` (only this file)
  - Added two `ToggleRow`s inside the existing `companion` section's
    `render()`, between `OpenCompanionHubButton` and `DevicesSection`.

No data-shape changes. No new fields (both `UserSettings` fields already exist
with default `true`). Does not touch `user-settings.ts`, so no conflict with
the in-flight `dept-phase1` merge (which stages `user-settings.ts` and the
dept billing/invite files).

## Verification

- `npx tsc --noEmit` from `frontend/` in the worktree: exit 0, zero errors.
- Components statically in scope: `ToggleRow` (defined in the same file),
  `settings` and `update` (both used by the sibling `notifications` section's
  render in the same `useMemo`).
- Not browser-verified. The change is observable once merged: Grant's running
  `:3000` will HMR-pick it up. To eyeball, open Settings -> Companion and
  confirm the two toggles appear above the pairing UI and that flipping one
  matches the Companion popover Settings tab.

## Merge

Tree was mid `dept-phase1` merge at handoff, so I did not merge. Once the tree
is healthy:

```
git merge --no-ff companion-settings-toggles \
  -m "Merge companion-settings-toggles: surface companion toggles in main Settings"
```

House voice preserved (no em-dashes, no emojis, no mid-sentence colons).
