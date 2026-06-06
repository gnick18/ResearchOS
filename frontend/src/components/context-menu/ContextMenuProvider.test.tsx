// sequence editor master. Tests for the website-wide smart right-click framework.
//
// The provider owns ONE shared menu plus the no-menu glyph, and one document-level
// contextmenu listener in the bubble phase. The contract under test.
//   1. The global fallback BAILS on an editable target, so the browser's native
//      menu is preserved (the event is not defaultPrevented, no glyph).
//   2. The global fallback TRIGGERS the glyph on a bare non-text right-click
//      (defaultPrevented, glyph rendered).
//   3. openMenu opens the ONE shared menu with the given items.
//   4. A registered handler that calls openMenu (which preventDefaults) stops the
//      glyph, so a claimed right-click never shows the no-menu mark.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import {
  ContextMenuProvider,
  useContextMenu,
  isEditableTarget,
} from "./ContextMenuProvider";
import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";

afterEach(() => cleanup());

// A right-click helper. jsdom's fireEvent.contextMenu dispatches a real, bubbling,
// cancelable MouseEvent, so document-level bubble-phase listeners and
// defaultPrevented both work as in a browser.
function rightClick(el: Element): MouseEvent {
  const ev = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 60,
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

describe("isEditableTarget", () => {
  it("flags inputs, textareas, selects, and contenteditable", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    document.body.append(input, textarea, select, ce);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(select)).toBe(true);
    expect(isEditableTarget(ce)).toBe(true);
    input.remove();
    textarea.remove();
    select.remove();
    ce.remove();
  });

  it("does not flag a bare div", () => {
    const div = document.createElement("div");
    document.body.append(div);
    expect(isEditableTarget(div)).toBe(false);
    div.remove();
  });
});

describe("the global fallback", () => {
  it("bails on an editable target so the native menu is preserved", () => {
    render(
      <ContextMenuProvider>
        <input data-testid="field" defaultValue="hello" />
      </ContextMenuProvider>,
    );
    const ev = rightClick(screen.getByTestId("field"));
    // Native menu preserved: we never prevented default, and no glyph appeared.
    expect(ev.defaultPrevented).toBe(false);
    expect(document.querySelector(".no-menu-glyph")).toBeNull();
  });

  it("triggers the glyph on a bare non-text right-click", () => {
    render(
      <ContextMenuProvider>
        <div data-testid="bare">bare panel</div>
      </ContextMenuProvider>,
    );
    const ev = rightClick(screen.getByTestId("bare"));
    // Acknowledged: default prevented (no native menu) and the glyph is shown.
    expect(ev.defaultPrevented).toBe(true);
    expect(document.querySelector(".no-menu-glyph")).not.toBeNull();
  });
});

// A tiny consumer that opens the shared menu from its own onContextMenu, so we can
// exercise openMenu through the real document event path.
function Consumer({ items }: { items: EditMenuItem[] }) {
  const { openMenu } = useContextMenu();
  return (
    <div data-testid="zone" onContextMenu={(e) => openMenu(e, items)}>
      zone
    </div>
  );
}

describe("openMenu", () => {
  it("opens the ONE shared menu with the given items", () => {
    const onRun = vi.fn();
    render(
      <ContextMenuProvider>
        <Consumer
          items={[
            { id: "a", label: "Do the thing", enabled: true, onRun },
            { id: "b", label: "Other thing", enabled: true, group: true, onRun: () => {} },
          ]}
        />
      </ContextMenuProvider>,
    );
    rightClick(screen.getByTestId("zone"));
    // The shared editor menu surface renders with our items.
    const menu = screen.getByTestId("sequence-context-menu");
    expect(menu).toBeInTheDocument();
    const item = screen.getByRole("menuitem", { name: "Do the thing" });
    fireEvent.click(item);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("a registered handler's preventDefault stops the glyph", () => {
    render(
      <ContextMenuProvider>
        <Consumer items={[{ id: "a", label: "Do the thing", enabled: true, onRun: () => {} }]} />
      </ContextMenuProvider>,
    );
    const ev = rightClick(screen.getByTestId("zone"));
    // openMenu prevented default, so the global fallback saw the event as handled.
    expect(ev.defaultPrevented).toBe(true);
    // The menu is open and NO glyph was shown.
    expect(screen.getByTestId("sequence-context-menu")).toBeInTheDocument();
    expect(document.querySelector(".no-menu-glyph")).toBeNull();
  });

  it("an empty items array opens nothing and shows no glyph", () => {
    render(
      <ContextMenuProvider>
        <Consumer items={[]} />
      </ContextMenuProvider>,
    );
    const ev = rightClick(screen.getByTestId("zone"));
    // Still claimed (default prevented, native suppressed) but nothing opens.
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.queryByTestId("sequence-context-menu")).toBeNull();
    expect(document.querySelector(".no-menu-glyph")).toBeNull();
  });
});
