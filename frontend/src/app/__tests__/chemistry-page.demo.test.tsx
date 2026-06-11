/**
 * /chemistry route gate vs demo mode.
 *
 * The workbench is flag-gated (CHEMISTRY_ENABLED, default off). With the flag
 * off, a real production visit shows the calm not-enabled notice, but a demo
 * session renders the real surface so the public demo can showcase it.
 *
 * Pins:
 *   - flag off + not demo -> the not-enabled notice (prod default, unchanged);
 *   - flag off + demo      -> the real hub (the ChemistryHub stub) renders.
 *
 * The flag is forced off, and the client-only demo signal is mocked behind a
 * holder so each test drives it deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/chemistry/config", () => ({ CHEMISTRY_ENABLED: false }));

const holder = vi.hoisted(() => ({ demo: false }));
vi.mock("@/lib/file-system/wiki-capture-mock", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/file-system/wiki-capture-mock")
    >();
  return { ...actual, getDemoMode: () => holder.demo };
});

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/chemistry/ChemistryHub", () => ({
  ChemistryHub: () => <div data-testid="chemistry-hub">hub</div>,
}));
vi.mock("@/components/chemistry/MoleculeEditorPopup", () => ({
  MoleculeEditorPopup: () => null,
}));
vi.mock("@/components/chemistry/PubChemImportDialog", () => ({
  PubChemImportDialog: () => null,
}));
vi.mock("@/components/chemistry/ImportFileDialog", () => ({
  ImportFileDialog: () => null,
}));

import ChemistryPage from "../chemistry/page";

beforeEach(() => {
  holder.demo = false;
});
afterEach(() => {
  holder.demo = false;
});

describe("ChemistryPage — gate vs demo mode", () => {
  it("shows the not-enabled notice when the flag is off and it is not a demo", async () => {
    render(<ChemistryPage />);
    expect(
      await screen.findByText(/Chemistry is not enabled/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("chemistry-hub")).not.toBeInTheDocument();
  });

  it("renders the real hub in demo mode even with the flag off", async () => {
    holder.demo = true;
    render(<ChemistryPage />);
    await waitFor(() => {
      expect(screen.getByTestId("chemistry-hub")).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/Chemistry is not enabled/i),
    ).not.toBeInTheDocument();
  });
});
