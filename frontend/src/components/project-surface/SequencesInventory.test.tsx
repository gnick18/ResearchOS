// frontend/src/components/project-surface/SequencesInventory.test.tsx
//
// project-sequences-tab bot (de-bloat arc, Phase 3b) — RTL coverage for the
// per-project Sequences section. This is PRESENTATION-ONLY: the section reads
// the sequence arc's live `sequencesApi.listByProject` and links OUT to the
// /sequences library; it never embeds the editor or writes data. The suite
// pins the three things that matter at this layer:
//
//   1. Each linked sequence renders a row with its display name, length (bp),
//      and type (seq_type), and the row links to /sequences.
//   2. A header affordance links out to the sequence library (/sequences).
//   3. An empty result renders the empty-state copy and no rows (the parent
//      ProjectRoute hides the tab entirely in that case; this is the body's
//      own graceful fallback).
//
// `sequencesApi` is mocked at the module level so no disk read happens; the
// assertions key off the rendered rows + the hrefs.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project, SequenceRecord } from "@/lib/types";

// FixtureLink wraps next/link; render a plain <a> so href assertions are simple
// and the next/navigation searchParams dependency is sidestepped.
vi.mock("@/components/FixtureLink", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const listByProject = vi.fn();
vi.mock("@/lib/local-api", () => ({
  sequencesApi: {
    listByProject: (...args: unknown[]) => listByProject(...args),
  },
}));

import SequencesInventory from "./SequencesInventory";

const PROJECT = { id: 7, owner: "alice", name: "Cloning" } as unknown as Project;

function makeSeq(over: Partial<SequenceRecord>): SequenceRecord {
  return {
    id: 1,
    display_name: "pUC19",
    project_ids: ["7"],
    added_at: new Date(0).toISOString(),
    seq_type: "dna",
    length: 2686,
    circular: true,
    feature_count: 3,
    ...over,
  };
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SequencesInventory project={PROJECT} />
    </QueryClientProvider>,
  );
}

describe("SequencesInventory", () => {
  beforeEach(() => {
    listByProject.mockReset();
  });

  it("renders a row per linked sequence with name, length (bp), and type, linking to /sequences", async () => {
    listByProject.mockResolvedValue([
      makeSeq({ id: 1, display_name: "pUC19", seq_type: "dna", length: 2686 }),
      makeSeq({
        id: 2,
        display_name: "GFP transcript",
        seq_type: "rna",
        length: 720,
      }),
    ]);

    renderSection();

    expect(listByProject).toHaveBeenCalledWith(7);

    await waitFor(() => expect(screen.getByText("pUC19")).toBeInTheDocument());

    // Name + type label + bp formatting for both rows.
    expect(screen.getByText("GFP transcript")).toBeInTheDocument();
    expect(screen.getByText("DNA")).toBeInTheDocument();
    expect(screen.getByText("RNA")).toBeInTheDocument();
    expect(screen.getByText("2,686 bp")).toBeInTheDocument();
    expect(screen.getByText("720 bp")).toBeInTheDocument();

    // Every row links OUT to the sequence library (presentation-only click-out).
    const rowLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href") === "/sequences");
    // 2 rows + 1 header affordance.
    expect(rowLinks.length).toBe(3);
  });

  it("renders the 'Manage in the sequence library' header affordance to /sequences", async () => {
    listByProject.mockResolvedValue([makeSeq({})]);
    renderSection();

    const header = await screen.findByText(/Manage in the sequence library/);
    expect(header.closest("a")).toHaveAttribute("href", "/sequences");
  });

  it("shows the empty state and no rows when the project has no linked sequences", async () => {
    listByProject.mockResolvedValue([]);
    renderSection();

    await waitFor(() =>
      expect(screen.getByText(/No sequences linked yet/)).toBeInTheDocument(),
    );
    // Only the header affordance link remains; no sequence rows.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/sequences");
  });
});
