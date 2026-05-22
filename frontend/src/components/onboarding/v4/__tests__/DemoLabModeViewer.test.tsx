/**
 * DemoLabModeViewer + DemoLabModeMount tests.
 *
 * Covers:
 *   - Viewer renders with the DEMO pill + exit button.
 *   - Exit button click fires the provided `onExit` callback.
 *   - Escape key dismisses (also fires onExit).
 *   - All 8 tab buttons render with the matching data-tour-target
 *     anchors (lab-mode-*-tab + lab-mode-exit-button).
 *   - Mount host opens on `lab-mode-tour:open` and closes on
 *     `lab-mode-tour:close` window events.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";

// Mock the data hook so the viewer doesn't try to call labApi (which
// reaches into IndexedDB in the production graph).
const useLabDataMock = vi.fn();
vi.mock("@/hooks/useLabData", () => ({
  useLabData: () => useLabDataMock(),
}));

// Each Lab panel imports a lot of heavy code (recharts, etc.); stub
// them to lightweight markers so the viewer test focuses on the
// viewer chrome, not panel content.
vi.mock("@/components/LabUserFilterButton", () => ({
  default: () => <div data-testid="stub-LabUserFilterButton" />,
}));
vi.mock("@/components/LabSearchPanel", () => ({
  default: () => <div data-testid="stub-LabSearchPanel" />,
}));
vi.mock("@/components/TaskDetailPopup", () => ({
  default: () => <div data-testid="stub-TaskDetailPopup" />,
}));
vi.mock("@/components/LabGanttChart", () => ({
  default: () => <div data-testid="stub-LabGanttChart" />,
}));
vi.mock("@/components/LabPurchasesPanel", () => ({
  default: () => <div data-testid="stub-LabPurchasesPanel" />,
}));
vi.mock("@/components/LabExperimentsPanel", () => ({
  default: () => <div data-testid="stub-LabExperimentsPanel" />,
}));
vi.mock("@/components/LabActivityPanel", () => ({
  default: () => <div data-testid="stub-LabActivityPanel" />,
}));
vi.mock("@/components/LabMethodsPanel", () => ({
  default: () => <div data-testid="stub-LabMethodsPanel" />,
}));
vi.mock("@/components/LabRoadmapsPanel", () => ({
  default: () => <div data-testid="stub-LabRoadmapsPanel" />,
}));
vi.mock("@/components/LabUserDetailPanel", () => ({
  default: () => <div data-testid="stub-LabUserDetailPanel" />,
}));
vi.mock("@/components/NotesPanel", () => ({
  default: () => <div data-testid="stub-NotesPanel" />,
}));

import DemoLabModeViewer from "../DemoLabModeViewer";
import DemoLabModeMount, {
  DEMO_LAB_MODE_EVENTS,
  openDemoLabModeViewer,
  closeDemoLabModeViewer,
} from "../DemoLabModeMount";

const TAB_ANCHORS = [
  "lab-mode-activity-tab",
  "lab-mode-gantt-tab",
  "lab-mode-experiments-tab",
  "lab-mode-purchases-tab",
  "lab-mode-roadmaps-tab",
  "lab-mode-methods-tab",
  "lab-mode-notes-tab",
  "lab-mode-search-tab",
];

describe("DemoLabModeViewer", () => {
  beforeEach(() => {
    useLabDataMock.mockReset();
    useLabDataMock.mockReturnValue({
      users: [
        { username: "alex", color: "#abc" },
        { username: "morgan", color: "#def" },
      ],
      tasks: [],
      projects: [],
      isLoading: false,
      errorMessage: null,
      retry: () => {},
    });
  });

  it("renders the DEMO pill", () => {
    const { getByTestId } = render(
      <DemoLabModeViewer onExit={() => {}} />,
    );
    expect(getByTestId("demo-lab-mode-pill").textContent).toMatch(/Demo/i);
  });

  it("renders all 8 tab buttons with matching data-tour-target anchors", () => {
    const { container } = render(
      <DemoLabModeViewer onExit={() => {}} />,
    );
    for (const target of TAB_ANCHORS) {
      const el = container.querySelector(`[data-tour-target="${target}"]`);
      expect(el, `missing tour target: ${target}`).toBeTruthy();
    }
  });

  it("renders the Exit Lab Mode button with the lab-mode-exit-button anchor", () => {
    const { container, getByTestId } = render(
      <DemoLabModeViewer onExit={() => {}} />,
    );
    expect(
      container.querySelector('[data-tour-target="lab-mode-exit-button"]'),
    ).toBeTruthy();
    expect(getByTestId("demo-lab-mode-exit")).toBeTruthy();
  });

  it("clicking the Exit Lab Mode button fires onExit", () => {
    const onExit = vi.fn();
    const { getByTestId } = render(<DemoLabModeViewer onExit={onExit} />);
    fireEvent.click(getByTestId("demo-lab-mode-exit"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("pressing Escape fires onExit", () => {
    const onExit = vi.fn();
    render(<DemoLabModeViewer onExit={onExit} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("DemoLabModeMount host", () => {
  beforeEach(() => {
    useLabDataMock.mockReset();
    useLabDataMock.mockReturnValue({
      users: [],
      tasks: [],
      projects: [],
      isLoading: false,
      errorMessage: null,
      retry: () => {},
    });
  });

  it("renders nothing while closed", () => {
    const { queryByTestId } = render(<DemoLabModeMount />);
    expect(queryByTestId("demo-lab-mode-viewer")).toBeNull();
  });

  it("opens on the open event and closes on the close event", async () => {
    const { queryByTestId } = render(<DemoLabModeMount />);
    expect(queryByTestId("demo-lab-mode-viewer")).toBeNull();
    act(() => {
      openDemoLabModeViewer();
    });
    await waitFor(() => {
      expect(queryByTestId("demo-lab-mode-viewer")).toBeTruthy();
    });
    act(() => {
      closeDemoLabModeViewer();
    });
    await waitFor(() => {
      expect(queryByTestId("demo-lab-mode-viewer")).toBeNull();
    });
  });

  it("exposes the open / close event names as constants", () => {
    expect(DEMO_LAB_MODE_EVENTS.open).toBe("lab-mode-tour:open");
    expect(DEMO_LAB_MODE_EVENTS.close).toBe("lab-mode-tour:close");
  });
});
