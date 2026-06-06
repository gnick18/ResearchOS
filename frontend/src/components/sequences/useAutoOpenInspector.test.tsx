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
  it("a region selection auto-opens Primers", () => {
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-region");
    expect(setActiveOp).toHaveBeenLastCalledWith("primers");
  });

  it("a CDS selection auto-opens Protein", () => {
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-cds");
    expect(setActiveOp).toHaveBeenLastCalledWith("protein");
  });

  it("a primer selection auto-opens Primers", () => {
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-primer");
    expect(setActiveOp).toHaveBeenLastCalledWith("primers");
  });

  it("clearing the selection does NOT open / close / move the inspector", () => {
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-region");
    setActiveOp.mockClear();
    click(container, "clear");
    expect(setActiveOp).not.toHaveBeenCalled();
  });

  it("does not thrash on a SAME-selection re-render", () => {
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-cds");
    expect(setActiveOp).toHaveBeenCalledTimes(1);
    // A re-render that does NOT change the selection identity must not re-open.
    click(container, "bump");
    click(container, "bump");
    expect(setActiveOp).toHaveBeenCalledTimes(1);
  });

  it("re-opens when the selection identity genuinely changes", () => {
    const setActiveOp = vi.fn();
    const { container } = render(<Harness setActiveOp={setActiveOp} />);
    click(container, "select-region");
    click(container, "select-cds");
    expect(setActiveOp).toHaveBeenCalledTimes(2);
    expect(setActiveOp).toHaveBeenNthCalledWith(1, "primers");
    expect(setActiveOp).toHaveBeenNthCalledWith(2, "protein");
  });
});
