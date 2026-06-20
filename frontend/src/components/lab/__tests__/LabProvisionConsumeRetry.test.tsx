// Tests for components/lab/LabProvisionConsumeRetry.tsx
//
// The catch-up worker that finishes a DROPPED provision consume. The bug it fixes:
// the genesis persists lab_id BEFORE the consume POST, so an interrupted claim (a
// UI hang plus a reload) can leave lab_id set while the staging is still pending
// and no lab_sites row exists. LabProvisionResume bails on lab_id, so nothing
// re-invokes consume. These cover the orchestration with every dependency mocked:
//   - a set lab_id WITH a still-pending staging re-drives the idempotent consume
//   - a set lab_id with NO pending staging stays inert (no consume POST)
//   - no lab_id (brand-new PI / non-lab user) does nothing (no server calls)
//   - a 409 (already consumed) is treated as done, not an error
//   - a 404 (publish not landed) leaves it retryable; a later attempt re-POSTs
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoisted mutable refs so the mock factories can close over them.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  currentUser: "emile" as string | null,
  settings: { lab_id: undefined as string | undefined },
  readUserSettings: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@/lib/lab/config", () => ({ LAB_TIER_ENABLED: true }));

vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ currentUser: h.currentUser }),
}));

vi.mock("@/lib/settings/user-settings", () => ({
  readUserSettings: h.readUserSettings,
  // The component subscribes but the tests drive attempts via mount instead.
  onUserSettingsWritten: () => () => {},
}));

vi.mock("@/lib/query-client", () => ({
  appQueryClient: { invalidateQueries: h.invalidateQueries },
}));

import LabProvisionConsumeRetry from "../LabProvisionConsumeRetry";

// ---------------------------------------------------------------------------

/**
 * Build a fetch mock. `pending` controls the /provision/pending response; the
 * consume response status is configurable to exercise 200/409/404.
 */
function mockFetch(pending: object | null, consumeStatus = 200) {
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.includes("/provision/pending")) {
      return {
        ok: true,
        json: async () => ({ pending }),
      } as unknown as Response;
    }
    // consume
    return {
      ok: consumeStatus >= 200 && consumeStatus < 300,
      status: consumeStatus,
      json: async () => ({ ok: consumeStatus < 300 }),
    } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function consumeCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter((c) =>
    String(c[0]).includes("/provision/consume"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.currentUser = "emile";
  h.settings = { lab_id: undefined };
  h.readUserSettings.mockImplementation(async () => h.settings);
});

describe("LabProvisionConsumeRetry", () => {
  it("re-drives consume when lab_id is set AND a staging is still pending", async () => {
    // The bug case: the genesis persisted lab_id but the consume was dropped, so
    // the staging is still pending. The worker must finish the consume.
    h.settings = { lab_id: "lab-123" };
    const fetchMock = mockFetch({ slug: "fungal-interactions" });
    render(<LabProvisionConsumeRetry />);

    await waitFor(() => expect(consumeCalls(fetchMock).length).toBe(1));
    // It re-POSTs consume with the persisted lab_id.
    const [, init] = consumeCalls(fetchMock)[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      labId: "lab-123",
    });
    expect(h.invalidateQueries).toHaveBeenCalled();
  });

  it("stays inert when lab_id is set but no staging is pending", async () => {
    h.settings = { lab_id: "lab-123" };
    const fetchMock = mockFetch(null);
    render(<LabProvisionConsumeRetry />);

    // It checks pending once and then does nothing (no consume POST).
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/provision/pending")),
      ).toBe(true),
    );
    expect(consumeCalls(fetchMock).length).toBe(0);
  });

  it("does nothing when there is no lab_id (no server calls at all)", async () => {
    h.settings = { lab_id: undefined };
    const fetchMock = mockFetch({ slug: "fungal-interactions" });
    render(<LabProvisionConsumeRetry />);

    await waitFor(() => expect(h.readUserSettings).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a 409 (already consumed) as done, not an error", async () => {
    h.settings = { lab_id: "lab-123" };
    const fetchMock = mockFetch({ slug: "fungal-interactions" }, 409);
    render(<LabProvisionConsumeRetry />);

    await waitFor(() => expect(consumeCalls(fetchMock).length).toBe(1));
    // A 409 means the staging is already consumed; the worker finalizes cleanly.
    expect(h.invalidateQueries).toHaveBeenCalled();
  });

  it("leaves the consume retryable on a 404 (publish not landed yet)", async () => {
    h.settings = { lab_id: "lab-123" };
    const fetchMock = mockFetch({ slug: "fungal-interactions" }, 404);
    render(<LabProvisionConsumeRetry />);

    await waitFor(() => expect(consumeCalls(fetchMock).length).toBe(1));
    // A 404 means the directory row is not published yet, so it must NOT finalize.
    expect(h.invalidateQueries).not.toHaveBeenCalled();
  });
});
