// Tests for components/lab/LabSessionMount.tsx
//
// Covers:
//   - useLabSession -> null: renders children directly (no gate wrapper)
//   - useLabSession -> { controller, labId }: renders LabSignInGate around children
//
// LabSignInGate is replaced with a marker so the test does not need real
// OAuth or controller infrastructure.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoist mutable ref so the mock factory can close over it.
// ---------------------------------------------------------------------------

const { useLabSessionRef } = vi.hoisted(() => ({
  useLabSessionRef: {
    current: null as null | { controller: object; labId: string },
  },
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/hooks/useLabSession", () => ({
  useLabSession: () => useLabSessionRef.current,
}));

vi.mock("@/components/lab/LabSignInGate", () => ({
  LabSignInGate: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="lab-sign-in-gate">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks.
// ---------------------------------------------------------------------------

import { LabSessionMount } from "../LabSessionMount";

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  useLabSessionRef.current = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LabSessionMount", () => {
  it("renders children directly when useLabSession returns null (solo / flag-off)", () => {
    useLabSessionRef.current = null;

    render(
      <LabSessionMount>
        <span>solo content</span>
      </LabSessionMount>,
    );

    expect(screen.getByText("solo content")).toBeDefined();
    expect(screen.queryByTestId("lab-sign-in-gate")).toBeNull();
  });

  it("wraps children in LabSignInGate when useLabSession returns a controller", () => {
    useLabSessionRef.current = {
      controller: {},
      labId: "L1",
    };

    render(
      <LabSessionMount>
        <span>lab content</span>
      </LabSessionMount>,
    );

    expect(screen.getByTestId("lab-sign-in-gate")).toBeDefined();
    expect(screen.getByText("lab content")).toBeDefined();
  });
});
