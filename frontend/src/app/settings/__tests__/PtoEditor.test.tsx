// Component tests for <PtoEditor /> — Phase S4 of the Streak-and-Milestones
// arc. Pins the public contract from STREAK_AND_MILESTONES_PROPOSAL.md
// §6.3 (PTO editor spec):
//
//   - Empty state copy + add / remove flow
//   - Sidecar persistence via patchStreak (write contract)
//   - Sorted + deduped list (the S0 normalize() invariant)
//   - Future-dates-only validation in the manual picker
//   - Soft cap warning at 500 entries (no hard block)
//
// We mock @/lib/streak/streak-sidecar so the editor talks to an in-memory
// shape instead of hitting fileService — keeps the test jsdom-clean.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const memSidecar = {
  schema_version: 1 as const,
  enabled: true,
  current_count: 0,
  longest_count: 0,
  last_activity_date: null as string | null,
  started_on: null as string | null,
  shown_privacy_notice: false,
  pto_dates: [] as string[],
  celebrations_seen: {
    account_anniversaries: [] as string[],
    streak_milestones: [] as string[],
  },
};

function snapshot() {
  return { ...memSidecar, pto_dates: [...memSidecar.pto_dates] };
}

function sortDedupe(dates: string[]): string[] {
  return Array.from(new Set(dates)).sort();
}

vi.mock("@/lib/streak/streak-sidecar", () => ({
  readStreak: vi.fn(async () => snapshot()),
  patchStreak: vi.fn(async (_username: string, mutator: (cur: typeof memSidecar) => typeof memSidecar) => {
    const next = mutator(snapshot());
    memSidecar.pto_dates = sortDedupe(next.pto_dates);
    return snapshot();
  }),
}));

import PtoEditor from "../PtoEditor";

beforeEach(() => {
  memSidecar.pto_dates = [];
});

// Pin "today" so future-date tests are deterministic regardless of the
// machine clock. Date constants below sit ahead of this anchor.
const TODAY_ANCHOR = "2026-05-21";
const FUTURE_1 = "2026-06-15";
const FUTURE_2 = "2026-06-10"; // earlier than FUTURE_1 — sort guard
const FUTURE_3 = "2026-07-04";
const PAST_DATE = "2024-01-01";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(`${TODAY_ANCHOR}T12:00:00`) });
});

afterAll(() => {
  vi.useRealTimers();
});

