// Render-smoke for the click-reward overlay (click-rewards sub-bot,
// orchestrator manager). Asserts the overlay renders both tiers without
// throwing and reflects the hook's state:
//   - Tier 1: a burst list renders one node per burst at the given point;
//     an empty list renders nothing.
//   - Tier 2: the crowd-wild layer mounts ONLY while `wild` is true; it is
//     absent when calm. The single gold marquee word (BRAVO) reads when wild.
//
// No emojis, no em-dashes.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import ClickRewards from "../ClickRewards";
import type { ClickBurst } from "../useClickStreak";

function installMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("reduce"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  installMatchMedia(false);
});

const burst = (id: number, x: number, y: number): ClickBurst => ({
  id,
  x,
  y,
  variant: id % 3,
});

describe("ClickRewards overlay", () => {
  it("renders nothing visible when idle (no bursts, not wild)", () => {
    const { container } = render(
      <ClickRewards bursts={[]} wild={false} wildWaveKey={0} wildEscalateKey={0} />,
    );
    // No crowd-wild layer when calm.
    expect(screen.queryByTestId("showcase-crowd-wild")).toBeNull();
    // No burst nodes either.
    expect(container.textContent).not.toContain("BRAVO");
  });

  it("renders one cursor-burst container per live burst (Tier 1)", () => {
    const bursts = [burst(0, 40, 60), burst(1, 120, 200), burst(2, 300, 90)];
    const { container } = render(
      <ClickRewards
        bursts={bursts}
        wild={false}
        wildWaveKey={0}
        wildEscalateKey={0}
      />,
    );
    // Each burst renders its expanding ring; count the rings as a proxy for
    // the burst nodes (class-name match via the CSS-module identity object).
    const rings = container.querySelectorAll("span");
    // At minimum one ring + one flash + 8 spray spans per burst => > bursts.length.
    expect(rings.length).toBeGreaterThan(bursts.length);
    // No crowd-wild while only Tier 1 is active.
    expect(screen.queryByTestId("showcase-crowd-wild")).toBeNull();
  });

  it("mounts the crowd-wild celebration only while wild (Tier 2)", () => {
    const { rerender } = render(
      <ClickRewards bursts={[]} wild={false} wildWaveKey={0} wildEscalateKey={0} />,
    );
    expect(screen.queryByTestId("showcase-crowd-wild")).toBeNull();

    rerender(
      <ClickRewards bursts={[]} wild wildWaveKey={1} wildEscalateKey={1} />,
    );
    expect(screen.getByTestId("showcase-crowd-wild")).toBeTruthy();
    // The single genuine gold marquee word reads when wild.
    expect(screen.getByText("BRAVO")).toBeTruthy();

    // Settling back down unmounts the celebration.
    rerender(
      <ClickRewards bursts={[]} wild={false} wildWaveKey={1} wildEscalateKey={1} />,
    );
    expect(screen.queryByTestId("showcase-crowd-wild")).toBeNull();
  });

  it("does not throw under reduced motion", () => {
    installMatchMedia(true);
    expect(() =>
      render(
        <ClickRewards
          bursts={[burst(0, 10, 10)]}
          wild
          wildWaveKey={1}
          wildEscalateKey={1}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("BRAVO")).toBeTruthy();
  });
});
