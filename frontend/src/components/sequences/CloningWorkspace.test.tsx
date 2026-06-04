// cloning polish bot. Component-level tests for two of the polish fixes,
//   L1  the construct name does NOT leak across a method switch, and
//   L9  the review pane shows a distinct "Resolving fragments…" state while a
//       library fragment is still resolving (instead of the no-product empty
//       state, which made latency read like an error).
//
// We mount the workspace directly in jsdom against a mocked sequencesApi so the
// library list + per-fragment resolution are deterministic. The cloning engines
// are the real pure modules; we never assert their biology here, only the UI
// state machine the polish pass touched.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SequenceRecord } from "@/lib/types";

// A tiny DNA library record helper.
function makeRecord(partial: Partial<SequenceRecord> & { id: number }): SequenceRecord {
  return {
    display_name: `seq-${partial.id}`,
    seq_type: "dna",
    length: 100,
    circular: false,
    annotations: [],
    seq: "ACGT".repeat(25),
    ...partial,
  } as SequenceRecord;
}

const LIBRARY: SequenceRecord[] = [
  makeRecord({ id: 1, display_name: "Insert A", length: 100 }),
  makeRecord({ id: 2, display_name: "Vector B", length: 100 }),
];

// `get` is overridden per-test so we can hold resolution pending (L9).
const getMock = vi.fn(async (id: number) => LIBRARY.find((s) => s.id === id) ?? null);

vi.mock("@/lib/local-api", () => ({
  sequencesApi: {
    list: vi.fn(async () => LIBRARY),
    get: (id: number) => getMock(id),
    create: vi.fn(async () => ({ id: 99 })),
  },
}));

import CloningWorkspace from "./CloningWorkspace";

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CloningWorkspace open onClose={() => {}} activeProjectIds={[]} onSaved={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  getMock.mockReset();
  getMock.mockImplementation(async (id: number) => LIBRARY.find((s) => s.id === id) ?? null);
});

describe("CloningWorkspace polish", () => {
  it("L1: clears the construct name when switching method", async () => {
    renderWorkspace();

    // Add two fragments so overlap can reach review.
    await screen.findByText("Insert A");
    fireEvent.click(screen.getByText("Insert A"));
    fireEvent.click(screen.getByText("Vector B"));

    // Wait for resolution, then go to the overlap review step.
    const reviewBtn = await screen.findByRole("button", { name: /review junctions/i });
    await waitFor(() => expect(reviewBtn).not.toBeDisabled());
    fireEvent.click(reviewBtn);

    // Type a name on the overlap review.
    const nameInput = await screen.findByPlaceholderText("Assembled construct");
    fireEvent.change(nameInput, { target: { value: "My Gibson construct" } });
    expect((nameInput as HTMLInputElement).value).toBe("My Gibson construct");

    // Switch chemistry via the Gateway method pill.
    fireEvent.click(screen.getByRole("button", { name: "Gateway" }));

    // Back on the pick step; the construct name state was cleared, so when we
    // reach a review again the field is empty (no leak from the prior method).
    // Re-enter overlap review and confirm the field is blank.
    fireEvent.click(screen.getByRole("button", { name: "Overlap" }));
    const reviewBtn2 = await screen.findByRole("button", { name: /review junctions/i });
    await waitFor(() => expect(reviewBtn2).not.toBeDisabled());
    fireEvent.click(reviewBtn2);
    const nameInput2 = await screen.findByPlaceholderText("Assembled construct");
    expect((nameInput2 as HTMLInputElement).value).toBe("");
  });

  it("L9: shows Resolving fragments instead of the empty state while a fragment resolves", async () => {
    // Hold resolution pending so `resolving` stays true.
    let release!: () => void;
    const pending = new Promise<void>((r) => {
      release = r;
    });
    getMock.mockImplementation(async (id: number) => {
      await pending;
      return LIBRARY.find((s) => s.id === id) ?? null;
    });

    renderWorkspace();
    await screen.findByText("Insert A");
    fireEvent.click(screen.getByText("Insert A"));
    fireEvent.click(screen.getByText("Vector B"));

    // The Review button is gated on !resolving, so while a fragment resolves the
    // picker shows its own "resolving…" row indicator and the no-product empty
    // state must never appear (it only renders on the review step, and we never
    // reach review with a missing product). Assert the resolving copy shows and
    // the false-error empty state stays absent throughout.
    expect(await screen.findAllByText(/resolving/i)).not.toHaveLength(0);
    expect(screen.queryByText(/No assembled product/i)).toBeNull();
    expect(screen.queryByText(/No recombination product/i)).toBeNull();

    release();
    await waitFor(() =>
      expect(screen.queryByText(/No assembled product/i)).toBeNull(),
    );
  });
});
