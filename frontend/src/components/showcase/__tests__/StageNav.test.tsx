// Tests for StageNav (Change 3): the persistent click nav that switches
// between the Runway view and the Scenes view (one at a time) and offers a
// Leave control to exit the show. This replaces the old scroll model.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { StageNav } from "../ShowcaseSections";

describe("StageNav", () => {
  it("renders Runway, Scenes, and Leave controls", () => {
    render(<StageNav view="runway" onSelect={() => {}} onLeave={() => {}} />);
    expect(screen.getByTestId("showcase-nav-runway")).toBeTruthy();
    expect(screen.getByTestId("showcase-nav-scenes")).toBeTruthy();
    expect(screen.getByTestId("showcase-nav-leave")).toBeTruthy();
  });

  it("marks the active view's button as pressed", () => {
    const { rerender } = render(
      <StageNav view="runway" onSelect={() => {}} onLeave={() => {}} />,
    );
    expect(
      screen.getByTestId("showcase-nav-runway").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("showcase-nav-scenes").getAttribute("aria-pressed"),
    ).toBe("false");

    rerender(<StageNav view="scenes" onSelect={() => {}} onLeave={() => {}} />);
    expect(
      screen.getByTestId("showcase-nav-scenes").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("showcase-nav-runway").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("calls onSelect with the chosen view", () => {
    const onSelect = vi.fn();
    render(<StageNav view="runway" onSelect={onSelect} onLeave={() => {}} />);
    fireEvent.click(screen.getByTestId("showcase-nav-scenes"));
    expect(onSelect).toHaveBeenCalledWith("scenes");
    fireEvent.click(screen.getByTestId("showcase-nav-runway"));
    expect(onSelect).toHaveBeenCalledWith("runway");
  });

  it("calls onLeave when Leave is clicked", () => {
    const onLeave = vi.fn();
    render(<StageNav view="runway" onSelect={() => {}} onLeave={onLeave} />);
    fireEvent.click(screen.getByTestId("showcase-nav-leave"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
