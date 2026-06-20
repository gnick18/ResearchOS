// Tests for components/lab/LabProvisionResume.tsx
//
// The staged-PI-provisioning resume is the one client piece that drives the real
// on-device genesis, so these cover its orchestration with every dependency
// mocked (no real OAuth, crypto, or Neon):
//   - a pending staging renders the one-tap confirm card (not a silent create)
//   - tapping "Set up my lab" runs createLabLocal, persists lab_head + lab_id,
//     publishes the genesis, then POSTs consume, in that order, and dismisses
//   - an existing lab_id provisions nothing (first-time PIs only)
//   - no pending staging renders nothing
//   - "Maybe later" dismisses without provisioning (never a soft-lock)
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoisted mutable refs so the mock factories can close over them.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  currentUser: "emile" as string | null,
  sessionEmail: "gluckthaler@wisc.edu" as string | null,
  identity: {} as object | null,
  settings: { lab_id: undefined as string | undefined },
  createLabLocal: vi.fn(),
  publishPendingGenesis: vi.fn(),
  patchUserSettings: vi.fn(),
  readUserSettings: vi.fn(),
}));

vi.mock("@/lib/lab/config", () => ({ LAB_TIER_ENABLED: true }));

vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ currentUser: h.currentUser }),
}));

vi.mock("next-auth/react", () => ({
  getSession: vi.fn(async () => ({ user: { email: h.sessionEmail } })),
}));

vi.mock("@/lib/sharing/identity/session-key", () => ({
  getSessionIdentity: () => h.identity,
}));

vi.mock("@/lib/lab/lab-create", () => ({
  createLabLocal: h.createLabLocal,
}));

vi.mock("@/lib/lab/lab-genesis-pending", () => ({
  publishPendingGenesis: h.publishPendingGenesis,
}));

vi.mock("@/lib/settings/user-settings", () => ({
  patchUserSettings: h.patchUserSettings,
  readUserSettings: h.readUserSettings,
}));

vi.mock("@/lib/query-client", () => ({
  appQueryClient: { invalidateQueries: vi.fn() },
}));

// LivingPopup: render children when open so the card body is assertable.
vi.mock("@/components/ui/LivingPopup", () => ({
  default: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div data-testid="living-popup">{children}</div> : null),
}));

vi.mock("@/components/BeakerBot", () => ({
  default: () => <div data-testid="beakerbot" />,
}));

import LabProvisionResume from "../LabProvisionResume";

// ---------------------------------------------------------------------------

const PENDING = {
  labName: "Fungal Interactions Lab",
  institution: "University of Wisconsin-Madison",
  slug: "fungal-interactions",
  piTitle: "Dr.",
  piDisplay: "Emile Gluck-Thaler",
};

function mockFetch(pending: typeof PENDING | null) {
  const consume = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.includes("/provision/pending")) {
      return {
        ok: true,
        json: async () => ({ pending }),
      } as unknown as Response;
    }
    // consume
    return (await consume()) as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.currentUser = "emile";
  h.sessionEmail = "gluckthaler@wisc.edu";
  h.identity = {};
  h.settings = { lab_id: undefined };
  h.readUserSettings.mockImplementation(async () => h.settings);
  h.createLabLocal.mockReturnValue({
    labId: "lab-123",
    created: { record: { r: 1 }, envelope: { e: 1 }, labKey: new Uint8Array(1) },
  });
  h.publishPendingGenesis.mockResolvedValue(true);
  h.patchUserSettings.mockResolvedValue(undefined);
});

describe("LabProvisionResume", () => {
  it("offers the one-tap confirm card when a staging is pending (no silent create)", async () => {
    mockFetch(PENDING);
    render(<LabProvisionResume />);

    expect(await screen.findByText("Your lab is ready to set up")).toBeDefined();
    expect(screen.getByText("Set up my lab")).toBeDefined();
    expect(screen.getByText(/Fungal Interactions Lab/)).toBeDefined();
    // The genesis must NOT run until the PI taps.
    expect(h.createLabLocal).not.toHaveBeenCalled();
  });

  it("runs genesis, persists lab_head + lab_id, publishes, then consumes on tap", async () => {
    const { fetchMock } = mockFetch(PENDING);
    render(<LabProvisionResume />);

    const button = await screen.findByText("Set up my lab");
    fireEvent.click(button);

    await waitFor(() => expect(h.createLabLocal).toHaveBeenCalledTimes(1));
    expect(h.createLabLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "emile",
        oauthEmail: "gluckthaler@wisc.edu",
      }),
    );
    // Persists the head + lab id (the same write LabCreateResume does).
    await waitFor(() =>
      expect(h.patchUserSettings).toHaveBeenCalledWith(
        "emile",
        expect.objectContaining({ account_type: "lab_head", lab_id: "lab-123" }),
      ),
    );
    // Publishes before consuming, then POSTs consume with the labId.
    await waitFor(() => expect(h.publishPendingGenesis).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const consumeCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/provision/consume"),
      );
      expect(consumeCall).toBeDefined();
    });
    // Card dismisses on success.
    await waitFor(() =>
      expect(screen.queryByText("Your lab is ready to set up")).toBeNull(),
    );
  });

  it("does not consume when the genesis publish fails (stays retryable)", async () => {
    h.publishPendingGenesis.mockResolvedValue(false);
    const { fetchMock } = mockFetch(PENDING);
    render(<LabProvisionResume />);

    fireEvent.click(await screen.findByText("Set up my lab"));

    await waitFor(() => expect(h.publishPendingGenesis).toHaveBeenCalled());
    // No consume POST when the directory row did not land.
    const consumeCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/provision/consume"),
    );
    expect(consumeCall).toBeUndefined();
  });

  it("provisions nothing when the user already has a lab", async () => {
    h.settings = { lab_id: "existing-lab" };
    mockFetch(PENDING);
    render(<LabProvisionResume />);

    await waitFor(() => expect(h.readUserSettings).toHaveBeenCalled());
    expect(screen.queryByText("Your lab is ready to set up")).toBeNull();
    expect(h.createLabLocal).not.toHaveBeenCalled();
  });

  it("renders nothing when there is no pending staging", async () => {
    mockFetch(null);
    render(<LabProvisionResume />);

    await waitFor(() => expect(h.readUserSettings).toHaveBeenCalled());
    expect(screen.queryByText("Your lab is ready to set up")).toBeNull();
  });

  it("dismisses without provisioning when the PI chooses Maybe later", async () => {
    mockFetch(PENDING);
    render(<LabProvisionResume />);

    fireEvent.click(await screen.findByText("Maybe later"));

    await waitFor(() =>
      expect(screen.queryByText("Your lab is ready to set up")).toBeNull(),
    );
    expect(h.createLabLocal).not.toHaveBeenCalled();
  });
});
