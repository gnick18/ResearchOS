// Privacy guard surface coverage for the wiki-capture real-user shadowing
// case. The provider sets `captureRefused` in exactly one place (the
// `realFolderConnected` refuse branch in file-system-context.tsx) when a
// `?wikiCapture=…` install is rejected because a real folder + real user are
// already connected. This banner is the visible signal that capture mode did
// NOT engage and the person's real data is on screen.
//
// What this pins:
//   - When the flag is set, a visible, role="alert" warning renders with the
//     "real folder is connected" copy.
//   - When the flag is false (normal use, true fixture install, /demo), the
//     banner renders nothing.
//   - The acknowledge button removes the banner (the only way to dismiss it).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import WikiCaptureRefusedBanner from "../WikiCaptureRefusedBanner";

// Stub the file-system context so we drive `captureRefused` directly without
// mounting the whole provider tree (mirrors how the guard predicate test
// isolates the provider's decision).
const mockState = { captureRefused: false };
vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => mockState,
}));

afterEach(() => {
  cleanup();
  mockState.captureRefused = false;
});

describe("WikiCaptureRefusedBanner", () => {
  it("renders a visible warning when capture install was refused", () => {
    mockState.captureRefused = true;
    render(<WikiCaptureRefusedBanner />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain(
      "Capture mode is unavailable while your real folder is connected",
    );
    expect(alert.textContent).toContain("Your real research data is showing");
  });

  it("renders nothing in the normal path (flag false)", () => {
    mockState.captureRefused = false;
    const { container } = render(<WikiCaptureRefusedBanner />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("hides after the person acknowledges it", () => {
    mockState.captureRefused = true;
    render(<WikiCaptureRefusedBanner />);

    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /i understand/i }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
