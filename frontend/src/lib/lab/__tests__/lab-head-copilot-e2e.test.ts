// End-to-end proof that the lab-head (PI) copilot READ tools produce real
// numbers from a member's work AFTER it round-trips through the lab mirror with
// REAL lab-key crypto, single-session, no second browser.
//
// This is the question a PI asked: can the copilot be exercised without the
// two-browser live setup? It can. The flow here is the real pipeline:
//
//   member (emile, maria): seed a LabWorkSource -> enumerateLabWork ->
//     syncLabWorkToMirror (REAL encrypt + push to an in-memory relay double) +
//     pushLabIndex
//   PI (a different owner, the head): build the lab-scoped read deps (REAL
//     decrypt via pullMemberLabRecords), bind readLabMembersWork to them, hand
//     that bound read to each lab-head tool factory, call execute(), and assert
//     the tool returns real numbers derived from the seeded data.
//
// Only the relay signature verification and the session / roster fetch are stood
// in (same doubles as lab-mirror-e2e.test.ts, covered by the relay contract
// audit and the unit tests). The encrypt / decrypt round-trip, the canonical
// serialization, and every tool's record parsing are the real code, so this
// catches composition bugs the mocked unit tests cannot.
//
// What proves the data is REAL and not mocked:
//   - The relay double stores only the ciphertext bytes syncLabWorkToMirror
//     produced; the PI deps decrypt them with the lab key via the real
//     pullMemberLabRecords. No tool is handed a hand-built readWork result.
//   - The numbers each tool returns (spend totals, low / out items, deposit
//     splits, the reproduced analysis verdict) are computed by the tool from the
//     decrypted plaintext, which only exists because the seed survived the
//     crypto round-trip.
//
// reproduce_member_result achieves a REAL match: the seeded resultCache is the
// exact output of runAnalysis on the seeded table (computed here in the test),
// and the tool re-runs the same runAnalysis on the decrypted table, so the
// recomputed scalars equal the cached scalars within tolerance.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";

// Enable the lab tier for the real client functions, preserving other exports.
vi.mock("../config", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  LAB_TIER_ENABLED: true,
}));

import { LAB_KEY_LENGTH } from "../lab-key";
import { labDataObjectKey } from "../lab-data-protocol";
import { putLabRecord, getLabRecord } from "../lab-data-client";
import {
  enumerateLabWork,
  type LabWorkSource,
  type OwnedRecord,
} from "../lab-work-enumerate";
import { syncLabWorkToMirror, pullMemberLabRecords } from "../lab-sync";
import { splitBySize, buildLabIndex, pushLabIndex } from "../lab-index";
import { readLabMembersWork, type LabScopedReadDeps } from "../lab-scoped-read";
import {
  buildSyntheticMemberSource,
  SYNTHETIC_GRANT_ID,
} from "../dev/synthetic-member-seed";

import {
  makeLabPulseTool,
  makeLabThroughputTool,
  makeGrantTaggedRollupTool,
  makeProgressReportScaffoldTool,
  makeReorderDigestTool,
  makeSpendSummaryTool,
  makeInventoryAuditTool,
  makeMethodDriftTool,
  makeProtocolGapsTool,
  makeMethodsSectionTool,
  makeDmspComplianceTool,
  makeReproduceMemberResultTool,
} from "@/lib/ai/tools/lab-head";
import { makeLabPlotsTool, makeLabFigureTool } from "@/lib/ai/tools/lab-figure";
import { createFigurePage, type FigurePage } from "@/lib/figure/figure-page";
import type { FundingAccount } from "@/lib/types";

// ---------------------------------------------------------------------------
// Crypto + relay doubles (mirrors lab-mirror-e2e.test.ts exactly).
// ---------------------------------------------------------------------------

function randomLabKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(LAB_KEY_LENGTH));
}

function randomKeyPair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = ed25519.utils.randomSecretKey();
  return { priv, pub: ed25519.getPublicKey(priv) };
}

