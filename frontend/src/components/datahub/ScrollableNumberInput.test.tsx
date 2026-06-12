// Behavior coverage for the scroll-to-adjust number box. Typing parses and
// clamps; a wheel over a focused box steps the value (up increments, down
// decrements), Shift uses the big step, and min / max clamp at the bounds.

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import ScrollableNumberInput from "./ScrollableNumberInput";

afterEach(() => cleanup());

/** Dispatch a native wheel event on the input. The component focuses-gates the
 * handler, so the caller focuses the node first. */
function wheel(node: HTMLElement, deltaY: number, shiftKey = false) {
  node.dispatchEvent(
    new WheelEvent("wheel", { deltaY, shiftKey, bubbles: true, cancelable: true }),
  );
}

describe("ScrollableNumberInput", () => {
  it("fires onChange clamped when typing", () => {
    const onChange = vi.fn();
    render(
      <ScrollableNumberInput
        value={10}
        onChange={onChange}
        min={0}
        max={100}
        ariaLabel="Box"
      />,
    );
    const input = screen.getByLabelText("Box");
    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenLastCalledWith(42);

    // Above max clamps down to the bound.
    fireEvent.change(input, { target: { value: "500" } });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it("wheel up increments and wheel down decrements by step", () => {
    const onChange = vi.fn();
    render(
      <ScrollableNumberInput
        value={10}
        onChange={onChange}
        step={5}
        ariaLabel="Box"
      />,
    );
    const input = screen.getByLabelText("Box") as HTMLInputElement;
    input.focus();

    wheel(input, -1); // up
    expect(onChange).toHaveBeenLastCalledWith(15);

    wheel(input, 1); // down
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("Shift uses the big step", () => {
    const onChange = vi.fn();
    render(
      <ScrollableNumberInput
        value={100}
        onChange={onChange}
        step={1}
        bigStep={25}
        ariaLabel="Box"
      />,
    );
    const input = screen.getByLabelText("Box") as HTMLInputElement;
    input.focus();

    wheel(input, -1, true); // shift + up
    expect(onChange).toHaveBeenLastCalledWith(125);
  });

  it("defaults the big step to step * 10", () => {
    const onChange = vi.fn();
    render(
      <ScrollableNumberInput
        value={50}
        onChange={onChange}
        step={2}
        ariaLabel="Box"
      />,
    );
    const input = screen.getByLabelText("Box") as HTMLInputElement;
    input.focus();

    wheel(input, -1, true); // shift + up, bigStep defaults to 20
    expect(onChange).toHaveBeenLastCalledWith(70);
  });

  it("wheel clamps to min and max", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ScrollableNumberInput
        value={2}
        onChange={onChange}
        step={5}
        min={0}
        max={10}
        ariaLabel="Box"
      />,
    );
    const input = screen.getByLabelText("Box") as HTMLInputElement;
    input.focus();

    wheel(input, 1); // 2 - 5 would be -3, clamps to 0
    expect(onChange).toHaveBeenLastCalledWith(0);

    onChange.mockClear();
    rerender(
      <ScrollableNumberInput
        value={8}
        onChange={onChange}
        step={5}
        min={0}
        max={10}
        ariaLabel="Box"
      />,
    );
    wheel(input, -1); // 8 + 5 would be 13, clamps to 10
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it("rounds wheel steps to the step's decimal precision", () => {
    const onChange = vi.fn();
    render(
      <ScrollableNumberInput
        value={0.3}
        onChange={onChange}
        step={0.1}
        ariaLabel="Box"
      />,
    );
    const input = screen.getByLabelText("Box") as HTMLInputElement;
    input.focus();

    wheel(input, -1); // 0.3 + 0.1, rounded to one decimal
    expect(onChange).toHaveBeenLastCalledWith(0.4);
  });

  it("ignores the wheel when neither focused nor hovered", () => {
    const onChange = vi.fn();
    render(
      <ScrollableNumberInput value={10} onChange={onChange} ariaLabel="Box" />,
    );
    const input = screen.getByLabelText("Box") as HTMLInputElement;
    // Not focused, jsdom has no real hover, so the handler should bail.
    wheel(input, -1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
