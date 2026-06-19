// Seed a synthetic member's work into the LIVE lab mirror.
//
// This is the committable counterpart of the in-memory round-trip proven by
// src/lib/lab/__tests__/lab-head-copilot-e2e.test.ts. That test seeds a rich
// LabWorkSource, enumerates it, splits by size, pushes the light set through
// syncLabWorkToMirror, and pushes the per-member index through pushLabIndex,
// all against an in-memory relay double with real lab-key crypto. Here we do
// the EXACT same push sequence but against the LIVE relay (the default fetch)
// and sign with the head's real keys, so a PI can open /lab-overview and watch
// BeakerBot answer with real numbers without standing up a second browser.
//
// buildSyntheticMemberSource is the single source of truth for the rich
// fixtures. The e2e test imports it for its "emile" member, so the numbers the
// test asserts (lab_pulse experiments 3 / done 1 / overdue 1, spend placed
// includes 250 + 40, three deposits with two DOIs and one version history, a
// real unpairedTTest that reproduces, one plot pl-1, and so on) are exactly the
// numbers a live PI will see after seeding.
//
// IMPORTANT relay behavior. The relay accepts a push for a member's owner prefix
// signed by the HEAD because the head is a roster member; the relay does not
// enforce signer == owner. So signing with the head's keys while owner is the
// synthetic member's username is correct and intended.
//
// No emojis, no em-dashes, no mid-sentence colons.

import {
  enumerateLabWork,
  type LabWorkSource,
  type OwnedRecord,
} from "../lab-work-enumerate";
import { syncLabWorkToMirror } from "../lab-sync";
import { splitBySize, buildLabIndex, pushLabIndex } from "../lab-index";
import { putLabRecord } from "../lab-data-client";
import { runAnalysis } from "@/lib/datahub/run-analysis";
import type {
  AnalysisSpec,
  DataHubDocContent,
  DataHubDocument,
  PlotSpec,
} from "@/lib/datahub/model/types";

// ---------------------------------------------------------------------------
// Seed dates relative to "now". The lab-head tools read updated_at / created_at
// and compare against new Date() at call time, so recent records anchor to
// today and overdue / expired records sit well in the past / future.
// ---------------------------------------------------------------------------

