# Surface audit, DARK mode (2026-06-07)

Read-only audit of high-traffic user-facing surfaces against
`docs/SURFACE_DESIGN_LANGUAGE.md`, with dark token values substituted
(`--surface #0a0e1a`, `--surface-raised #131c2e`, `--surface-sunken #0d1424`,
`--foreground #f1f5f9`, `--foreground-muted #b4bfd0`). The recurring failure is
the dark mirror of the light-mode bug the standard was written to stop. Whole
elements hardcode light-only colors (`bg-white`, `text-gray-700/800/900`,
`text-slate-800/900`, `border-gray-200`, white-fill SVG dot textures) with no
`dark:` variant, so in dark mode they collapse to near-black text on a near-black
surface (invisible) or a glaring white card. Two onboarding modals and the
primary notes list are the most damaging. Most other in-app token surfaces pass.

Findings by severity: HIGH 7, MEDIUM 4, LOW 3 (14 total).

Note on intentional surfaces I did NOT flag: `UserLoginScreen.tsx` (off-limits,
the reference); `AccountPasswordPopup.tsx` (a deliberately fixed dark slate-800
card, identical in both modes); the AppShell `tinted` segmented controls
(`bg-white`/`text-gray-900` is correct on the user-color header tint, not a
surface token); `LandingPage.tsx` and `WelcomePage.tsx` (intentional light-only
marketing pages); the picker-walkthrough beats and `SpeechBubble`
(`bg-white`/`text-slate-900` chat bubbles sit on a brand-gradient backdrop in
both modes).

## HIGH (invisible or unreadable in dark)

