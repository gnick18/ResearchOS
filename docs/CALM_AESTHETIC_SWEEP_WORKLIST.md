# Calm Aesthetic Sweep — worklist (from inventory 2026-06-14)

Companion to `CALM_AESTHETIC_KIT.md`. Kit codes: **SA** ScrollArea · **CS**
`.ros-popup-card-shadow` · **TA** `titleAccent` · **RB** raised-button shadow ·
**SE** `.ros-seam`.

## State of play
- Only 4 popups on CalmPopupShell: NewPurchaseModal (amber ✓), PurchaseHistoryPopup
  (violet ✓), NoteDetailPopup (needs TA — editable title, non-trivial),
  TaskDetailPopup (needs TA). All 4 already inherit the dark card shadow.
- ~25 more named-object popups are bare LivingPopup → upgrade or add CS+TA+SA.
- ~40 substantial scroll regions → ScrollArea (list below).
- Many hand-rolled `shadow-xl/2xl bg-surface-raised/overlay` cards → swap to CS
  (gives dark-mode separation): NewGraphDialog, NewTableDialog, PowerPlannerDialog,
  HighLevelGoalModal L225, TaskModal L541, SharingSection L1310.
- RB hotspots (flat `bg-surface-raised/5 hover:bg-surface-raised/10 border`):
  SharingSection L1974/2149/2243, CloudStorageUsageSection L196/246, datahub dialogs.

## Areas (effort)
- **Popups fleet** (L) — Tier 1: TaskDetailPopup, NoteDetailPopup, ProjectDetailPopup,
  billing/BillingPopup, WhatsNewModal. Tier 2: FeedbackModal, HighLevelGoalModal,
  RoadmapModal, ImportELNDialog, UnifiedShareDialog, ProfileSettingsModal,
  ResearcherProfileModal.
- **Settings** (M) — SettingsShell (SA nav L187 + content L262; SE between sections),
  NotificationsSection/AiUsageSection/CloudStorageUsageSection/SharingSection (SE, RB).
  Owned by this lane (Lab/Settings lane handed it over).
- **Data Hub** (L) — page.tsx SA L2510; DataHubRail SA L844 + SE; GraphEditor SA L771;
  ResultsSheet SA; Transform/GuidedAnalysis/NewAnalysis/DatasetAnalysis/DatasetPlot/
  NewGraph/NewTable/PowerPlanner dialogs (CS+TA+SA).
- **Phylo** (M) — PhyloStudio SA L1647 + inner popup CS; PhyloCollectionRail SA L362 + SE;
  PhyloLayers SE; SmartDataWizard TA+CS+SA.
- **Notebook/Methods** (L) — methods/page.tsx 5 scroll regions + SE rail; MethodTabs SA;
  MethodExperimentsSidebar SA; MethodPicker SA+CS; MethodLibraryDetail/CompoundMethodBuilder/
  CreateMethodModal (TA+CS); NotebookRail SA+SE; SharedNotebookView SA.
- **BeakerBot/AI** (M) — BeakerBotConversation SA L1278 (high value, live chat scroll);
  BeakerChatRail SA L284; BeakerBotCanvas SA L254; MacroEditorSheet TA+CS+SA;
  RecordSetWidget SA; PdfFigurePicker SA.
- **Inventory** (M) — page.tsx SA + 6 LivingPopups; StorageTree SA; StorageMap CS;
  ItemFormDialog/ReceiveToInventoryDialog/ImportInventoryDialog/CellDetailDialog (TA+CS+SA).
- **Marketing** (S) — page/pricing/about/showcase/u/[handle] — mostly RB on CTAs, CS on
  feature cards; no SA (OS page scroll is fine).
- **Misc** — CalendarSidebar SA; DailyTasksSidebar SA+SE; CompanionHub SA+TA+CS;
  lab-head AuditTrailViewer/LabRoster (TA+CS+SA); EntityVersionHistorySidebar (SA+CS done in popup);
  SharedWithMeTab SA; Deposit/ProjectDepositDialog (SA+CS+TA); ProjectCreateModal (TA+CS);
  admin/OperatorShell SA; sequences/*Dialog x12 (CS+TA+SA); chemistry MoleculeEditorPopup (TA+CS).

## Skip (tiny dropdowns/menus/confirms — native scroll fine, no TA/SA)
MentionPicker, ComposerSlashMenu/MentionPicker, CodeLanguagePicker, autocomplete dropdowns,
SendTo*Picker, TaskPicker, one-liner confirm dialogs (SequenceConfirmDialog, DeleteMethodConfirm,
PiEditConfirmDialog, DuplicateUploadDialog, ErrorReportConfirmDialog, ExportFormatDialog, etc.).

## Open decisions (gate the campaign)
1. Hue taxonomy: 5 hues vs ~12 object types. Expand palette / group by domain / accent
   only core object types.
2. Batch order + whether to dispatch per-area sub-bots (worktree) with the kit as brief,
   each verified by Grant on :3000.
