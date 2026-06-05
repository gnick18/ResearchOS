import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useEscapeToClose } from "../useEscapeToClose";

function Dialog({ onClose, enabled }: { onClose: () => void; enabled?: boolean }) {
  useEscapeToClose(onClose, enabled);
  return <div>dialog</div>;
}

function pressEscape() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
}

afterEach(() => cleanup());

describe("useEscapeToClose", () => {
  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores non-Escape keys", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} enabled={false} />);
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("unbinds on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Dialog onClose={onClose} />);
    unmount();
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("only one layer acts per press (defaultPrevented guard)", () => {
    const first = vi.fn();
    const second = vi.fn();
    // Two overlays mounted at once. The first-registered listener handles the
    // press and marks the event handled; the second bails on defaultPrevented,
    // so a single Escape closes exactly one layer.
    render(
      <>
        <Dialog onClose={first} />
        <Dialog onClose={second} />
      </>,
    );
    pressEscape();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
