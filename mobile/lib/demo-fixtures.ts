// Demo-mode fixture data. Believable fake lab content that never touches the
// network. Mirrors the tone of the web ?wikiCapture=1 fixture lab. House style:
// no em-dashes, no emojis, no mid-sentence colons.
//
// Consumed by:
//   - fetchSnapshot (snapshots.ts) when pairing.demo is true
//   - seedDemoCaptures() called from the Notebook tab on demo entry
//   - scheduleDemoNotification() called once per demo session

import type { TodaySnapshot, NotificationsSnapshot } from '@/lib/snapshots';
import type { InventorySnapshot } from '@/lib/scan';

// ---------------------------------------------------------------------------
// Today snapshot fixture (name = "today")
// ---------------------------------------------------------------------------

// Use a stable base date so the "Last synced" line shows a plausible timestamp.
// We compute it at module-load time so it never drifts during a session.
const NOW_ISO = new Date().toISOString();

// A task scheduled for today.
const TODAY = new Date();
const todayStr = TODAY.toISOString().slice(0, 10);

// A task that was due yesterday (overdue).
const yesterday = new Date(TODAY);
yesterday.setDate(TODAY.getDate() - 1);
const yesterdayStr = yesterday.toISOString().slice(0, 10);

// A task coming up in two days.
const twoDaysOut = new Date(TODAY);
twoDaysOut.setDate(TODAY.getDate() + 2);
const twoDaysOutStr = twoDaysOut.toISOString().slice(0, 10);

export const DEMO_TODAY_SNAPSHOT: TodaySnapshot = {
  generatedAt: NOW_ISO,
  tasks: [
    {
      id: 'demo-task-1',
      name: 'Split HEK293 cells (passage 18)',
      start_date: todayStr,
      end_date: todayStr,
      task_type: 'Cell culture',
    },
    {
      id: 'demo-task-2',
      name: 'Image plate 4 (GFP channel, 20x)',
      start_date: todayStr,
      end_date: todayStr,
      task_type: 'Imaging',
    },
  ],
  overdue: 1,
  upcoming: 1,
  overdueTasks: [
    {
      id: 'demo-task-3',
      name: 'qPCR validation of KO clone B7',
      start_date: yesterdayStr,
      end_date: yesterdayStr,
      task_type: 'PCR',
    },
  ],
  upcomingTasks: [
    {
      id: 'demo-task-4',
      name: 'Western blot for p53 (lysate batch 3)',
      start_date: twoDaysOutStr,
      end_date: twoDaysOutStr,
      task_type: 'Protein analysis',
    },
  ],
};

// ---------------------------------------------------------------------------
// Inventory snapshot fixture (name = "inventory")
// ---------------------------------------------------------------------------

export const DEMO_INVENTORY_SNAPSHOT: InventorySnapshot = {
  generatedAt: NOW_ISO,
  trackedStocks: [
    {
      stockId: 'demo-stock-1',
      itemName: 'DMEM (high glucose, no phenol red)',
      vendor: 'Gibco',
      productBarcode: '10569010',
      unitsPerScan: 1,
      unitsRemaining: 3,
      unitLabel: 'bottles',
      lowAtCount: 2,
      totalUnits: 6,
    },
    {
      stockId: 'demo-stock-2',
      itemName: 'Fetal bovine serum (heat-inactivated)',
      vendor: 'Sigma-Aldrich',
      productBarcode: 'F4135',
      unitsPerScan: 1,
      unitsRemaining: 1,
      unitLabel: 'bottles',
      lowAtCount: 2,
      totalUnits: 4,
    },
    {
      stockId: 'demo-stock-3',
      itemName: 'Trypsin-EDTA 0.25%',
      vendor: 'Gibco',
      productBarcode: '25200072',
      unitsPerScan: 1,
      unitsRemaining: 5,
      unitLabel: 'vials',
      lowAtCount: 2,
      totalUnits: 10,
    },
    {
      stockId: 'demo-stock-4',
      itemName: 'Puromycin dihydrochloride (10 mg/mL)',
      vendor: 'InvivoGen',
      productBarcode: 'ant-pr-1',
      unitsPerScan: 1,
      unitsRemaining: 2,
      unitLabel: 'vials',
      lowAtCount: 3,
      totalUnits: 5,
    },
  ],
  recentPurchases: [
    {
      purchaseItemId: 'demo-po-1',
      name: 'Lipofectamine 3000 Transfection Kit',
      vendor: 'Invitrogen',
      orderedDate: yesterdayStr,
      catalog: 'L3000001',
    },
    {
      purchaseItemId: 'demo-po-2',
      name: 'Pierce BCA Protein Assay Kit',
      vendor: 'Thermo Fisher',
      orderedDate: yesterdayStr,
      catalog: '23225',
    },
  ],
  barcodeIndex: {},
  items: [],
};

