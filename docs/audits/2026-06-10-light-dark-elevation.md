# Light/dark elevation audit findings

Generated from the elevation audit (48 components, 35 with violations, 13 clean).
House rule: page bg-surface < card bg-surface-raised < popup bg-surface-overlay (popups also need border-border + shadow). No hardcoded bg-white/bg-gray/text-gray on adapting surfaces.

## [HIGH] app/links/page.tsx
- L691 [both] `bg-surface-raised rounded-xl p-6 max-w-sm mx-4`
  - Delete confirmation modal uses bg-surface-raised (card-level elevation) instead of bg-surface-overlay (popup-level elevation). Modal is a top-level overlay and 
  - FIX: bg-surface-overlay border border-border shadow-lg rounded-xl p-6 max-w-sm mx-4

## [HIGH] app/page.tsx (dark-broken)
- L206 [dark] `bg-white/80`
  - Hardcoded white background with opacity on elevated loading overlay (z-[90]) does not adapt to dark mode. Will render as a glaring white semi-transparent box on
  - FIX: Replace bg-white/80 with bg-surface-overlay/95 (or similar backdrop token). If using a plain background, also add border border-border and shadow-lg to ensure e

## [HIGH] page.tsx (dark-broken)
- L1035 [both] `bg-surface-raised rounded-xl shadow-xl max-w-md w-full mx-4 p-5`
  - Modal/dialog uses bg-surface-raised (card elevation) instead of bg-surface-overlay (popup elevation). This makes the modal the same color as a raised card, brea
  - FIX: bg-surface-overlay