| File | Line(s) | Element | Failing class string | Why it fails in DARK | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| components/NoteListRow.tsx | 76 | Note title (primary content of the notes list) | `font-medium text-body text-gray-900 truncate group-hover:text-emerald-700` | `text-gray-900` (#111827) on `--surface #0a0e1a` is near-black on near-black, the note title is unreadable. Hover `text-emerald-700` is also too dark on dark. | Use `text-foreground` (flips to #f1f5f9 in dark), add `dark:group-hover:text-emerald-300`. Anti-pattern: "decorative/text layer built for one mode." |
| components/NoteListRow.tsx | 94 | Note one-line snippet | `block text-meta text-gray-400 truncate` | `text-gray-400` is a light-mode muted value; on `--surface-raised #131c2e` it is low-contrast and reads as dead text. | Use `text-foreground-muted` (#b4bfd0 in dark) so the snippet keeps AA in both modes. |
| components/onboarding/v4/TourBootstrap.tsx | 673-724 | V3InflightPrompt "Welcome tour updated" modal (full card) | card `bg-white ... border-gray-200`; header `text-gray-500`, `text-gray-900`; body `text-gray-700`; Skip btn `border-gray-300 text-gray-700 hover:bg-gray-50` | Entire onboarding modal is light-only. In dark mode it is a glaring white card, then the Skip button (`border-gray-300 text-gray-700`, no fill) is the "hairline + muted text" anti-pattern that disappears. | Move card to `bg-surface-raised border-border`, text to `text-foreground` / `text-foreground-muted`, give Skip a real fill (`bg-surface-sunken border border-border text-foreground`). Principle 4 (visible control character) + Principle 7 (both modes first-class). |
| components/onboarding/v4/TourBootstrap.tsx | 784-820+ | V4ResumePrompt "Continue your welcome tour?" modal (full card) | card `bg-white ... border-gray-200`; `text-gray-500`, `text-gray-900`, `text-gray-700` | Same light-only modal pattern, hit on nearly every refresh mid-tour. Glaring white card + dark-on-dark text in dark mode. | Same fix as V3InflightPrompt, port to surface tokens + foreground tokens, give the tertiary buttons a tinted fill. |
| components/profile/ColorPickerRows.tsx | 116, 179 | "Primary color" / "Optional second color" field labels (Your profile, AppearanceCard) | `block text-meta font-medium text-gray-700` | `text-gray-700` on `--surface-raised` is near-black-on-dark, the picker's only labels vanish. High traffic (every appearance edit). | `text-foreground-muted`. Principle 5 (AA in this mode). |
| components/profile/ColorPickerRows.tsx | 186 | "Clear secondary" link | `text-meta text-gray-500 hover:text-gray-900 underline` | Muted-gray link plus a hover that goes DARKER (`text-gray-900`) is unreadable on dark in both rest and hover. | `text-foreground-muted hover:text-foreground` (or `text-brand-action dark:text-brand-sky` for a true link). |
| components/profile/ColorPickerRows.tsx | 155 | Selected-swatch ring | `border-gray-900 scale-110` | The "this color is selected" affordance is a near-black ring, invisible against the dark surface, so the user cannot see which swatch is active. | `border-foreground` or a brand ring (`ring-2 ring-brand-sky`), mirroring the rainbow branch already using `ring-sky-500`. |

## MEDIUM (flat / no depth or off-mode, still usable)

| File | Line(s) | Element | Failing class string | Why it fails in DARK | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| components/ResearchFolderSetupNew.tsx | 298-305, 529-536, 623-630, 722-729 | Dot texture on all four folder-setup gate variants (user-select, initialize, reconnect, link) | `opacity-5` layer with SVG `fill='%23ffffff'` (pure white dots) | The reference login fix explicitly replaced white dots with a slate (`%23475569`) texture BECAUSE white dots are invisible in light and were the leftover light-design bug. These four gates still use pure-white dots, so the texture is invisible in light and only barely shows in dark, the opposite of the intended ambience. There is also no brand glow (Principle 3) here, only the dot layer. | Swap the texture fill to a mid slate (`%23475569`) like UserLoginScreen, and add the brand glow blob (`from-brand-sky/30 ... opacity-70 blur-3xl dark:opacity-40`). Principle 3 + the worked example. |
| components/ResearchFolderSetupNew.tsx | 762, 765, 769 | BeakerBot welcome speech bubble (link-folder screen) | tail `... bg-white`; body `relative rounded-2xl bg-white px-3 py-3 ... shadow-lg`; copy `text-slate-800` | Hardcoded white bubble with `text-slate-800` body, no dark variant. On the dark gate it is a glaring white box, and `shadow-lg` (a dark shadow) is invisible on dark so it has no depth either. | Either keep it deliberately white in both modes (acceptable for a chat bubble) OR move to `bg-surface-raised text-foreground border border-border`. If kept white, add `dark:shadow-black/40` for depth. |
| components/ResearchFolderSetupNew.tsx | 297, 721 | VersionBadge tone on the folder-setup gates | `<VersionBadge tone="onDark" .../>` | The gate background is the LIGHT-leaning `from-surface via-surface-sunken to-surface` gradient (light in light mode), but the badge is forced to `tone="onDark"`. In light mode the badge is styled for a dark bg and washes out, the same class of mismatch the login screen fixed by switching to `tone="surface"`. (Reverse-mode finding, hurts light not dark, but it is the same lazy-mode bug the standard targets.) | Use `tone="surface"` so the badge follows tokens in both modes, matching the UserLoginScreen fix. |
| components/profile/ProfileSettingsContent.tsx | 180 | "Create your account" primary button (Your profile none-state) | `px-4 py-2 text-body bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium` | Functions in dark (white text on blue), but it is off-token raw `bg-blue-600` instead of the brand fill the standard prescribes, so it does not match the brand-action button used everywhere else and reads slightly flat (no shadow/lift). | Use `btn-brand` (or `bg-brand-action`) per Principle 4 "Primary action: solid brand fill," add `shadow-sm`. |

## LOW (polish)

| File | Line(s) | Element | Failing class string | Why it fails in DARK | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| components/LoadingOverlay.tsx | 22 | Spinner track ring | `absolute inset-0 border-4 border-blue-200 rounded-full` | The spinner's static track is a light `border-blue-200`; the animated `border-blue-600` arc is still visible so the spinner works, but the track ring nearly disappears on the dark card and the loader reads thinner/flatter than intended. | Add `dark:border-blue-900/40` (or use a token like `border-border`) for the track so the ring has presence in dark. |
| components/StagedLoadingScreen.tsx | 159, 163 | "N files read" / "Ns elapsed" pills | `px-3 py-1 bg-white border border-[#e3ecf6] dark:bg-surface-raised dark:border-border` | Has dark variants and is fine, but flagged for visibility: this is the CORRECT pattern (light value + explicit `dark:` token). No fix needed, included so the audit baseline is clear. | None, reference of the right shape. |
| components/ResearchFolderSetupNew.tsx | 406, 886 | "Create" / "Link Folder" primary buttons | `bg-blue-500 hover:bg-blue-600 text-white` | Works in dark, but raw `bg-blue-500` instead of `btn-brand`/`bg-brand-action`, so the gate's primary actions drift from the brand fill used on the login screen and elsewhere. | Standardize on `btn-brand` for the gate's primary actions (consistency, Principle 4). |

## Suggested follow-up grouping for fix chips

1. NoteListRow tokens (HIGH, one tiny file, biggest content impact).
2. TourBootstrap V3/V4 prompt modals to surface tokens (HIGH, two modals, same recipe).
3. ColorPickerRows tokens + selected-swatch ring (HIGH, one file).
4. ResearchFolderSetupNew ambience pass (white dots to slate, add glow, tone="surface", btn-brand) (MEDIUM, batches the four gate variants together).

There is a broad tail of other in-app files using hardcoded `text-gray-*`
without `dark:` (CommentsThread.tsx, OrcidField.tsx, transparency/TransparencyTabs.tsx,
import-eln/steps/*, workbench/*, researchers/OrcidPublications.tsx,
lab-head/PurchaseApprovalControls.tsx, experiments/MethodChip.tsx,
PlateLayoutEditor.tsx). Each is the same class of bug (dark text, no dark variant)
but lower traffic than the items above; recommend a dedicated sweep chip
("replace hardcoded text-gray-*/border-gray-* with foreground/border tokens or
add dark: variants across in-app components") rather than enumerating every line
here, since the fix is mechanical and identical.

dark surface audit
