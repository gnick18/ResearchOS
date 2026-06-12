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

// BeakerSearchAskHeader renders as a stub with a controllable back callback.
vi.mock("@/components/ai/BeakerSearchAskHeader", () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="beakersearch-ask-header-stub">
      <button data-testid="beakersearch-back-to-search" onClick={onBack} type="button">
        Back
      </button>
    </div>
  ),
}));

// The left history rail is its own component, stubbed here so the morph test
// does not pull in the persistence layer (listThreads etc.).
vi.mock("@/components/ai/BeakerChatRail", () => ({
  default: () => <div data-testid="beaker-chat-rail-stub" />,
}));

// Suppress createPortal: render inline so queries work.
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

// Stub the conversation store. The rider reads `sending` via the hook form
// (useConversationStore(selector)), and new-chat uses getState().clearConversation,
// so the mock must be BOTH callable (a zustand-style selector hook) and carry a
// getState method.
const { mockClearConversation } = vi.hoisted(() => ({
  mockClearConversation: vi.fn(),
}));
vi.mock("@/lib/ai/conversation-store", () => {
  const state = { clearConversation: mockClearConversation, sending: false };
  const useConversationStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useConversationStore.getState = () => state;
  return { useConversationStore };
});

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

  // New chat moved from the header into the left history rail (BeakerChatRail,
  // stubbed here), so it is covered by the rail's own tests, not the morph test.

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

// The "escalation panel-store regression guard" block was removed with the
// retirement of the docked panel (Phase 4). The old dock store (panel-store.ts,
// useBeakerBotPanel) is deleted, so the regression it guarded (escalation
// opening a separate dock) is now structurally impossible. Escalation morphs
// the palette and the FAB (openBeakerBot) opens it in Ask mode; there is no
// dock store left to touch.
