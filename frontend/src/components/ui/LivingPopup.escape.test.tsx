import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import LivingPopup from "./LivingPopup";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { usePopupLayer } from "@/lib/ui/popup-stack";

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

  it("a nested overlay registered in the popup stack wins Escape over the LivingPopup it sits in", async () => {
    // Mirrors SharingSetupWizard launched from the embedded SendOutsideDialog on
    // the UnifiedShareDialog's "Outside your lab" tab. The wizard is NOT a
    // LivingPopup, it uses a window-level useEscapeToClose for its own Escape,
    // but it registers in the shared popup stack via usePopupLayer(true, false).
    // Registering puts it ABOVE the dialog in the stack, so the dialog's
    // LivingPopup sees isTop=false and stands its Escape down; the wizard then
    // closes itself, returning the user to the dialog rather than closing the
    // whole dialog (the UX refinement this test pins).
    //
    // It is toggled open AFTER the dialog mounts (as the real flow does, behind a
    // "set up sharing" click), so it registers last and is genuinely the top-most
    // layer. A nested child mounted at the same time as its parent would register
    // FIRST (child effects run before parent effects), which is not the real
    // ordering, hence the toggle.
    const dialogClose = vi.fn();
    const wizardClose = vi.fn();
    function WizardLike({ onClose }: { onClose: () => void }) {
      // The two hooks the real SharingSetupWizard uses for Escape + stack.
      useEscapeToClose(onClose);
      usePopupLayer(true, false);
      return <div>wizard body</div>;
    }
    function Harness() {
      const [wizardOpen, setWizardOpen] = useState(false);
      return (
        <LivingPopup open onClose={dialogClose} label="Share">
          <div>share body</div>
          <button type="button" onClick={() => setWizardOpen(true)}>
            open wizard
          </button>
          {wizardOpen && <WizardLike onClose={() => {
            wizardClose();
            setWizardOpen(false);
          }} />}
        </LivingPopup>
      );
    }
    render(<Harness />);
    await waitForPopup("share body");
    fireEvent.click(screen.getByText("open wizard"));
    await waitForPopup("wizard body");

    // First press closes ONLY the wizard; the dialog stands down.
    pressEscape();
    expect(wizardClose).toHaveBeenCalledTimes(1);
    expect(dialogClose).not.toHaveBeenCalled();

    // After the wizard unmounts (and deregisters from the stack), the dialog is
    // top-most again, so the next press reaches it. Wait for the wizard's
    // listener + stack entry to clear first.
    await waitFor(() => {
      pressEscape();
      expect(dialogClose).toHaveBeenCalledTimes(1);
    });
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
