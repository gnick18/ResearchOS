import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import BeakerBotDock from "../BeakerBotDock";
import { useBeakerBotPanel } from "@/lib/ai/panel-store";

// BeakerBotDock is the app-wide home for BeakerBot, mounted ONCE in the root
// layout so its conversation persists across navigation. These tests pin two
// kinds of behavior, the panel mechanics (the summon button toggles the panel and
// the panel stays MOUNTED while closed, so useAiChat is never torn down), and the
// self-gate (the dock shows ONLY when the flag is on AND a user is connected AND
// the route is not /sequences or /wiki).

const holder = vi.hoisted(() => ({
  ai: true,
  currentUser: "mira" as string | null,
  pathname: "/workbench",
}));

// The panel mounts the navigation bridge (useNavigationBridge), which reads the
// App Router. There is no router provider in these unit renders, so mock
// next/navigation with inert stubs (mirrors the BeakerBotPanel test). usePathname
// is read by the dock's own visibility gate.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => holder.pathname,
}));

// The dock self-gates on the flag and a connected user, drive both from the
// hoisted holder so each test can flip them.
vi.mock("@/lib/ai/config", () => ({
  get AI_ASSISTANT_ENABLED() {
    return holder.ai;
  },
}));

vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ currentUser: holder.currentUser, isLoading: false }),
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
  // Default to a visible dock (flag on, user connected, ordinary app route).
  holder.ai = true;
  holder.currentUser = "mira";
  holder.pathname = "/workbench";
  // Reset the store to closed before each test.
  act(() => useBeakerBotPanel.getState().close());
});

afterEach(() => {
  vi.restoreAllMocks();
  holder.ai = true;
  holder.currentUser = "mira";
  holder.pathname = "/workbench";
  act(() => useBeakerBotPanel.getState().close());
});

describe("BeakerBotDock visibility gate", () => {
  it("does not render when the AI flag is off", () => {
    holder.ai = false;
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-dock")).toBeNull();
    expect(screen.queryByTestId("beakerbot-summon")).toBeNull();
  });

  it("does not render when no user is connected (pre-login / setup)", () => {
    holder.currentUser = null;
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-dock")).toBeNull();
    expect(screen.queryByTestId("beakerbot-summon")).toBeNull();
  });

  it("does not render on /sequences", () => {
    holder.pathname = "/sequences";
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-dock")).toBeNull();
  });

  it("does not render on /wiki", () => {
    holder.pathname = "/wiki/getting-started";
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-dock")).toBeNull();
  });

  it("renders on an ordinary app route when the flag is on and a user is connected", () => {
    render(<BeakerBotDock />);
    expect(screen.getByTestId("beakerbot-dock")).toBeInTheDocument();
    expect(screen.getByTestId("beakerbot-summon")).toBeInTheDocument();
  });
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
