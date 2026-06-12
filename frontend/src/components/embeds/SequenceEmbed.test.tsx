// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();
vi.mock("@/lib/local-api", () => ({
  sequencesApi: { get: (...a: unknown[]) => get(...a) },
}));

import SequenceEmbed from "./SequenceEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "sequence",
  id: "5",
  view: "map",
  isEmbed: true,
  opts: {},
};

const detail = {
  id: 5,
  display_name: "pUC19",
  project_ids: [],
  added_at: "",
  seq_type: "dna",
  length: 2686,
  circular: true,
  feature_count: 2,
  genbank: "",
  seq: "ATGC",
  locus_name: "pUC19",
  annotations: [
    { name: "AmpR", start: 100, end: 900, direction: 1, color: "#fbcfe8" },
    { name: "lacZ", start: 1000, end: 1400, direction: -1 },
  ],
};

describe("SequenceEmbed", () => {
  it("renders the header facts and a feature ribbon", async () => {
    get.mockResolvedValue(detail);
    render(<SequenceEmbed descriptor={descriptor} caption="pUC19 map" basePath="" />);
    await waitFor(() => expect(screen.getByText("pUC19 map")).toBeInTheDocument());
    expect(screen.getByText(/2,686 bp · Circular · 2 features/)).toBeInTheDocument();
    expect(screen.getByText("AmpR")).toBeInTheDocument();
    // The ribbon is an accessible figure.
    expect(screen.getByRole("img", { name: /feature map/ })).toBeInTheDocument();
  });

  it("labels a protein sequence length in aa", async () => {
    get.mockResolvedValue({ ...detail, seq_type: "protein", length: 220, circular: false, feature_count: 0, annotations: [] });
    render(<SequenceEmbed descriptor={descriptor} caption="GST" basePath="" />);
    await waitFor(() => expect(screen.getByText(/220 aa · Linear · 0 features/)).toBeInTheDocument());
  });

  it("falls back to the generic card when the sequence is gone", async () => {
    get.mockResolvedValue(null);
    render(<SequenceEmbed descriptor={descriptor} caption="Gone" basePath="" />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/sequences?seq=5"),
    );
  });
});