const NOW = new Date();
function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
function isoDaysAhead(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

// The funding account id that ties a purchase (and, in the test harness, a
// grant breakdown) to one grant. Exported so the e2e test reuses the exact id.
export const SYNTHETIC_GRANT_ID = 7;

// ---------------------------------------------------------------------------
// A real DataHub table + a real cached analysis (for reproduce_member_result).
//
// Control / Drug A, 6 replicates each. We compute the genuine runAnalysis output
// here and store it as the analysis resultCache, so the PI re-running the same
// runAnalysis on the decrypted table reproduces it within tolerance (a true
// MATCH, not a parsed-only verdict). One PlotSpec points at the analysis.
// ---------------------------------------------------------------------------

const DH_META: DataHubDocument = {
  id: "dh-emile-1",
  name: "Cell viability assay",
  project_ids: [],
  folder_path: null,
  table_type: "column",
  created_at: isoDaysAgo(3),
  updated_at: isoDaysAgo(2),
} as DataHubDocument;

const CONTROL = [98, 102, 95, 105, 100, 99];
const DRUG_A = [78, 82, 75, 80, 85, 79];

function datahubContentWithRealCache(): DataHubDocContent {
  const columns = [
    { id: "col-1", name: "Control", role: "y" as const, dataType: "number" as const },
    { id: "col-2", name: "Drug A", role: "y" as const, dataType: "number" as const },
  ];
  const rows = Array.from({ length: 6 }, (_, r) => ({
    id: `row-${r + 1}`,
    cells: { "col-1": CONTROL[r], "col-2": DRUG_A[r] } as Record<string, number>,
  }));

  const spec: AnalysisSpec = {
    id: "an-ttest-1",
    type: "unpairedTTest",
    params: {},
    inputs: { columnIds: ["col-1", "col-2"] },
    resultCache: null,
    resultStale: false,
  };

  const baseContent: DataHubDocContent = {
    meta: DH_META,
    columns,
    rows,
    analyses: [spec],
    plots: [],
  };

  // Compute the genuine engine result and store it as the cache, so the PI's
  // re-run reproduces it exactly. This is what makes the match REAL.
  const outcome = runAnalysis(spec, baseContent);
  if (!outcome.ok) {
    throw new Error(`seed analysis failed to compute: ${outcome.error}`);
  }
  const specWithCache: AnalysisSpec = { ...spec, resultCache: outcome };

  const plot: PlotSpec = {
    id: "pl-1",
    type: "columnBar",
    style: { kind: "columnBar", title: "Control vs Drug A" },
    source: { analysisId: "an-ttest-1", columnIds: ["col-1", "col-2"] },
  };

  return {
    meta: DH_META,
    columns,
    rows,
    analyses: [specWithCache],
    plots: [plot],
  };
}

// ---------------------------------------------------------------------------
// buildSyntheticMemberSource: the FULL LabWorkSource (all 21 methods). The
// mentorship / check-in / announcement methods return [] so enumerateLabWork
// resolves; the rest carry realistic records for every read tool to chew on.
//
// The `owner` parameter is threaded through so every record belongs to the
// caller's member; the record VALUES themselves do not embed the owner (the
// enumerator keys each object by labId/owner/recordType/recordId from the push
// arguments, not from the record body), so parameterizing on owner is a no-op
// on the values but keeps the contract explicit and future proof.
// ---------------------------------------------------------------------------

export function buildSyntheticMemberSource(owner: string): LabWorkSource {
  // owner is intentionally referenced so the signature stays a function of it;
  // the record bodies are owner-agnostic (the key carries the owner).
  void owner;

  const none = async (): Promise<OwnedRecord[]> => [];

  return {
    // Tasks (and three experiments). project_id 100 is grant-tagged via the
    // purchase direct link below; the read tools key off the purchase, not a
    // project record (the enumerator yields no "project" type).
    listTasks: async () => [
      // A grant-tagged task, recent.
      {
        id: 1,
        name: "Run PCR plate",
        task_type: "task",
        status: "todo",
        project_id: 100,
        created_at: isoDaysAgo(2),
        updated_at: isoDaysAgo(2),
      },
      // A done task, recent.
      {
        id: 2,
        name: "Gel imaging",
        task_type: "task",
        status: "done",
        created_at: isoDaysAgo(40),
        updated_at: isoDaysAgo(3),
      },
      // An overdue task (due in the past, not done).
      {
        id: 3,
        name: "Order primers",
        task_type: "task",
        status: "todo",
        due_date: isoDaysAgo(5),
        created_at: isoDaysAgo(10),
        updated_at: isoDaysAgo(4),
      },
      // A stalled task (no activity in a long time).
      {
        id: 4,
        name: "Old cloning plan",
        task_type: "task",
        status: "todo",
        created_at: isoDaysAgo(120),
        updated_at: isoDaysAgo(90),
      },
      // An experiment with a protocol attachment carrying an override (drives
      // method_drift) that references method id 50 (in the library).
      {
        id: 5,
        name: "qPCR run A",
        task_type: "experiment",
        status: "todo",
        created_at: isoDaysAgo(3),
        updated_at: isoDaysAgo(1),
        method_attachments: [
          { method_id: 50, owner: null, pcr_gradient: "60-64C" },
        ],
      },
      // An experiment with a protocol referencing a method NOT in the library
      // (drives protocol_gaps -> protocol_not_in_library).
      {
        id: 6,
        name: "qPCR run B",
        task_type: "experiment",
        status: "todo",
        created_at: isoDaysAgo(3),
        updated_at: isoDaysAgo(2),
        method_attachments: [{ method_id: 999, owner: null }],
      },
      // An experiment with NO protocol (drives protocol_gaps ->
      // no_protocol_attached).
      {
        id: 7,
        name: "Bare experiment",
        task_type: "experiment",
        status: "todo",
        created_at: isoDaysAgo(3),
        updated_at: isoDaysAgo(2),
      },
    ],

    listNotes: async () => [
      {
        id: 11,
        title: "Lab note 1",
        note_kind: "note",
        created_at: isoDaysAgo(2),
        updated_at: isoDaysAgo(2),
      },
      {
        id: 12,
        title: "Lab note 2",
        note_kind: "note",
        created_at: isoDaysAgo(5),
        updated_at: isoDaysAgo(5),
      },
    ],

    // Methods: a parent + a child variant (parent grouping for method_drift);
    // method 50 is the one referenced by the experiment attachment above.
    listMethods: async () => [
      {
        id: 50,
        name: "qPCR protocol",
        method_type: "pcr",
        parent_method_id: null,
        tags: ["qpcr", "manuscript"],
        source_path: "https://example.org/qpcr",
        created_at: isoDaysAgo(20),
        updated_at: isoDaysAgo(10),
      },
      {
        id: 51,
        name: "qPCR protocol v2",
        method_type: "pcr",
        parent_method_id: 50,
        tags: ["qpcr"],
        created_at: isoDaysAgo(15),
        updated_at: isoDaysAgo(9),
      },
    ],

    // Purchases: one placed (ordered) tied to the grant, one pending
    // (needs_ordering). total_price drives spend_summary; order_status drives
    // the placed vs pending split and reorder_digest.
    listPurchases: async () => [
      {
        id: 21,
        item_name: "Taq polymerase",
        vendor: "NEB",
        total_price: 250,
        order_status: "ordered",
        funding_account_id: SYNTHETIC_GRANT_ID,
        created_at: isoDaysAgo(10),
        updated_at: isoDaysAgo(10),
      },
      {
        id: 22,
        item_name: "PCR tubes",
        vendor: "Eppendorf",
        total_price: 40,
        order_status: "needs_ordering",
        created_at: isoDaysAgo(2),
        updated_at: isoDaysAgo(2),
      },
    ],

    // Inventory items with low_at_count thresholds.
    listInventory: async () => [
      { id: 30, name: "dNTP mix", vendor: "NEB", low_at_count: 5 },
      { id: 31, name: "Agarose", vendor: "Sigma", low_at_count: 2 },
    ],

    // Stocks. Item 30 has one empty stock (out). Item 31 has one stock expiring
    // soon, one already expired, and one with containers but no location.
    listInventoryStock: async () => [
      {
        id: 40,
        item_id: 30,
        container_count: 2,
        status: "in_stock",
        location_text: "Freezer A",
      },
      {
        id: 41,
        item_id: 30,
        container_count: 0,
        status: "empty",
        location_text: "Freezer A",
      },
      {
        id: 42,
        item_id: 31,
        container_count: 3,
        status: "in_stock",
        expiration_date: isoDaysAhead(10),
        location_text: "Shelf 2",
      },
      {
        id: 43,
        item_id: 31,
        container_count: 1,
        status: "in_stock",
        expiration_date: isoDaysAgo(5),
        location_text: "Shelf 2",
      },
      {
        id: 44,
        item_id: 31,
        container_count: 4,
        status: "in_stock",
        location_text: null,
        location_node_id: null,
      },
    ],

    // Deposits: one with a doi (zenodo), one missing a doi (figshare,
    // actionable), one with version history (version_sequence > 1).
    listDeposits: async () => [
      {
        id: "100",
        repository: "zenodo",
        title: "Genome assembly",
        doi: "10.5281/zenodo.123",
        task_id: 5,
        created_at: isoDaysAgo(20),
      },
      {
        id: "101",
        repository: "figshare",
        title: "Raw reads",
        doi: null,
        project_id: 100,
        created_at: isoDaysAgo(10),
      },
      {
        id: "102",
        repository: "zenodo",
        title: "Assembly v2",
        doi: "10.5281/zenodo.456",
        concept_doi: "10.5281/zenodo.999",
        version_sequence: 2,
        created_at: isoDaysAgo(5),
      },
    ],

    // A real DataHub doc with a real cached analysis + a plot referencing it.
    // The enumerator keys the relay object on a top-level id, so we attach one
    // (matching meta.id) alongside the full DataHubDocContent the tools parse.
    listDatahub: async () => [
      {
        id: DH_META.id,
        ...datahubContentWithRealCache(),
      } as unknown as OwnedRecord,
    ],

    // The remaining list* methods yield nothing, but must be present so
    // enumerateLabWork resolves all 21 sources.
    listSequences: none,
    listPhylo: none,
    listMolecules: none,
    listResultSheets: none,
    listNotesSheets: none,
    listOneOnOnes: none,
    listOneOnOneActionItems: none,
    listIdps: none,
    listWeeklyGoals: none,
    listCheckinCompacts: none,
    listCheckinOnboarding: none,
    listCheckinRotations: none,
    listAnnouncements: none,
  };
}

// ---------------------------------------------------------------------------
// seedSyntheticMemberWork: the live push. Same sequence the e2e test runs in
// memberPush, against the live relay (default fetch when fetchImpl is omitted),
// signing with the head's real keys. A FRESH empty manifest {} means every
// record is treated as new and pushed (no dedup against a prior run).
// ---------------------------------------------------------------------------

// Large threshold so nothing is held back as "heavy"; the synthetic records are
// all small, so this keeps the live behavior identical to the e2e harness.
const THRESHOLD = 1_000_000;

export async function seedSyntheticMemberWork(params: {
  labId: string;
  owner: string;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const { labId, owner, labKey, signerEd25519Priv, signerEd25519Pub, fetchImpl } =
    params;

  const records = await enumerateLabWork({
    owner,
    source: buildSyntheticMemberSource(owner),
  });
  const { light, heavy } = splitBySize(records, THRESHOLD);

  // Push the light set, encrypted under the lab key and signed by the head.
  // A fresh empty manifest forces every record to push.
  await syncLabWorkToMirror({
    labId,
    owner,
    records: light,
    labKey,
    signerEd25519Priv,
    signerEd25519Pub,
    manifest: {},
    tombstoneRemoved: false,
    fetchImpl,
  });

  // Push the member's index over ALL records (light + heavy), same shape the
  // e2e test passes. The putImpl forwards the live fetch so the index lands on
  // the same relay as the records.
  await pushLabIndex({
    labId,
    owner,
    index: buildLabIndex(owner, records, THRESHOLD),
    labKey,
    signerEd25519Priv,
    signerEd25519Pub,
    putImpl: (p) => putLabRecord({ ...p, fetchImpl }),
  });

  return (
    `SEED MEMBER WORK done for owner=${owner}\n` +
    `  records enumerated: ${records.length}\n` +
    `  pushed (light): ${light.length}\n` +
    `  held (heavy, not pushed): ${heavy.length}\n` +
    `  index pushed: yes\n` +
    `  Next: F. Make me a lab head -> reload -> open /lab-overview and ask BeakerBot.`
  );
}
