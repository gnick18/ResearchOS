# Light-mode surface audit (2026-06-07)

Read-only audit of high-traffic user-facing surfaces against
`docs/SURFACE_DESIGN_LANGUAGE.md`, using the live light-mode token values from
`frontend/src/app/globals.css` (--surface #ffffff, --surface-raised #ffffff,
--surface-sunken #f8fafc, --border-subtle #e5e7eb, --foreground #171717,
--foreground-muted #6b7280, --color-brand-action #1283c9, --color-brand-sky
#1aa0e6). The reference bar is the fixed `UserLoginScreen.tsx` and was not
re-flagged. House style honored: no em-dashes, no emojis, no mid-sentence colons.

## Summary

The biggest structural problem is the folder-setup gate, the first screen every
new user sees. Its three full-screen sub-screens copy a decorative dot texture
that paints pure white (`fill='%23ffffff'`) at `opacity-5`, so in light mode the
texture is invisible white-on-white and the background reduces to a near-flat
white-to-#f8fafc wash. The same screen layers a white `bg-surface-raised` card on
that white background and stacks `bg-surface-sunken` rows inside it, separated
only by hairlines, which is the exact anti-pattern the standard exists to kill.
After that, the recurring failures are loading and empty states that are a bare
spinner or one line of muted text on a flat panel, quiet buttons that are a
hairline border plus muted text with a no-op hover, and a cluster of raw
`text-gray-300` / `text-gray-400` text that fails AA on white.

Findings by severity: high 6, medium 9, low 5 (20 total).

## High severity (invisible or unreadable to a user)

| File | Line(s) | Element | Failing class string | Why it fails in LIGHT | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| frontend/src/components/ResearchFolderSetupNew.tsx | 298-305, 529-536, 623-630, 722-729 | Full-screen decorative dot texture (all 4 gate sub-screens) | `absolute inset-0 opacity-5` wrapping an SVG with `fill='%23ffffff' fill-opacity='1'` | The texture is pure white dots on a white-to-#f8fafc background, so it is completely invisible in light mode (this is the precise bug the login fix corrected). Anti-pattern: "a decorative layer that only works in one mode". | Switch the dot fill to a mid neutral slate and bump opacity, matching the login fix (`opacity-[0.05]` slate dots). Texture must read faintly in both modes per principle 3. |
| frontend/src/components/ResearchFolderSetupNew.tsx | 296, 528, 622, 720 | Full-screen gate background | `bg-gradient-to-br from-surface via-surface-sunken to-surface` (no brand glow layer) | #ffffff to #f8fafc to #ffffff is a near-flat white sheet with no ambience, and the only texture layer (above) is invisible. A large background that is effectively flat single-surface color. | Add the login screen's soft brand glow (`from-brand-sky/30 via-brand-purple/15 to-transparent`, `opacity-70 blur-3xl dark:opacity-40`) behind the card, plus the fixed slate texture, per principle 3 and the worked example. |
| frontend/src/components/ResearchFolderSetupNew.tsx | 335-338 | Account-selection rows (multi-user select screen) | `bg-surface-sunken hover:bg-surface-sunken/70 border border-border hover:border-blue-500/50 rounded-lg` | `surface-sunken` (#f8fafc) tiles sit inside a `surface-raised` (#ffffff) card with only a hairline and no shadow, so the rows barely separate from the card. The reference login made these `bg-surface` tiles with `shadow-sm` + hover lift. | Give rows `shadow-sm` at rest plus `hover:-translate-y-0.5 hover:shadow-md`, mirroring the login account rows (principle 2 + worked example). |
| frontend/src/components/CommentsThread.tsx | 189 | "No comments yet." empty state | `text-meta text-gray-400 mb-3` | #9ca3af on #ffffff is roughly 2.5:1, below AA, and it is a single muted line with no panel, illustration, or action. Fails AA and principle 6 (lazy empty state). | Use `text-foreground-muted` (#6b7280, AA-passing) and wrap in a real empty-state block (sunken panel or small BeakerBot plus a prompt to add the first comment). |
| frontend/src/components/workbench/WorkbenchListsPanel.tsx | 297-298 | "No list tasks yet" empty state | `text-title text-gray-400` heading + `text-body text-gray-300` body | #d1d5db (gray-300) on white is roughly 1.5:1, effectively unreadable. AA failure (principle 5/6). | Replace gray-300/gray-400 with `text-foreground` heading and `text-foreground-muted` body, and give the empty state a characterful surface plus primary action. |
| frontend/src/components/CommentsThread.tsx | 189-191 (notSharedHint) | "not shared" hint banner | `text-meta text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3` | Hardcoded gray tokens instead of semantic tokens; `bg-gray-50` (#f9fafb) on a white parent is a barely-visible panel and the component never adapts. Borderline AA and zero depth. | Use `bg-surface-sunken border border-border` with `text-foreground-muted`, or tint it (informational blue/amber) so the hint reads as a real callout, not flat-on-flat. |

## Medium severity (flat or no depth, but usable)

| File | Line(s) | Element | Failing class string | Why it fails in LIGHT | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| frontend/src/components/settings/SettingsModal.tsx | 23-28 | Settings lazy-load fallback | `flex flex-1 items-center justify-center p-16` with a lone `h-7 w-7 animate-spin` ring | A bare spinner on the flat white LivingPopup card. The first thing seen on opening Settings is a lazy spinner with no character (principle 6). | Add a one-line label and a faint surface, or a couple of skeleton `surface-sunken` blocks shaped like the settings sections, with motion. |
| frontend/src/components/settings/SharingSection.tsx | 182-196, 308-351, 733-803 | Settings/sharing `Card` sections | `bg-surface-raised rounded-xl border border-border p-6` | These white cards render inside the white LivingPopup card with only a hairline and no shadow or tint, so multiple stacked sections melt together. Anti-pattern: surface-raised on surface-raised by hairline alone. | Set the settings body background to `surface-sunken` so the white cards lift off it, or give each card `shadow-sm`. Confirm the SettingsBody scroll container uses a sunken background. |
| frontend/src/components/settings/SharingSection.tsx | 506, 514, 525, 595, 1209, 1217, 1319 | Secondary action buttons (Rotate key, Disconnect, Reset, Edit profile, Cancel) | `bg-surface-sunken hover:bg-surface-sunken text-foreground rounded-lg` | The hover class equals the rest class, so hover changes nothing (principle 4 requires a real hover). The `surface-sunken` fill on a white card is also a very weak affordance. | Make hover deepen the fill (for example `hover:bg-border` or a brand tint) and add a real border, per principle 4 tertiary pattern. |
| frontend/src/components/ResearchFolderSetupNew.tsx | 1104-1113 | "Import from LabArchives" CTA | `bg-surface-sunken hover:bg-surface-sunken/70 border border-border hover:border-blue-500/50 text-foreground` | A near-white `surface-sunken` fill plus hairline on a white card reads as almost no button. Weak character at rest. | Promote to the secondary pattern (brand-tinted fill `bg-brand-action/[0.06]`, brand border, brand label) since this is a primary onboarding path. |
| frontend/src/components/ResearchFolderSetupNew.tsx | 940-1004 | System-folder recovery modal | `bg-surface-raised border border-amber-300/30 shadow-2xl` with amber body text `text-amber-700 dark:text-amber-100/90` | The card itself is fine (shadow-2xl), but it is a white card with a barely-visible amber/30 border, and the amber-700 body on white is the only color cue. Reads flat for a warning dialog. | Add an amber-tinted card background (`bg-amber-50` light) so the warning surface itself signals caution, not just the border. |
| frontend/src/components/project-surface/ActivityFeed.tsx | 170, 174 | "No activity yet." / "Loading activity..." | `text-body text-foreground-muted italic` | A single italic muted line with no panel or motion for both the loading and empty states (principle 6). | Loading should be a skeleton of `surface-sunken` rows; empty should be a small illustration or BeakerBot plus a one-line prompt. |
| frontend/src/components/methods/VariationNotesPanel.tsx | 488-491 | "No variation notes yet." | `text-center py-6 text-amber-600` with two muted lines | No surface, just centered text on the flat panel. Color is AA-ok but the state has no character or affordance (principle 6). | Wrap in a `surface-sunken` rounded block with a small icon and the existing prompt copy. |
| frontend/src/components/TaskPicker.tsx | 252-258 | Esc / close button in picker | `text-meta text-foreground-muted hover:text-foreground-muted px-2 py-1 border border-border rounded` | Hairline border plus muted text with a no-op hover (`hover:text-foreground-muted` equals rest). Principle 4 violation. | Give it a `surface-sunken` fill and a hover that actually changes (`hover:text-foreground`, `hover:bg-border`). |
| frontend/src/components/MethodPicker.tsx | 554-560 | Esc / close button in picker | `text-meta text-foreground-muted hover:text-foreground-muted px-2 py-1 border border-border rounded` | Same no-op-hover hairline button as TaskPicker (shared pattern). | Same fix as TaskPicker, a sunken fill plus a real hover. |

## Low severity (polish)

| File | Line(s) | Element | Failing class string | Why it fails in LIGHT | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| frontend/src/components/CommentsThread.tsx | 265, 270, 436, 460 | Comment count, chevron, deleted label, delete button | `text-gray-400` (multiple) | #9ca3af on white is below AA for these small text and icon accents. Should use semantic muted, which is darker. | Replace `text-gray-400` with `text-foreground-muted`. |
| frontend/src/components/workbench/WorkbenchListsPanel.tsx | 323, 327, 333 | List secondary labels | `text-gray-400` (multiple) | Same sub-AA gray on white for small text. | Replace with `text-foreground-muted`. |
| frontend/src/components/LabGanttChart.tsx | 350 | "No tasks to display." | `<p className="mb-2">No tasks to display.</p>` (inherits muted gray) | Single bare line, no surface or action. Minor since it is a secondary view. | Add a small empty-state block with a hint to create a task. |
| frontend/src/components/workbench/WorkbenchExperimentsPanel.tsx | 563 | "No experiments yet" | `text-title text-gray-400` | gray-400 title on white, slightly under AA, and a bare line. | Use `text-foreground` plus a `surface-sunken` empty-state block. |
| frontend/src/components/ResearchFolderSetupNew.tsx | 759-776 | BeakerBot welcome speech bubble | `bg-white px-3 py-3 ... shadow-lg` with `text-slate-800` | Hardcoded `bg-white` (not a token) reads fine in light but will not flip in dark; acceptable today but is a latent both-modes bug per principle 7. | Move to `bg-surface-raised` plus `text-foreground` so it stays correct in dark. |

## Notes for the fix pass

- The folder-setup gate (`ResearchFolderSetupNew.tsx`) is the highest-leverage
  single file. Porting the exact login-screen treatment (slate texture, brand
  glow, raised tiles with shadow and hover lift, brand-tinted secondary buttons)
  fixes the first four high findings plus several medium ones at once. It already
  shares the BeakerBot pill and copy patterns, so the visual language is close.
- `CommentsThread.tsx` and the `workbench/*Panel.tsx` files still use raw
  `text-gray-300` / `text-gray-400` / `bg-gray-50` instead of semantic tokens,
  which is both an AA problem and a dark-mode latent bug. A token sweep there is
  low risk and clears five findings.
- `LivingPopup.tsx` itself is correct (shadow-2xl + ring-1 ring-black/5 on the
  card, dimmed scrim). The flatness inside Settings comes from the section cards
  and the body background, not the shell.

light surface audit
