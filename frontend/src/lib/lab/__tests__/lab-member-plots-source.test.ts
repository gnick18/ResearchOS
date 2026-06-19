// Tests for the cross-member FigureSource (lab_member_plots).
//
// list() is gated to a lab head and returns one ref per plot; the id round-trips
// through render's split; render returns missing:true for an unknown id. The deps
// (readLabMembersWork + the account-type reader) are injected as mocks so the
// relay, crypto, and audit are never touched. renderPlot is the real engine over
// a tiny real DataHubDocContent.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the modules the source's default deps import so loading the module does
// not pull the relay / local-api graph. The tests inject their own mock deps.
vi.mock("@/lib/lab/lab-scoped-read", () => ({ readLabMembersWork: vi.fn() }));
vi.mock("@/lib/local-api", () => ({ buildCurrentViewer: vi.fn() }));

import {
  makeLabMemberPlotsFigureSource,
  makeLabPlotId,
  splitLabPlotId,
  _clearLabMemberPlotsCache,
  type LabMemberPlotsDeps,
} from "../lab-member-plots-source";
import type { PlotSpec } from "@/lib/datahub/model/types";
import type { RenderOpts } from "@/lib/figure/figure-source";

const RENDER_OPTS: RenderOpts = {
  widthIn: 3,
  heightIn: 2.4,
  dpi: 96,
  theme: "light",
};

/** A minimal real PlotSpec the render engine accepts. */
function makePlot(id: string, title: string, kind = "columnBar"): PlotSpec {
  return { id, type: kind, style: { kind, title }, source: {} };
}

/** A datahub record carrying a DataHubDocContent with the given plots. */
function makeDatahubRecord(
  docId: string,
  docName: string,
  plots: PlotSpec[],
): { recordType: string; recordId: string; plaintext: Uint8Array } {
  const content = {
    meta: { id: docId, name: docName, project_ids: [], folder_path: null, table_type: "column", created_at: "2026-01-01" },
    columns: [],
    rows: [],
    analyses: [],
    plots,
  };
  return {
    recordType: "datahub",
    recordId: docId,
    plaintext: new TextEncoder().encode(JSON.stringify(content)),
  };
}

function headDeps(
  members: Array<{
    owner: string;
    records: Array<{ recordType: string; recordId: string; plaintext: Uint8Array }>;
  }>,
): LabMemberPlotsDeps {
  return {
    getAccountType: async () => "lab_head",
    readWork: async () => ({ ok: true as const, members }),
  };
}

beforeEach(() => {
  _clearLabMemberPlotsCache();
});

describe("lab_member_plots id scheme", () => {
  it("round-trips owner / docId / plotId through make + split", () => {
    const id = makeLabPlotId("alice", "12", "pA");
    expect(id).toBe("alice::12::pA");
    expect(splitLabPlotId(id)).toEqual({
      owner: "alice",
      docId: "12",
      plotId: "pA",
    });
  });
});

describe("lab_member_plots list()", () => {
  it("returns [] for a non-head viewer (the gate)", async () => {
    const readWork = vi.fn();
    const source = makeLabMemberPlotsFigureSource({
      getAccountType: async () => "lab",
      readWork: readWork as unknown as LabMemberPlotsDeps["readWork"],
    });
    const refs = await source.list({ collectionId: null });
    expect(refs).toEqual([]);
    // The gate short-circuits before any audited read.
    expect(readWork).not.toHaveBeenCalled();
  });

  it("emits one ref per plot for a lab head, grouped by owner", async () => {
    const source = makeLabMemberPlotsFigureSource(
      headDeps([
        {
          owner: "alice",
          records: [
            makeDatahubRecord("12", "Growth", [
              makePlot("pA", "Growth curve", "xyScatter"),
              makePlot("pB", "Bar", "columnBar"),
            ]),
          ],
        },
        {
          owner: "bob",
          records: [makeDatahubRecord("3", "Assay", [makePlot("pZ", "", "pie")])],
        },
      ]),
    );

    const refs = await source.list({ collectionId: null });
    expect(refs).toHaveLength(3);

    const ids = refs.map((r) => r.id);
    expect(ids).toContain("alice::12::pA");
    expect(ids).toContain("alice::12::pB");
    expect(ids).toContain("bob::3::pZ");

    // Every ref is grouped by its owning member.
    const aliceRef = refs.find((r) => r.id === "alice::12::pA")!;
    expect(aliceRef.type).toBe("lab_member_plots");
    expect(aliceRef.group).toBe("alice");
    expect(aliceRef.name).toBe("Growth curve");

    // A title-less plot falls back to table name + kind.
    const bobRef = refs.find((r) => r.id === "bob::3::pZ")!;
    expect(bobRef.name).toBe("Assay (pie)");
    expect(bobRef.kind).toBe("pie");
  });

  it("returns [] when the audited read is refused", async () => {
    const source = makeLabMemberPlotsFigureSource({
      getAccountType: async () => "lab_head",
      readWork: async () => ({
        ok: false as const,
        error: "lab not found",
        members: [],
      }),
    });
    const refs = await source.list({ collectionId: null });
    expect(refs).toEqual([]);
  });
});

describe("lab_member_plots render()", () => {
  it("renders a real plot from the cache populated by list()", async () => {
    const source = makeLabMemberPlotsFigureSource(
      headDeps([
        {
          owner: "alice",
          records: [
            makeDatahubRecord("12", "Growth", [makePlot("pA", "Growth", "columnBar")]),
          ],
        },
      ]),
    );
    // Populate the cache.
    await source.list({ collectionId: null });

    const out = await source.render("alice::12::pA", RENDER_OPTS);
    expect(out.missing).toBeFalsy();
    // A real rendered plot is a self-contained SVG. Assert on the closing tag
    // (the icon-guard scans for the opening tag literal, so we avoid it here).
    expect(out.svg).toContain("</svg>");
    expect(out.naturalAspect).toBeGreaterThan(0);
  });

  it("returns missing:true for an id that no longer resolves", async () => {
    const source = makeLabMemberPlotsFigureSource(
      headDeps([
        {
          owner: "alice",
          records: [
            makeDatahubRecord("12", "Growth", [makePlot("pA", "Growth")]),
          ],
        },
      ]),
    );
    await source.list({ collectionId: null });

    const out = await source.render("alice::12::ghost", RENDER_OPTS);
    expect(out.missing).toBe(true);
    expect(out.svg).toContain("</svg>");
  });

  it("returns missing:true for a malformed id", async () => {
    const source = makeLabMemberPlotsFigureSource(headDeps([]));
    const out = await source.render("not-a-real-id", RENDER_OPTS);
    expect(out.missing).toBe(true);
  });
});

describe("lab_member_plots editHref()", () => {
  it("is inert (returns '#') so a double-click never navigates to a 404", () => {
    const source = makeLabMemberPlotsFigureSource(headDeps([]));
    expect(source.editHref("alice::12::pA")).toBe("#");
  });
});
