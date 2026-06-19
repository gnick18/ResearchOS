// Rotation behavior for ProgressEntertainer: the wait cycles through a
// pool of BeakerBot scenes instead of replaying only the centrifuge.
// Each entertainer scene is mocked with a tiny stub that identifies
// itself and exposes a button to fire onComplete, so the rotation can
// be driven deterministically without the real animation timers.
//
// The mocked order must match ENTERTAINER_SCENES in ProgressEntertainer:
//   0 centrifuge, 1 coffee, 2 bubbles, 3 beakers, 4 bugstomp.

import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// The decorative-animation gate ships OFF in production (POPUP_ANIMATIONS_ENABLED
// = false), which short-circuits ProgressEntertainer to null. These rotation tests
// exercise the scene cycling for when the gate is ON, so force it true here.
vi.mock("@/lib/animations/popup-gate", () => ({
  POPUP_ANIMATIONS_ENABLED: true,
}));

vi.mock("@/components/BeakerBotCentrifugeScene", () => ({
  default: ({ onComplete }: { active: boolean; onComplete: () => void }) => (
    <div data-testid="scene-centrifuge">
      <button data-testid="complete-centrifuge" onClick={() => onComplete()} />
    </div>
  ),
}));
vi.mock("@/components/BeakerBotCoffeeRefillScene", () => ({
  default: ({ onComplete }: { active: boolean; onComplete: () => void }) => (
    <div data-testid="scene-coffee">
      <button data-testid="complete-coffee" onClick={() => onComplete()} />
    </div>
  ),
}));
vi.mock("@/components/BeakerBotBlowingBubblesScene", () => ({
  default: ({ onComplete }: { active: boolean; onComplete: () => void }) => (
    <div data-testid="scene-bubbles">
      <button data-testid="complete-bubbles" onClick={() => onComplete()} />
    </div>
  ),
}));
vi.mock("@/components/BeakerBotTooManyBeakersScene", () => ({
  default: ({ onComplete }: { active: boolean; onComplete: () => void }) => (
    <div data-testid="scene-beakers">
      <button data-testid="complete-beakers" onClick={() => onComplete()} />
    </div>
  ),
}));
vi.mock("@/components/BeakerBotBugStompScene", () => ({
  default: ({ onComplete }: { active: boolean; onComplete: () => void }) => (
    <div data-testid="scene-bugstomp">
      <button data-testid="complete-bugstomp" onClick={() => onComplete()} />
    </div>
  ),
}));

import ProgressEntertainer from "../ProgressEntertainer";

describe("ProgressEntertainer scene rotation", () => {
  afterEach(() => cleanup());

  it("shows the first scene (centrifuge) on open", () => {
    render(<ProgressEntertainer open title="Exporting" />);
    expect(screen.getByTestId("scene-centrifuge")).toBeTruthy();
  });

  it("advances to the next scene after a loop completes", () => {
    vi.useFakeTimers();
    try {
      render(<ProgressEntertainer open title="Exporting" />);
      expect(screen.getByTestId("scene-centrifuge")).toBeTruthy();
      // Fire the active scene's onComplete, then let the 500ms breath
      // between loops elapse so the next scene mounts.
      fireEvent.click(screen.getByTestId("complete-centrifuge"));
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getByTestId("scene-coffee")).toBeTruthy();
      expect(screen.queryByTestId("scene-centrifuge")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("advances to a fresh scene on each re-open", () => {
    const { rerender } = render(<ProgressEntertainer open title="Exporting" />);
    expect(screen.getByTestId("scene-centrifuge")).toBeTruthy();
    // Close, then re-open: the next open should show a different scene.
    rerender(<ProgressEntertainer open={false} title="Exporting" />);
    rerender(<ProgressEntertainer open title="Exporting" />);
    expect(screen.getByTestId("scene-coffee")).toBeTruthy();
    expect(screen.queryByTestId("scene-centrifuge")).toBeNull();
  });
});
