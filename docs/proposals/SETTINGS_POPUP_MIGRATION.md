# Retiring the /settings page in favor of the Settings popup

Status: APPROVED 2026-06-07, FULL MIGRATION. Grant picked the recommended path,
thin /settings route + tour rework + deep-links (route-option B, tour-rework A,
deep-links yes). Build in phases S1..S5; the tour rework (S3) lands behind the
NEXT_PUBLIC_DISABLE_V4_TOUR safety and is persona-verified before the route
slim-down (S4).
Author: master (orchestrator)
Date: 2026-06-07

House style: no em-dashes, no emojis, no mid-sentence colons.

## TL;DR

The Settings popup already exists and already renders the WHOLE settings surface.
`components/settings/SettingsModal.tsx` (mounted once in AppShell) lazy-imports
the exact same `SettingsBody` that `app/settings/page.tsx` renders. So there is
nothing new to build at the rendering level. "Migrating" means three things:

1. Make the popup the front door everywhere (repoint the entry points and links).
2. Rework the onboarding tour, which is wired to the `/settings` ROUTE and
   spotlights on-page elements. This is the real work and the main risk.
3. Decide the fate of the `/settings` route (keep as a thin fallback, redirect,
   or fully retire) and support deep-links to a section.

This is a real initiative, not a cleanup, almost entirely because of the tour.

## Current state (accurate map)

### Rendering
- `app/settings/page.tsx` exports `SettingsBody`, which renders ~18 sections:
  Data folder, Account, Professional mode, Tabs, LabArchives, AI helper, Sidebar,
  Defaults, Appearance, Animation, Behavior, Streaks, Trash & History, Data
  inventory, Maintenance, Tips, Security, Offline mode, plus a Lab Mode tab
  (Account type, Lab head, Lab roster). It uses a `SectionShell` pattern with a
  live search box that filters every section + row.
- `components/settings/SettingsModal.tsx` renders that SAME `SettingsBody` inside
  the shared `LivingPopup` (blur + zoom + scrim), `widthClassName="max-w-3xl"`,
  `fillHeight`. Opened via `useSettingsModal` (settings-modal-store). The page
  and popup are already a single source of truth for the body.
- `components/profile/ProfileSettingsContent.tsx` (the ProfileSettingsModal
  popup, and the `/profile` page) is a SEPARATE, focused surface, appearance +
  researcher profile + sharing/keys only. It is not the settings hub; do not
  conflate them.

### The onboarding tour (the crux)
A large part of the v4 walkthrough targets the settings ROUTE and on-page nodes:
`SettingsIntroStep`, `SettingsColorStep`, the AI-helper beats
(`SettingsAiHelper*`), `AnimationPickerStep`, and the `SettingsTourBeats`
(folder, telegram, account-type, visible-tabs, streak, rerun) all carry
`expectedRoute: "/settings"` and spotlight `data-tour-target` nodes that live on
the page. If the page goes away, these beats break. `LivingPopup` already stamps
`data-tour-popup-occluding` and `TourSpotlight` already handles targets INSIDE a
living popup, so the machinery exists, but every settings beat has to be
re-pointed to drive the popup and target nodes inside it.

### Entry points + links (inventory)
- Open the popup today: the avatar menu "Settings" entry (`useSettingsModal`).
- Hard-navigate to `/settings`: `DailyTasksSidebar`, `SidebarContentsPopup`,
  `onboarding/.../SetupWrapupStep` (`settingsHref="/settings"`),
  `UserAvatarMenu` (a `pathname === "/settings"` check).
- Deep-links to a section: `trash/page.tsx` and the wiki trash pages use
  `/settings#history-and-trash`. This anchor jump must keep working.
- Already fixed: the `ResearcherProfileModal` "Set up your own profile" link now
  opens the ProfileSettingsModal popup instead of `/settings#researcher-profile`.

## Target model

The popup is the front door. Clicking Settings anywhere opens the `SettingsModal`
over the current page. The `/settings` route's job shrinks to a deep-link /
fallback surface. The tour drives the popup.

## Open questions for Grant (need answers before building)

1. The `/settings` ROUTE fate, pick one:
   - A. Keep it as a real page (current), popup is just an additional front door.
     Zero risk, but the "deprecate the page" goal is not met.
   - B. Thin route, `/settings` (and `/settings#section`) becomes a tiny client
     route that opens the popup over the app shell and otherwise renders nothing
     (or redirects home). Keeps deep-links + bookmarks working, retires the page
     as a standalone surface. RECOMMENDED.
   - C. Fully retire, delete the route, repoint/410 all links. Most invasive,
     breaks bookmarks, and forces the tour rework first.
2. The onboarding tour:
   - A. Rework the settings beats to drive the popup (open it, target nodes
     inside it). Necessary for B or C. Real work + persona re-verification.
   - B. Keep the settings beats on a still-real `/settings` page (only compatible
     with route-option A). Cheapest, but means the page never really goes away.
3. Deep-link granularity, should `/settings#history-and-trash` open the popup
   scrolled to that section (needs an optional `section` arg on
   `useSettingsModal.open` + a scroll-into-view in `SettingsBody`)? Recommended
   yes, so existing anchor links keep their meaning.

## Phased plan (assuming route-option B + tour rework)

S1. Deep-link support, add an optional `section` to `useSettingsModal.open`, and
    have `SettingsBody` scroll the matching `SectionShell` into view on open.
    Make the popup openable to a named section. (No behavior change yet.)
S2. Front-door repoint, every Settings entry point and `/settings` link opens the
    popup (passing the section for the anchored ones) instead of navigating.
    Keep the page rendering for now.
S3. Tour rework, re-point every `expectedRoute: "/settings"` beat to open the
    popup and target its in-popup `data-tour-target` nodes; verify the spotlight
    + occlusion behave inside `LivingPopup`. Re-run the walkthrough persona bots
    (literal / explorer / distracted / skeptic / restart) over the settings arc.
S4. Route slim-down, convert `/settings` to the thin popup-opening route
    (option B), `/settings#section` opens the popup to that section. Remove the
    standalone page chrome.
S5. Verify, full tour pass + mechanics + a fresh-account walk; confirm no
    orphaned links, anchors still resolve, and search still filters in the popup.

## Risks / notes
- The tour is 80 percent of the effort and the only thing that can regress a
  user-facing flow. Do S3 behind the existing `NEXT_PUBLIC_DISABLE_V4_TOUR`
  safety and verify with personas before S4.
- The import cycle (page imports AppShell imports SettingsModal imports the page
  body) is already broken via `next/dynamic`, keep that pattern.
- `SectionShell` search + `data-tour-target` must keep working unchanged inside
  the popup (they already do, the popup renders the same body).
- Do NOT touch `ProfileSettingsModal` / `/profile`, that split is intentional and
  separate.
