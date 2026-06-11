import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import BeakerBotDock from "../BeakerBotDock";
import { useBeakerBotPanel } from "@/lib/ai/panel-store";

// BeakerBotDock is the app-wide home for BeakerBot. These tests pin the two
// behaviors that make the navigate-and-spotlight fix work, the summon button
// toggles the panel open / closed, and the panel stays MOUNTED while closed (it
// is hidden with a transform, not unmounted), so the conversation in useAiChat is
// never torn down across navigation.

// The panel mounts the navigation bridge (useNavigationBridge), which reads the
// App Router. There is no router provider in these unit renders, so mock
// next/navigation with inert stubs (mirrors the BeakerBotPanel test).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The read tool reads from local-api. Mock it so the panel renders without a
// folder (the conversation hook is only constructed, never sent in these tests).
vi.mock("@/lib/local-api", () => ({
  fetchAllTasksIncludingShared: vi.fn(async () => []),
  projectsApi: { list: vi.fn(async () => []) },
}));

// Tooltip wraps the trigger; render it as a passthrough so the button is queryable.
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  // Reset the store to closed before each test.
  act(() => useBeakerBotPanel.getState().close());
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => useBeakerBotPanel.getState().close());
});

describe("BeakerBotDock", () => {
  it("renders the summon button and starts closed", () => {
    render(<BeakerBotDock />);
    expect(screen.getByTestId("beakerbot-summon")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-dock")).toHaveAttribute(
      "data-open",
      "false",
    );
  });

  it("keeps the panel mounted while closed (conversation survives)", () => {
    render(<BeakerBotDock />);
    // The panel is present in the DOM even before opening, so useAiChat is never
    // torn down. This is the property that lets a spotlight navigation preserve
    // the chat.
    expect(screen.getByTestId("beakerbot-panel")).toBeInTheDocument();
  });

  it("opens the panel when the summon button is clicked", () => {
    render(<BeakerBotDock />);
    fireEvent.click(screen.getByTestId("beakerbot-summon"));
    expect(screen.getByTestId("beakerbot-dock")).toHaveAttribute(
      "data-open",
      "true",
    );
    expect(useBeakerBotPanel.getState().isOpen).toBe(true);
  });

  it("closes the panel from the panel's close affordance without unmounting it", () => {
    render(<BeakerBotDock />);
    fireEvent.click(screen.getByTestId("beakerbot-summon"));
    expect(useBeakerBotPanel.getState().isOpen).toBe(true);

    // The docked panel exposes a close button (onClose wired to the store).
    fireEvent.click(screen.getByTestId("beakerbot-close"));
    expect(useBeakerBotPanel.getState().isOpen).toBe(false);
    // Still mounted, just hidden, so the conversation is preserved.
    expect(screen.getByTestId("beakerbot-panel")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-dock")).toHaveAttribute(
      "data-open",
      "false",
    );
  });
});
