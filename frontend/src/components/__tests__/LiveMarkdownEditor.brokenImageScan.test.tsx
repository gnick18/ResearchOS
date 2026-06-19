import "@/components/__tests__/prewarm-editor-chunk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useState } from "react";
import LiveMarkdownEditor from "../LiveMarkdownEditor";
import { fileService } from "@/lib/file-system/file-service";

/**
 * Broken-image scan loop guard.
 *
 * The edit-mode scan effect rewrites a broken local image ref in place when the
 * file already exists at the canonical `${imageBasePath}/Images/{basename}`
 * destination, then flushes the rewrite through onChange. That onChange feeds
 * the parent, which hands back a new value AND can hand back a fresh onChange
 * identity. If onChange were in the effect's dep array, a changed onChange
 * identity alone would re-run the effect, which calls onChange again, which is
 * the "Maximum update depth exceeded" loop a stale build hit.
 *
 * The fix reads onChange through a ref so a changed identity can no longer
 * re-fire the effect, and the rewrite stays idempotent via the processed-src
 * set plus the canonical-now-exists check. These tests pin both halves.
 *
 * The harness below deliberately passes a FRESH inline arrow as onChange on
 * every render (the exact NoteDetailPopup anti-pattern the fix hardens). Even
 * with an unstable onChange the scan must call it at most once.
 */

const BASE = "notes/mynote";
// Broken ref: oldfolder/foo.png does not exist, but the canonical copy at
// `${BASE}/Images/foo.png` does, so the scan rewrites the ref to Images/foo.png.
const BROKEN = "![diagram](oldfolder/foo.png)";
const FIXED = "![diagram](Images/foo.png)";

function ControlledEditor({
  initial,
  spy,
}: {
  initial: string;
  spy: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <LiveMarkdownEditor
      value={value}
      // Fresh arrow every render on purpose. With the ref-based scan effect this
      // must never feed a render loop.
      onChange={(next) => {
        spy(next);
        setValue(next);
      }}
      imageBasePath={BASE}
    />
  );
}

describe("LiveMarkdownEditor: broken-image scan loop guard", () => {
  beforeEach(() => {
    // fileExists is the only filesystem touch the scan needs. The canonical
    // Images copy exists, every other path is missing.
    vi.spyOn(fileService, "fileExists").mockImplementation(async (path: string) => {
      return path === `${BASE}/Images/foo.png`;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rewrites a recoverable broken ref exactly once and does not loop", async () => {
    const spy = vi.fn();
    render(<ControlledEditor initial={BROKEN} spy={spy} />);

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(FIXED);

    // The rewrite updates value, which re-renders and re-runs the scan against
    // the now-fixed content. Give that pass time to settle and confirm onChange
    // did not fire again.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on already-fixed content", async () => {
    const spy = vi.fn();
    render(<ControlledEditor initial={FIXED} spy={spy} />);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});