async function flush() {
  // Let the initial readStreak Promise resolve + state propagate.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("PtoEditor", () => {
  it("renders the header and empty state", async () => {
    render(<PtoEditor username="alex" />);
    await flush();
    expect(screen.getByText("Days off (PTO)")).toBeInTheDocument();
    expect(screen.getByTestId("pto-editor-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/No PTO days yet/i),
    ).toBeInTheDocument();
  });

  it("adds a future date and persists to the sidecar", async () => {
    render(<PtoEditor username="alex" />);
    await flush();

    const input = screen.getByTestId("pto-editor-date-input") as HTMLInputElement;
    const addBtn = screen.getByTestId("pto-editor-add-button");

    fireEvent.change(input, { target: { value: FUTURE_1 } });
    await act(async () => {
      fireEvent.click(addBtn);
    });
    await flush();

    expect(memSidecar.pto_dates).toEqual([FUTURE_1]);
    expect(screen.getByTestId(`pto-editor-entry-${FUTURE_1}`)).toBeInTheDocument();
  });

  it("dedupes when the same date is added twice", async () => {
    render(<PtoEditor username="alex" />);
    await flush();

    const input = screen.getByTestId("pto-editor-date-input") as HTMLInputElement;
    const addBtn = screen.getByTestId("pto-editor-add-button");

    for (let i = 0; i < 2; i++) {
      fireEvent.change(input, { target: { value: FUTURE_1 } });
      await act(async () => {
        fireEvent.click(addBtn);
      });
      await flush();
    }

    expect(memSidecar.pto_dates).toEqual([FUTURE_1]);
    // Only one list entry rendered.
    expect(screen.getAllByTestId(/^pto-editor-entry-/)).toHaveLength(1);
  });

  it("sorts entries ascending on persist", async () => {
    render(<PtoEditor username="alex" />);
    await flush();

    const input = screen.getByTestId("pto-editor-date-input") as HTMLInputElement;
    const addBtn = screen.getByTestId("pto-editor-add-button");

    for (const d of [FUTURE_1, FUTURE_2, FUTURE_3]) {
      fireEvent.change(input, { target: { value: d } });
      await act(async () => {
        fireEvent.click(addBtn);
      });
      await flush();
    }

    expect(memSidecar.pto_dates).toEqual([FUTURE_2, FUTURE_1, FUTURE_3]);
  });

  it("removes a date via the remove button", async () => {
    memSidecar.pto_dates = sortDedupe([FUTURE_1, FUTURE_2]);
    render(<PtoEditor username="alex" />);
    await flush();

    const removeBtn = screen.getByTestId(`pto-editor-remove-${FUTURE_1}`);
    await act(async () => {
      fireEvent.click(removeBtn);
    });
    await flush();

    expect(memSidecar.pto_dates).toEqual([FUTURE_2]);
    expect(
      screen.queryByTestId(`pto-editor-entry-${FUTURE_1}`),
    ).not.toBeInTheDocument();
  });

  it("rejects past dates from the manual picker", async () => {
    render(<PtoEditor username="alex" />);
    await flush();

    const input = screen.getByTestId("pto-editor-date-input") as HTMLInputElement;
    const addBtn = screen.getByTestId("pto-editor-add-button");

    fireEvent.change(input, { target: { value: PAST_DATE } });
    await act(async () => {
      fireEvent.click(addBtn);
    });
    await flush();

    expect(memSidecar.pto_dates).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(/past dates/i);
  });

  it("accepts a date equal to today", async () => {
    render(<PtoEditor username="alex" />);
    await flush();

    const input = screen.getByTestId("pto-editor-date-input") as HTMLInputElement;
    const addBtn = screen.getByTestId("pto-editor-add-button");

    fireEvent.change(input, { target: { value: TODAY_ANCHOR } });
    await act(async () => {
      fireEvent.click(addBtn);
    });
    await flush();

    expect(memSidecar.pto_dates).toEqual([TODAY_ANCHOR]);
  });

  it("renders the soft cap warning at 500+ entries without blocking adds", async () => {
    // Pre-seed 500 future dates.
    const seeded: string[] = [];
    const baseY = 2030;
    let added = 0;
    for (let y = baseY; added < 500; y++) {
      for (let m = 1; m <= 12 && added < 500; m++) {
        for (let d = 1; d <= 28 && added < 500; d++) {
          seeded.push(
            `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          );
          added++;
        }
      }
    }
    memSidecar.pto_dates = sortDedupe(seeded);
    expect(memSidecar.pto_dates).toHaveLength(500);

    render(<PtoEditor username="alex" />);
    await flush();

    expect(
      screen.getByTestId("pto-editor-soft-cap-warning"),
    ).toBeInTheDocument();

    // 501st entry: not blocked.
    const input = screen.getByTestId("pto-editor-date-input") as HTMLInputElement;
    const addBtn = screen.getByTestId("pto-editor-add-button");
    fireEvent.change(input, { target: { value: "2050-12-31" } });
    await act(async () => {
      fireEvent.click(addBtn);
    });
    await flush();

    expect(memSidecar.pto_dates).toHaveLength(501);
    expect(
      screen.getByTestId("pto-editor-soft-cap-warning"),
    ).toBeInTheDocument();
  });
});

// Wait helper: in case the first flush isn't enough for the soft-cap render
// — guard against flake by waiting on a DOM signal.
async function waitForListRender(testid: string) {
  await waitFor(() => {
    expect(screen.getByTestId(testid)).toBeInTheDocument();
  });
}
// Re-export so unused-vars rule doesn't trip if not consumed above.
void waitForListRender;
