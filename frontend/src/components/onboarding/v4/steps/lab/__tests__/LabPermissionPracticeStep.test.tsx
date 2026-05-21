/**
 * Onboarding v4 P7: lab-permission-practice step body tests.
 *
 * Covers §6.16b: clicking "Rename it" on the edit card flips the
 * displayed name; clicking "Delete" on the view-only card surfaces
 * the red lock blocked-toast. Neither click writes to disk: the
 * card is a pure UI demonstration of the permission flavors.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LabPermissionPracticeInner from "../LabPermissionPracticeStep";

describe("LabPermissionPracticeStep (v4 P7)", () => {
  it("renders the edit-permission card with a Rename action", async () => {
    render(<LabPermissionPracticeInner />);

    expect(screen.getByText(/Plasmid prep/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Rename it$/i }),
    ).toBeInTheDocument();
  });

  it("renames the edit task on click and surfaces the edit-access copy", async () => {
    render(<LabPermissionPracticeInner />);

    await userEvent.setup().click(
      screen.getByRole("button", { name: /^Rename it$/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/edited by you/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Edit access lets you change anything/i),
    ).toBeInTheDocument();
  });

  it("blocks delete on the view-only card and surfaces the lock indicator", async () => {
    render(<LabPermissionPracticeInner />);

    // The lock indicator is always present (the icon IS the indicator),
    // but the blocked toast only appears after the user attempts delete.
    expect(
      screen.getByTestId("lab-view-lock-indicator"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("lab-view-blocked")).toBeNull();

    await userEvent.setup().click(
      screen.getByRole("button", { name: /^Delete$/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("lab-view-blocked"),
      ).toBeInTheDocument();
    });
    // Blocked-toast copy precision: "View-only locks the task, you can
    // read but not edit or delete." (no em-dash, U+2014)
    expect(
      screen.getByTestId("lab-view-blocked").textContent,
    ).toMatch(/View-only locks the task/i);
    expect(
      screen.getByTestId("lab-view-blocked").textContent,
    ).not.toMatch(/—/);
  });

  it("the speech copy contains no em-dashes", () => {
    render(<LabPermissionPracticeInner />);
    // Pull all text and assert no em-dash literal (U+2014) anywhere.
    expect(document.body.textContent ?? "").not.toMatch(/—/);
  });
});
