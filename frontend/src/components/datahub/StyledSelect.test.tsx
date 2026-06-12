// Behavior coverage for the custom Data Hub dropdown. The native <select> it
// replaces rendered an OS popup; this asserts the themed replacement opens on
// click, fires onChange and closes on select, and closes via Escape and
// click-away (the no-soft-lock guarantee).

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import StyledSelect from "./StyledSelect";

const OPTIONS = [
  { value: "none", label: "None" },
  { value: "linear", label: "Linear" },
  { value: "exp", label: "Exponential" },
];

afterEach(() => cleanup());

describe("StyledSelect", () => {
  it("opens the listbox on trigger click", () => {
    render(
      <StyledSelect
        value="none"
        options={OPTIONS}
        onChange={() => {}}
        ariaLabel="Fitted curve"
      />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("selecting an option fires onChange and closes", () => {
    const onChange = vi.fn();
    render(
      <StyledSelect
        value="none"
        options={OPTIONS}
        onChange={onChange}
        ariaLabel="Fitted curve"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Linear"));
    expect(onChange).toHaveBeenCalledWith("linear");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the open menu", () => {
    render(
      <StyledSelect value="none" options={OPTIONS} onChange={() => {}} />,
    );
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("click-away closes the open menu", () => {
    render(
      <StyledSelect value="none" options={OPTIONS} onChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("arrow keys move the cursor and Enter selects", () => {
    const onChange = vi.fn();
    render(
      <StyledSelect value="none" options={OPTIONS} onChange={onChange} />,
    );
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    // Opens seeded on "none" (index 0). Two downs lands on "exp" (index 2).
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("exp");
  });
});
