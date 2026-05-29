// Render test for the Runway (R3.8). Asserts the runway renders one
// frame per look (18 single looks + 1 clustered pointing trio = 19
// look frames) plus the 5 collection interstitials, and surfaces the
// starred R3.1 category names on the placards.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import Runway from "../Runway";
import {
  SHOWCASE_RUNWAY_FRAME_COUNT,
  SHOWCASE_COLLECTIONS,
  SHOWCASE_LOOKS,
  POINTING_TRIO,
} from "../showcase-data";

beforeEach(() => {
  // jsdom lacks IntersectionObserver; stub a no-op so the sequencer
  // mount is a no-op and the component renders all frames statically.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Runway", () => {
  it("renders one frame per look (19: 18 single + 1 clustered trio)", () => {
    render(<Runway />);
    const looks = screen.getAllByTestId("showcase-look");
    expect(looks).toHaveLength(SHOWCASE_RUNWAY_FRAME_COUNT);
    expect(looks).toHaveLength(19);
  });

  it("renders all five collection interstitials", () => {
    render(<Runway />);
    const interstitials = screen.getAllByTestId("showcase-interstitial");
    expect(interstitials).toHaveLength(SHOWCASE_COLLECTIONS.length);
    expect(interstitials).toHaveLength(5);
  });

  it("renders a category placard for every look frame", () => {
    render(<Runway />);
    const placards = screen.getAllByTestId("showcase-placard");
    // One per look frame.
    expect(placards).toHaveLength(19);
  });

  it("surfaces the starred category names on the placards", () => {
    render(<Runway />);
    // A few representative starred names should appear verbatim.
    expect(screen.getByText("Resting Reaction Realness")).toBeTruthy();
    expect(screen.getByText("Eureka Eleganza")).toBeTruthy();
    expect(screen.getByText("Exothermic Eleganza")).toBeTruthy();
    expect(screen.getByText("The Direction Is Clear")).toBeTruthy(); // trio
  });

  it("renders the pointing trio as one clustered frame, all three poses", () => {
    render(<Runway />);
    const trio = screen
      .getAllByTestId("showcase-look")
      .find((el) => el.getAttribute("data-look") === "pointing-trio");
    expect(trio).toBeTruthy();
    // All three pointing poses render inside the trio frame.
    for (const pose of POINTING_TRIO.poses) {
      expect(trio!.querySelector(`[aria-label="BeakerBot ${pose}"]`)).toBeTruthy();
    }
  });

  it("renders a BeakerBot for every single-pose look", () => {
    render(<Runway />);
    for (const look of SHOWCASE_LOOKS) {
      expect(
        screen.getByLabelText(`BeakerBot ${look.pose}`),
      ).toBeTruthy();
    }
  });
});
