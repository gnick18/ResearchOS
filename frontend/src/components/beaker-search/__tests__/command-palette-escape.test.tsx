import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// CommandPalette Escape-layering tests (slash-escape fix, 2026-06-17).
//
// The palette registers itself as the BASE layer of the shared overlay stack
// (useEscapeLayer). A lighter surface opened on top of it, the BeakerBot slash
// command menu, registers ABOVE the palette via its own useEscapeLayer call. We
// reproduce that here by pushing a layer onto the SAME stack the palette uses,
// then assert one Escape closes only the topmost layer:
//   - no top layer  -> Escape closes the palette (onClose fires).
//   - slash on top   -> Escape closes the slash layer, palette stays open.
//   - slash popped   -> Escape reaches the palette again.
//
// This is the regression guard for the bug where Escape with the slash menu open
// closed the WHOLE dialog because the palette owned a raw window keydown listener
// that never yielded to surfaces above it.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workbench",
}));

vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/BeakerBot", () => ({
  default: ({ ariaLabel }: { ariaLabel?: string }) => (
    <span data-testid="beakerbot-mark">{ariaLabel ?? ""}</span>
  ),
}));

vi.mock("@/components/ai/BeakerBotConversation", () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="beakerbot-conversation-stub" className={className}>
      Conversation
    </div>
  ),
}));

vi.mock("@/components/ai/BeakerSearchAskHeader", () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="beakersearch-ask-header-stub">
      <button data-testid="beakersearch-back-to-search" onClick={onBack} type="button">
        Back
      </button>
    </div>
  ),
}));

vi.mock("@/components/ai/BeakerChatRail", () => ({
  default: () => <div data-testid="beaker-chat-rail-stub" />,
}));

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

vi.mock("@/lib/ai/conversation-store", () => {
  const state = { clearConversation: vi.fn(), sending: false };
  const useConversationStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useConversationStore.getState = () => state;
  return { useConversationStore };
});

import { CommandPalette } from "@/components/sequences/CommandPalette";
import {
  pushOverlay,
  overlayStackDepth,
  _resetOverlayStack,
} from "@/lib/ui/overlay-stack";

afterEach(() => {
  cleanup();
  _resetOverlayStack();
});

function pressEscape() {
  fireEvent.keyDown(window, { key: "Escape" });
}

describe("CommandPalette Escape layering", () => {
  it("closes the palette on Escape when no surface is open above it", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette open onClose={onClose} commands={[]} askMode="ask" onExitAskMode={vi.fn()} />,
    );
    // The palette pushed itself as the only (topmost) layer.
    expect(overlayStackDepth()).toBe(1);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes only the slash menu on Escape, leaving the dialog open", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette open onClose={onClose} commands={[]} askMode="ask" onExitAskMode={vi.fn()} />,
    );

    // Mirror what BeakerBotConversation's useEscapeLayer(slashOpen, closeOverlays)
    // does when the user types "/": push a layer ABOVE the palette.
    const closeSlash = vi.fn();
    const { pop } = pushOverlay(closeSlash);
    expect(overlayStackDepth()).toBe(2);

    pressEscape();
    // Topmost layer (the slash menu) handled it; the palette did not close.
    expect(closeSlash).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    // After the menu pops, a second Escape reaches the palette as before.
    pop();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
