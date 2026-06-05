import { afterEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import type { EditFeature } from "@/lib/sequences/edit-model";

// Mock the on-device byte source + engine so the panel test asserts the wiring
// (curated source -> getCuratedHmmDb -> runLocalHmmer -> parseDomtblout) without
// downloading or running WASM. The domtblout parser is real (pure), so a stub
// table flows through to the review list exactly as in the app. vi.hoisted gives
// the mock factories access to these stubs despite the mock hoist.
const { getCuratedHmmDb, getCuratedDbManifest, runLocalHmmer } = vi.hoisted(
  () => {
    // One reported domain over residues 2..5 of our protein (env from/to in the
    // --domtblout layout), so a single row flows into the review list.
    const STUB_DOMTBL = [
      "# target accession tlen query accession qlen ...",
      "cds - 8 GFP PF01353.28 230 1e-30 100 0 1 1 1e-30 1e-30 99 0 1 230 2 5 2 5 0.99 -",
    ].join("\n");
    return {
      getCuratedHmmDb: vi.fn(async () => new Uint8Array([1, 2, 3])),
      getCuratedDbManifest: vi.fn(async () => ({
        name: "Common Pfam domains",
        version: "2026-06-05",
        families: 44,
        sizeBytes: 3049633,
        source: "Pfam (CC0)",
      })),
      runLocalHmmer: vi.fn(async () => STUB_DOMTBL),
      STUB_DOMTBL,
    };
  });
vi.mock("@/lib/sequences/hmmer-db-cache", () => ({
  getCuratedHmmDb,
  getCuratedDbManifest,
  CuratedHmmDbError: class extends Error {},
}));
vi.mock("@/lib/sequences/hmmer-client", () => ({
  runLocalHmmer,
  HMMER_FLAGS: [],
  LocalHmmerError: class extends Error {},
}));

import DomainAnnotationPanel from "./DomainAnnotationPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const codingFeature: EditFeature = {
  name: "egfp",
  type: "CDS",
  strand: 1,
  start: 0,
  end: 24,
} as EditFeature;

function renderPanel() {
  const onAddDomains = vi.fn();
  render(
    <DomainAnnotationPanel
      feature={codingFeature}
      protein={"MGGGGGGG"}
      seqLength={24}
      disabled={false}
      onAddDomains={onAddDomains}
    />,
  );
  return { onAddDomains };
}

describe("DomainAnnotationPanel curated source", () => {
  it("offers a Common domains source in the picker", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /annotate domains/i }));
    expect(
      screen.getByText(/common domains \(on your computer, downloads once\)/i),
    ).toBeInTheDocument();
  });

  it("shows the manifest family count on the curated step", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /annotate domains/i }));
    fireEvent.click(
      screen.getByText(/common domains \(on your computer, downloads once\)/i),
    );
    await waitFor(() =>
      expect(getCuratedDbManifest).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.getByText(/44 common Pfam families/i)).toBeInTheDocument(),
    );
  });

  it("calls getCuratedHmmDb then runLocalHmmer and opens the review list", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /annotate domains/i }));
    fireEvent.click(
      screen.getByText(/common domains \(on your computer, downloads once\)/i),
    );
    // The curated step's own "Annotate domains" run button.
    const runButton = await screen.findByRole("button", {
      name: /^annotate domains$/i,
    });
    fireEvent.click(runButton);

    await waitFor(() => expect(getCuratedHmmDb).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runLocalHmmer).toHaveBeenCalledTimes(1));
    // The stub domtblout's single GFP domain reaches the review list.
    await waitFor(() =>
      expect(screen.getByText(/domains found/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("GFP")).toBeInTheDocument();
    // The review footer reflects the on-device curated source.
    expect(
      screen.getByText(/on your computer, common domains/i),
    ).toBeInTheDocument();
  });
});
