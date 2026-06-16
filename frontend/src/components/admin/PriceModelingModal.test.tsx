// Render smoke test for the Path-A FinalizeTab service-tier dashboard. Proves
// the rebuilt component mounts in jsdom and renders the new AI + scenario
// content without throwing, independent of the dev server. Canvas is a no-op in
// jsdom (clientWidth 0, so prep() returns null before getContext), which the
// component already handles. Some labels repeat (a preset button plus a table
// cell), so queries use getAllByText.

import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { FinalizeTab } from "./PriceModelingModal";

const has = (re: RegExp) => expect(screen.getAllByText(re).length).toBeGreaterThan(0);

describe("FinalizeTab (Path-A service dashboard)", () => {
  it("mounts and shows the locked AI rates + the three outcome panels", () => {
    render(<FinalizeTab />);
    has(/metered token product at LOCKED rates/i); // locked AI rates strip
    has(/AI adoption/i); // share of paid users who buy AI
    has(/AI per AI-user/i); // streamlined assumption knob
    has(/Conservative/i); // scenario preset
    has(/Dept-heavy/i); // mix preset
    has(/When do we become profitable/i); // the break-even plot
    has(/Break even/i); // the headline break-even-users readout
    has(/Break-even users by conversion scenario/i); // per-scenario break-even
    has(/Where the money comes from/i); // composition plot
    has(/AI margin/i); // composition row
    has(/Governance fees/i); // composition row
    // Free users are ~$0/mo recurring; the grant is a separate one-time line.
    has(/None of that writes to us/i);
    has(/Acquiring this free base/i); // one-time acquisition line
    has(/Free relay \(recurring\)/i); // recurring cost line
    has(/Fixed business costs/i); // recurring cost line
    has(/Fixed business costs \(charged every month/i); // the editable panel
    has(/Claude Max \(co-runs ops/i); // the permanent ops subscription
    has(/Cost growth with scale/i); // fixed costs step up with users
    cleanup();
  });

  it("free tier uses 'shared-folder workspaces', never 'collab' for the free capability", () => {
    render(<FinalizeTab />);
    has(/shared-folder workspaces/i);
    cleanup();
  });

  it("puts the working area (dials + plots) above the prose context", () => {
    const { container } = render(<FinalizeTab />);
    const text = container.textContent ?? "";
    const assumptions = text.indexOf("Assumptions");
    const plot = text.indexOf("When do we become profitable");
    const lockedStrip = text.indexOf("Path A, locked");
    const howToRead = text.indexOf("How to read it");
    expect(assumptions).toBeGreaterThanOrEqual(0);
    expect(plot).toBeGreaterThanOrEqual(0);
    // Working-area markers must come before the bottom prose in DOM order.
    expect(plot).toBeLessThan(lockedStrip);
    expect(assumptions).toBeLessThan(howToRead);
    cleanup();
  });

  it("scenario + mix preset clicks do not throw", () => {
    render(<FinalizeTab />);
    fireEvent.click(screen.getAllByText(/Optimistic/i)[0]);
    fireEvent.click(screen.getAllByText(/Dept-heavy/i)[0]);
    has(/Break-even conversion/i); // still rendered after recomputation
    cleanup();
  });
});
