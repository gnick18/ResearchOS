// frontend/src/components/FeedbackModal.test.tsx
//
// Coverage for the screenshot-attach feature added to the "Report an
// Issue" modal (feedback-screenshots bot). The modal submits by opening a
// prefilled GitHub new-issue URL, which is text-only, so images can never
// auto-flow into the issue. Instead we collect images in component state,
// append a `## Screenshots` prompt to the issue body, and copy the image
// to the user's clipboard so they can paste it into the GitHub
// description. These tests lock that contract:
//
//   1. attach via the file <input>, via paste, and via drop
//   2. remove a thumbnail
//   3. the generated GitHub URL gains a `## Screenshots` section when an
//      image is attached
//   4. on submit with an image, navigator.clipboard.write is invoked with
//      a ClipboardItem (mocked), and the modal transitions to the
//      "last step" confirmation rather than closing
//
// The body-builder section assertions live against generateGitHubIssueUrl
// directly so we don't have to scrape the URL out of a window.open spy.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import FeedbackModal from "./FeedbackModal";
import {
  generateGitHubIssueUrl,
  SCREENSHOTS_SECTION,
} from "@/lib/error-reporting";

// --- Environment shims for jsdom -------------------------------------------
// jsdom does not implement URL.createObjectURL / revokeObjectURL or the
// ClipboardItem constructor + navigator.clipboard.write, all of which the
// modal touches. Provide controllable stubs.

const createObjectURL = vi.fn(() => "blob:mock-url");
const revokeObjectURL = vi.fn();
// Typed param so `clipboardWrite.mock.calls[0][0]` indexes cleanly (the
// real signature is `write(items: ClipboardItem[])`).
const clipboardWrite = vi.fn(async (_items: MockClipboardItem[]) => {});

class MockClipboardItem {
  data: Record<string, Blob>;
  constructor(data: Record<string, Blob>) {
    this.data = data;
  }
}

function makeImageFile(name = "shot.png", type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  clipboardWrite.mockClear();
  clipboardWrite.mockResolvedValue(undefined);

  (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL =
    createObjectURL;
  (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL =
    revokeObjectURL;

  (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem =
    MockClipboardItem;

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: clipboardWrite, writeText: vi.fn(async () => {}) },
  });

  // window.open is called on submit; stub it so jsdom doesn't warn.
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Body builder ----------------------------------------------------------

describe("generateGitHubIssueUrl — screenshots section", () => {
  it("omits the Screenshots section when no images are attached", () => {
    const url = generateGitHubIssueUrl({
      type: "bug",
      description: "it broke",
      hasScreenshots: false,
    });
    const decoded = decodeURIComponent(url);
    expect(decoded).not.toContain("## Screenshots");
  });

  it("appends a `## Screenshots` section for every feedback type when an image is attached", () => {
    for (const type of ["bug", "feature", "feedback"] as const) {
      const url = generateGitHubIssueUrl({
        type,
        description: "something",
        hasScreenshots: true,
      });
      // URLSearchParams encodes spaces as "+"; decodeURIComponent leaves
      // those alone, so normalize "+" back to spaces (the way a form value
      // is decoded) before asserting on human-readable copy.
      const decoded = decodeURIComponent(url).replace(/\+/g, " ");
      expect(decoded).toContain(SCREENSHOTS_SECTION);
      expect(decoded).toContain("Paste your screenshot(s) below.");
    }
  });
});

// --- Attach / remove -------------------------------------------------------

describe("FeedbackModal — attaching screenshots", () => {
  it("attaches an image via the file input and renders a thumbnail", async () => {
    render(<FeedbackModal isOpen onClose={() => {}} />);

    const input = screen.getByLabelText("Attach screenshot images") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });

    const thumb = await screen.findByRole("img", { name: "shot.png" });
    expect(thumb).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("attaches an image via paste anywhere in the modal", async () => {
    render(<FeedbackModal isOpen onClose={() => {}} />);

    const file = makeImageFile("pasted.png");
    const dialog = screen.getByText("Report an Issue").closest("div")!;
    fireEvent.paste(dialog, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
        files: [file],
      },
    });

    expect(await screen.findByRole("img", { name: "pasted.png" })).toBeInTheDocument();
  });

  it("attaches an image via drag-and-drop onto the modal", async () => {
    render(<FeedbackModal isOpen onClose={() => {}} />);

    const file = makeImageFile("dropped.png");
    const dialog = screen.getByText("Report an Issue").closest("div")!;
    fireEvent.drop(dialog, {
      dataTransfer: { files: [file], items: [] },
    });

    expect(await screen.findByRole("img", { name: "dropped.png" })).toBeInTheDocument();
  });

  it("ignores non-image files", () => {
    render(<FeedbackModal isOpen onClose={() => {}} />);
    const input = screen.getByLabelText("Attach screenshot images") as HTMLInputElement;
    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [textFile] } });
    expect(screen.queryByRole("img", { name: "notes.txt" })).not.toBeInTheDocument();
  });

  it("removes a thumbnail and revokes its object URL", async () => {
    render(<FeedbackModal isOpen onClose={() => {}} />);

    const input = screen.getByLabelText("Attach screenshot images") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });

    await screen.findByRole("img", { name: "shot.png" });

    fireEvent.click(screen.getByRole("button", { name: "Remove shot.png" }));

    await waitFor(() => {
      expect(screen.queryByRole("img", { name: "shot.png" })).not.toBeInTheDocument();
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});

