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

// A sample lab floor plan (vector) so the demo Room map shows a real plan under
// the pins. Mirrors frontend sample-floorplan.ts; freezer bank upper-left, cold
// storage lower-right (matching the demo pins).
const SAMPLE_FLOORPLAN_SVG = `<svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">
  <rect x="5" y="5" width="290" height="190" rx="4" fill="#ffffff" stroke="#94a3b8" stroke-width="2.5"/>
  <path d="M132 195 A36 36 0 0 1 168 195" fill="none" stroke="#cbd5e1" stroke-width="1.4"/>
  <rect x="20" y="26" width="92" height="46" rx="3" fill="#e7f0fb" stroke="#94a3b8" stroke-width="1.6"/>
  <line x1="51" y1="26" x2="51" y2="72" stroke="#94a3b8" stroke-width="1"/>
  <line x1="82" y1="26" x2="82" y2="72" stroke="#94a3b8" stroke-width="1"/>
  <text x="66" y="19" font-size="9" fill="#475569" text-anchor="middle">Freezer bank</text>
  <rect x="196" y="22" width="84" height="26" rx="2" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="238" y="39" font-size="9" fill="#475569" text-anchor="middle">Fume hood</text>
  <rect x="96" y="92" width="108" height="34" rx="3" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.6"/>
  <line x1="150" y1="92" x2="150" y2="126" stroke="#cbd5e1" stroke-width="1"/>
  <text x="150" y="113" font-size="9" fill="#475569" text-anchor="middle">Bench</text>
  <rect x="14" y="120" width="30" height="42" rx="2" fill="#eff6ff" stroke="#94a3b8" stroke-width="1.4"/>
  <circle cx="29" cy="141" r="6" fill="none" stroke="#94a3b8" stroke-width="1.2"/>
  <text x="29" y="174" font-size="8" fill="#475569" text-anchor="middle">Sink</text>
  <rect x="214" y="104" width="66" height="60" rx="3" fill="#e7f0fb" stroke="#94a3b8" stroke-width="1.6"/>
  <text x="247" y="100" font-size="9" fill="#475569" text-anchor="middle">Cold storage</text>
</svg>`;

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
      // Experiment-typed task: drives the active-experiments band (Home hub +
      // Today panel). Carries a linked method so the band card shows it.
      id: '9001',
      owner: 'you',
      name: 'fakeGFP expression (chapter 2)',
      start_date: yesterdayStr,
      end_date: twoDaysOutStr,
      task_type: 'experiment',
      projectName: 'GFP reporter library',
      linkedMethodName: 'Colony PCR, GoTaq',
      linkedMethodType: 'pcr',
      linkedMethodCount: 3,
      linkedMethods: [
        { name: 'Colony PCR, GoTaq', methodType: 'pcr' },
        { name: 'Plasmid miniprep', methodType: 'extract' },
        { name: 'Agarose gel electrophoresis', methodType: 'markdown' },
      ],
    },
    {
      id: '9002',
      owner: 'you',
      name: 'Split HEK293 cells (passage 18)',
      start_date: todayStr,
      end_date: todayStr,
      task_type: 'Cell culture',
      linkedMethodName: 'HEK293 passaging (1:6 split)',
      linkedMethodType: 'cell-culture',
      linkedMethodCount: 1,
      linkedMethods: [
        { name: 'HEK293 passaging (1:6 split)', methodType: 'cell-culture' },
      ],
    },
    {
      id: '9003',
      owner: 'you',
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
      id: '9004',
      owner: 'you',
      name: 'qPCR validation of KO clone B7',
      start_date: yesterdayStr,
      end_date: yesterdayStr,
      task_type: 'PCR',
      linkedMethodName: 'qPCR validation, SYBR Green',
      linkedMethodType: 'pcr',
      linkedMethodCount: 2,
      linkedMethods: [
        { name: 'qPCR validation, SYBR Green', methodType: 'pcr' },
        { name: 'Relative quantification (ddCt)', methodType: 'markdown' },
      ],
    },
  ],
  upcomingTasks: [
    {
      id: '9005',
      owner: 'you',
      name: 'Western blot for p53 (lysate batch 3)',
      start_date: twoDaysOutStr,
      end_date: twoDaysOutStr,
      task_type: 'Protein analysis',
      linkedMethodName: 'Western blot, wet transfer',
      linkedMethodType: 'protein',
      linkedMethodCount: 1,
      linkedMethods: [
        { name: 'Western blot, wet transfer', methodType: 'protein' },
      ],
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
      unitLabel: 'bottle',
      lowAtCount: 2,
      totalUnits: 6,
      location: 'Cold room, shelf B2',
    },
    {
      stockId: 'demo-stock-2',
      itemName: 'Fetal bovine serum (heat-inactivated)',
      vendor: 'Sigma-Aldrich',
      productBarcode: 'F4135',
      unitsPerScan: 1,
      unitsRemaining: 1,
      unitLabel: 'bottle',
      lowAtCount: 2,
      totalUnits: 4,
      location: '-20 freezer, door rack',
    },
    {
      stockId: 'demo-stock-3',
      itemName: 'Trypsin-EDTA 0.25%',
      vendor: 'Gibco',
      // A valid UPC-A so the GTIN-normalized match is demoable: scanning or
      // typing its EAN-13 form (0036000291452) still resolves to this stock.
      productBarcode: '036000291452',
      unitsPerScan: 1,
      unitsRemaining: 5,
      unitLabel: 'vial',
      lowAtCount: 2,
      totalUnits: 10,
      location: '-80 door, left',
    },
    {
      stockId: 'demo-stock-4',
      itemName: 'Puromycin dihydrochloride (10 mg/mL)',
      vendor: 'InvivoGen',
      productBarcode: 'ant-pr-1',
      unitsPerScan: 1,
      unitsRemaining: 2,
      unitLabel: 'vial',
      lowAtCount: 3,
      totalUnits: 5,
      locationPath: '-80 #2 > Rack 1 > Box: Selection antibiotics - B4',
      locationNodeId: 3,
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
  // A small storage tree so the scan-in structured location picker is demoable:
  // a freezer with a rack + 9x9 box, and a fridge with a shelf.
  storageNodes: [
    { id: 1, name: '-80 #2', kind: 'freezer', parentId: null },
    { id: 2, name: 'Rack 1', kind: 'rack', parentId: 1 },
    { id: 3, name: 'Box: Selection antibiotics', kind: 'box', parentId: 2, boxRows: 9, boxCols: 9 },
    { id: 4, name: '4 C fridge', kind: 'fridge', parentId: null },
    { id: 5, name: 'Shelf 2', kind: 'shelf', parentId: 4 },
  ],
  // A small room map so the phone viewer + "find on map" are demoable: the -80
  // and the fridge pinned on the floor plan.
  labMap: {
    aspect: 1.5,
    imageSvg: SAMPLE_FLOORPLAN_SVG,
    pins: [
      { nodeId: 1, label: null, x: 0.26, y: 0.32 },
      { nodeId: 4, label: null, x: 0.68, y: 0.62 },
    ],
  },
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

// ---------------------------------------------------------------------------
// Experiment notes/results read fixture (name = "experiment-notes")
// Read-only pull of the focused experiment's notes.md / results.md, for the
// experiment hub's read view. Markdown is rendered by MarkdownLite.
// ---------------------------------------------------------------------------
export const DEMO_EXPERIMENT_NOTES = {
  taskId: 9001,
  owner: 'you',
  experimentName: 'fakeGFP expression (chapter 2)',
  notes: {
    markdown: [
      '# Lab notes',
      '',
      '## Day 1 - colony pick',
      'Picked 8 colonies from the GoTaq plate into 5 mL LB + amp.',
      'Grew overnight at 37 C, 220 rpm.',
      '',
      '## Day 2 - miniprep',
      'Mini-prepped all 8. A260/A280 between 1.85 and 1.92 for every sample.',
      '',
      '- Tube 3 yield was low (re-elute next time)',
      '- Tubes 5 and 7 looked best',
    ].join('\n'),
  },
  results: {
    markdown: [
      '# Results',
      '',
      'Gel of the colony PCR, lanes 1 to 8. Expected band at 1.2 kb.',
      '',
      'Clones 5 and 7 show the correct insert; clone 3 is empty vector.',
    ].join('\n'),
  },
  generatedAt: yesterdayIso,
};
