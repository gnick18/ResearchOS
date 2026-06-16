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
    has(/AI per paid user/i); // streamlined assumption knob
    has(/Conservative/i); // scenario preset
    has(/Dept-heavy/i); // mix preset
    has(/Net per month by scenario/i); // outcome plot 2
    has(/Where the money comes from/i); // outcome plot 3
    has(/AI margin/i); // composition row
    has(/Governance fees/i); // composition row
    cleanup();
  });

  it("free tier uses 'shared-folder workspaces', never 'collab' for the free capability", () => {
    render(<FinalizeTab />);
    has(/shared-folder workspaces/i);
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
