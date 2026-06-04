// import overlay bot — covers the centered multi-file import progress modal:
//   - hidden for null progress and for single-file imports (total <= 1)
//   - renders a determinate bar at the right fraction for done/total
//   - shows the live count and the "stay on this page" warning

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ImportProgressOverlay from "./ImportProgressOverlay";

afterEach(() => cleanup());

describe("ImportProgressOverlay", () => {
  it("renders nothing when there is no progress", () => {
    const { container } = render(<ImportProgressOverlay progress={null} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders nothing for a single-file import (total <= 1)", () => {
    render(<ImportProgressOverlay progress={{ done: 0, total: 1 }} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the dialog, warning, and count for a multi-file import", () => {
    render(<ImportProgressOverlay progress={{ done: 3, total: 8 }} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Importing 3 of 8 files/)).toBeTruthy();
    expect(
      screen.getByText(/Keep this tab open and stay on this page/),
    ).toBeTruthy();
  });

  it("drives the progress bar fill width to the done/total fraction", () => {
    render(<ImportProgressOverlay progress={{ done: 2, total: 8 }} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("8");
    const fill = screen.getByTestId("import-progress-bar-fill") as HTMLElement;
    // 2 / 8 = 25%.
    expect(fill.style.width).toBe("25%");
  });

  it("clamps an over-count to 100% and the total", () => {
    render(<ImportProgressOverlay progress={{ done: 12, total: 8 }} />);
    const fill = screen.getByTestId("import-progress-bar-fill") as HTMLElement;
    expect(fill.style.width).toBe("100%");
    expect(screen.getByText(/Importing 8 of 8 files \(100%\)/)).toBeTruthy();
  });
});
