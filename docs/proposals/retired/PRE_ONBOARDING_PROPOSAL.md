# Pre-onboarding proposal

**Status:** Design locked via master ↔ Grant brainstorm 2026-05-21 (4 AskUserQuestion rounds, all defaults accepted). Ready for implementation manager dispatch.
**Author:** master bot, synthesizing the brainstorm into a ready-for-implementation spec.
**Related:** Sits BEFORE the v4 onboarding tour ([ONBOARDING_V4_PROPOSAL.md](ONBOARDING_V4_PROPOSAL.md)) in the new-user journey. v4 assumes the user has already linked a folder and created a username; pre-onboarding handles everything that happens BEFORE that.

---

## 1. Thesis

A fresh visitor lands on ResearchOS.com and is immediately asked to "pick a folder" via the File System Access API. They have zero context for what ResearchOS is, why a folder is needed, whether their data is safe, or how to set up cloud-synced storage. Most users will bounce.

Pre-onboarding fills that gap. It's a one-shot, skippable, BeakerBot-led intro that fires the first time a user visits the site, BEFORE the existing DataSetupScreen. Four beats:

1. **Welcome** — meet BeakerBot, learn what ResearchOS is in 2 sentences.
2. **Data security** — your data NEVER leaves your computer. We can't see it. We can't upload it. Your folder is yours.
3. **Folder choice** — pick local (recommended for solo) or cloud-synced (for cross-device). Cloud requires the provider's desktop app to be installed and syncing already.
4. **Cloud-provider setup (conditional)** — if user picks cloud, point them at the per-provider wiki page to set up the local sync, then come back.

User then proceeds to the existing DataSetupScreen → UserLoginScreen → app → v4 tour. The pre-onboarding never fires again for that browser.

**Why this matters.** The biggest first-touch friction is fear of data leaving the browser. Without an explicit, reassuring data-security panel, users assume any "pick a folder" prompt is uploading their files. With the panel, they understand local-first as a feature, not a bug.

---

## 2. What this proposal deprecates

Nothing. New surface. Existing systems unchanged.

| Surface | Connection |
|---|---|
| `DataSetupScreen` | Renders AFTER pre-onboarding. No code change; pre-onboarding routes to it on Continue. |
| `UserLoginScreen` | Renders after DataSetupScreen. No change. |
| `TourBootstrap` / v4 tour | Fires after the user is in the app. No change. |
| BeakerBot SVG | Reused. Same character continuity. |
| `BeakerBotCursor` | NOT used in pre-onboarding (no in-product UI to anchor on yet). |
| `TourSpotlight` | NOT used in pre-onboarding (modal-only). |
| Wiki pages | New per-provider setup guides (OneDrive / Google Drive / Box / iCloud) added by the wiki manager during P6. |

---

## 3. Design locks (8 total)

| # | Decision | Locked value |
|---|---|---|
| **L1** | Character treatment | BeakerBot + speech bubble. Same character as v4 tour for continuity. No separate marketing-style visual language. |
| **L2** | Cloud setup guidance | External wiki link per provider. Pre-onboarding stays lean; the wiki owns the multi-step per-provider setup detail. |
| **L3** | Re-run policy | Strictly one-shot per browser. Once seen, never re-fires. Not exposed in Settings. |
| **L4** | Skip path | Each screen has a small "Skip, I know what I'm doing" link in the corner. User can bypass straight to DataSetupScreen. |
| **L5** | Persistence | localStorage flag `researchos_pre_onboarding_seen`. Set on completion OR skip. Read on first paint. (Not stored in user data folder because pre-onboarding happens BEFORE the folder is linked.) |
| **L6** | Surface | Full-screen takeover. Centered card with BeakerBot mascot, speech bubble, and screen content. Same backdrop treatment as v4 setup modal so the user never sees ResearchOS chrome until they've completed (or skipped) pre-onboarding. |
| **L7** | Folder picker integration | The final pre-onboarding screen is a "Ready to pick your folder?" beat with a primary CTA that dismisses pre-onboarding AND opens the DataSetupScreen's folder picker. Single click flow. |
| **L8** | Folder-not-linked detection on return visits | If a user returns without a linked folder (e.g. revoked permissions, new device sharing the localStorage but no folder), pre-onboarding still does NOT re-fire (L3 invariant). They land on DataSetupScreen directly. The folder-choice content is wiki-discoverable. |

