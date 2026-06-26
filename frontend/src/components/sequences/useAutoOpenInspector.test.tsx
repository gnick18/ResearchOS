// sequence editor master, tests for the AUTO-OPEN rule of the contextual
// inspector (sequences redesign phase 3). A fresh selection opens the relevant
// rail op; the rule must not thrash (no re-fire on a same-kind re-render) and
// clearing the selection must not close or move the inspector.

import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useAutoOpenInspector } from "./useAutoOpenInspector";
import type { SelectionKind } from "@/lib/sequences/inspector-context";

afterEach(() => cleanup());

// A tiny harness that mirrors the production wiring: a selection identity +
// kind drive the hook, which opens the active op. We expose setters so a test
// can change the selection and re-render at will, plus a "bump" that forces a
// SAME-selection re-render (the thrash probe).
function Harness({
  setActiveOp,
  initialIdentity = "none",
  initialKind = "none",
}: {
  setActiveOp: (id: string) => void;
  initialIdentity?: string;
  initialKind?: SelectionKind;
}) {
  const [identity, setIdentity] = useState(initialIdentity);
  const [kind, setKind] = useState<SelectionKind>(initialKind);
  const [, setBump] = useState(0);
  useAutoOpenInspector(identity, kind, setActiveOp);
  return (
    <div>
      <button
        onClick={() => {
          setIdentity("region-100-120");
          setKind("region");
        }}
      >
        select-region
      </button>
      <button
        onClick={() => {
          setIdentity("feature-cds-3");
          setKind("feature-cds");
        }}
      >
        select-cds
      </button>
      <button
        onClick={() => {
          setIdentity("feature-primer-7");
          setKind("feature-primer");
        }}
      >
        select-primer
      </button>
      <button
        onClick={() => {
          setIdentity("none");
          setKind("none");
        }}
      >
        clear
      </button>
      <button onClick={() => setBump((n) => n + 1)}>bump</button>
    </div>
  );
}

function click(el: HTMLElement, text: string) {
  const btn = Array.from(el.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement;
  act(() => {
    btn.click();
  });
}

describe("useAutoOpenInspector", () => {
  it("a bare region selection does NOT auto-open anything", () => {
    // Highlighting a base range is constant while reading the map, so it must
    // not yank the Primers panel open. Only a deliberate feature pick does.
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-region");
    expect(setActiveOp).not.toHaveBeenCalled();
  });

  it("a CDS selection does NOT auto-open Protein (the rail op shimmers instead)", () => {
    // Picking a gene of interest must not auto-pop the protein analysis. The
    // protein panel only opens on an explicit rail click; the rail op shimmers
    // to invite it. So the auto-open hook never fires for a CDS pick.
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-cds");
    expect(setActiveOp).not.toHaveBeenCalled();
  });

  it("a primer selection does NOT auto-open Primers (the rail op shimmers instead)", () => {
    // Phase-3 follow-up (commit 8b21b2253): a single primer click no longer
    // yanks the Primers panel open. It selects the primer and shimmers the rail
    // op to invite a deliberate click (double-click opens it), matching the CDS
    // case above. So the auto-open hook never fires for a primer pick.
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-primer");
    expect(setActiveOp).not.toHaveBeenCalled();
  });

  it("clearing the selection does NOT open / close / move the inspector", () => {
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-primer");
    setActiveOp.mockClear();
    click(container, "clear");
    expect(setActiveOp).not.toHaveBeenCalled();
  });

  it("stays inert across a SAME-selection re-render (never spuriously fires)", () => {
    // Every selection kind shimmers its rail op instead of auto-opening today,
    // so the hook stays silent on a primer pick, and a same-identity re-render
    // must never spuriously call setActiveOp.
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-primer");
    click(container, "bump");
    click(container, "bump");
    expect(setActiveOp).not.toHaveBeenCalled();
  });

  it("never auto-opens as the selection identity changes between shimmer-only kinds", () => {
    // With no kind auto-opening, changing the selection identity (region ->
    // primer) still never opens a rail op. The identity-tracking machinery is
    // dormant until a future kind opts back into auto-open.
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-region");
    click(container, "select-primer");
    expect(setActiveOp).not.toHaveBeenCalled();
  });
});
