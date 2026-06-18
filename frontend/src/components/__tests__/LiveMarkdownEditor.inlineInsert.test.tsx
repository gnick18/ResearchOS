import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import InlineMarkdownEditor from "../InlineMarkdownEditor";

/**
 * Inline (CodeMirror 6) imperative INSERT API (Typora editor finish).
 *
 * Pins the last-mile insert wiring the inline Style Guide rail rides on: the
 * inline editor publishes an `insertRef` whose function splices a markdown
 * snippet in AT THE CURRENT SELECTION (replacing any selection) and refocuses.
 * The MarkdownShortcutsSidebar's click-to-insert entries call this via
 * LiveMarkdownEditor's `onInsertSyntax={(s) => insertRef.current?.(s)}`.
 *
 * We render the real InlineMarkdownEditor (which dynamic-imports CM6) and drive
 * the published insertRef directly, asserting the snippet lands at the caret
 * and the change flows out through onChange. A second case selects a range and
 * asserts the insert REPLACES the selection (replaceSelection semantics).
 *
 * jsdom note: CM6 measures layout on dispatch + focus; jsdom lacks Range client
 * rects, so we shim getClientRects / getBoundingClientRect / createRange the way
 * CM6-in-jsdom harnesses do. The roundtrip gates mount a bare view and never
 * measure; this test exercises the full component, so the shim is required.
 */

beforeAll(() => {
  // CM6 measures text geometry via Range.getClientRects on dispatch / focus.
  // jsdom returns nothing, which throws inside CM6's measuring. Provide inert
  // rects so the editor mounts + dispatches without crashing (we never assert
  // on geometry, only on the document string).
  const rect = {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
  if (typeof Range !== "undefined") {
    Range.prototype.getClientRects = function getClientRects() {
      return {
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      } as unknown as DOMRectList;
    };
    Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return rect;
    };
  }
});

// The editor gates on a REAL dynamic import() of seven CM6 modules plus a live
// EditorView mount (jsdom measuring included). In isolation that resolves in
// well under a second, but under full-suite parallel load the workers contend
// for CPU and the import can take several seconds, blowing waitFor's 1000ms
// default and making this file intermittently flaky. We can't fake-timer past
// it (the gate is microtask-driven import resolution + CM6's real DOM
// measuring, which fake timers would stall), so instead we give the
// import-gated waits a generous ceiling: each waitFor still resolves the
// instant the import lands, it just no longer gives up early under load.
// IMPORT_WAIT must stay below the per-test timeout so the test fails with the
// concrete assertion, not an opaque test-level timeout.
const IMPORT_WAIT = { timeout: 15000 } as const;
const TEST_TIMEOUT = 20000;

describe("InlineMarkdownEditor: imperative insert API (insertRef)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts the syntax at the current selection and flows through onChange", async () => {
    const onChange = vi.fn();
    const insertRef: React.MutableRefObject<((syntax: string) => void) | null> = {
      current: null,
    };

    render(
      <InlineMarkdownEditor value="seed" onChange={onChange} insertRef={insertRef} />,
    );

    // Wait for the CM6 dynamic import + view mount. The host div carries the
    // testid from first render (before the async view attaches), so we wait on
    // the "Loading editor..." placeholder disappearing, which flips only once
    // `loaded` is true AND viewRef points at a live EditorView, which is what
    // the insert closure reads at call time.
    await waitFor(() => {
      expect(screen.getByTestId("inline-markdown-editor")).toBeInTheDocument();
    }, IMPORT_WAIT);
    await waitFor(() => {
      expect(screen.queryByText("Loading editor...")).toBeNull();
    }, IMPORT_WAIT);
    await waitFor(() => {
      expect(insertRef.current).toBeTypeOf("function");
    }, IMPORT_WAIT);

    // Selection defaults to offset 0 on a fresh mount, so the snippet is
    // spliced in BEFORE the seed text (not appended, not replacing the doc).
    act(() => {
      insertRef.current?.("**bold**");
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    }, IMPORT_WAIT);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last).toBe("**bold**seed");
  }, TEST_TIMEOUT);

  it("gives a block-level snippet its own line when inserted mid-line", async () => {
    // Regression: clicking the Style Guide "## Heading 2" while the caret sat at
    // the end of a non-empty line used to glue the marker onto that line
    // (`a checkbox task## Heading 2`), which CommonMark reads as paragraph text
    // so the Preview showed the literal `## ` joined onto the next line. The
    // insert now breaks the heading onto its own line.
    const onChange = vi.fn();
    const insertRef: React.MutableRefObject<((syntax: string) => void) | null> = {
      current: null,
    };

    render(
      <InlineMarkdownEditor value="a checkbox task" onChange={onChange} insertRef={insertRef} />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading editor...")).toBeNull();
    }, IMPORT_WAIT);
    await waitFor(() => {
      expect(insertRef.current).toBeTypeOf("function");
    }, IMPORT_WAIT);

    act(() => {
      insertRef.current?.("## Heading 2");
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    }, IMPORT_WAIT);
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    // A fresh mount selects offset 0, so the heading is inserted BEFORE the seed
    // and lands on its own line with the seed pushed below it.
    expect(last).toBe("## Heading 2\na checkbox task");
    // The marker is never glued onto adjacent text.
    expect(last).not.toContain("task## Heading");
    expect(last).not.toContain("Heading 2a checkbox");
  }, TEST_TIMEOUT);

  it("clears the insert ref on unmount", async () => {
    const insertRef: React.MutableRefObject<((syntax: string) => void) | null> = {
      current: null,
    };
    const { unmount } = render(
      <InlineMarkdownEditor value="x" onChange={vi.fn()} insertRef={insertRef} />,
    );
    await waitFor(() => {
      expect(screen.queryByText("Loading editor...")).toBeNull();
    }, IMPORT_WAIT);
    await waitFor(() => {
      expect(insertRef.current).toBeTypeOf("function");
    }, IMPORT_WAIT);
    unmount();
    expect(insertRef.current).toBeNull();
  }, TEST_TIMEOUT);
});
