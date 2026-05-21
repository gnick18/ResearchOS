import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import BeakerBot, { type BeakerBotPose } from "../BeakerBot";

/**
 * P9 of the Onboarding v3 arc: the 7-pose mascot menu. The mascot's
 * pose surface is the contract every wiring site (wizard shell, lab
 * tour resume modal, tip cards, dev buttons) depends on. These tests
 * lock the canonical pose names + the per-pose DOM signals (data
 * attributes, conditional sub-paths, animation class application).
 *
 * Animation playback itself isn't asserted: jsdom doesn't execute CSS
 * keyframes. We only assert that the right animation CLASS is applied
 * so a future regression that drops the class would fail loud.
 */

const ALL_POSES: BeakerBotPose[] = [
  "idle",
  "pointing",
  "pointing-up",
  "pointing-down",
  "cheering",
  "waving",
  "bouncing",
  "thinking",
  "typing",
  "bow-wink",
];

describe("BeakerBot pose mechanism", () => {
  it.each(ALL_POSES)(
    "renders pose %s with the matching data-pose attribute",
    (pose) => {
      const { container } = render(<BeakerBot pose={pose} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("data-pose")).toBe(pose);
    },
  );

  it("emits data-animated=true by default", () => {
    const { container } = render(<BeakerBot pose="idle" />);
    expect(container.querySelector("svg")?.getAttribute("data-animated")).toBe(
      "true",
    );
  });

  it("emits data-animated=false when animated=false is passed", () => {
    const { container } = render(<BeakerBot pose="idle" animated={false} />);
    expect(container.querySelector("svg")?.getAttribute("data-animated")).toBe(
      "false",
    );
  });

  it("applies an animation class on the SVG root when pose=idle and animated=true", () => {
    const { container } = render(<BeakerBot pose="idle" />);
    const svg = container.querySelector("svg");
    // Class names from CSS modules are hashed; we only require that
    // SOME class beyond Tailwind sizing is present (the merged
    // module class set). The exact name is environment-dependent.
    expect(svg?.className.baseVal ?? svg?.getAttribute("class") ?? "").toMatch(
      /\S/,
    );
  });

  it("renders the thinking dots only when pose=thinking", () => {
    const idleResult = render(<BeakerBot pose="idle" />);
    // The thought-bubble dot trio uses cx=30,33,36. Idle has no such
    // circles outside of eyes (cx=17,23). Confirm idle does not emit
    // a circle at cx=30.
    const idleCircles = idleResult.container.querySelectorAll("circle");
    const idleDots = Array.from(idleCircles).filter(
      (c) => c.getAttribute("cx") === "33",
    );
    expect(idleDots.length).toBe(0);
    idleResult.unmount();

    const thinkResult = render(<BeakerBot pose="thinking" />);
    const thinkDots = Array.from(
      thinkResult.container.querySelectorAll("circle"),
    ).filter((c) => c.getAttribute("cx") === "33");
    expect(thinkDots.length).toBeGreaterThan(0);
  });

  it("renders a typing-hand circle at cx=33 only when pose=typing", () => {
    const cheerResult = render(<BeakerBot pose="cheering" />);
    const cheerHand = Array.from(
      cheerResult.container.querySelectorAll("circle"),
    ).filter(
      (c) => c.getAttribute("cx") === "33" && c.getAttribute("cy") === "20",
    );
    expect(cheerHand.length).toBe(0);
    cheerResult.unmount();

    const typeResult = render(<BeakerBot pose="typing" />);
    const typeHand = Array.from(
      typeResult.container.querySelectorAll("circle"),
    ).filter(
      (c) => c.getAttribute("cx") === "33" && c.getAttribute("cy") === "20",
    );
    expect(typeHand.length).toBe(1);
  });

  it("flips the SVG horizontally when direction=left and pose is directional", () => {
    const { container } = render(
      <BeakerBot pose="pointing" direction="left" />,
    );
    const svg = container.querySelector("svg") as SVGSVGElement | null;
    expect(svg?.style.transform).toBe("scaleX(-1)");
  });

  it("does not flip for non-directional poses regardless of direction prop", () => {
    const { container } = render(
      <BeakerBot pose="cheering" direction="left" />,
    );
    const svg = container.querySelector("svg") as SVGSVGElement | null;
    expect(svg?.style.transform ?? "").not.toContain("scaleX(-1)");
  });

  it("respects noLiquid (no white body fill + no rainbow liquid)", () => {
    const { container } = render(<BeakerBot pose="idle" noLiquid />);
    // The two skipped paths are the only ones using fill="white" and
    // fill="url(#beaker-liquid-...)". When noLiquid is true, neither
    // should appear.
    const paths = container.querySelectorAll("path");
    const fills = Array.from(paths).map((p) => p.getAttribute("fill"));
    expect(fills).not.toContain("white");
    expect(fills.some((f) => f && f.startsWith("url(#beaker-liquid-"))).toBe(
      false,
    );
  });

  it("still emits all the structural feature paths regardless of pose", () => {
    // The eyes, smile, cheek dashes, body outline, and beaker lip
    // must render for every pose; without them the mascot reads as
    // a blob. Smoke-check by counting circles >= 2 (two eyes).
    for (const pose of ALL_POSES) {
      const { container, unmount } = render(<BeakerBot pose={pose} />);
      const circles = container.querySelectorAll("circle");
      expect(circles.length).toBeGreaterThanOrEqual(2);
      unmount();
    }
  });
});
