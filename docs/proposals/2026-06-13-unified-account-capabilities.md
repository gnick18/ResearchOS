# Unified account capabilities (one source of truth for feature gating)

Status: proposed 2026-06-13. Grew out of the Companion no-account gate fix, where the panel showed account-presumptive copy to a solo user because the gate conflated "no account" with "locked." That is a symptom of a bigger problem.

## The problem

There is no central model for "what can this account do." Feature visibility is decided ad hoc in ~186 places that read `useSharingIdentity()` plus a scatter of build flags. The same capability is gated off different primitives in different files, and the drift has produced real bugs:

- **Share buttons have NO account gate.** `TaskDetailPopup` and `NoteDetailPopup` render Share regardless of account state; a solo user only meets the "make an account" wall inside the dialog. (`TaskDetailPopup.tsx:1497`, `NoteDetailPopup.tsx:2451`)
- **BeakerBot AI gates only on the build flag `AI_ASSISTANT_ENABLED`, not on account state**, even though the settings copy says solo users lose AI. (`datahub/NewAnalysisDialog.tsx:762`, `app/layout.tsx:114`, vs the claim at `settings/page.tsx:362`)
- **External collaboration is gated two different ways**: `EXTERNAL_COLLAB_ENABLED && isRealSharingEnabled()` in one place, `status === "ready" && email` in another. (`UnifiedShareDialog.tsx:355` vs `SharedWithMeTab.tsx:462`)
- Notifications mark channels `accountOnly: true` as data, with the runtime gate implicit. (`NotificationsSection.tsx:35`)

The only existing centralization is the Settings group registry, which hides whole groups on `hasAccount = sharing.status === "ready"` (`settings/page.tsx:431`). Good pattern, but Settings-only.

## The existing primitives (inputs, not the model)

- **Identity** (`useSharingIdentity`): `status` (`none` / `needs-restore` / `ready`), `published` (in the directory, has email), `email`, `isReady`.
- **Feature flags** (build/server env): `AI_ASSISTANT_ENABLED`, `NEXT_PUBLIC_SHARING_ENABLED` (+ `isOAuthPublishAvailable`/`isRealSharingEnabled`), `EXTERNAL_COLLAB_ENABLED`, `isBillingEnabled`, `LAB_TIER_ENABLED`.
- **Modes**: `getDemoMode`, `isWikiCaptureMode`.
- **Online/offline**.

A capability depends on a COMBINATION of these. Today every surface recombines them by hand.

## The model

One hook, one source of truth. Surfaces read named capabilities, never raw primitives.

```ts
// src/hooks/useAccountCapabilities.ts
export type AccountMode = "solo" | "locked" | "account"; // coarse headline ("the one var")

export interface AccountCapabilities {
  mode: AccountMode;            // solo = status "none"; locked = "needs-restore"; account = "ready"
  isPublished: boolean;         // account + in directory (has email)
  email: string | null;

  // Derived, named capabilities (the rules live HERE, once):
  canShare: boolean;            // mode === "account"
  canPairPhone: boolean;        // mode === "account" (solo/locked show the setup/unlock path)
  canUseCloud: boolean;         // mode === "account"
  canPublishProfile: boolean;   // mode === "account" && isPublished
  canEmailNotify: boolean;      // mode === "account"
  canPhoneNotify: boolean;      // mode === "account"
  canUseAI: boolean;            // AI_ASSISTANT_ENABLED && mode === "account"
  canCollabExternally: boolean; // EXTERNAL_COLLAB_ENABLED && isRealSharingEnabled() && mode === "account" && isPublished
  canAccessInbox: boolean;      // mode === "account" && !!email

  // Pass-throughs for surfaces that genuinely need the raw flag:
  aiEnabled: boolean; billingEnabled: boolean; oauthAvailable: boolean;
}
```

`mode` is the single headline var Grant asked for (set it and the screen changes). The fine-grained `canX` flags are derived from `mode` + the feature flags in ONE place, so a rule change ("AI is now free for solo") is a one-line edit, not a 15-file hunt.

### How surfaces consume it

```tsx
const { canShare } = useAccountCapabilities();
// hide the button entirely, OR show it disabled with an upsell tooltip
{canShare ? <ShareButton /> : <UpsellChip feature="sharing" />}
```

Plus two ergonomics helpers:
- `<Capability need="canShare" fallback={<Upsell .../>}>...</Capability>` for declarative show/hide.
- The Settings registry already gates groups; migrate it to read `caps.canUseCloud` etc.

### Solo upsell, not dead controls

Per the standing rule ([[feedback_solo_user_feature_gating]]): when a capability is off, the surface either hides cleanly OR shows a gentle "comes with a free account" affordance, never a dead/broken control. The capability model centralizes WHICH upsell copy maps to which capability, so it is consistent everywhere.

## Migration (phased, each phase verifiable)

This touches many files, so phase it and verify each:

- **Phase 1 (foundation + the bug fixes):** build `useAccountCapabilities()` + `<Capability>` + the upsell chip. Migrate the THREE inconsistencies as the first consumers: gate the Share buttons, add the `canUseAI` gate to BeakerBot entry points, unify external-collab. High value, small surface. The Companion gate (just shipped) re-points at `caps` too.
- **Phase 2:** migrate Settings (the group registry reads caps), profile/cloud/billing, notifications channels.
- **Phase 3:** sweep the remaining ad-hoc `useSharingIdentity()` reads that are really capability checks (leave the genuine identity reads alone). A lint/grep checklist tracks the long tail; no silent "done" while call-sites remain.

Demo/wiki-capture mode keeps working because the fixture sets the identity state the same way; `mode` derives from it unchanged.

## Open questions for Grant

1. **AI for solo?** Is BeakerBot strictly account-only (`canUseAI` requires account), or available to solo with a free-token gift and only the cloud/billing parts gated? (Changes one line.)
2. **Hide vs disable-with-upsell** as the default for off capabilities. Recommendation: hide deep-in-flow buttons (Share on a card), but show a gentle upsell where discovery matters (Settings, the AI entry).
3. **Account tiers (Free/Plus/Pro, Lab)** are a SEPARATE axis (paid storage), orthogonal to this account/solo axis. Keep them separate for now, or fold tier into the same capabilities object later?