---

## 4. Architecture

### 4.1 Mount point

`<PreOnboardingScreen />` mounts in [providers.tsx](frontend/src/lib/providers.tsx) as the FIRST gate, BEFORE DataSetupScreen / UserLoginScreen / AppShell. The gate logic:

```tsx
// Pseudocode in providers.tsx
const [preOnboardingSeen, setPreOnboardingSeen] = useState<boolean>(() =>
  typeof localStorage !== "undefined" &&
  localStorage.getItem("researchos_pre_onboarding_seen") === "true"
);

if (!preOnboardingSeen) {
  return <PreOnboardingScreen onComplete={() => setPreOnboardingSeen(true)} />;
}

// Existing flow continues:
//   - DataSetupScreen (if no folder linked)
//   - UserLoginScreen (if folder linked but no user)
//   - AppShell (if both)
```

On `onComplete`: write `localStorage.setItem("researchos_pre_onboarding_seen", "true")` and unmount. The existing DataSetupScreen takes over.

### 4.2 Screen-state machine

Internal step state managed by `useState` in `PreOnboardingScreen`. Steps:

```ts
type PreOnboardingStep =
  | "welcome"
  | "data-security"
  | "folder-choice"
  | "cloud-provider"  // conditional, only when user picks cloud at folder-choice
  | "ready";
```

Linear progression with Back / Next buttons in the speech bubble corner. Same pattern as v4 setup modal.

### 4.3 Screen layout

Full-screen takeover, centered card:

```
┌─────────────────────────────────────────┐
│                                         │
│           Skip, I know what I'm doing   │ ← small skip link, top-right
│                                         │
│      [BeakerBot mascot, larger]         │
│                                         │
│   ┌─ Speech bubble ──────────────┐      │
│   │ Screen-specific content here │      │
│   │                              │      │
│   │ [Back]              [Next]   │      │
│   └──────────────────────────────┘      │
│                                         │
└─────────────────────────────────────────┘
```

- Dim backdrop (same as v4 setup modal)
- BeakerBot rendered at ~200px (larger than the v4 tour's 120px because pre-onboarding is the user's first impression and BeakerBot is the headline)
- Speech bubble below mascot, white card with sky-blue border
- Per-screen content lives in the speech bubble
- Back / Next buttons inside the speech bubble's footer

### 4.4 Skip behavior

Per L4: small "Skip, I know what I'm doing" link in the top-right. Click writes the localStorage flag and unmounts, routing to DataSetupScreen. The skip is BLOCKED on the data-security screen for ~3 seconds (you have to read at least a beat of it before the skip becomes clickable) — soft enforcement that doesn't bother developers but ensures fresh users see the security message.

Actually no, that's over-engineering. Per Grant's L4 answer, fully skippable. The user takes their own risk.

---

## 5. Phase plan

| Phase | Effort | Scope | Notes |
|---|---|---|---|
| **P0** | 1d | localStorage persistence helper (`pre-onboarding-storage.ts`) + gate logic in `providers.tsx`. Renders an empty stub for the screen so the gate's existence is testable independently. | UI-merge-on-report |
| **P1** | 2d | `<PreOnboardingScreen />` shell: full-screen card, BeakerBot mascot, speech bubble, Back/Next/Skip footer, screen-state machine. Renders a placeholder for each of the 5 steps. | UI-merge-on-report |
| **P2** | 1d | Welcome + Data Security screen content. The two highest-priority panels. Copy reviewed by Grant before merge. | UI-merge-on-report |
| **P3** | 2d | Folder-choice screen content: local vs cloud explainer + the conditional cloud-provider screen with provider tiles (OneDrive / Google Drive / Box / iCloud) and wiki links. | UI-merge-on-report |
| **P4** | 1d | "Ready to pick your folder?" final screen with a primary CTA that dismisses pre-onboarding AND opens the DataSetupScreen's folder picker. | UI-merge-on-report |
| **P5** | 1d | Skip-path polish + tests for the full state machine + localStorage integration test. | UI-merge-on-report |
| **P6** | XS | Wiki page authoring per cloud provider. Handoff to wiki manager. The pre-onboarding chip wires the link URLs to placeholders; the wiki manager fills them in. | Handoff |
| **P7** | 1d | Polish: reduced-motion verification, accessibility (screen reader narration of BeakerBot speech), copy review for tone consistency with v4 wizard. | Merge on report |

