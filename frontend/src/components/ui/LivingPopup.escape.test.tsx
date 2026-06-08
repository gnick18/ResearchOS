import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import LivingPopup from "./LivingPopup";

/**
 * Escape-coordination regression tests for the shared LivingPopup primitive.
 *
 * The bug: LivingPopup's Escape handler closed on every press without checking
 * `event.defaultPrevented` or marking the event handled, so a single Escape
 * closed every stacked overlay at once (the "double-close"). The fix mirrors
 * useEscapeToClose, bail when already handled, and preventDefault +
 * stopPropagation when it acts. These tests pin the contract for the ~70
 * overlays built on this primitive.
 */

afterEach(() => cleanup());

// LivingPopup mounts on `open` then attaches its document-level Escape listener
// on the next effect pass. Wait for the body text before firing Escape so the
// listener is guaranteed registered.
async function waitForPopup(text: string) {
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
}

function pressEscape() {
  // Dispatch on the body so the event bubbles up to BOTH document (where
  // LivingPopup listens) and window (where useEscapeToClose-style parents
  // listen), exactly as a real key press does.
  fireEvent.keyDown(document.body, { key: "Escape" });
}

describe("LivingPopup Escape coordination", () => {
  it("closes a lone popup on Escape (the baseline must keep working)", async () => {
    const onClose = vi.fn();
    render(
      <LivingPopup open onClose={onClose} label="Lone">
        <div>lone body</div>
      </LivingPopup>,
    );
    await waitForPopup("lone body");

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on Escape when closeOnEscape is false", async () => {
    const onClose = vi.fn();
    render(
      <LivingPopup open onClose={onClose} label="Guarded" closeOnEscape={false}>
        <div>guarded body</div>
      </LivingPopup>,
    );
    await waitForPopup("guarded body");

    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("nested popups: one Escape closes only the inner, the outer survives", async () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    // The inner popup renders INSIDE the outer's children (genuine nesting), so
    // React runs the inner's effect first and its Escape listener registers
    // first. The inner closes and marks the event handled; the outer bails.
    render(
      <LivingPopup open onClose={outerClose} label="Outer">
        <div>outer body</div>
        <LivingPopup open onClose={innerClose} label="Inner">
          <div>inner body</div>
        </LivingPopup>
      </LivingPopup>,
    );
    await waitForPopup("inner body");

    pressEscape();
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it("nested popups: a second Escape then closes the outer (one layer per press)", async () => {
    function Stack() {
      const [innerOpen, setInnerOpen] = useState(true);
      const [outerOpen, setOuterOpen] = useState(true);
      return (
        <LivingPopup open={outerOpen} onClose={() => setOuterOpen(false)} label="Outer">
          <div>outer body</div>
          <LivingPopup
            open={innerOpen}
            onClose={() => setInnerOpen(false)}
            label="Inner"
          >
            <div>inner body</div>
          </LivingPopup>
        </LivingPopup>
      );
    }
    render(<Stack />);
    await waitForPopup("inner body");

    // First press closes the inner. Its body keeps rendering through the exit
    // animation, so assert on the live outer instead and wait for the inner's
    // listener to detach.
    pressEscape();
    await waitFor(() =>
      expect(screen.getByText("outer body")).toBeInTheDocument(),
    );

    // Second press now reaches the outer (the inner no longer handles Escape).
    // Give the inner a tick to finish unmounting its listener first.
    await waitFor(() => {
      pressEscape();
      expect(screen.queryByText("outer body")).not.toBeInTheDocument();
    });
  });

  it("a window-handler parent does not advance when a nested LivingPopup eats the Escape", async () => {
    // Mirrors NoteDetailPopup / TaskDetailPopup: a parent with a window-level
    // Escape handler that guards on defaultPrevented, wrapping a nested
    // LivingPopup overlay. The inner (document, bubbles first) closes and marks
    // the event handled, so the parent's window handler bails.
    const parentEscape = vi.fn();
    const innerClose = vi.fn();
    function Parent() {
      useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
          if (e.key !== "Escape" || e.defaultPrevented) return;
          e.preventDefault();
          parentEscape();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      return (
        <LivingPopup open onClose={innerClose} label="Inner over parent">
          <div>inner over parent</div>
        </LivingPopup>
      );
    }
    render(<Parent />);
    await waitForPopup("inner over parent");

    pressEscape();
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(parentEscape).not.toHaveBeenCalled();
  });

  it("sibling gating: the outer stands its Escape down so a sibling overlay wins", async () => {
    // Mirrors TaskModal (duplicate warning) and CompoundMethodBuilder
    // (ComponentPicker): the inner overlay is a SIBLING that mounts later, so it
    // cannot rely on registration order. The outer passes
    // closeOnEscape={!innerOpen}; only the inner handles the press.
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    function Siblings() {
      const innerOpen = true;
      return (
        <>
          <LivingPopup
            open
            onClose={outerClose}
            label="Outer form"
            closeOnEscape={!innerOpen}
          >
            <div>outer form body</div>
          </LivingPopup>
          {innerOpen && (
            <LivingPopup open onClose={innerClose} label="Sibling warning">
              <div>sibling warning body</div>
            </LivingPopup>
          )}
        </>
      );
    }
    render(<Siblings />);
    await waitForPopup("sibling warning body");

    pressEscape();
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});
