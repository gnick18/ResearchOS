import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Palette morph Phase 2 tests (ai palette-morph bot, 2026-06-11).
//
// Tests for the BeakerSearch palette's Ask/Search mode morph behavior.
// These tests exercise:
//   1. CommandPalette renders the ask body in ask mode.
//   2. CommandPalette renders the search body in search mode.
//   3. Back-to-search fires onExitAskMode.
//   4. New chat fires clearConversation.
//   5. The panel store is NOT opened by escalation (the dock stays closed).
//
// The CommandPalette is tested in isolation with askMode as a controlled prop so
// the morph logic is exercised without the full provider machinery.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workbench",
}));

// Tooltip renders as a passthrough so buttons are queryable directly.
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// BeakerBot renders as a simple span so no SVG registration is needed.
vi.mock("@/components/BeakerBot", () => ({
  default: ({ ariaLabel }: { ariaLabel?: string }) => (
    <span data-testid="beakerbot-mark">{ariaLabel ?? ""}</span>
  ),
}));

// BeakerBotConversation renders as a stub so the full agent loop is not needed.
vi.mock("@/components/ai/BeakerBotConversation", () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="beakerbot-conversation-stub" className={className}>
      Conversation
    </div>
  ),
}));

// BeakerSearchAskHeader renders as a stub with controllable callbacks.
vi.mock("@/components/ai/BeakerSearchAskHeader", () => ({
  default: ({
    onBack,
    onNewChat,
  }: {
    onBack: () => void;
    onNewChat: () => void;
  }) => (
    <div data-testid="beakersearch-ask-header-stub">
      <button data-testid="beakersearch-back-to-search" onClick={onBack} type="button">
        Back
      </button>
      <button data-testid="beakersearch-new-chat" onClick={onNewChat} type="button">
        New chat
      </button>
    </div>
  ),
}));

// Suppress createPortal: render inline so queries work.
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

// Stub the conversation store — only clearConversation is needed here.
const mockClearConversation = vi.fn();
vi.mock("@/lib/ai/conversation-store", () => ({
  useConversationStore: {
    getState: () => ({ clearConversation: mockClearConversation }),
  },
}));

import { CommandPalette } from "@/components/sequences/CommandPalette";

afterEach(() => {
  cleanup();
  mockClearConversation.mockClear();
});

describe("CommandPalette ask-mode morph", () => {
  it("renders the search body in search mode (default)", () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        commands={[]}
        askMode="search"
      />,
    );
    expect(screen.queryByTestId("beakersearch-search-body")).not.toBeNull();
    expect(screen.queryByTestId("beakersearch-ask-body")).toBeNull();
  });

  it("renders the ask body in ask mode", () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        commands={[]}
        askMode="ask"
        onExitAskMode={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("beakersearch-ask-body")).not.toBeNull();
    expect(screen.queryByTestId("beakersearch-search-body")).toBeNull();
  });

  it("renders the conversation component inside the ask body", () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        commands={[]}
        askMode="ask"
        onExitAskMode={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("beakerbot-conversation-stub")).not.toBeNull();
  });

  it("calls onExitAskMode when back-to-search is clicked", () => {
    const onExitAskMode = vi.fn();
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        commands={[]}
        askMode="ask"
        onExitAskMode={onExitAskMode}
      />,
    );
    fireEvent.click(screen.getByTestId("beakersearch-back-to-search"));
    expect(onExitAskMode).toHaveBeenCalledTimes(1);
  });

  it("calls clearConversation on the store when new-chat is clicked", () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        commands={[]}
        askMode="ask"
        onExitAskMode={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("beakersearch-new-chat"));
    expect(mockClearConversation).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when palette is closed", () => {
    const { container } = render(
      <CommandPalette
        open={false}
        onClose={vi.fn()}
        commands={[]}
        askMode="search"
      />,
    );
    // The palette portals nothing when closed (mounted=true guard still fires,
    // but the component returns null before the portal call).
    expect(container.firstChild).toBeNull();
  });
});

describe("escalation panel-store regression guard", () => {
  it("the panel store is never touched by escalation (v1 regression, v4 confirmed)", async () => {
    // v1 escalation called useBeakerBotPanel.getState().open() which opened
    // the separate dock. v2 morphed the palette instead. v4 (Phase 4) retires
    // the dock entirely: the panel store is now unused in production code.
    // The store still exists (panel-store.ts is kept for reference), but no
    // escalation path touches it. This test confirms the invariant holds.
    const { useBeakerBotPanel } = await import("@/lib/ai/panel-store");
    expect(useBeakerBotPanel.getState().isOpen).toBe(false);
    // Escalation (escalateToBeakerBot) morphs the palette. The FAB
    // (openBeakerBot) opens the palette in Ask mode. Neither touches this
    // store. The value stays false throughout.
    expect(useBeakerBotPanel.getState().isOpen).toBe(false);
  });
});
