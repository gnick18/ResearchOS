# Onboarding v2 Phase 5: existing-user invisibility audit

## Test coverage added

7 new vitest cases at `frontend/src/lib/onboarding/is-fresh-user.test.ts`:

1. **All three signals absent → returns true** — defaults-only baseline.
2. **`_onboarding.json` present → returns false** — sidecar mere-presence disqualifies (body shape irrelevant).
3. **`settings.json` present → returns false** — settings file alone is an existing-user signal.
4. **`_user_metadata` entry present → returns false** — metadata entry signals existing-ness even without sidecar/settings.
5. **`fileService.isConnected() === false` → returns false** — defensive; no folder mounted = no wizard.
6. **All three signals present → returns false** — defense in depth (no precedence accident).
7. **V1-holdover with `mode` set, no wizard_completed/skipped → returns false** — realistic v1 → v2 migration: existing user keeps her tip-mode pick and never sees the v2 wizard.

All 7 pass. Full `src/lib/onboarding/` suite: 68/68 pass after the addition.

## Audit findings

### 1. file-system-context.tsx
No code path deletes `_onboarding.json` or `settings.json` for an existing user. `disconnect()` (line 662) clears in-memory state and the IndexedDB directory handle, but does NOT touch on-disk user files — the next folder-connect re-probes whatever lives on disk. There is no "factory reset" or "clear all data" button. `setCurrentUser()` (line 691) hydrates settings via `hydrateSettingsForUser()` but never writes a clear/delete. The only delete path that touches a user's directory tree is `usersApi.delete()` in `local-api.ts` (covered below), and that's the user-deletion flow, not a folder switch.

### 2. orchestrator.tsx
The exact `showWizard` gate (lines 632-638):
```ts
const showWizard = wizardPreviewMode
  ? !previewDismissed
  : sidecar !== null &&
    isFreshUser === true &&
    sidecar.wizard_completed_at === null &&
    sidecar.wizard_skipped_at === null &&
    activeTip === null;
```
This consults `isFreshUser` (Phase 1 probe of `isFreshUserForWizard()`), the sidecar's two timestamps, AND the active-tip belt-and-suspenders, exactly as the brief specifies. `wizardPreviewMode` (`?wizard-preview=1`) intentionally bypasses every gate for testing — completion / skip handlers no-op in preview mode so nothing persists.

### 3. is-fresh-user.ts
The predicate is conservative: returns false on ANY existing-user signal (sidecar, settings, or metadata) AND returns false when `fileService.isConnected() === false`. Reads only — no writes. Uses `Promise.all` over the three signal checks, so the latency is one parallel I/O cycle. The default-true case requires ALL THREE explicit absences. Behavior is fully covered by the 7 new cases.

### 4. sidecar.ts (normalize chain)
`readOnboarding()` → `fileService.readJson()` returns `null` for an absent file → `normalize(null)` returns `makeDefault()`. The defaulted sidecar has `wizard_completed_at: null` and `wizard_skipped_at: null`. **Crucially**, the `showWizard` gate in orchestrator.tsx consults `isFreshUser === true` BEFORE relying on the defaulted timestamps — so an absent sidecar's default does NOT trick the wizard into mounting for an existing user whose other signals (settings.json, metadata entry) are present. The chain is correct: existing user with no sidecar still gets `isFreshUser === false` because the metadata or settings signal flips first.

### 5. local-api.ts (user-delete + related)
`usersApi.delete()` (line 4331) is the only user-deletion path. It tombstones via `setUserMetadataField(username, "deleted_at", ...)` FIRST (line 4361), then best-effort hard-deletes the user's folder bytes recursively. The tombstone is the authoritative signal — `discoverUsers` / `usersApi.list` filter out tombstoned users regardless of whether the folder still exists. **However**, the `deleted_at` field stays in the metadata entry, so `getUserMetadata(username)` still returns a non-null record for a deleted user. That means a deleted user re-created under the same name later would NOT trigger the wizard (the metadata entry blocks freshness). This is arguably correct behavior — re-using a deleted username should not look like a brand-new user — but worth flagging.

### 6. Settings → Tips replay affordance
`replayOnboarding(username)` (sidecar.ts:302) clears: `tips: {}`, `tips_off: false`, `last_tip_at: cur.active_seconds`, `shown_count: 0`. The function uses a spread `...cur` and overrides only the four fields above. It does NOT touch `wizard_completed_at`, `wizard_skipped_at`, `use_cases`, `other_use_case`, `mode`, or any of the three Phase 2c decision fields. Confirmed by reading: the existing replay button is safe to re-use for the wizard's tip-only replay semantic. The Phase 4 "Re-run welcome wizard" entry will need a separate clear that flips `wizard_completed_at` and `wizard_skipped_at` to null.

## Regression risks identified

- **Low: tombstoned-username collision.** `local-api.ts:4361` writes `deleted_at` to the metadata entry but leaves the entry in place. If a user is deleted then a new user is created later with the same username, `getUserMetadata()` still returns the tombstoned record so the wizard skips. The new user would land on her profile without onboarding. Severity: low — username re-use after delete is uncommon, and "skip onboarding" is a graceful failure (no UI break, no data loss). Recommendation: defer; the alternative (deleting the metadata entry) breaks the cloud-sync tombstone semantic which is load-bearing.

- **Low: settings.json mirroring writes a metadata entry.** `user-settings.ts:181` calls `setUserMetadataField(username, "color", ...)` from `writeUserSettings()`. So ANY settings write (e.g. visibleTabs from a settings-page edit) creates a metadata entry as a side-effect. This means a user who somehow wrote settings.json WITHOUT going through the wizard would still get `getUserMetadata() !== null` and the wizard would skip her. This is the intended invariant (her settings.json is already an existing-user signal on its own) — the metadata entry is just a secondary echo. Severity: low. No fix needed.

- **None — high or medium severity.** No code path was found that could re-trigger the wizard for an existing user.

## Recommendation for follow-up chips

None — invariant holds. The seven test cases pin every signal independently and combined, the orchestrator gate is the exact five-condition shape the brief locked, and the replay button preserves the wizard timestamps. Phase 4's "Re-run welcome wizard" entry (not yet built) will need its own dedicated clear function that sets both `wizard_completed_at` and `wizard_skipped_at` to null — flagging here as a forward-looking note rather than a follow-up chip.

## Phase 4 follow-up (2026-05-20)

The forward-looking flag from this audit was acted on in Phase 4
(`<commit-sha>`): the Re-run welcome wizard entry in Settings calls
`clearWizardCompletion(username)` which sets a new additive sidecar
field `wizard_force_show: true` alongside null-ing the two wizard
timestamps. The orchestrator's `showWizard` gate ORs
`sidecar.wizard_force_show === true` with `isFreshUser === true`,
preserving the existing-user invisibility invariant for everyone
EXCEPT users who explicitly clicked Re-run. The wizard's
onComplete/onSkip handlers clear `wizard_force_show` back to false
so the bypass is one-shot per Re-run click.

The Phase 5 invariant tests at `is-fresh-user.test.ts` remain valid
unchanged: `isFreshUserForWizard()` returns false for existing
users regardless of `wizard_force_show`. The gate-bypass logic
lives in `orchestrator.tsx` where it's testable as a UI integration
case if needed.
