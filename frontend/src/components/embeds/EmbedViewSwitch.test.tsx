// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import EmbedViewSwitch from "./EmbedViewSwitch";

const views = [
  { value: "map", label: "Map" },
  { value: "bases", label: "Bases" },
];

describe("EmbedViewSwitch", () => {
  it("renders nothing for fewer than two views", () => {
    const { container } = render(
      <EmbedViewSwitch views={[{ value: "map", label: "Map" }]} current="map" onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a button per view when two or more exist", () => {
    render(<EmbedViewSwitch views={views} current="map" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bases" })).toBeInTheDocument();
  });

  it("marks the current view as pressed", () => {
    render(<EmbedViewSwitch views={views} current="bases" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Bases" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onSelect with the clicked view value", () => {
    const onSelect = vi.fn();
    render(<EmbedViewSwitch views={views} current="map" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Bases" }));
    expect(onSelect).toHaveBeenCalledWith("bases");
  });
});
