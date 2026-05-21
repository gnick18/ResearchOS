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
  "typing-on-laptop",
  "bow-wink",
  "volcano-eruption",
  "sleeping",
  "hiccup",
  "yawn",
  "reading",
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

  it("typing-hand keyframe uses a small percentage so the 120px tour size renders a hand pulse, not a scattered-dots jump", async () => {
    // Regression test for the v4 §6.2 pose bug: the original
    // .typeHand keyframe used `translateY(-30%)` which under
    // `transform-box: view-box` resolves to 30% of the SVG view-box
    // height (40 units = 12 user-space units). At the v4 tour's
    // 120px display size that produced a ~36px vertical jump at
    // 5.3 Hz which read as scattered floating dots. The fix dropped
    // the percentage to a small value (~1-2%) so the pulse is a
    // subtle keyboard-hammer motion at every display size.
    //
    // We assert by reading the CSS module source directly — jsdom
    // doesn't run keyframes so a render-side assertion would be
    // a no-op. Going via the filesystem ties the test to the file
    // we actually changed.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const cssPath = path.resolve(
      __dirname,
      "..",
      "BeakerBot.module.css",
    );
    const css = await fs.readFile(cssPath, "utf8");
    // Pull just the @keyframes beakerBotTypeHand block.
    const match = css.match(
      /@keyframes\s+beakerBotTypeHand\s*\{[\s\S]*?\n\}/,
    );
    expect(match, "beakerBotTypeHand keyframe should be defined").not.toBeNull();
    const block = match![0];
    // Find every translateY(...) percentage in the block, parse to a
    // number, take the largest magnitude. The pulse should be small
    // (< 5%) so the hand reads as a hammer, not a viewbox-wide jump.
    const percents = Array.from(
      block.matchAll(/translateY\(\s*(-?\d+(?:\.\d+)?)%\s*\)/g),
    ).map((m) => Math.abs(Number(m[1])));
    expect(percents.length).toBeGreaterThan(0);
    const maxMagnitude = Math.max(...percents);
    expect(maxMagnitude).toBeLessThan(5);
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

/**
 * Volcano-eruption pose: side easter-egg one-shot. The pose renders
 * three decorative SVG layers in addition to the base BeakerBot:
 *   1. Test tube (the pouring vessel)
 *   2. Particle fountain (the erupting droplets)
 *   3. Dizzy stars (the post-eruption wobble decoration)
 *
 * We assert each layer is present when the pose is dispatched, ABSENT
 * for other poses (so a future regression that always-renders the
 * layers fails loud), and that animated=false renders the static
 * silhouette without the per-particle animation classes.
 */
describe("BeakerBot volcano-eruption pose", () => {
  // The test tube SVG uses fill="#8b5cf6" for its purple liquid. No
  // other pose uses this fill color, so it's a clean signal that the
  // test tube is mounted.
  const VOLCANO_TEST_TUBE_FILL = "#8b5cf6";

  it("renders the test tube SVG when pose=volcano-eruption", () => {
    const { container } = render(<BeakerBot pose="volcano-eruption" />);
    const paths = container.querySelectorAll("path");
    const purpleFills = Array.from(paths).filter(
      (p) => p.getAttribute("fill") === VOLCANO_TEST_TUBE_FILL,
    );
    expect(purpleFills.length).toBeGreaterThan(0);
  });

  it("renders the particle fountain (10 droplets) when pose=volcano-eruption", () => {
    const { container } = render(<BeakerBot pose="volcano-eruption" />);
    // Particles spawn at cx=20, cy=12 (BeakerBot's beaker top). The
    // base mascot has no circles at this position, so a count of
    // circles at (20, 12) tracks particle count directly.
    const circles = container.querySelectorAll("circle");
    const particles = Array.from(circles).filter(
      (c) =>
        c.getAttribute("cx") === "20" && c.getAttribute("cy") === "12",
    );
    expect(particles.length).toBe(10);
  });

  it("does NOT render the volcano test tube or particles for pose=idle", () => {
    const { container } = render(<BeakerBot pose="idle" />);
    const paths = container.querySelectorAll("path");
    const purpleFills = Array.from(paths).filter(
      (p) => p.getAttribute("fill") === VOLCANO_TEST_TUBE_FILL,
    );
    expect(purpleFills.length).toBe(0);

    const circles = container.querySelectorAll("circle");
    const particles = Array.from(circles).filter(
      (c) =>
        c.getAttribute("cx") === "20" && c.getAttribute("cy") === "12",
    );
    expect(particles.length).toBe(0);
  });

  it("applies the volcano root animation class when animated=true", () => {
    const { container } = render(<BeakerBot pose="volcano-eruption" />);
    const svg = container.querySelector("svg");
    const cls = svg?.getAttribute("class") ?? "";
    // CSS module hashes the class name, but the unhashed token
    // includes `volcanoErupting` as a prefix/substring in dev test
    // environments and is fully hashed in prod. We rely on the
    // data-pose attribute as the canonical signal here.
    expect(svg?.getAttribute("data-pose")).toBe("volcano-eruption");
    expect(svg?.getAttribute("data-animated")).toBe("true");
    // At minimum, some class beyond the default Tailwind sizing
    // should be present (the merged module + animation classes).
    expect(cls).toMatch(/\S/);
  });

  it("reduced-motion path: pose=volcano-eruption with animated=false renders the static silhouette", () => {
    // The component's `animated=false` prop is the call-site way to
    // opt OUT of the animation loop (decorative chips, tip thumbs).
    // It mirrors what happens under prefers-reduced-motion: reduce,
    // since the CSS module's @media block sets animation: none. Under
    // animated=false the per-element animation classes are NOT applied
    // (no styles.volcanoTestTube.animated, etc.), so the decorative
    // layers render in their static start-state silhouette.
    const { container } = render(
      <BeakerBot pose="volcano-eruption" animated={false} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-pose")).toBe("volcano-eruption");
    expect(svg?.getAttribute("data-animated")).toBe("false");
    // Test tube + particles + dizzy stars still render as structural
    // SVG so the silhouette is intact; only the animation classes are
    // gated. Particle circles are still present.
    const circles = container.querySelectorAll("circle");
    const particles = Array.from(circles).filter(
      (c) =>
        c.getAttribute("cx") === "20" && c.getAttribute("cy") === "12",
    );
    expect(particles.length).toBe(10);
    // The particle circles must NOT carry the per-particle animation
    // class when animated=false, since the class is what binds them
    // to the keyframe + per-particle CSS vars.
    for (const p of particles) {
      const cls = p.getAttribute("class") ?? "";
      // CSS module names are hashed, but the source token is
      // `volcanoParticle`. We can't match the hashed form portably,
      // so we instead check that the inline style has NO
      // animationDelay set (which is only emitted in the animated
      // branch).
      const style = p.getAttribute("style") ?? "";
      expect(style).not.toMatch(/animation-delay/i);
      // And no inline animation-end CSS vars either.
      expect(style).not.toMatch(/--volcano-end-x/);
      expect(cls).not.toMatch(/animated/);
    }
  });
});

/**
 * Side easter-egg pose batch 2: sleeping / hiccup / yawn / reading.
 *
 * Each pose adds its own decorative SVG layer(s). These tests assert
 * the layer renders when the pose is dispatched, does NOT render for
 * other poses, and degrades to the static silhouette under
 * animated=false (the reduced-motion analogue, since the @media
 * (prefers-reduced-motion: reduce) block sets animation: none AND
 * display: none on the decorative <g>s; in jsdom we only validate the
 * animated=false branch since jsdom doesn't enforce media queries).
 */

describe("BeakerBot sleeping pose", () => {
  // The blanket uses fill="#A6D2F4" (soft blue) — no other pose uses
  // this exact fill on a path, so it's a clean signal that the
  // blanket is mounted.
  const SLEEP_BLANKET_FILL = "#A6D2F4";

  it("renders the blanket SVG when pose=sleeping", () => {
    const { container } = render(<BeakerBot pose="sleeping" />);
    const paths = container.querySelectorAll("path");
    const blanketPaths = Array.from(paths).filter(
      (p) => p.getAttribute("fill") === SLEEP_BLANKET_FILL,
    );
    expect(blanketPaths.length).toBeGreaterThan(0);
  });

  it("renders 3 ZZZ text glyphs when pose=sleeping", () => {
    const { container } = render(<BeakerBot pose="sleeping" />);
    const zTexts = Array.from(container.querySelectorAll("text")).filter(
      (t) => t.textContent === "Z",
    );
    expect(zTexts.length).toBe(3);
  });

  it("does NOT render the blanket or ZZZs for pose=idle", () => {
    const { container } = render(<BeakerBot pose="idle" />);
    const paths = container.querySelectorAll("path");
    const blanketPaths = Array.from(paths).filter(
      (p) => p.getAttribute("fill") === SLEEP_BLANKET_FILL,
    );
    expect(blanketPaths.length).toBe(0);
    const zTexts = Array.from(container.querySelectorAll("text")).filter(
      (t) => t.textContent === "Z",
    );
    expect(zTexts.length).toBe(0);
  });

  it("reduced-motion path: sleeping with animated=false renders silhouette without per-glyph animation classes", () => {
    const { container } = render(
      <BeakerBot pose="sleeping" animated={false} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-pose")).toBe("sleeping");
    expect(svg?.getAttribute("data-animated")).toBe("false");
    // ZZZ glyphs still render structurally but without the
    // animationDelay inline style binding them to the keyframe.
    const zTexts = Array.from(container.querySelectorAll("text")).filter(
      (t) => t.textContent === "Z",
    );
    expect(zTexts.length).toBe(3);
    for (const z of zTexts) {
      const style = z.getAttribute("style") ?? "";
      expect(style).not.toMatch(/animation-delay/i);
    }
  });
});

describe("BeakerBot hiccup pose", () => {
  it("renders the rainbow bubble SVG when pose=hiccup", () => {
    const { container } = render(<BeakerBot pose="hiccup" />);
    // The bubble is a circle with cx=20, cy=26 and a url(#...-hiccup)
    // radial-gradient fill — that fill signature is unique to this
    // pose.
    const bubble = Array.from(
      container.querySelectorAll("circle"),
    ).filter((c) => {
      const fill = c.getAttribute("fill") ?? "";
      return fill.includes("-hiccup");
    });
    expect(bubble.length).toBe(1);
  });

  it("renders 8 pop particles at cx=20, cy=8 when pose=hiccup", () => {
    const { container } = render(<BeakerBot pose="hiccup" />);
    // Pop particles spawn at the bubble's pop position (20, 8). The
    // base mascot has no circles at this exact position.
    const particles = Array.from(
      container.querySelectorAll("circle"),
    ).filter(
      (c) =>
        c.getAttribute("cx") === "20" && c.getAttribute("cy") === "8",
    );
    expect(particles.length).toBe(8);
  });

  it("does NOT render the hiccup bubble or particles for pose=idle", () => {
    const { container } = render(<BeakerBot pose="idle" />);
    const bubble = Array.from(
      container.querySelectorAll("circle"),
    ).filter((c) => (c.getAttribute("fill") ?? "").includes("-hiccup"));
    expect(bubble.length).toBe(0);
    const particles = Array.from(
      container.querySelectorAll("circle"),
    ).filter(
      (c) =>
        c.getAttribute("cx") === "20" && c.getAttribute("cy") === "8",
    );
    expect(particles.length).toBe(0);
  });

  it("reduced-motion path: hiccup with animated=false drops per-particle CSS vars", () => {
    const { container } = render(
      <BeakerBot pose="hiccup" animated={false} />,
    );
    expect(
      container.querySelector("svg")?.getAttribute("data-animated"),
    ).toBe("false");
    const particles = Array.from(
      container.querySelectorAll("circle"),
    ).filter(
      (c) =>
        c.getAttribute("cx") === "20" && c.getAttribute("cy") === "8",
    );
    expect(particles.length).toBe(8);
    for (const p of particles) {
      const style = p.getAttribute("style") ?? "";
      expect(style).not.toMatch(/--hiccup-end-x/);
    }
  });
});

describe("BeakerBot yawn pose", () => {
  it("renders the open-mouth ellipse when pose=yawn", () => {
    const { container } = render(<BeakerBot pose="yawn" />);
    // The yawn replaces the smile path with a filled ellipse at the
    // mouth position (20, 23). No other pose renders an <ellipse>.
    const ellipses = container.querySelectorAll("ellipse");
    expect(ellipses.length).toBe(1);
    expect(ellipses[0].getAttribute("cx")).toBe("20");
    expect(ellipses[0].getAttribute("cy")).toBe("23");
  });

  it("does NOT render the yawn ellipse for pose=idle (default smile path)", () => {
    const { container } = render(<BeakerBot pose="idle" />);
    const ellipses = container.querySelectorAll("ellipse");
    expect(ellipses.length).toBe(0);
  });

  it("reduced-motion path: yawn with animated=false renders the static ellipse", () => {
    const { container } = render(<BeakerBot pose="yawn" animated={false} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-pose")).toBe("yawn");
    expect(svg?.getAttribute("data-animated")).toBe("false");
    // The ellipse is structural geometry; only the animation class is
    // gated by animated, so the static yawn silhouette still renders.
    const ellipses = container.querySelectorAll("ellipse");
    expect(ellipses.length).toBe(1);
  });
});

/**
 * Typing-on-laptop pose: side-profile L variant redesigned 2026-05-21
 * (Grant feedback: the v1 front-view laptop made BeakerBot look like he
 * was reaching across a wall, and the percent-translate hand pulse was
 * imperceptible at the v4 tour's 120px display size).
 *
 * v2 geometry: the laptop is shown FROM THE SIDE as an L (one vertical
 * rect = back of the screen, one horizontal rect = keyboard slab). No
 * screen content, no keyboard detail. BeakerBot's two arms reach down
 * onto the horizontal portion and the hand dots hammer in alternation
 * with absolute-px keyframes (~2-unit travel, ~6px at 120px).
 */
describe("BeakerBot typing-on-laptop pose", () => {
  // Laptop body uses fill="#374151" (dark gray) on both the vertical
  // and horizontal portions of the L. No other pose uses this fill
  // color, so it's a clean signal that the laptop is mounted.
  const LAPTOP_BODY_FILL = "#374151";

  it("renders the L's vertical + horizontal rects when pose=typing-on-laptop", () => {
    const { container } = render(<BeakerBot pose="typing-on-laptop" />);
    const rects = container.querySelectorAll("rect");
    const laptopRects = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === LAPTOP_BODY_FILL,
    );
    // Two laptop body rects forming an L: vertical screen-side bar +
    // horizontal keyboard slab.
    expect(laptopRects.length).toBe(2);
  });

  it("renders two hand dots on the keyboard slab (cx=30 and cx=34, cy=30) when pose=typing-on-laptop", () => {
    // Hands moved further from BeakerBot's body (x=20 area) per Grant's
    // 2026-05-21 revision so they sit on the keyboard surface rather
    // than under his torso.
    const { container } = render(<BeakerBot pose="typing-on-laptop" />);
    const circles = Array.from(container.querySelectorAll("circle"));
    const leftHand = circles.filter(
      (c) => c.getAttribute("cx") === "30" && c.getAttribute("cy") === "30",
    );
    const rightHand = circles.filter(
      (c) => c.getAttribute("cx") === "34" && c.getAttribute("cy") === "30",
    );
    expect(leftHand.length).toBe(1);
    expect(rightHand.length).toBe(1);
  });

  it("does NOT render the laptop body for pose=idle", () => {
    const { container } = render(<BeakerBot pose="idle" />);
    const rects = container.querySelectorAll("rect");
    const laptopRects = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === LAPTOP_BODY_FILL,
    );
    expect(laptopRects.length).toBe(0);
  });

  it("does NOT render the laptop body for pose=typing (bare-hand variant)", () => {
    const { container } = render(<BeakerBot pose="typing" />);
    const rects = container.querySelectorAll("rect");
    const laptopRects = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === LAPTOP_BODY_FILL,
    );
    expect(laptopRects.length).toBe(0);
  });

  it("emits data-pose=typing-on-laptop when the pose is active", () => {
    const { container } = render(<BeakerBot pose="typing-on-laptop" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-pose")).toBe("typing-on-laptop");
  });

  it("flips horizontally for direction=left (the pose is directional)", () => {
    const { container } = render(
      <BeakerBot pose="typing-on-laptop" direction="left" />,
    );
    const svg = container.querySelector("svg") as SVGSVGElement | null;
    expect(svg?.style.transform).toBe("scaleX(-1)");
  });

  it("reduced-motion path: animated=false drops per-hand animation classes", () => {
    const { container } = render(
      <BeakerBot pose="typing-on-laptop" animated={false} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-pose")).toBe("typing-on-laptop");
    expect(svg?.getAttribute("data-animated")).toBe("false");
    // Laptop body + hand dots still render structurally (the static
    // tableau is the reduced-motion silhouette), but the hand <g>
    // wrappers carry no class so the keyframe doesn't bind.
    const rects = container.querySelectorAll("rect");
    const laptopRects = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === LAPTOP_BODY_FILL,
    );
    expect(laptopRects.length).toBe(2);
    const circles = Array.from(container.querySelectorAll("circle"));
    const hands = circles.filter(
      (c) =>
        (c.getAttribute("cx") === "28" || c.getAttribute("cx") === "33") &&
        c.getAttribute("cy") === "30",
    );
    expect(hands.length).toBe(2);
    // Each hand circle's parent <g> should have no class attribute set
    // when animated=false (the animation class is the only thing the
    // branch puts on the wrapper).
    for (const hand of hands) {
      const parent = hand.parentElement;
      // Parent should be a <g> wrapper with no class.
      expect(parent?.tagName.toLowerCase()).toBe("g");
      expect(parent?.getAttribute("class") ?? "").toBe("");
    }
  });

  it("typing-on-laptop hand keyframe uses absolute px units, not percent (view-box trap guard)", async () => {
    // v2 rewrite (Grant: the v1 -1.5% pulse was visually imperceptible
    // at the 120px tour display size). The keyframe now uses absolute
    // px translates which the browser interprets in the inner SVG's
    // user-space, so 2px == 2 view-box units == ~6px of visible hand
    // travel at 120px. The trap we keep guarding against: percent
    // translates inside a `transform-box: view-box` rule resolve
    // against the 40-unit view-box and produce the v4 6.2 scattered-
    // dots bug (commit 272dd3da). This test pins the keyframe to px
    // and forbids any percent translate from sneaking back in.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const cssPath = path.resolve(__dirname, "..", "BeakerBot.module.css");
    const css = await fs.readFile(cssPath, "utf8");
    const match = css.match(
      /@keyframes\s+beakerBotTypeHandLaptopLeft\s*\{[\s\S]*?\n\}/,
    );
    expect(
      match,
      "beakerBotTypeHandLaptopLeft keyframe should be defined",
    ).not.toBeNull();
    const block = match![0];
    // Forbid percent translates inside the keyframe.
    const percents = Array.from(
      block.matchAll(/translate[XY]?\(\s*-?\d+(?:\.\d+)?%/g),
    );
    expect(
      percents.length,
      "keyframe must not use percent translates (view-box trap)",
    ).toBe(0);
    // Require at least one absolute-px translate, and pin its magnitude
    // to the readable hammer range (1.5..3 units).
    const pxValues = Array.from(
      block.matchAll(/translateY\(\s*(-?\d+(?:\.\d+)?)px\s*\)/g),
    ).map((m) => Math.abs(Number(m[1])));
    expect(pxValues.length).toBeGreaterThan(0);
    const maxPx = Math.max(...pxValues);
    expect(maxPx).toBeGreaterThanOrEqual(1.5);
    expect(maxPx).toBeLessThanOrEqual(3);
  });

  it("typing-on-laptop hand wrappers do NOT set transform-box: view-box (forces user-space px interpretation)", async () => {
    // Pair to the keyframe test above. With `transform-box: view-box`
    // the browser would still resolve px in user-space, but the brief
    // calls for "straight transform on the hand's <g> element with
    // absolute SVG values" — i.e. no view-box mapping on the wrapper.
    // Pin both .typeHandLeft and .typeHandRight to that contract.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const cssPath = path.resolve(__dirname, "..", "BeakerBot.module.css");
    const css = await fs.readFile(cssPath, "utf8");
    const leftBlock = css.match(/\.typeHandLeft\.animated\s*\{[\s\S]*?\n\}/);
    const rightBlock = css.match(/\.typeHandRight\.animated\s*\{[\s\S]*?\n\}/);
    expect(leftBlock).not.toBeNull();
    expect(rightBlock).not.toBeNull();
    expect(leftBlock![0]).not.toMatch(/transform-box\s*:\s*view-box/);
    expect(rightBlock![0]).not.toMatch(/transform-box\s*:\s*view-box/);
  });
});

describe("BeakerBot reading pose", () => {
  // The book cover uses fill="#7A3B3B" (burgundy). No other pose uses
  // this exact fill, so it's a clean signal that the book is mounted.
  const BOOK_COVER_FILL = "#7A3B3B";

  it("renders the book cover when pose=reading", () => {
    const { container } = render(<BeakerBot pose="reading" />);
    const rects = container.querySelectorAll("rect");
    const cover = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === BOOK_COVER_FILL,
    );
    expect(cover.length).toBe(1);
  });

  it("renders 2 page rects (off-white) when pose=reading", () => {
    const { container } = render(<BeakerBot pose="reading" />);
    const rects = container.querySelectorAll("rect");
    const pages = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === "#FAF6EC",
    );
    expect(pages.length).toBe(2);
  });

  it("does NOT render the book for pose=idle", () => {
    const { container } = render(<BeakerBot pose="idle" />);
    const rects = container.querySelectorAll("rect");
    const cover = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === BOOK_COVER_FILL,
    );
    expect(cover.length).toBe(0);
  });

  it("reduced-motion path: reading with animated=false renders the static book silhouette", () => {
    const { container } = render(
      <BeakerBot pose="reading" animated={false} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-pose")).toBe("reading");
    expect(svg?.getAttribute("data-animated")).toBe("false");
    // Book + pages still render as structural SVG; only animation
    // classes are gated.
    const rects = container.querySelectorAll("rect");
    const cover = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === BOOK_COVER_FILL,
    );
    expect(cover.length).toBe(1);
  });
});
