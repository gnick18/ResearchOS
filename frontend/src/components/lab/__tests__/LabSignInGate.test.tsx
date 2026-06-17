// frontend/src/components/lab/__tests__/LabSignInGate.test.tsx
//
// Unit tests for LabSignInGate. The controller is a fake object that holds
// mutable state and a subscriber set; signIn is a vi.fn so calls can be
// asserted. SharingProviderButtons is gated on isOAuthPublishAvailable()
// and isDevMockAuth(); we mock oauth-availability so isDevMockAuth() returns
// true, which causes SharingProviderButtons to render the single dev-mock
// button and skip the null-return from isOAuthPublishAvailable() returning
// false. This lets us assert that the provider callback is wired correctly
// without needing real OAuth env vars.
//
// Test areas:
//   1. locked state     - renders gate title + at least one provider button
//   2. provider click   - clicking the button calls controller.signIn with provider id
//   3. live state       - renders children, hides the gate
//   4. authenticating   - renders "Signing in..." indicator (no provider buttons)
//   5. unlocking        - renders "Unlocking your lab..." indicator
//   6. error display    - getError() returning an Error shows its message
//   7. start("lab")     - controller.start is called with "lab" on mount

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LabSessionController, LabSessionState } from "@/lib/lab/lab-session";
import React from "react";
import { LabSignInGate } from "../LabSignInGate";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks ────────────────────────────────────────────────────────────────

// Force the dev-mock path in SharingProviderButtons so a button renders in
// tests without real OAuth credentials being set.
vi.mock("@/lib/sharing/oauth-availability", () => ({
  isOAuthPublishAvailable: () => true,
  isDevMockAuth: () => true,
  isRealSharingEnabled: () => false,
}));

// LabSignInGate calls useFileSystem() for `disconnect`; mock it so the suite
// doesn't need a real FileSystemProvider wrapper.
vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ disconnect: vi.fn() }),
}));

// ── Fake controller factory ───────────────────────────────────────────────

function makeFakeController(
  initialState: LabSessionState,
  initialError: Error | null = null,
): LabSessionController & { _setState: (s: LabSessionState) => void } {
  let state = initialState;
  let error = initialError;
  const subs = new Set<() => void>();

  const controller: LabSessionController & { _setState: (s: LabSessionState) => void } = {
    getState: () => state,
    subscribe: (fn: () => void) => {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
    getError: () => error,
    start: vi.fn(),
    signIn: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
    signalExpiry: vi.fn(),
    tickExpiry: vi.fn(),
    logout: vi.fn(),
    _setState(next: LabSessionState) {
      state = next;
      error = null;
      subs.forEach((fn) => fn());
    },
  };

  return controller;
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("LabSignInGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the sign-in gate when state is locked", () => {
    const ctrl = makeFakeController({ kind: "locked" });
    renderWithQuery(<LabSignInGate controller={ctrl} />);

    expect(screen.getByText("Sign in to your lab")).toBeDefined();
    // The dev-mock button should render inside SharingProviderButtons
    expect(screen.getByText(/Dev mock sign-in/i)).toBeDefined();
  });

  it("clicking a provider button calls controller.signIn with the provider id", async () => {
    const ctrl = makeFakeController({ kind: "locked" });
    renderWithQuery(<LabSignInGate controller={ctrl} />);

    const btn = screen.getByText(/Dev mock sign-in/i);
    await userEvent.click(btn);

    expect(ctrl.signIn).toHaveBeenCalledTimes(1);
    expect(ctrl.signIn).toHaveBeenCalledWith("devmock");
  });

  it("renders children and hides the gate when state is live", () => {
    const ctrl = makeFakeController({
      kind: "live",
      labId: "lab-1",
      labKey: new Uint8Array(32),
      signingKeyPair: {
        ed25519Priv: new Uint8Array(64),
        ed25519Pub: new Uint8Array(32),
      },
      member: { username: "alice", labId: "lab-1" },
      graceUntil: null,
    });

    renderWithQuery(<LabSignInGate controller={ctrl}><div>APP</div></LabSignInGate>);

    expect(screen.getByText("APP")).toBeDefined();
    expect(screen.queryByText("Sign in to your lab")).toBeNull();
  });

  it("renders a signing-in indicator for authenticating state", () => {
    const ctrl = makeFakeController({ kind: "authenticating" });
    renderWithQuery(<LabSignInGate controller={ctrl} />);

    expect(screen.getByText("Signing in...")).toBeDefined();
    expect(screen.queryByText(/Dev mock sign-in/i)).toBeNull();
  });

  it("renders an unlocking indicator for unlocking state", () => {
    const ctrl = makeFakeController({ kind: "unlocking" });
    renderWithQuery(<LabSignInGate controller={ctrl} />);

    expect(screen.getByText("Unlocking your lab...")).toBeDefined();
    expect(screen.queryByText(/Dev mock sign-in/i)).toBeNull();
  });

  it("shows the error message when getError() is non-null", () => {
    const ctrl = makeFakeController({ kind: "locked" }, new Error("OAuth denied"));
    renderWithQuery(<LabSignInGate controller={ctrl} />);

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("OAuth denied")).toBeDefined();
  });

  it("calls controller.start with 'lab' on mount", () => {
    const ctrl = makeFakeController({ kind: "locked" });
    renderWithQuery(<LabSignInGate controller={ctrl} />);

    expect(ctrl.start).toHaveBeenCalledTimes(1);
    expect(ctrl.start).toHaveBeenCalledWith("lab");
  });
});