// ---------------------------------------------------------------------------
// Notebooks snapshot fixture (name = "notebooks")
// ---------------------------------------------------------------------------

// The destination list the capture chooser routes into. Typed structurally to
// the raw snapshot shape fetchNotebooks (lib/notebooks.ts) decodes, so demo mode
// shows real destinations to pick instead of an empty chooser. Tone matches the
// demo lab (HEK293 / GFP / p53 work above).
export const DEMO_NOTEBOOKS_SNAPSHOT: {
  generatedAt: string;
  notebooks: Array<{
    noteId: number;
    owner: string;
    title: string;
    isRunningLog: boolean;
    kind: 'own' | 'shared' | 'oneOnOne';
    entries: Array<{ id: string; title: string; date: string }>;
    lastEditedEntryId: string | null;
    partnerUsername: string | null;
    isLabHead: boolean | null;
  }>;
} = {
  generatedAt: NOW_ISO,
  notebooks: [
    {
      noteId: 1,
      owner: 'you',
      title: 'Lab Notes',
      isRunningLog: true,
      kind: 'own',
      entries: [
        { id: 'demo-nb1-e1', title: 'HEK293 passage 18 split', date: todayStr },
        { id: 'demo-nb1-e2', title: 'Plate 4 imaging setup', date: todayStr },
      ],
      lastEditedEntryId: 'demo-nb1-e2',
      partnerUsername: null,
      isLabHead: null,
    },
    {
      noteId: 2,
      owner: 'you',
      title: 'fakeGFP expression (chapter 2)',
      isRunningLog: false,
      kind: 'own',
      entries: [
        { id: 'demo-nb2-e1', title: 'Cq tightening with ACT1 reference', date: todayStr },
      ],
      lastEditedEntryId: 'demo-nb2-e1',
      partnerUsername: null,
      isLabHead: null,
    },
    {
      noteId: 3,
      owner: 'mira',
      title: 'Results',
      isRunningLog: false,
      kind: 'shared',
      entries: [
        { id: 'demo-nb3-e1', title: 'p53 western, lysate batch 3', date: yesterdayStr },
      ],
      lastEditedEntryId: 'demo-nb3-e1',
      partnerUsername: 'mira',
      isLabHead: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// Demo capture seeding (called idempotently from the Notebook tab)
// ---------------------------------------------------------------------------

// AsyncStorage key used to guard against re-seeding on every demo session entry.
export const DEMO_SEED_KEY = 'researchos.demo.captures_seeded.v1';

// A stable placeholder image uri. This is a data: uri so it works without any
// bundled asset: a 1x1 sky-blue PNG encoded as base64. The Notebook outbox
// will show the tiny thumbnail; that is fine for a reviewer demo.
export const DEMO_IMAGE_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// Demo notification copy (locked decision 2)
// ---------------------------------------------------------------------------

export const DEMO_NOTIFICATION_TITLE = 'Demo Lab';
export const DEMO_NOTIFICATION_BODY =
  'Trypsin incubation timer finished. Your cells are ready to split. (Sample notification from Demo Lab)';

// AsyncStorage key to guard firing at most once per demo session.
export const DEMO_NOTIF_FIRED_KEY = 'researchos.demo.notif_fired.v1';

// ---------------------------------------------------------------------------
// Notifications snapshot fixture (name = "notifications")
// ---------------------------------------------------------------------------
//
// Sample phone-routed notifications so the Notifications screen shows real rows
// in demo mode. Times are anchored off NOW_ISO so the relative labels read as
// recent. Categories match the laptop's notificationCategory output.

const oneHourAgo = new Date(Date.parse(NOW_ISO) - 60 * 60 * 1000).toISOString();
const threeHoursAgo = new Date(
  Date.parse(NOW_ISO) - 3 * 60 * 60 * 1000,
).toISOString();
const yesterdayIso = new Date(
  Date.parse(NOW_ISO) - 26 * 60 * 60 * 1000,
).toISOString();

export const DEMO_NOTIFICATIONS_SNAPSHOT: NotificationsSnapshot = {
  generatedAt: NOW_ISO,
  notifications: [
    {
      id: 'demo-notif-1',
      category: 'shared',
      title: 'Shared with you',
      body: 'Wei shared the experiment "KO clone B7 validation" with you.',
      createdAt: oneHourAgo,
      read: false,
    },
    {
      id: 'demo-notif-2',
      category: 'reminders',
      title: 'Reminder',
      body: 'Western blot for p53 is scheduled to start in two days.',
      createdAt: threeHoursAgo,
      read: false,
    },
    {
      id: 'demo-notif-3',
      category: 'shared',
      title: 'Shared with you',
      body: 'Mateo shared the method "Trypsin passage protocol" with you.',
      createdAt: yesterdayIso,
      read: true,
    },
  ],
};