- L1079 [both] `fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-gray-900 text-white`
  - Toast notification hardcodes bg-gray-900, a non-semantic dark color that does not adapt to light/dark mode. In light mode it remains dark/broken (glaring dark b
  - FIX: Replace bg-gray-900 text-white with bg-surface-overlay text-foreground (and adjust styling so text color adapts automatically via tokens)

## [HIGH] AppShell.tsx (dark-broken)
- L787 [both] `bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg`
  - Error toast uses hardcoded bg-red-600 instead of a semantic elevation token. Does not adapt to dark mode and violates the elevation ladder rule. Also missing ex
  - FIX: Replace with bg-red-950 dark:bg-red-900 (or create a semantic token) and add border border-red-800 dark:border-red-700, or better: use a semantic bg-surface-ove
- L823 [dark] `bg-white rounded-full px-3.5 py-1.5 shadow-sm`
  - PillWrap uses hardcoded bg-white instead of bg-surface-raised. While only rendered in tinted header context (light-scope), if reused outside that scope it will 
  - FIX: Replace bg-white with bg-surface-raised for proper dark mode adaptation, or if light-scope is guaranteed, add a comment and consider bg-white/90 with explicit e
- L409 [dark] `text-gray-700`
  - Hardcoded text-gray-700 in disabled nav button (tinted header). Does not use semantic text-foreground token and won't adapt to dark mode themes beyond the light
  - FIX: Replace text-gray-700 with text-foreground-muted (or keep hardcoded gray if light-scope is truly guaranteed, but document it)
- L412 [dark] `text-gray-900`
  - Hardcoded text-gray-900 in active nav button (tinted header). Does not use semantic text-foreground token.
  - FIX: Replace text-gray-900 with text-foreground or add explicit dark mode skip if light-scope is architectural

## [HIGH] CalendarRemindersModal.tsx (dark-broken)
- L211 [dark] `bg-white/30`
  - Hardcoded bg-white overlay does not adapt to dark mode. In dark mode, this renders as a glaring white semi-transparent box on a dark (#28344c) bg-surface-overla
  - FIX: Use a semantic token like bg-black/10 or bg-surface-overlay with adjusted opacity to create a loading veil that adapts to both light and dark modes. For a semi-

## [HIGH] CommentsThread.tsx (dark-broken)
- L252 [dark] `border-gray-200`
  - Hardcoded gray-200 border on page-level section divider will not adapt to dark mode, creating invisible border in dark theme
  - FIX: border-border
- L257 [dark] `hover:bg-gray-50`
  - Hardcoded gray-50 on collapse button hover state does not flip in dark mode, will not be visible on dark background
  - FIX: hover:bg-surface-raised
- L260 [dark] `text-gray-500`
  - Hardcoded gray-500 text on icon will not flip in dark mode, will be same color as dark background
  - FIX: text-foreground-muted
- L263 [dark] `text-gray-700`
  - Hardcoded gray-700 text on heading will become invisible on dark backgrounds
  - FIX: text-foreground
- L360 [dark] `border-gray-100`
  - Hardcoded gray-100 left border on reply thread will be invisible in dark mode
  - FIX: border-border
- L438 [dark] `text-gray-700`
  - Hardcoded gray-700 on comment author name will be invisible on dark background
  - FIX: text-foreground
- L444 [dark] `text-gray-500`
  - Hardcoded gray-500 on metadata row will not adapt to dark mode
  - FIX: text-foreground-muted
- L468 [dark] `text-gray-800`
  - Hardcoded gray-800 on comment body text will be invisible on dark backgrounds
  - FIX: text-foreground
- L730 [dark] `border-gray-200`
  - Hardcoded gray-200 textarea border will be invisible on dark backgrounds in dark mode
  - FIX: border-border
- L745 [dark] `text-gray-500 hover:text-gray-700`
  - Hardcoded gray text on cancel button will not adapt to dark mode, becomes invisible
  - FIX: text-foreground-muted hover:text-foreground

## [HIGH] FeedbackModal.tsx (dark-broken)
- L337 [both] `bg-surface-raised`
  - Modal (popup, top elevation) uses bg-surface-raised (card rung) instead of bg-surface-overlay (popup rung). The modal is the topmost elevated surface and must u
  - FIX: bg-surface-raised -> bg-surface-overlay
- L737 [both] `bg-gray-900 hover:bg-gray-800 ... disabled:bg-gray-300`
  - Submit button uses hardcoded gray colors (bg-gray-900, bg-gray-800, bg-gray-300) instead of semantic tokens. These do not adapt to dark mode and break the eleva
  - FIX: Replace bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 with semantic button tokens, e.g. bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 (or use a button

## [HIGH] components/FileStrip.tsx (dark-broken)
- L353 [dark] `bg-white/80`
  - Hardcoded bg-white/80 for delete button instead of semantic elevation token. Sits on bg-surface-raised card. In dark mode with data-theme='dark', bg-white (#fff
  - FIX: Change bg-white/80 to bg-surface-sunken dark:bg-surface-sunken/80 (or bg-red-50 dark:bg-red-500/10 if you want a tinted inset; both preserve semantic dark adapt

## [HIGH] GanttChart.tsx (dark-broken)
- L1611 [dark] `bg-gray-900`
  - Goal hover tooltip hardcodes bg-gray-900 instead of using bg-surface-overlay. In dark mode this will be a dark gray box on a dark page (#0a0e1a), making the too
  - FIX: bg-surface-overlay border border-border
- L2204 [dark] `hover:bg-sky-50`
  - PTO context menu item hardcodes hover:bg-sky-50 (light cyan) instead of using a token. In dark mode, the menu background is #1c2638 but this hover state will pa
  - FIX: hover:bg-surface-sunken

## [HIGH] ImageAnnotatorModal.tsx (dark-broken)
- L746 [dark] `bg-surface-sunken/95`
  - Toolbar panel is using bg-surface-sunken (input well token) instead of bg-surface-raised. In dark mode, sunken is darker than raised, so this toolbar will appea
  - FIX: bg-surface-raised/95

## [HIGH] ImageMetadataPopup.tsx
- L185 [both] `bg-surface-raised`
  - Popup/modal incorrectly uses bg-surface-raised (card elevation) instead of bg-surface-overlay (popup elevation). A modal sitting on top of the entire page must 
  - FIX: bg-surface-overlay
- L259 [both] `bg-gray-700 hover:bg-gray-800`
  - Hardcoded gray colors that do not adapt to dark mode. These will remain dark gray in both light and dark modes, creating poor contrast in light mode and being s
  - FIX: Use semantic token like bg-surface-raised hover:bg-surface-raised/80 or a proper button token

## [HIGH] NoteDeleteUndoToast.tsx (dark-broken)
- L76 [both] `bg-gray-900 text-white`
  - Toast is an elevated surface (popup/overlay) that hardcodes bg-gray-900 and text-white. This creates a dark box on a light page (inverted elevation), and hardco
  - FIX: Change bg-gray-900 to bg-surface-overlay, text-white to text-foreground, and add border border-border to make the edge visible in light mode
- L91 [light] `text-gray-400`
  - Icon uses hardcoded text-gray-400 which doesn't adapt to light mode where gray-400 is too dark on a light background.
  - FIX: Change text-gray-400 to text-foreground-muted
- L117 [light] `text-gray-400 hover:text-white`
  - Dismiss button uses hardcoded text-gray-400 and hover:text-white which don't adapt to light mode.
  - FIX: Change text-gray-400 hover:text-white to text-foreground-muted hover:text-foreground

## [HIGH] Tooltip.tsx (dark-broken)
- L389 [both] `bg-gray-900 text-white`
  - Default tooltip bubble (line 388-391) hardcodes bg-gray-900 and text-white instead of using semantic surface tokens. This dark gray is not adaptive to light mod
  - FIX: Change to: bg-surface-overlay text-foreground
- L313 [both] `bg-sky-50 dark:bg-sky-500/15 border-sky-100`
  - firstPaintHint header strip (line 313) hardcodes bg-sky-50 with a dark variant, but should use a semantic background token from the surface ladder. Also hardcod
  - FIX: Change to: bg-surface-sunken dark:bg-sky-500/15 border-border (or use a single semantic token if the sky tint is not required per design spec)
- L73 [dark] `bg-white/75`
  - NotificationBadge pill option (NotificationBadge.tsx line 73) hardcodes bg-white/75 which doesn't adapt to dark mode. On a dark background, the pill becomes inv
  - FIX: Change to: bg-surface-raised/75 or bg-surface-raised dark:opacity-75

## [HIGH] ResearchFolderSetupNew.tsx (dark-broken)
- L383 [dark] `bg-slate-900/95 text-slate-100 border border-white/10`
  - Tooltip popup hardcodes dark background and light text instead of using semantic surface tokens. In dark mode, slate-900/95 is nearly the same color as the dark
  - FIX: bg-surface-overlay border border-border text-foreground

## [HIGH] Tooltip.tsx (dark-broken)
- L389 [dark] `rounded-md bg-gray-900 text-white text-meta font-medium px-2.5 py-1.5 `
  - Default hover tooltip uses hardcoded bg-gray-900 and text-white instead of semantic tokens. In dark mode, bg-gray-900 (#111827) is darker than the page backgrou
  - FIX: bg-gray-900 text-white -> bg-surface-overlay text-foreground
- L390 [dark] `whitespace-nowrap rounded-md bg-gray-900 text-white text-meta font-med`
  - Single-line default hover tooltip uses hardcoded bg-gray-900 and text-white instead of semantic tokens. Same dark-mode elevation ladder problem as line 389: bg-
  - FIX: bg-gray-900 text-white -> bg-surface-overlay text-foreground

## [HIGH] UserLoginScreen.tsx (dark-broken)
- L1966 [both] `bg-slate-800 rounded-2xl shadow-2xl border border-white/20`
  - Recovery code modal (top-tier elevated surface) hardcodes bg-slate-800 and border-white/20 instead of semantic tokens. In light mode, this renders a dark gray m
  - FIX: bg-surface-raised rounded-2xl shadow-2xl border border-border, and remove hardcoded text-white/text-slate-400/text-slate-100/border-white/10 from child elements
- L1582 [dark] `bg-white px-4 py-2.5 text-meta font-semibold text-gray-800`
  - Google OAuth button hardcodes bg-white and text-gray-800, ignoring dark mode entirely. In dark mode renders as a white button on dark background (glaring white 
  - FIX: bg-surface-overlay text-foreground (or keep brand white but add dark:bg-surface-raised dark:text-foreground for dark mode adaptation)
- L1767 [dark] `bg-white text-slate-800 hover:bg-slate-100`
  - Unlock gate Google button hardcodes bg-white and text-slate-800. In dark mode appears as white button on dark backdrop (white-box bug).
  - FIX: bg-surface-overlay text-foreground (or dark:bg-surface-raised dark:text-foreground)
- L1435 [both] `bg-slate-900/95 text-slate-100 border border-white/10`
  - Tooltip (popup/overlay, top-tier elevated surface) hardcodes dark theme colors instead of semantic bg-surface-overlay token. Breaks the elevation ladder and ign
  - FIX: bg-surface-overlay text-foreground border border-border (or use Tooltip component's own styling if it provides dark-mode-aware defaults)
- L1454 [both] `bg-slate-900/95 text-slate-100 border border-white/10`
  - Second tooltip hardcodes dark theme colors instead of semantic tokens. Same elevator-ladder violation as line 1435.
  - FIX: bg-surface-overlay text-foreground border border-border
- L1472 [both] `bg-slate-900/95 text-slate-100 border border-white/10`
  - Third tooltip hardcodes dark theme colors instead of semantic tokens. Same elevator-ladder violation as line 1435.
  - FIX: bg-surface-overlay text-foreground border border-border
- L1591 [both] `bg-slate-800 px-4 py-2.5 text-meta font-semibold text-white`
  - GitHub OAuth button hardcodes bg-slate-800 and text-white. Hardcoded dark theme ignores the semantic elevation and dark-mode token system.
  - FIX: bg-surface-raised text-foreground dark:text-foreground (use semantic tokens instead of hardcoded slate-800/white)
- L1776 [both] `bg-[#24292e] text-white hover:bg-[#2f363d]`
  - Unlock gate GitHub button hardcodes hex color #24292e (hardcoded GitHub dark color) instead of semantic elevation tokens. Ignores dark-mode adaptation.
  - FIX: Use semantic bg-surface-raised and text-foreground tokens with optional dark-mode-aware GitHub brand color variant

## [HIGH] TaskDocVersionHistory.tsx (dark-broken)
- L389 [dark] `bg-gray-900 text-white`
  - Tooltip hardcodes non-semantic dark gray that does not adapt to dark mode. In dark mode (#111827) it becomes nearly invisible against page background (#0a0e1a),
  - FIX: bg-surface-overlay text-foreground
- L390 [dark] `bg-gray-900 text-white`
  - Duplicate hardcoded gray-900 in single-line tooltip variant - same dark mode visibility failure as line 389.
  - FIX: bg-surface-overlay text-foreground
- L396 [dark] `text-gray-100`
  - Hardcoded text-gray-100 does not flip in dark mode. Will be light gray on dark background, poor contrast in dark mode.
  - FIX: text-foreground-muted
- L102 [dark] `bg-stone-50`
  - Diff block hardcodes bg-stone-50 (#fafaf9), a light gray that will render as bright white/near-white in dark mode, invisible against dark page backgrounds. This
  - FIX: bg-surface-raised (and optionally add shadow-sm for light mode edge definition)

## [HIGH] PickUserBeforeImportModal.tsx (dark-broken)
- L112 [dark] `bg-gradient-to-br from-slate-800 to-slate-900 border border-white/15`
  - Modal uses hardcoded dark gradient instead of bg-surface-overlay token. In dark mode, slate-800/900 is nearly the same color as the page background (#0a0e1a), m
  - FIX: bg-surface-overlay border border-border
- L135 [both] `bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-`
  - User tiles use hardcoded opacity-based styling (white/5, white/10) that won't adapt to light mode. Should use semantic surface tokens and border-border.
  - FIX: bg-surface-raised/80 hover:bg-surface-raised border border-border hover:border-blue-500/50
- L155 [both] `bg-white/10 border border-white/20 placeholder-slate-400`
  - Input field uses hardcoded white/10 and white/20 instead of bg-surface-sunken and border-border. Hardcoded slate-400 placeholder won't flip in dark mode.
  - FIX: bg-surface-sunken border border-border placeholder-foreground-muted
- L117 [light] `text-white`
  - Heading hardcoded to white; will be white on white in light mode if this modal is ever shown in light theme. Should use text-foreground.
  - FIX: text-foreground
- L138 [light] `text-white`
  - User tile text hardcoded to white; will be white on white in light mode. Should use text-foreground.
  - FIX: text-foreground

## [HIGH] DoneStep.tsx (dark-broken)
- L217 [dark] `rounded-lg border border-gray-200 bg-gray-50`
  - SkippedPanel card hardcodes bg-gray-50 without dark mode variant. In dark mode the page is #0a0e1a and the card stays light gray — a glaring white box on dark b
  - FIX: bg-surface-raised dark:bg-surface-raised border-border dark:border-border
- L223 [dark] `text-gray-800`
  - Hardcoded text-gray-800 does not flip for dark mode. Will be nearly invisible on dark surface.
  - FIX: text-foreground dark:text-foreground
- L226 [dark] `text-gray-500`
  - Hardcoded text-gray-500 does not flip for dark mode. Will be nearly invisible on dark surface.
  - FIX: text-foreground-muted dark:text-foreground-muted
- L230 [dark] `text-gray-700`
  - Hardcoded text-gray-700 does not flip for dark mode. Will be nearly invisible on dark surface.
  - FIX: text-foreground-muted dark:text-foreground-muted

## [HIGH] LabArchivesSignInStep.tsx (dark-broken)
- L52 [dark] `border-gray-100`
  - Hardcoded border color that does not adapt to dark mode. In dark mode, gray-100 remains light gray and creates poor contrast against dark backgrounds.
  - FIX: Change border-gray-100 to border-border (semantic token that flips automatically)
- L56 [dark] `text-gray-700 hover:text-gray-900`
  - Hardcoded text colors that do not flip for dark mode. Dark gray text on dark backgrounds becomes invisible.
  - FIX: Change text-gray-700 hover:text-gray-900 to text-foreground hover:text-foreground-bright (or semantic equivalent)
- L64 [dark] `bg-gray-100 hover:bg-gray-200 text-gray-800`
  - Hardcoded button background and text colors that do not adapt to dark mode. Gray background violates elevation semantics; text becomes unreadable on dark page.
  - FIX: Change to bg-surface-sunken hover:bg-surface-sunken/80 text-foreground (or use a proper button component with semantic tokens)

## [HIGH] CloudProviderBeat.tsx (dark-broken)
- L87 [both] `bg-white border border-slate-200`
  - Provider cards use hardcoded bg-white and border-slate-200 instead of semantic elevation tokens. In dark mode, bg-white renders as a glaring white box on the da
  - FIX: Replace 'bg-white border border-slate-200' with 'bg-surface-raised border border-border shadow-lg'. This ensures the card uses the correct elevation token (whit

## [HIGH] FolderChoiceBeat.tsx (dark-broken)
- L115 [both] `bg-white hover:bg-slate-50`
  - Card background hardcoded to white and slate-50 instead of semantic token. Will render as glaring white box in dark mode, breaking the elevation ladder. In ligh
  - FIX: bg-surface-raised hover:bg-surface-raised, add shadow-sm and border-border for light-mode edge definition
- L114 [dark] `bg-sky-50`
  - Selected card uses hardcoded bg-sky-50 instead of semantic surface token. Will not adapt to dark mode. Non-standard elevation color breaks the three-rung ladder
  - FIX: bg-surface-raised with optional ring-2 ring-sky-500 for selection state, remove hardcoded bg-sky-50
- L111 [light] `border-2 (with border-sky-500 or border-slate-200)`
  - Cards lack shadow-sm or shadow-lg. In light mode, the unselected card (white bg on slate-50 page) has no shadow to reinforce elevation—only a thin border. Selec
  - FIX: Add shadow-sm to both selected and unselected states for proper card elevation in light mode

## [HIGH] CloningProductPreview.tsx (dark-broken)
- L130 [dark] `border-gray-200 ring-sky-200`
  - Card border and ring use hardcoded light-mode colors that don't adapt to dark mode; border-gray-200 becomes invisible on dark card background
  - FIX: border-border (replaces border-gray-200); remove hardcoded ring-sky-200 or add conditional dark:ring-sky-950
- L144 [dark] `text-gray-700`
  - Heading text is hardcoded dark gray that won't flip for dark mode; becomes low-contrast on dark background
  - FIX: text-foreground
- L147 [dark] `text-gray-500`
  - Metadata text hardcoded to gray-500 (medium gray) which is mid-scale and doesn't flip; poor contrast in dark mode
  - FIX: text-foreground-muted
- L155 [dark] `border-gray-200 text-gray-600 hover:bg-gray-100`
  - Copy button uses hardcoded light colors: border and text won't adapt to dark mode; hover state is non-existent in dark
  - FIX: border-border text-foreground-muted hover:bg-surface-raised (or dark:hover:bg-slate-700)
- L180 [dark] `border-gray-200`
  - SequenceReadView container border hardcoded to light gray; invisible on dark card
  - FIX: border-border
- L202 [dark] `text-gray-600 hover:text-gray-800`
  - Disclosure button text hardcoded to gray shades that don't flip for dark mode; hover state is broken (darker gray on dark background)
  - FIX: text-foreground-muted hover:text-foreground
- L209 [dark] `bg-gray-50 border-gray-200 text-gray-700`
  - Sequence preview well (sunken surface) uses hardcoded bg-gray-50 instead of bg-surface-sunken; border and text also hardcoded; appears as light box on dark card
  - FIX: bg-surface-sunken border-border text-foreground

## [HIGH] FeatureSegmentDiagram.tsx (dark-broken)
- L65 [dark] `bg-gray-50/70 border-gray-200`
  - Container uses hardcoded bg-gray-50/70 and border-gray-200 instead of semantic tokens bg-surface-raised and border-border. Will not adapt to dark mode — the gra
  - FIX: bg-surface-raised border-border
- L78 [dark] `stroke="#d1d5db"`
  - SVG baseline stroke hardcoded to #d1d5db (gray-300). Will not adapt to dark mode.
  - FIX: Use currentColor or a CSS variable linked to border-border token (--color-border-border or equivalent)
- L90 [dark] `stroke="#9ca3af"`
  - SVG intron connector stroke hardcoded to #9ca3af (gray-400). Will not adapt to dark mode.
  - FIX: Use currentColor or a CSS variable linked to a muted border color token
- L125 [dark] `fill="#6b7280"`
  - SVG text fill hardcoded to #6b7280 (gray-500). Will not adapt to dark mode.
  - FIX: Use currentColor or CSS variable linked to text-foreground-muted token
- L128 [dark] `fill="#6b7280"`
  - SVG text fill hardcoded to #6b7280 (gray-500). Will not adapt to dark mode.
  - FIX: Use currentColor or CSS variable linked to text-foreground-muted token
- L134 [dark] `text-gray-500`
  - Summary text uses hardcoded text-gray-500 instead of text-foreground-muted. Will not adapt to dark mode.
  - FIX: text-foreground-muted

## [HIGH] components/sequences/SequenceEditView.tsx (dark-broken)
- L620 [dark] `bg-white/95`
  - FloatingSelectionBadge is a floating card (elevated surface, z-30) that hardcodes bg-white/95, rendering as a glaring white box in dark mode. Does not use the s
  - FIX: Replace bg-white/95 with bg-surface-overlay (or bg-surface-overlay/95 if transparency is needed, but the token itself should handle dark mode color adaptation)

## [HIGH] components/Tooltip.tsx (dark-broken)
- L389 [dark] `bg-gray-900 text-white`
  - Default tooltip uses hardcoded bg-gray-900 (dark gray) instead of semantic bg-surface-overlay token. In dark mode, a hardcoded dark gray is nearly invisible aga
  - FIX: Change bg-gray-900 to bg-surface-overlay and text-white to text-foreground (which will automatically adapt). Keep the shadow-lg for light mode edge visibility.
- L390 [dark] `bg-gray-900 text-white text-gray-100`
  - Same as line 389 — multi-line variant hardcodes bg-gray-900. Additionally, line 396 hardcodes text-gray-100 for the body text instead of using text-foreground-m
  - FIX: Change bg-gray-900 to bg-surface-overlay, text-white to text-foreground, and text-gray-100 (line 396) to text-foreground-muted. All three must flip for dark mod

## [HIGH] TaxonomyTreeView.tsx (dark-broken)
- L1400 [dark] `bg-white/95`
  - Thickness legend card hardcodes white background instead of adapting to dark mode via semantic token. In dark mode this creates a glaring white box on the dark 
  - FIX: bg-surface-raised
- L1324 [dark] `fill="#ffffff"`
  - SVG label pill hardcodes white fill for the background rectangle. In dark mode on a dark page, the white pill stands out as a glaring box, but more critically t
  - FIX: Use currentColor or a CSS variable bound to bg-surface-raised equivalent for SVG fills, or implement a dark-mode-aware SVG rendering. Alternatively, switch the 

## [HIGH] SharingSetupWizard.tsx (dark-broken)
- L716 [dark] `bg-white text-slate-800 hover:bg-slate-100 font-medium transition-colo`
  - ORCID sign-in button hardcodes bg-white, which will be a glaring white box on the dark bg-surface-raised modal. Does not adapt to dark mode. Also text-slate-800
  - FIX: Change to: bg-surface-raised text-foreground hover:bg-surface-raised/80 font-medium transition-colors border border-border
- L724 [dark] `bg-white text-slate-800 hover:bg-slate-100 font-medium transition-colo`
  - Google sign-in button hardcodes bg-white, which will be a glaring white box on the dark bg-surface-raised modal. Does not adapt to dark mode. Also text-slate-80
  - FIX: Change to: bg-surface-raised text-foreground hover:bg-surface-raised/80 font-medium transition-colors border border-border

## [HIGH] components/transparency/TransparencyTabs.tsx (dark-broken)
- L75 [dark] `border-gray-200 bg-gray-50/60`
  - OracleCitation is an elevated card in a list but hardcodes bg-gray-50 (light-only) without dark mode color. Will not adapt to dark mode and loses elevation on d
  - FIX: Replace bg-gray-50/60 with bg-surface-raised dark:bg-surface-raised (or equivalent semantic token); add dark:border-border if needed for dark mode contrast
- L104 [dark] `border-gray-200 bg-gray-50/70`
  - CaseVisualCard is an elevated card with hardcoded bg-gray-50 (light-only). Will not adapt to dark mode and loses visual hierarchy.
  - FIX: Replace bg-gray-50/70 with bg-surface-raised dark:bg-surface-raised; update border-gray-200 to border-border
- L162 [dark] `border-gray-200 bg-gray-50`
  - ScalarTable thead row hardcodes bg-gray-50 (light-only color) without dark mode variant. Will not adapt in dark mode.
  - FIX: Replace bg-gray-50 with bg-surface-sunken or appropriate semantic token with dark variant
- L350 [dark] `border-sky-200 dark:border-sky-500/30 border-b-sky-600 bg-sky-50/70 te`
  - Selected tab background uses bg-sky-50/70 without dark mode color. Will render as white box on dark page.
  - FIX: Add dark:bg-sky-900/30 or similar dark mode background to match the dark border-sky-500/30
- L357 [dark] `bg-gray-100 text-gray-500`
  - Unselected tab badge uses bg-gray-100 (hardcoded light color) without dark mode support. Will not adapt to dark mode.
  - FIX: Add dark:bg-gray-700 dark:text-gray-400 or replace with semantic surface-sunken token
- L242 [dark] `bg-gray-100`
  - DomainSummary 'within tolerance' chip hardcodes bg-gray-100 without dark mode color. Will not adapt.
  - FIX: Add dark:bg-gray-700/50 dark:text-gray-300 to match semantic dark mode expectations
- L247 [dark] `bg-slate-100`
  - DomainSummary 'expected difference' chip hardcodes bg-slate-100 without dark mode variant.
  - FIX: Add dark:bg-slate-700/50 dark:text-slate-300

## [MEDIUM] DepositDialog.tsx (dark-broken)
- L1076 [both] `text-meta bg-gray-900 text-gray-100 rounded-lg p-3 overflow-auto max-h`
  - Code block hardcodes bg-gray-900 and text-gray-100, which are non-adapting colors. In dark mode, a gray-900 background on a #28344c overlay looks wrong (both da
  - FIX: Change to 'text-meta bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-50 rounded-lg p-3 overflow-auto max-h-52 leading-relaxed' or use 'bg-surface-

## [MEDIUM] ProjectDepositDialog.tsx
- L1132 [light] `bg-gray-900 text-gray-100`
  - Code display block hardcodes dark gray background that does not adapt to light mode. In light mode, a bg-gray-900 block will be nearly black on a light page, cr
  - FIX: Change to bg-surface-sunken dark:bg-gray-900 and text-foreground dark:text-gray-100, or use a light-gray background like bg-slate-100 dark:bg-gray-900 with text

## [MEDIUM] ExperimentResultCard.tsx (dark-broken)
- L328 [both] `bg-gray-800`
  - Hardcoded dark gray placeholder background in hero image container does not adapt to light/dark mode. In light mode it works, but the token-based approach shoul
  - FIX: Use bg-surface-sunken or another semantic token, or apply a theme-aware class
- L288 [dark] `text-blue-600`
  - Hardcoded blue text in markdown links does not adapt to dark mode. text-blue-600 may not have sufficient contrast or readability in dark backgrounds.
  - FIX: Use text-blue-400 for dark mode or a semantic text-link token that flips automatically

## [MEDIUM] LabMembershipPanel.tsx (dark-broken)
- L353 [dark] `bg-white`
  - Toggle knob hardcodes bg-white instead of using a semantic token. In dark mode, a white knob on a dark toggle background (bg-border which is dark in dark mode) 
  - FIX: Replace bg-white with a semantic surface token or a color that inverts with the theme—likely bg-surface (white in light, #1c2638 in dark) or a dedicated token f

## [MEDIUM] SequenceOperationsRail.tsx
- L131 [dark] `hover:border-gray-300`
  - Hardcoded hover border color that does not adapt to dark mode. The text-gray-300 will be light gray in both modes, breaking contrast in dark mode.
  - FIX: Change to hover:border-border (semantic token that flips)
- L135 [dark] `bg-gray-100 text-gray-600`
  - Hardcoded tile background and text colors without dark mode equivalents in the default case. These will stay light gray/600 in dark mode.
  - FIX: Use semantic tokens like bg-surface-sunken and text-foreground-muted, or add explicit dark: overrides
- L212 [both] `text-gray-400 hover:text-gray-600`
  - Hardcoded text colors without dark mode overrides. Gray-400/600 will be light gray in both modes, hard to see on light backgrounds in light mode.
  - FIX: Use text-foreground-muted for base, and add dark:hover:text-foreground or use semantic text tokens
- L268 [light] `text-gray-400`
  - Hardcoded text-gray-400 for group label. Non-semantic color that doesn't use the dark mode flip pattern.
  - FIX: Change to text-foreground-muted (already present in dark: override, remove the hardcoded gray-400)
- L281 [dark] `text-gray-600 hover:bg-gray-100`
  - Hardcoded text and hover background colors. Text-gray-600 will be light in both modes. Hover bg-gray-100 missing dark mode override.
  - FIX: Use text-foreground-muted and dark:hover:bg-surface-sunken to complete the dark mode support
- L94 [light] `bg-amber-50`
  - In InspectorContextBar selected state, hardcoded bg-amber-50 (light amber) is not a semantic token. While dark mode override exists, the light-mode hardcoding b
  - FIX: Replace with a semantic color token or ensure it uses the design system's amber scale consistently

## [MEDIUM] WorkbenchExperimentsPanel.tsx (dark-broken)
- L574 [dark] `bg-gray-50 border border-gray-200`
  - The 'Next in chain' button hardcodes light-mode colors without dark-mode variants. In dark mode, it renders as a light gray box on a dark page, breaking the ele
  - FIX: Add dark: variants: bg-gray-50 dark:bg-surface-raised border border-gray-200 dark:border-border. Or use semantic tokens: bg-surface-raised border border-border
- L782 [dark] `bg-gray-200 text-gray-900`
  - Earlier layout button (flat) hardcodes light-mode styling. In dark mode, the active state is a light gray box that breaks dark-mode reading.
  - FIX: Add dark variants: bg-gray-200 dark:bg-surface-raised text-gray-900 dark:text-foreground
- L793 [dark] `bg-gray-200 text-gray-900`
  - Earlier layout button (grouped) hardcodes light-mode styling. Same issue as line 782.
  - FIX: Add dark variants: bg-gray-200 dark:bg-surface-raised text-gray-900 dark:text-foreground
- L859 [dark] `hover:bg-gray-50`
  - Earlier group toggle button hover state hardcodes light gray without dark-mode equivalent. Subtle but still a hardcoded non-semantic color.
  - FIX: Change to: hover:bg-gray-50 dark:hover:bg-surface-raised