// --- Escape-to-close (app-wide convention) ---------------------------------

describe("FeedbackModal — Escape closes the modal", () => {
  it("calls onClose when Escape is pressed while open", () => {
    const onClose = vi.fn();
    render(<FeedbackModal isOpen onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not bind the Escape listener while closed", () => {
    const onClose = vi.fn();
    render(<FeedbackModal isOpen={false} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});

// --- Submit / clipboard ----------------------------------------------------

describe("FeedbackModal — submit with screenshots", () => {
  it("with no images, opens the issue and closes the modal (today's behavior)", () => {
    const onClose = vi.fn();
    render(<FeedbackModal isOpen onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText(/Describe what happened/i), {
      target: { value: "the thing broke" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create GitHub Issue" }));

    expect(window.open).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("with an image, calls navigator.clipboard.write with a ClipboardItem and shows the confirmation step instead of closing", async () => {
    const onClose = vi.fn();
    render(<FeedbackModal isOpen onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText(/Describe what happened/i), {
      target: { value: "the thing broke" },
    });

    const input = screen.getByLabelText("Attach screenshot images") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });
    await screen.findByRole("img", { name: "shot.png" });

    fireEvent.click(screen.getByRole("button", { name: "Create GitHub Issue" }));

    // window.open still fires (the issue opens), but the modal stays open
    // on a "last step" confirmation so the clipboard-paste flow is reachable.
    expect(window.open).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
    });

    // The blob passed to ClipboardItem must be an image.
    const item = clipboardWrite.mock.calls[0][0][0] as unknown as MockClipboardItem;
    expect(Object.keys(item.data)).toContain("image/png");

    // Confirmation state, not closed.
    expect(onClose).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("heading", { name: /Last step: add your screenshots/i }),
    ).toBeInTheDocument();

    // Done closes the modal.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces a graceful fallback when clipboard.write rejects", async () => {
    clipboardWrite.mockRejectedValue(new Error("denied"));
    render(<FeedbackModal isOpen onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Describe what happened/i), {
      target: { value: "broke" },
    });
    const input = screen.getByLabelText("Attach screenshot images") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeImageFile()] } });
    await screen.findByRole("img", { name: "shot.png" });

    fireEvent.click(screen.getByRole("button", { name: "Create GitHub Issue" }));

    // Still transitions to the confirmation step, with a fallback message.
    expect(
      await screen.findByRole("heading", { name: /Last step/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Could not copy the image automatically/i)).toBeInTheDocument();
  });

  it("per-thumbnail Copy button copies that specific image", async () => {
    render(<FeedbackModal isOpen onClose={() => {}} />);

    const input = screen.getByLabelText("Attach screenshot images") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeImageFile("a.png"), makeImageFile("b.png")] },
    });
    await screen.findByRole("img", { name: "a.png" });

    // Click the Copy button scoped to the second thumbnail.
    fireEvent.click(screen.getByRole("button", { name: "Copy b.png to clipboard" }));

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
    });
  });
});
