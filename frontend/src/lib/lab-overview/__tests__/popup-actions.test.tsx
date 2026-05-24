// frontend/src/lib/lab-overview/__tests__/popup-actions.test.tsx
//
// Pins the three guarantees the popup-close hook exposes (popup-close
// hook manager, 2026-05-24):
//   1. `usePopupActions` returns a no-op default when no provider is in
//      the tree, so widget bodies rendered inline outside a popup can
//      call `closePopup()` without crashing or extra wrapping.
//   2. `PopupActionsProvider` injects a working `closePopup` that flows
//      through `useContext` to any descendant.
//   3. A child that calls `closePopup()` actually invokes the parent's
//      `onClose` callback — the wiring SnapshotTilePopup depends on.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PopupActionsProvider,
  usePopupActions,
} from "../popup-actions";

function Consumer({ label = "close" }: { label?: string }) {
  const { closePopup } = usePopupActions();
  return (
    <button type="button" onClick={() => closePopup()}>
      {label}
    </button>
  );
}

describe("popup-actions", () => {
  it("returns a no-op default when no provider is mounted", async () => {
    // No PopupActionsProvider ancestor. Clicking the button must not
    // throw — the no-op default is what widget bodies rely on when
    // they're rendered inline outside a popup.
    render(<Consumer label="standalone-close" />);
    const user = userEvent.setup();
    await user.click(screen.getByText("standalone-close"));
    // If we reach this line without an unhandled exception, the no-op
    // contract held. An explicit assertion keeps the test readable.
    expect(screen.getByText("standalone-close")).toBeInTheDocument();
  });

  it("injects a working closePopup that descendants can invoke", async () => {
    const closeSpy = vi.fn();
    render(
      <PopupActionsProvider closePopup={closeSpy}>
        <Consumer label="provided-close" />
      </PopupActionsProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("provided-close"));
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("propagates through nested children", async () => {
    // Sanity: SnapshotTilePopup wraps `children` once, but those
    // children are arbitrary widget bodies that may have their own
    // wrappers. The context must traverse normally.
    const closeSpy = vi.fn();
    render(
      <PopupActionsProvider closePopup={closeSpy}>
        <div>
          <section>
            <Consumer label="nested-close" />
          </section>
        </div>
      </PopupActionsProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("nested-close"));
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
