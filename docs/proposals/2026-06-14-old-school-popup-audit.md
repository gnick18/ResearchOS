# Old-school popup / modal revamp audit (2026-06-14)

Triage of popups/dialogs still on raw/old-school chrome (the flavor of the bare
`/lab/join` and plain MigrationGate we revamped 2026-06-14). Read-only audit;
nothing changed by it. Pick from this list.

House style: no emojis, no em-dashes, no mid-sentence colons.

## Headline
The modern shells (`LivingPopup`, `CalmPopupShell`) have spread to ~100 files,
but the CALM KIT primitives barely propagated: `.ros-btn-neutral` was in only 2
files before this audit, and the hand-rolled-card popups use black
`shadow-xl`/`shadow-lg` (invisible on the dark canvas) instead of a card-shadow
primitive, with flat brand/grey buttons. ~18-22 genuine candidates. Most are
"flat + wrong-shadow + unbranded buttons" (the surface tokens are dark-aware, so
not fully color-broken); the hardcoded-light cases in section C are the worse,
rarer ones.

Cheapest single sweep: replace `shadow-xl`/`shadow-lg` on popup CARDS with the
card-shadow primitive, and swap flat buttons to `.ros-btn-neutral` /
`.ros-btn-destructive` (both now canonical in globals.css).

## (A) HIGH - bare/broken or commonly hit
1. `src/components/FileRenamePopup.tsx:74` - file rename (common). Raw `bg-black/30` overlay, hand-rolled card, flat buttons. -> LivingPopup + `.ros-btn-neutral` Cancel.
2. `src/components/UserColorPickerPopup.tsx:229` - pick user/cursor color. Raw `bg-black/60`, off-brand `from-blue-500 to-purple-600` gradient action. -> LivingPopup, drop gradient, brand-action + neutral Cancel.
3. `src/components/account/FindAndShareModal.tsx:236,240` - find-a-user / send (a sharing entry point Grant cares about). Raw `bg-black/50` + hand-rolled `shadow-xl` card (dark-invisible). -> card-shadow / LivingPopup + neutral secondary.
4. `src/components/project-surface/ProjectCardKebab.tsx:277,331` - Archive/Delete confirms off a project card. Two raw `bg-black/50` confirms, flat `bg-amber-600`/`bg-red-600`. -> LivingPopup + `.ros-btn-destructive`.
5. `src/components/sharing/ShareDialog.tsx:496` - core Share dialog. Hand-rolled `shadow-xl` card, flat brand buttons, `shadow-sm` chips. -> LivingPopup + card-shadow + neutral.
6. `src/components/sharing/SharingSetupWizard.tsx:575,727` - first-run sharing setup (rare, high-stakes). `bg-white text-slate-800` rows; separate real provider buttons from generic rows and neutralize the generic ones.

## (B) MEDIUM - flat-but-functional (dark-aware tokens, hand-rolled chrome + flat buttons)
7. `src/components/methods/ForkToLibraryAction.tsx:99,103` - fork method to library. Raw `bg-black/40` + `shadow-xl`. -> LivingPopup + neutral.
8. `src/components/sharing/RecoveryKitModal.tsx:51,56` - one-time recovery code (seen once, important). Raw `bg-black/40` + `shadow-xl`. -> card-shadow + neutral.
9. `src/components/sharing/CreateLocalIdentityStep.tsx:167` + the `*SendOutsideDialog.tsx` family (Sequence/Method/Project/Experiment/Calculator/BulkSequence under `src/components/sharing/`) - external-send steps, consistent flat buttons. Batch `.ros-btn-neutral` pass.
10. `src/components/references/ReferencePicker.tsx`, `SendReferencePicker.tsx`, `ExportConversationPicker.tsx` - flat `shadow-sm` segmented toggles. -> neutral segmented control.
11. `src/components/import-eln/BulkSortScreen.tsx:504,508` - ELN bulk-sort confirm. Raw `bg-black/40` + `shadow-xl`. -> LivingPopup.
12. `src/components/store/StoreShell.tsx:188` - store modal. Raw `bg-black/30`; toggle uses `bg-gray-300` (no dark). -> LivingPopup; dark toggle.
13. `src/components/DataSetupScreen.tsx:48` - data-setup gate (first-run-ish). Raw `bg-black/40` + hand-rolled card. -> branded shell like `/lab/join`.
14. `src/components/sequences/SequenceEditMenu.tsx:341,400` - sequence rename/edit popover + `bg-black/40` modal. -> neutral.
15. `src/components/sharing/ProjectImportDialog.tsx`, `SequenceSendOutsideDialog.tsx`, and `settings/SharingSection.tsx:186` section card (`shadow-sm` -> `.ros-seam`). Many flat brand buttons.

## (C) Dark-mode-only issues (color-broken, often missed)
16. `prose-gray` body text with no `dark:prose-invert` - 7 files: `app/methods/page.tsx:2468`, `components/TaskDetailPopup.tsx:1886`, `MethodPicker.tsx`, `LiveMarkdownEditor.tsx`, `AttachmentViewerModal.tsx`, `methods/MarkdownMethodTabContent.tsx`, `history/VersionDiffView.tsx`. Muddy rendered-markdown bodies in dark (high-visibility). One-line fix each: add `dark:prose-invert`.
17. `src/components/BrowserNotSupported.tsx:39,41` - `bg-white/10` glass + `text-slate-300` hardcoded. Rare but a real first-impression page.
18. `src/components/UserLoginScreen.tsx:1744` - login is intentionally `light-scope`, but the inner confirm modal at 1744 + `bg-white text-gray-800` provider buttons read old-school even within the light scope. Verify intent.
19. General: every (A)/(B) popup card uses black `shadow-xl`/`shadow-lg` - vanish on the dark room. Replace with the card-shadow primitive.

## Already modern (skip)
MigrationGate (revamped today), NewPurchaseModal / PurchaseHistoryPopup (the 10/10 reference), NoteDetailPopup, TaskDetailPopup (chrome; its prose body still needs C16), ProjectDetailPopup, the sequences/inventory/datahub/chemistry/notebooks `*Dialog` sets, SettingsModal, BillingPopup, UnifiedShareDialog, FeedbackModal, ResearcherProfileModal, lab/SelfExportModal + MigrateToSoloModal, people/PeoplePage modals.

Excluded as non-dialogs (raw `fixed inset-0` but correctly not chrome): animations/*, LoadingOverlay, StagedLoadingScreen, Celebration/RockExplosion/ScienceAnimation, ProgressEntertainer, BeakerBot*Scene, TimerAlarm, wiki/Screenshot, figure/FigureComposer (the `bg-white` is the publication paper), PhyloLayers/PhyloCollectionRail (canvas rails), and the light-scope onboarding splashes (VariantAurora/Bloom/SplitStage, SuccessTransition, FolderConnectGate, LabSignInGate - intentionally light-only branded full-screens).

## Recommended pick order
1. Small common confirms (FileRenamePopup, UserColorPickerPopup, ProjectCardKebab) - fast, high hit-rate, exactly the MigrationGate treatment.
2. The `prose-gray` dark sweep - one-line fix x7, fixes visible body text in dark.
3. The sharing-dialog family (ShareDialog, FindAndShareModal, the `*SendOutsideDialog` set) - one batch, shared copy-pasted chrome.
