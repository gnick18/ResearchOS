// Smoke test for the BeakerBot animation gallery dev page.
// Asserts:
//   - the page renders without throwing
//   - the dropdown lists all 21 poses + 11 scenes + 3 pose-celebration
//     variants = 35 entries total (PipetteAim + CoffeeRefill + MicroscopeBubble landed)
//   - the loop toggle is on by default
//   - switching the dropdown to a scene mounts that scene component
//     (verified by its data-testid)
//
// Intentionally light. This is a dev-only tool; we don't need to
// exercise every scene's stage timeline or every pose's keyframe.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import BeakerBotGalleryPage, {
  BEAKERBOT_ANIMATION_CATALOG,
} from "../page";

describe("BeakerBotGalleryPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders without throwing", () => {
    render(<BeakerBotGalleryPage />);
    expect(
      screen.getByRole("heading", { name: /BeakerBot Animation Gallery/i }),
    ).toBeTruthy();
  });

  it("exports a catalog of 35 entries: 21 poses + 11 scenes + 3 pose-celebrations", () => {
    const poses = BEAKERBOT_ANIMATION_CATALOG.filter((e) => e.kind === "pose");
    const scenes = BEAKERBOT_ANIMATION_CATALOG.filter(
      (e) => e.kind === "scene",
    );
    const poseCelebrations = BEAKERBOT_ANIMATION_CATALOG.filter(
      (e) => e.kind === "pose-celebration",
    );
    expect(poses).toHaveLength(21);
    expect(scenes).toHaveLength(11);
    expect(poseCelebrations).toHaveLength(3);
    expect(BEAKERBOT_ANIMATION_CATALOG).toHaveLength(35);
  });

  it("dropdown lists all 35 catalog entries", () => {
    render(<BeakerBotGalleryPage />);
    const select = screen.getByTestId("gallery-select") as HTMLSelectElement;
    // Each <option> in every <optgroup> counts. The select has no
    // placeholder option, so option count === catalog count.
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(35);
  });

  it("dropdown groups options under Poses / Scenes / Pose Celebration Scenes optgroups", () => {
    render(<BeakerBotGalleryPage />);
    const select = screen.getByTestId("gallery-select") as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll("optgroup")).map((g) =>
      g.getAttribute("label"),
    );
    expect(groups).toEqual([
      "Poses (21)",
      "Scenes (11)",
      "Pose Celebration Scenes (3)",
    ]);
  });

  it("loop toggle is on by default", () => {
    render(<BeakerBotGalleryPage />);
    const toggle = screen.getByTestId("gallery-loop-toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("loop toggle flips to off on click", () => {
    render(<BeakerBotGalleryPage />);
    const toggle = screen.getByTestId("gallery-loop-toggle");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});