**Total:** ~9 person-days. ~2 weeks at one manager dispatching chips sequentially. Some parallelism possible: P2 + P3 + P4 are independent and can fan out after P1 lands the shell.

---

## 6. Per-screen content

### 6.1 Welcome

**BeakerBot pose:** `waving`
**Speech:**

> "Hi, I'm BeakerBot! Welcome to ResearchOS. I'm here to help you set up your lab notebook in a way that keeps all your data private and under your control."

**CTA:** Next

### 6.2 Data security

**BeakerBot pose:** `pointing`
**Speech:**

> "Quick thing before we start. ResearchOS is **local-first**: every experiment, note, method, and result lives in a folder on YOUR computer.
>
> Nothing ever gets uploaded to a server. Our website cannot see your data. If you close your browser and never come back, your folder is still yours, with everything intact.
>
> If you ever want to back up or share, that's your call (we'll show you how when you need it). For now: nothing leaves your computer."

**CTA:** Next

### 6.3 Folder choice

**BeakerBot pose:** `thinking`
**Speech:**

> "First step: pick a folder where your data lives. Two ways to do this:
>
> - **A folder on your computer** (recommended if you're just trying ResearchOS out, or you only work from one device).
> - **A cloud-synced folder** (OneDrive, Google Drive, Box, iCloud) — useful if you want to access your data from multiple devices. Heads up: you'll need the cloud provider's desktop app installed and syncing first.
>
> Which one fits you?"

**Three buttons:** "A folder on my computer" / "Cloud-synced" / "I'm not sure yet"

- **A folder on my computer:** advance to §6.5 (ready screen)
- **Cloud-synced:** advance to §6.4 (cloud-provider screen)
- **I'm not sure yet:** advance to §6.5 with a tooltip "We'll start with a local folder. You can always migrate later."

### 6.4 Cloud-provider (conditional)

**BeakerBot pose:** `pointing-down`
**Speech:**

> "Pick your cloud provider. Each one needs a bit of setup on your computer first."

**Provider tiles:** OneDrive, Google Drive, Box, iCloud. Each tile is a card with the provider's logo, a short caption ("OneDrive's local sync folder"), and a "Setup guide →" link to the wiki page.

> "Set things up on your machine, then come back here and click Continue."

**CTAs:** Back / Continue (proceeds to §6.5)

### 6.5 Ready

**BeakerBot pose:** `cheering`
**Speech:**

> "All set. Let's go pick your folder. I'll be waiting for you in ResearchOS when you're ready."

**CTA:** "Let's go" — dismisses pre-onboarding AND immediately opens the DataSetupScreen's folder picker (auto-click the picker button).

---

## 7. Behavior contracts

### 7.1 First-touch detection

`localStorage.getItem("researchos_pre_onboarding_seen")` returns `"true"` iff the user has either completed or skipped pre-onboarding in this browser. Otherwise null/undefined → fire pre-onboarding.

### 7.2 Skip path

Skip link writes the flag and routes to DataSetupScreen. Skipped users never see pre-onboarding again.

### 7.3 Persistence boundary

Because pre-onboarding happens BEFORE a folder is linked, the seen-flag CAN'T live in the user's data folder (no folder yet). localStorage is the only option. Caveats:

- Different browsers / private windows show pre-onboarding again. Acceptable; treating each browser independently is fine.
- Clearing localStorage re-fires pre-onboarding. Acceptable; user explicitly cleared state.

After pre-onboarding completes AND the user finishes DataSetupScreen + UserLoginScreen, an optional later chip can MIRROR the seen-flag into the user's `_user_metadata.json` for cross-device awareness IF the user is using a cloud-synced folder. Out of scope for v1.

### 7.4 Back navigation

User can step back through screens via the Back button. State preserves their choices. Going back FROM data-security to welcome resets nothing.

### 7.5 Reduced motion

BeakerBot pose animations are gated by `prefers-reduced-motion: reduce` (already implemented at the BeakerBot component level). Screen transitions are instant rather than fading when reduced motion is on.

---

## 8. Data model

No sidecar changes. No new files in the user's data folder.

```ts
// localStorage key
const PRE_ONBOARDING_SEEN_KEY = "researchos_pre_onboarding_seen";

// Module-level helper
export function markPreOnboardingSeen(): void {
  try {
    localStorage.setItem(PRE_ONBOARDING_SEEN_KEY, "true");
  } catch {
    // SSR or sandboxed iframe; safe to ignore. Worst case the user
    // sees pre-onboarding again on the next visit — annoying but not
    // dangerous.
  }
}

export function hasPreOnboardingBeenSeen(): boolean {
  try {
    return typeof localStorage !== "undefined" &&
      localStorage.getItem(PRE_ONBOARDING_SEEN_KEY) === "true";
  } catch {
    return false;
  }
}
```

Lives at `frontend/src/lib/onboarding/pre-onboarding-storage.ts`.

---

## 9. Migration and rollout

- **Brand-new visitors post-ship:** pre-onboarding fires on first visit.
- **Existing users (have linked folder and used the app before):** the providers.tsx gate would normally fire pre-onboarding for them since they have no localStorage flag. To avoid surprising existing users:
  - On first run after pre-onboarding ships, the gate checks BOTH `pre_onboarding_seen` localStorage AND a "looks like the user already has linked data" heuristic (sidecar exists, user metadata exists). If either is true, treat as seen.
  - This avoids ambushing returning users with the new flow while still firing for actual fresh visitors.
- **v4 onboarding tour:** unaffected. Pre-onboarding completes → DataSetupScreen → UserLoginScreen → AppShell → v4 fires. No change to v4.

---

## 10. Open questions for the implementation manager

1. **Detection heuristic for existing users (§9):** the gate's "user has data already, skip pre-onboarding" check needs a clean read path. Probably: `fileService.hasLinkedFolder() || localStorage.getItem("researchos_pre_onboarding_seen")`. Verify there's a clean API for that.
2. **Provider tile design (§6.4):** should the tiles be clickable cards (each opens the wiki page in a new tab) or accordion sections (expand inline)? Recommend new-tab opens — keeps pre-onboarding lean.
3. **Skip-button styling:** "Skip, I know what I'm doing" vs shorter "Skip" or "I know how this works" — pick the wording during P1 based on visual balance.
4. **Cloud-provider tile order:** OneDrive / Google Drive / Box / iCloud — alphabetical? Market-share-weighted? US-user-default-weighted? Recommend alphabetical for fairness.
5. **Beak-Bot mascot size (§4.3):** I proposed 200px but the v4 tour is 120px. Validate the larger size reads well in the centered card layout.

---

## 11. Phase plan summary table

| Phase | Effort | Description | Merge timing |
|---|---|---|---|
| P0 | 1d | localStorage gate + stub | Merge on report |
| P1 | 2d | Shell + state machine | Merge on report |
| P2 | 1d | Welcome + Data Security screens | Merge on report |
| P3 | 2d | Folder choice + cloud provider screens | Merge on report |
| P4 | 1d | Ready screen + folder picker handoff | Merge on report |
| P5 | 1d | Skip path + tests | Merge on report |
| P6 | XS | Wiki page authoring | Handoff |
| P7 | 1d | Polish + a11y | Merge on report |

**Total:** ~9 person-days, ~2 weeks at sustained dispatch cadence.

---

## 12. Acknowledgment and handoff

This proposal is ready for a Pre-onboarding manager to absorb as their role brief. Manager should:

1. Create `PRE_ONBOARDING_MANAGER_ROLE_BRIEF.md` modeled on v4's brief, with this proposal cited as canonical spec
2. Append an AGENTS.md §8 "Active bot branches (in flight)" entry once they start
3. Dispatch P0 first (storage gate, low-risk foundation) — merge on report
4. Surface any unlocked design call to master via AskUserQuestion before the dependent chip fires

Signed: **master bot**, 2026-05-21
