import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BeakerBotDock from "../BeakerBotDock";

// BeakerBotDock (Phase 4): the docked right-side panel is retired. The FAB is
// the only thing this component renders. Clicking it calls openBeakerBot()
// from useBeakerSearch, which opens the centered palette in Ask mode. There is
// no docked panel, no panel store, no data-open attribute.
//
// Tests cover:
//   1. The self-gate (flag off / no user / suppressed route -> nothing renders).
//   2. The FAB renders on ordinary routes when the gate passes.
//   3. Clicking the FAB calls openBeakerBot().
//   4. No beakerbot-dock element exists (the panel is gone).

const holder = vi.hoisted(() => ({
  ai: true,
  currentUser: "mira" as string | null,
  pathname: "/workbench",
}));

const mockOpenBeakerBot = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => holder.pathname,
}));

vi.mock("@/lib/ai/config", () => ({
  get AI_ASSISTANT_ENABLED() {
    return holder.ai;
  },
}));

vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ currentUser: holder.currentUser, isLoading: false }),
}));

// Mock the BeakerSearch context so BeakerBotDock can call openBeakerBot.
vi.mock("@/components/beaker-search/BeakerSearchProvider", () => ({
  useBeakerSearch: () => ({
    open: false,
    openPalette: vi.fn(),
    closePalette: vi.fn(),
    togglePalette: vi.fn(),
    hasSource: false,
    openBeakerBot: mockOpenBeakerBot,
  }),
}));

// Tooltip renders as a passthrough so the button is queryable.
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => {
  holder.ai = true;
  holder.currentUser = "mira";
  holder.pathname = "/workbench";
  mockOpenBeakerBot.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  holder.ai = true;
  holder.currentUser = "mira";
  holder.pathname = "/workbench";
});

describe("BeakerBotDock visibility gate", () => {
  it("does not render when the AI flag is off", () => {
    holder.ai = false;
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-summon")).toBeNull();
  });

  it("does not render when no user is connected (pre-login / setup)", () => {
    holder.currentUser = null;
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-summon")).toBeNull();
  });

  it("does not render on /sequences", () => {
    holder.pathname = "/sequences";
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-summon")).toBeNull();
  });

  it("does not render on /wiki", () => {
    holder.pathname = "/wiki/getting-started";
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-summon")).toBeNull();
  });

  it("renders on an ordinary app route when the flag is on and a user is connected", () => {
    render(<BeakerBotDock />);
    expect(screen.getByTestId("beakerbot-summon")).toBeInTheDocument();
  });
});

describe("BeakerBotDock FAB behavior (Phase 4)", () => {
  it("renders the summon button", () => {
    render(<BeakerBotDock />);
    expect(screen.getByTestId("beakerbot-summon")).toBeInTheDocument();
  });

  it("does NOT render a beakerbot-dock panel element (dock is retired)", () => {
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-dock")).toBeNull();
  });

  it("does NOT render a beakerbot-panel element (dock is retired)", () => {
    render(<BeakerBotDock />);
    expect(screen.queryByTestId("beakerbot-panel")).toBeNull();
  });

  it("calls openBeakerBot when the summon button is clicked", () => {
    render(<BeakerBotDock />);
    fireEvent.click(screen.getByTestId("beakerbot-summon"));
    expect(mockOpenBeakerBot).toHaveBeenCalledTimes(1);
  });

  it("calls openBeakerBot again on a second click (each tap resumes the palette)", () => {
    render(<BeakerBotDock />);
    fireEvent.click(screen.getByTestId("beakerbot-summon"));
    fireEvent.click(screen.getByTestId("beakerbot-summon"));
    expect(mockOpenBeakerBot).toHaveBeenCalledTimes(2);
  });
});
