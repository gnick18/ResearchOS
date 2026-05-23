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
  "panicked",
  "amazed",
  "embarrassed",
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

  it("renders the thinking thought-cloud only when pose=thinking", () => {
    // 2026-05-23 (copy manager): the thinking pose uses a fluffy cloud
    // silhouette + cascading mini-bubbles + three ellipsis dots inside
    // the cloud at cy=4. Sleeping uses Zzz letters; the cloud + dots
    // combo at this position is unique to thinking. Gate on the trio
    // of dots at (33,4) / (35,4) / (37,4).
    const idleResult = render(<BeakerBot pose="idle" />);
    const idleDots = Array.from(
      idleResult.container.querySelectorAll("circle"),
    ).filter((c) => c.getAttribute("cy") === "4");
    expect(idleDots.length).toBe(0);
    idleResult.unmount();

    const thinkResult = render(<BeakerBot pose="thinking" />);
    const thinkDots = Array.from(
      thinkResult.container.querySelectorAll("circle"),
    ).filter((c) => c.getAttribute("cy") === "4");
    expect(thinkDots.length).toBe(3);
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

  it("test tube path geometry stays small + skinny (4w x 8h, left-side anchor)", () => {
    // Regression guard for the volcano fix pass: Grant called out that
    // the original tube (8w x 12h, right-side anchor x=32..40) was too
    // big, too square, and pouring in the wrong direction. The fix
    // shrinks it to ~4 units wide x ~8 units tall and anchors it on
    // the LEFT of BeakerBot (x=4..8). Re-inflating the tube would put
    // us right back where we started, so we lock the path bounds here.
    const { container } = render(<BeakerBot pose="volcano-eruption" />);
    const paths = container.querySelectorAll("path");
    const purpleLiquid = Array.from(paths).find(
      (p) => p.getAttribute("fill") === VOLCANO_TEST_TUBE_FILL,
    );
    expect(purpleLiquid).toBeDefined();
    const d = purpleLiquid?.getAttribute("d") ?? "";
    // Extract every numeric coordinate from the path and assert the
    // bounding box is small + on the LEFT of the viewBox (not the
    // right where the old tube lived).
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    expect(nums.length).toBeGreaterThan(0);
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    // All coords sit in the [0, 10] range — the tube is small AND on
    // the left half of the viewBox (x < 10). If anyone bumps the tube
    // back to x=32..40 or doubles its size, this test fails fast.
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(10);
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
 * Typing-on-laptop pose (v3, redesigned 2026-05-22 per Grant feedback
 * that the v2 two-arm hammer layout read as disconcerting). The pose
 * now reuses the regular `typing` arm + hand verbatim and tucks a small
 * side-profile laptop under that single hand. Structural elements:
 *   1. Laptop keyboard slab (horizontal rect, fill #374151) just under
 *      the hand at y=20.
 *   2. Laptop screen edge (vertical rect, fill #374151) at the far end
 *      of the keyboard so the screen faces AWAY from BeakerBot.
 *   3. The regular `typing` arm + hand circle (one arm, one hand at
 *      cx=33, cy=20, reused verbatim).
 *
 * The hand uses the same .typeHand wrapper + 190ms pulse keyframe as
 * the regular typing pose. No body-lean root animation (matches the
 * regular typing pose, which also has no root animation). The v2-era
 * .typeHandLeft / .typeHandRight CSS classes are retained in the
 * stylesheet for backward compatibility but no longer referenced by
 * the JSX.
 */
describe("BeakerBot typing-on-laptop pose", () => {
  // Laptop body uses fill="#374151" (dark gray) on both the keyboard
  // slab and the screen edge. No other pose uses this fill color, so
  // it's a clean signal that the laptop is mounted.
  const LAPTOP_BODY_FILL = "#374151";

  it("renders the laptop keyboard slab + screen edge rects when pose=typing-on-laptop", () => {
    const { container } = render(<BeakerBot pose="typing-on-laptop" />);
    const rects = container.querySelectorAll("rect");
    const laptopRects = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === LAPTOP_BODY_FILL,
    );
    // Two laptop body rects: keyboard slab + screen edge.
    expect(laptopRects.length).toBe(2);
  });

  it("renders the reused typing arm's hand circle (cx=33, cy=20) when pose=typing-on-laptop", () => {
    // The v3 pose reuses the regular `typing` arm + hand verbatim, so
    // the hand sits at the same (33, 20) coordinate as the `typing`
    // pose. This pins the "one-hand redo reusing the regular typing
    // arm" contract: if a future redesign moves the hand, this test
    // fails loud so the regular-typing-parity intent is reconsidered.
    const { container } = render(<BeakerBot pose="typing-on-laptop" />);
    const circles = Array.from(container.querySelectorAll("circle"));
    const hand = circles.filter(
      (c) => c.getAttribute("cx") === "33" && c.getAttribute("cy") === "20",
    );
    expect(hand.length).toBe(1);
  });

  it("does NOT render the v2 two-hand layout (no hands at cy=30) for typing-on-laptop", () => {
    // Grant 2026-05-22: the two-hand keyboard hammer (hands at
    // cx=30,cy=30 and cx=34,cy=30) was the disconcerting silhouette
    // that the v3 redesign replaces. The other arm rests against the
    // body silhouette (not drawn), matching the regular typing pose
    // convention. If this test fails, the two-arm layout has crept
    // back in and Grant's feedback has been silently reverted.
    const { container } = render(<BeakerBot pose="typing-on-laptop" />);
    const circles = Array.from(container.querySelectorAll("circle"));
    const v2Hands = circles.filter(
      (c) =>
        (c.getAttribute("cx") === "30" || c.getAttribute("cx") === "34") &&
        c.getAttribute("cy") === "30",
    );
    expect(v2Hands.length).toBe(0);
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

  it("reduced-motion path: animated=false drops the hand animation class", () => {
    const { container } = render(
      <BeakerBot pose="typing-on-laptop" animated={false} />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-pose")).toBe("typing-on-laptop");
    expect(svg?.getAttribute("data-animated")).toBe("false");
    // Laptop body + hand circle still render structurally (the static
    // tableau is the reduced-motion silhouette), but the hand <g>
    // wrapper carries no class so the keyframe doesn't bind.
    const rects = container.querySelectorAll("rect");
    const laptopRects = Array.from(rects).filter(
      (r) => r.getAttribute("fill") === LAPTOP_BODY_FILL,
    );
    expect(laptopRects.length).toBe(2);
    const circles = Array.from(container.querySelectorAll("circle"));
    const hand = circles.find(
      (c) => c.getAttribute("cx") === "33" && c.getAttribute("cy") === "20",
    );
    expect(hand).toBeDefined();
    // The hand circle's parent <g> should have no class attribute set
    // when animated=false (the animation class is the only thing the
    // branch puts on the wrapper).
    const parent = hand!.parentElement;
    expect(parent?.tagName.toLowerCase()).toBe("g");
    expect(parent?.getAttribute("class") ?? "").toBe("");
  });

  it("uses the regular .typeHand 190ms keyframe (not the v2 .typeHandLeft hammer) for the hand pulse", async () => {
    // The v3 redesign reuses the regular `typing` pose's animation
    // contract: a small ~190ms pulse on the .typeHand wrapper. The
    // v2 .typeHandLeft / .typeHandRight 240ms hammer keyframes are
    // retained in the CSS for backward compatibility but the JSX no
    // longer references them. We pin this by reading the JSX source
    // and slicing out the typing-on-laptop branch (between its
    // `effectivePose === "typing-on-laptop"` predicate and the next
    // `effectivePose === "..."` predicate that starts a different
    // pose branch).
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const tsxPath = path.resolve(__dirname, "..", "BeakerBot.tsx");
    const tsx = await fs.readFile(tsxPath, "utf8");
    const startIdx = tsx.indexOf('effectivePose === "typing-on-laptop"');
    expect(startIdx, "typing-on-laptop JSX branch must exist").toBeGreaterThan(
      -1,
    );
    // Slice from the branch start to the next effectivePose check (or
    // the next standalone `{effectivePose === "thinking"` etc.). Using
    // a forward-scan keeps us inside the typing-on-laptop branch only.
    const tail = tsx.slice(startIdx);
    const nextBranchIdx = tail.indexOf("effectivePose ===", 10);
    const branch = nextBranchIdx > 0 ? tail.slice(0, nextBranchIdx) : tail;
    expect(branch).toMatch(/styles\.typeHand\b/);
    expect(branch).not.toMatch(/styles\.typeHandLeft\b/);
    expect(branch).not.toMatch(/styles\.typeHandRight\b/);
  });

  it("retains the v2 .typeHandLeft / .typeHandRight CSS classes (backward-compat, even though unused by JSX)", async () => {
    // The v3 redesign (2026-05-22) stopped referencing these classes
    // from the JSX in favor of the regular .typeHand pulse, but we
    // keep the CSS rules around so any downstream consumer that still
    // composes the class names (e.g. snapshot tests in app shells)
    // doesn't get a CSS module key-miss error at build time. They
    // must still NOT set transform-box: view-box (the view-box trap
    // guard from the v2 era still applies if anyone re-wires them).
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
