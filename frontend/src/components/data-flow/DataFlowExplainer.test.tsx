// Unit coverage for the reusable DataFlowExplainer.
//
// The explainer is a clickable four-step (Local / Share / Collab / Cost).
// These tests confirm it mounts on the local step, switches steps on tab
// click, and surfaces the honesty-critical wording: a one-time send is
// end-to-end, while live collaboration is explicitly not end-to-end.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import DataFlowExplainer from "./DataFlowExplainer";

describe("DataFlowExplainer", () => {
  it("mounts on the local step by default", () => {
    render(<DataFlowExplainer />);
    const root = screen.getByTestId("data-flow-explainer");
    expect(root).toHaveAttribute("data-dfx-step", "local");
    expect(
      screen.getByText(/your work lives on your own computer/i)
    ).toBeInTheDocument();
  });

  it("switches to the share step and keeps the send end-to-end", () => {
    render(<DataFlowExplainer />);
    fireEvent.click(screen.getByTestId("data-flow-tab-share"));
    expect(screen.getByTestId("data-flow-explainer")).toHaveAttribute(
      "data-dfx-step",
      "share"
    );
    // The one-time send must be described as end-to-end and free to receive.
    expect(screen.getByText(/end-to-end encrypted/i)).toBeInTheDocument();
    expect(
      screen.getByText(/receiving is always free/i)
    ).toBeInTheDocument();
  });

  it("switches to the collab step and never calls it end-to-end", () => {
    render(<DataFlowExplainer />);
    fireEvent.click(screen.getByTestId("data-flow-tab-collab"));
    expect(screen.getByTestId("data-flow-explainer")).toHaveAttribute(
      "data-dfx-step",
      "collab"
    );
    // Honesty guard: live collaboration is explicitly NOT end-to-end.
    expect(
      screen.getByText(/it isn't end-to-end/i)
    ).toBeInTheDocument();
  });

  it("shows the cost payoff on the cost step", () => {
    render(<DataFlowExplainer />);
    fireEvent.click(screen.getByTestId("data-flow-tab-cost"));
    expect(
      screen.getByText(/this is why it stays cheap and private/i)
    ).toBeInTheDocument();
  });

  it("honors an initialStep override", () => {
    render(<DataFlowExplainer initialStep="cost" />);
    expect(screen.getByTestId("data-flow-explainer")).toHaveAttribute(
      "data-dfx-step",
      "cost"
    );
  });
});