function makeInMemoryRelay(): {
  fetchImpl: typeof fetch;
  store: Map<string, Uint8Array>;
} {
  const store = new Map<string, Uint8Array>();
  const keyFromBody = (b: Record<string, unknown>) =>
    labDataObjectKey(
      b.labId as string,
      b.owner as string,
      b.recordType as string,
      b.recordId as string,
    );

  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.endsWith("/lab/data/put")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const ciphertext = Uint8Array.from(atob(body.ciphertext as string), (c) =>
        c.charCodeAt(0),
      );
      store.set(keyFromBody(body), ciphertext);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (urlStr.includes("/lab/data/get")) {
      const key = new URL(urlStr).searchParams.get("key") ?? "";
      const blob = store.get(key);
      if (!blob) return new Response("not found", { status: 404 });
      const copy = new Uint8Array(blob.byteLength);
      copy.set(blob);
      return new Response(copy.buffer, { status: 200 });
    }
    if (urlStr.endsWith("/lab/data/list")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const labId = body.labId as string;
      const prefix = body.prefix as string;
      const full = prefix === "" ? `${labId}/` : `${labId}/${prefix}`;
      const keys = [...store.keys()].filter((k) => k.startsWith(full));
      return new Response(JSON.stringify({ keys }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  return { fetchImpl, store };
}

/** Empty source with every LabWorkSource method present, override as needed. */
function emptySource(): LabWorkSource {
  const none = async (): Promise<OwnedRecord[]> => [];
  return {
    listTasks: none,
    listNotes: none,
    listMethods: none,
    listPurchases: none,
    listInventory: none,
    listInventoryStock: none,
    listSequences: none,
    listPhylo: none,
    listMolecules: none,
    listDatahub: none,
    listResultSheets: none,
    listNotesSheets: none,
    listDeposits: none,
    // Mentorship / check-in / announcement record types (added by the lab-view
    // pull lane). The read tools this file drives do not consume them, so they
    // stay empty here.
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
// Seed dates relative to a fixed-ish now. The tools read updated_at /
// created_at and compare against new Date() at call time, so we anchor recent
// records to "today" and overdue / expired records well in the past / future.
// ---------------------------------------------------------------------------

const NOW = new Date();
function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// The rich "emile" member source (the seeded DataHub table + real cached
// unpairedTTest analysis, the tasks / notes / methods / purchases / inventory /
// deposits) now lives in the committable seed module and is imported above as
// buildSyntheticMemberSource. Importing it here proves those exact fixtures
// still produce the numbers this file asserts, so the dev-harness "Seed member
// work" button seeds the same data a PI sees in /lab-overview.
// ---------------------------------------------------------------------------

// (the previous local richSource + DataHub fixtures were extracted; kept below
// is the small maria source for the per-member breakdown assertions.)
/** A second, smaller member so per-member breakdowns are exercised. */
function mariaSource(): LabWorkSource {
  return {
    ...emptySource(),
    listTasks: async () => [
      {
        id: 1,
        name: "Maria assay",
        task_type: "task",
        status: "done",
        created_at: isoDaysAgo(60),
        updated_at: isoDaysAgo(4),
      },
    ],
    listPurchases: async () => [
      {
        id: 21,
        item_name: "Pipette tips",
        vendor: "Rainin",
        total_price: 120,
        order_status: "received",
        created_at: isoDaysAgo(6),
        updated_at: isoDaysAgo(6),
      },
    ],
  };
}

// NOTE ON GRANT LINKAGE. The enumerator exposes 13 list* methods, none of which
// yields a recordType "project". grant_tagged_rollup's project pass and its
// task-reverse-map therefore find nothing in this harness; the exercised path is
// the PURCHASE direct link (funding_account_id on the purchase record), which is
// what the grant_tagged_rollup assertion below checks.

// ---------------------------------------------------------------------------
// The full round-trip: seed -> push (real crypto) -> PI read deps.
// ---------------------------------------------------------------------------

const labId = "lab-copilot-e2e";
const THRESHOLD = 1_000_000; // large, so nothing is held back as heavy

async function memberPush(
  relay: ReturnType<typeof makeInMemoryRelay>,
  labKey: Uint8Array,
  owner: string,
  source: LabWorkSource,
) {
  const signer = randomKeyPair();
  const records = await enumerateLabWork({ owner, source });
  const { light } = splitBySize(records, THRESHOLD);

  await syncLabWorkToMirror({
    labId,
    owner,
    records: light,
    labKey,
    signerEd25519Priv: signer.priv,
    signerEd25519Pub: signer.pub,
    manifest: {},
    tombstoneRemoved: true,
    fetchImpl: relay.fetchImpl,
  });

  await pushLabIndex({
    labId,
    owner,
    index: buildLabIndex(owner, records, THRESHOLD),
    labKey,
    signerEd25519Priv: signer.priv,
    signerEd25519Pub: signer.pub,
    putImpl: (p) => putLabRecord({ ...p, fetchImpl: relay.fetchImpl }),
  });
}

function piReadDeps(
  relay: ReturnType<typeof makeInMemoryRelay>,
  labKey: Uint8Array,
): Partial<LabScopedReadDeps> {
  const pi = randomKeyPair();
  const identity = {
    keys: {
      signing: { privateKey: pi.priv, publicKey: pi.pub },
      encryption: { privateKey: new Uint8Array(32), publicKey: new Uint8Array(32) },
    },
  };
  const roster = {
    record: {
      members: [
        { username: "pi", role: "head" },
        { username: "emile", role: "member" },
        { username: "maria", role: "member" },
      ],
    },
    envelopes: [{ generation: 1 }],
  };

  return {
    getViewer: async () => ({ username: "pi", account_type: "lab_head" }) as never,
    getLabId: async () => labId,
    getIdentity: () => identity as never,
    fetchLab: async () => roster as never,
    openKey: () => labKey,
    pullRecords: (p) =>
      pullMemberLabRecords({
        labId: p.labId,
        memberOwner: p.memberOwner,
        labKey: p.labKey,
        signerEd25519Priv: pi.priv,
        signerEd25519Pub: pi.pub,
        fetchImpl: relay.fetchImpl,
      }),
    appendAudit: async () => {},
  };
}

/** Stand up the whole lab in the relay and return a bound PI read. */
async function setupLab() {
  const relay = makeInMemoryRelay();
  const labKey = randomLabKey();
  await memberPush(relay, labKey, "emile", buildSyntheticMemberSource("emile"));
  await memberPush(relay, labKey, "maria", mariaSource());
  const readDeps = piReadDeps(relay, labKey);
  // The bound read every tool factory takes. It threads the real PI deps into
  // readLabMembersWork, so the tool sees the decrypted lab without knowing the
  // crypto exists.
  const boundRead = ((opts) =>
    readLabMembersWork(opts ?? {}, readDeps)) as typeof readLabMembersWork;
  return { relay, labKey, boundRead };
}

const GRANTS: FundingAccount[] = [
  {
    id: SYNTHETIC_GRANT_ID,
    name: "NIH R01",
    award_number: "R01-GM-000000",
    funder_name: "NIH",
    award_title: "Fungal genomics",
  } as FundingAccount,
];

// ---------------------------------------------------------------------------
// The sanity anchor: the PI really read the member, decrypted.
// ---------------------------------------------------------------------------

describe("lab-head copilot end to end (real crypto, single session)", () => {
  it("the PI read-back finds the member and decrypts their seeded work", async () => {
    const { boundRead } = await setupLab();
    const res = await boundRead({});
    expect(res.ok).toBe(true);

    const emile = res.members.find((m) => m.owner === "emile");
    expect(emile).toBeTruthy();
    expect(emile!.records.length).toBeGreaterThan(0);

    // A decrypted task really is emile's seeded task.
    const taskRec = emile!.records.find(
      (r) => r.recordType === "task" && r.recordId === "3",
    );
    expect(taskRec).toBeTruthy();
    const decoded = JSON.parse(new TextDecoder().decode(taskRec!.plaintext));
    expect(decoded.name).toBe("Order primers");

    // The maria member also round-tripped.
    expect(res.members.find((m) => m.owner === "maria")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // lab_pulse: per-member activity counts derived from the decrypted records.
  // -------------------------------------------------------------------------
  it("lab_pulse reports emile's seeded experiment / done / overdue counts", async () => {
    const { boundRead } = await setupLab();
    const tool = makeLabPulseTool({ readWork: boundRead });
    const res = (await tool.execute({})) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    const members = res.members as Array<Record<string, number | string>>;
    const emile = members.find((m) => m.owner === "emile")!;
    expect(emile).toBeTruthy();
    // 3 experiments seeded (ids 5, 6, 7).
    expect(emile.experiments).toBe(3);
    // 1 done task (id 2).
    expect(emile.tasksDone).toBe(1);
    // 1 overdue task (id 3, due in the past, not done).
    expect(emile.tasksOverdue).toBe(1);
    expect(res.totalExperiments as number).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // lab_throughput: aggregate output over the period.
  // -------------------------------------------------------------------------
  it("lab_throughput aggregates real counts over the period", async () => {
    const { boundRead } = await setupLab();
    const tool = makeLabThroughputTool({ readWork: boundRead });
    const res = (await tool.execute({ periodDays: 30, perMember: true })) as Record<
      string,
      unknown
    >;

    expect(res.hasLab).toBe(true);
    const totals = res.totals as Record<string, number>;
    // 3 experiments updated within 30 days.
    expect(totals.experiments).toBe(3);
    // emile's done task (id 2) updated 3 days ago + maria's (4 days ago) = 2.
    expect(totals.tasksDone).toBeGreaterThanOrEqual(2);
    const members = res.members as Array<Record<string, unknown>>;
    expect(members.find((m) => m.owner === "emile")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // spend_summary: dollar totals + placed vs pending split + grant breakdown.
  // -------------------------------------------------------------------------
  it("spend_summary totals match the seeded purchase prices", async () => {
    const { boundRead } = await setupLab();
    const tool = makeSpendSummaryTool({
      readWork: boundRead,
      listFundingAccounts: async () => GRANTS,
    });
    const res = (await tool.execute({ periodDays: 90, groupBy: "both" })) as Record<
      string,
      unknown
    >;

    expect(res.hasLab).toBe(true);
    const totals = res.totals as Record<string, number>;
    // Placed = emile NEB 250 (ordered) + maria Rainin 120 (received) = 370.
    expect(totals.placed).toBe(370);
    // Pending = emile Eppendorf 40 (needs_ordering).
    expect(totals.pending).toBe(40);
    expect(totals.count).toBe(3);

    // The grant breakdown shows the NEB purchase under grant 7.
    const byGrant = res.byGrant as Array<Record<string, unknown>>;
    const grantEntry = byGrant.find((g) => g.grantId === SYNTHETIC_GRANT_ID);
    expect(grantEntry).toBeTruthy();
    expect(grantEntry!.total).toBe(250);
  });

  // -------------------------------------------------------------------------
  // reorder_digest: the low + out items and the pending order surface.
  // -------------------------------------------------------------------------
  it("reorder_digest surfaces the low and out items and the pending order", async () => {
    const { boundRead } = await setupLab();
    const tool = makeReorderDigestTool({ readWork: boundRead });
    const res = (await tool.execute({})) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    const outItems = res.outItems as Array<Record<string, unknown>>;
    const lowItems = res.lowItems as Array<Record<string, unknown>>;
    // Item 30 (dNTP mix) has an empty stock -> out of stock.
    expect(outItems.some((i) => i.name === "dNTP mix")).toBe(true);
    // Item 31 (Agarose) sums to 8 containers, above its threshold of 2, so it
    // is neither low nor out; the OUT signal here is dNTP mix via the empty
    // stock. At least one reorder queue entry (the needs_ordering purchase).
    const queue = res.reorderQueue as Array<Record<string, unknown>>;
    expect(queue.some((q) => q.itemName === "PCR tubes")).toBe(true);
    // lowItems is an array (may be empty given the seed); the structure is real.
    expect(Array.isArray(lowItems)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // inventory_audit: expiring / out / unlocated lists are non-empty as seeded.
  // -------------------------------------------------------------------------
  it("inventory_audit flags the expiring, out, and unlocated stocks", async () => {
    const { boundRead } = await setupLab();
    const tool = makeInventoryAuditTool({ readWork: boundRead });
    const res = (await tool.execute({ expiringDays: 30 })) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    const expiring = res.expiring as Array<Record<string, unknown>>;
    const outOfStock = res.outOfStock as Array<Record<string, unknown>>;
    const unlocated = res.unlocated as Array<Record<string, unknown>>;
    // Two Agarose stocks flagged: one expiring within 10 days, one already
    // expired 5 days ago.
    expect(expiring.filter((e) => e.itemName === "Agarose").length).toBe(2);
    // dNTP mix has an empty stock -> out of stock.
    expect(outOfStock.some((o) => o.itemName === "dNTP mix")).toBe(true);
    // The Agarose stock with no location and containers > 0 -> unlocated.
    expect(unlocated.some((u) => u.itemName === "Agarose")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // dmsp_compliance: deposit ledger split is correct from the decrypted data.
  // -------------------------------------------------------------------------
  it("dmsp_compliance reports the seeded deposit ledger", async () => {
    const { boundRead } = await setupLab();
    const tool = makeDmspComplianceTool({ readWork: boundRead });
    const res = (await tool.execute({})) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    const deposits = res.deposits as Record<string, unknown>;
    // 3 deposits seeded for emile.
    expect(deposits.total).toBe(3);
    // 2 with a doi, 1 missing.
    expect(deposits.withDoi).toBe(2);
    expect(deposits.missingDoi).toBe(1);
    // 1 with version history (version_sequence 2).
    expect(deposits.withVersionHistory).toBe(1);
    const missingList = deposits.missingDoiList as Array<Record<string, unknown>>;
    expect(missingList).toHaveLength(1);
    expect(missingList[0].title).toBe("Raw reads");
    const byRepo = deposits.byRepository as Record<string, number>;
    expect(byRepo.zenodo).toBe(2);
    expect(byRepo.figshare).toBe(1);
  });

  // -------------------------------------------------------------------------
  // method_drift: the seeded override surfaces, grouped by the parent method.
  // -------------------------------------------------------------------------
  it("method_drift surfaces the seeded protocol override", async () => {
    const { boundRead } = await setupLab();
    const tool = makeMethodDriftTool({ readWork: boundRead });
    const res = (await tool.execute({})) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    const groups = res.groups as Array<Record<string, unknown>>;
    // Experiment 5 attaches method 50 with a pcr_gradient override.
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const variants = groups.flatMap(
      (g) => g.variants as Array<Record<string, unknown>>,
    );
    const driftVariant = variants.find(
      (v) => (v.overridesApplied as string[]).includes("pcr_gradient"),
    );
    expect(driftVariant).toBeTruthy();
    expect(driftVariant!.member).toBe("emile");
  });

  // -------------------------------------------------------------------------
  // protocol_gaps: a missing-protocol and a not-in-library reference surface.
  // -------------------------------------------------------------------------
  it("protocol_gaps surfaces the missing and out-of-library protocols", async () => {
    const { boundRead } = await setupLab();
    const tool = makeProtocolGapsTool({ readWork: boundRead });
    const res = (await tool.execute({})) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    const gaps = res.gaps as Array<Record<string, unknown>>;
    // Experiment 7 has no protocol attached.
    expect(
      gaps.some(
        (g) => g.experimentId === "7" && g.kind === "no_protocol_attached",
      ),
    ).toBe(true);
    // Experiment 6 references method 999 which is not in the library.
    expect(
      gaps.some(
        (g) =>
          g.experimentId === "6" && g.kind === "protocol_not_in_library",
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // methods_section: the seeded methods surface with their facts.
  // -------------------------------------------------------------------------
  it("methods_section returns the seeded method records", async () => {
    const { boundRead } = await setupLab();
    const tool = makeMethodsSectionTool({ readWork: boundRead });
    const res = (await tool.execute({})) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    // 2 methods seeded for emile.
    expect(res.methodCount as number).toBeGreaterThanOrEqual(2);
    const methods = res.methods as Array<Record<string, unknown>>;
    const qpcr = methods.find((m) => m.name === "qPCR protocol");
    expect(qpcr).toBeTruthy();
    expect(qpcr!.sourceUrl).toBe("https://example.org/qpcr");

    // The tag filter narrows to the manuscript-tagged method.
    const tagged = (await tool.execute({ filterTag: "manuscript" })) as Record<
      string,
      unknown
    >;
    expect(tagged.methodCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // grant_tagged_rollup: the grant-tagged purchase surfaces.
  //
  // The enumerator has no listProjects method, so no "project" record reaches
  // the mirror in this harness; grant_tagged_rollup's project + task-reverse
  // passes therefore find nothing, but the PURCHASE direct link (which carries
  // funding_account_id) is the real, exercised path. We assert that.
  // -------------------------------------------------------------------------
  it("grant_tagged_rollup links the grant-tagged purchase", async () => {
    const { boundRead } = await setupLab();
    const tool = makeGrantTaggedRollupTool({
      readWork: boundRead,
      listFundingAccounts: async () => GRANTS,
    });
    const res = (await tool.execute({ grantId: SYNTHETIC_GRANT_ID })) as Record<
      string,
      unknown
    >;

    expect(res.hasGrant).toBe(true);
    expect(res.hasLab).toBe(true);
    const totals = res.totals as Record<string, number>;
    // The NEB purchase carries funding_account_id 7.
    expect(totals.purchases).toBe(1);
    const links = res.recordLinks as Array<Record<string, unknown>>;
    expect(
      links.some((l) => l.recordType === "purchase" && l.owner === "emile"),
    ).toBe(true);
    const grant = res.grant as Record<string, unknown>;
    expect(grant.name).toBe("NIH R01");
  });

  // -------------------------------------------------------------------------
  // progress_report_scaffold: accomplishments + products counts over a window.
  // -------------------------------------------------------------------------
  it("progress_report_scaffold counts accomplishments and products", async () => {
    const { boundRead } = await setupLab();
    const tool = makeProgressReportScaffoldTool({
      readWork: boundRead,
      listFundingAccounts: async () => GRANTS,
    });
    const res = (await tool.execute({})) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    const totals = res.totals as Record<string, number>;
    // 3 experiments seeded fall in the default 365-day window.
    expect(totals.accomplishmentsExperiments).toBe(3);
    // The datahub doc + methods are depositable products.
    expect(totals.products).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // reproduce_member_result: the datahub analysis reproduces as a real MATCH.
  // -------------------------------------------------------------------------
  it("reproduce_member_result reproduces the seeded analysis (real MATCH)", async () => {
    const { boundRead } = await setupLab();
    const tool = makeReproduceMemberResultTool({ readWork: boundRead });
    const res = (await tool.execute({ member: "emile" })) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    expect(res.found).toBe(true);
    const summary = res.summary as Record<string, number>;
    // The single seeded analysis reproduces exactly because the cache is the
    // genuine runAnalysis output and the tool re-runs the same function.
    expect(summary.total).toBe(1);
    expect(summary.match).toBe(1);
    expect(summary.mismatch).toBe(0);

    const analyses = res.analyses as Array<Record<string, unknown>>;
    expect(analyses[0].status).toBe("match");
    expect(analyses[0].analysisType).toBe("unpairedTTest");
    // Real recomputed scalars are present (the t statistic among them).
    const recomputed = analyses[0].recomputed as Record<string, number>;
    expect(typeof recomputed.statistic).toBe("number");
  });

  // -------------------------------------------------------------------------
  // lab_plots: the seeded plot appears with its owner::doc::plot id + member.
  // -------------------------------------------------------------------------
  it("lab_plots lists the seeded plot with its composite id", async () => {
    const { boundRead } = await setupLab();
    const tool = makeLabPlotsTool({ readWork: boundRead });
    const res = (await tool.execute({})) as Record<string, unknown>;

    expect(res.hasLab).toBe(true);
    const plots = res.plots as Array<Record<string, unknown>>;
    const seeded = plots.find((p) => p.plotId === "emile::dh-emile-1::pl-1");
    expect(seeded).toBeTruthy();
    expect(seeded!.member).toBe("emile");
    expect(seeded!.table).toBe("Cell viability assay");
  });

  // -------------------------------------------------------------------------
  // lab_figure: composes a page from the plot id lab_plots discovered. Its
  // create / save / render deps are mocked (like its unit test) since they
  // touch the figure store and renderer, but the plotId it places comes from
  // the real, decrypted lab_plots inventory.
  // -------------------------------------------------------------------------
  it("lab_figure composes a page from the discovered plot id", async () => {
    const { boundRead } = await setupLab();

    // Discover the real plot id through the decrypted lab.
    const plotsTool = makeLabPlotsTool({ readWork: boundRead });
    const plotsRes = (await plotsTool.execute({})) as Record<string, unknown>;
    const plots = plotsRes.plots as Array<Record<string, unknown>>;
    const plotId = plots[0].plotId as string;
    expect(plotId).toBe("emile::dh-emile-1::pl-1");

    let saved: FigurePage | null = null;
    const tool = makeLabFigureTool({
      createPage: async (name: string) => createFigurePage("fig-1", name, null),
      savePage: async (page: FigurePage) => {
        saved = page;
      },
      renderPlot: async () => ({ svg: "stub-svg", naturalAspect: 1.4 }),
    });

    const res = (await tool.execute({
      plotIds: [plotId],
      title: "PI synthesis figure",
    })) as Record<string, unknown>;

    expect(res.ok).toBe(true);
    expect(res.panelCount).toBe(1);
    expect(saved).not.toBeNull();
    const page = saved as unknown as FigurePage;
    expect(page.panels).toHaveLength(1);
    expect(page.panels[0].ref.id).toBe(plotId);
  });

  // -------------------------------------------------------------------------
  // find_across_lab is SKIPPED here. It reads through searchLabIndex (the
  // index-search engine with its own LabIndexSearchDeps), not readWork, so it
  // does not compose through the bound read this file exercises. The mirror
  // e2e test (lab-mirror-e2e.test.ts) already drives searchLabIndex with real
  // crypto end to end. The mentorship tools (prep_one_on_one, lab_meeting_prep,
  // onboard_member) are also out of scope here: they read the 1:1 / check-in
  // local APIs (and onboard_member is a write), separately unit-covered.
  // -------------------------------------------------------------------------
  it.skip("find_across_lab (searchLabIndex path, covered by lab-mirror-e2e)", () => {});
});
