// sequence editor master (redesign phase 5). The History tab "Results" section.
// Renders SequenceHistoryPanel with the version timeline mocked EMPTY (so the
// engine never touches a real fileService) and asserts the Results section:
// lists artifacts, fires Open, an inline-confirmed Delete, a calm empty state,
// and a STALE chip when the live fingerprint differs from a result's lineage.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Mock the heavy history engine so the panel resolves to an EMPTY timeline
// without a fileService. The empty branch still renders the Results section.
vi.mock("@/lib/history", () => ({
  historyEngine: {
    readHistory: vi.fn(async () => []),
    reconstructState: vi.fn(async () => ""),
  },
  sequenceAdapter: {
    projectBody: vi.fn(() => ({ body: "" })),
    summarize: vi.fn(() => ""),
  },
}));

vi.mock("@/lib/history/sequences-history", () => ({
  SEQUENCES_ENTITY_TYPE: "sequences",
}));

vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => ({}),
}));

import SequenceHistoryPanel from "./SequenceHistoryPanel";
import type { Artifact } from "@/lib/sequences/artifacts";

afterEach(() => cleanup());

function artifact(over: Partial<Artifact> = {}): Artifact {
  return {
    id: over.id ?? "a1",
    type: over.type ?? "alignment",
    title: over.title ?? "Align EGFP to TRAP1",
    summary: over.summary ?? "92% identity over 700 cols, score 1200",
    createdAt: over.createdAt ?? new Date().toISOString(),
    lineage: over.lineage ?? {
      sequenceId: 1,
      sequenceVersion: "v1",
      inputs: {},
    },
    result: over.result ?? {},
  };
}

const BASE_PROPS = {
  sequenceId: 1,
  owner: "alex",
  headCanonical: "x",
  canRestore: false,
  sequenceVersion: "v1",
};

/** Wait for the panel's async load effect to resolve to its empty timeline (the
 *  Results section renders once the loading state clears). */
async function flush() {
  await waitFor(() =>
    expect(screen.getByTestId("sequence-results-section")).toBeInTheDocument(),
  );
}

describe("SequenceHistoryPanel Results section", () => {
  it("shows the calm empty state when there are no results", async () => {
    render(<SequenceHistoryPanel {...BASE_PROPS} artifacts={[]} />);
    await flush();
    expect(screen.getByTestId("sequence-results-section")).toBeInTheDocument();
    expect(screen.getByTestId("sequence-results-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/Run an analysis and its result is saved here/i),
    ).toBeInTheDocument();
  });

  it("lists artifacts newest first with their title and summary", async () => {
    render(
      <SequenceHistoryPanel
        {...BASE_PROPS}
        artifacts={[
          artifact({ id: "a1", title: "Align EGFP to TRAP1" }),
          artifact({ id: "a2", type: "domains", title: "Domains in EGFP", summary: "2 hits (GFP)" }),
        ]}
      />,
    );
    await flush();
    const rows = screen.getAllByTestId("sequence-result-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Align EGFP to TRAP1")).toBeInTheDocument();
    expect(screen.getByText("Domains in EGFP")).toBeInTheDocument();
    expect(screen.getByText("2 hits (GFP)")).toBeInTheDocument();
  });

  it("fires onOpenArtifact when Open is clicked", async () => {
    const onOpen = vi.fn();
    render(
      <SequenceHistoryPanel
        {...BASE_PROPS}
        artifacts={[artifact({ id: "a1" })]}
        onOpenArtifact={onOpen}
      />,
    );
    await flush();
    fireEvent.click(screen.getByTestId("sequence-result-open"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe("a1");
  });

  it("deletes through an inline confirm", async () => {
    const onDelete = vi.fn();
    render(
      <SequenceHistoryPanel
        {...BASE_PROPS}
        artifacts={[artifact({ id: "a1" })]}
        onDeleteArtifact={onDelete}
      />,
    );
    await flush();
    // First click reveals the confirm, does NOT delete yet.
    fireEvent.click(screen.getByTestId("sequence-result-delete"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("sequence-result-delete-confirm")).toBeInTheDocument();
    // Confirm deletes.
    fireEvent.click(
      screen.getByTestId("sequence-result-delete-confirm").querySelector("button")!,
    );
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("flags a result STALE when the live fingerprint differs from its lineage", async () => {
    render(
      <SequenceHistoryPanel
        {...BASE_PROPS}
        sequenceVersion="v2"
        artifacts={[
          artifact({
            id: "a1",
            lineage: { sequenceId: 1, sequenceVersion: "v1", inputs: {} },
          }),
        ]}
      />,
    );
    await flush();
    expect(screen.getByTestId("sequence-result-stale")).toBeInTheDocument();
  });

  it("does not flag stale when the fingerprint matches", async () => {
    render(
      <SequenceHistoryPanel
        {...BASE_PROPS}
        sequenceVersion="v1"
        artifacts={[
          artifact({
            id: "a1",
            lineage: { sequenceId: 1, sequenceVersion: "v1", inputs: {} },
          }),
        ]}
      />,
    );
    await flush();
    expect(screen.queryByTestId("sequence-result-stale")).not.toBeInTheDocument();
  });
});
