import { describe, it, expect } from "vitest";
import { nextBeakerBotShortcutState } from "../BeakerSearchProvider";

// Cmd/Ctrl+J opens BeakerBot directly in Ask mode. The decision is a pure
// function of the current open + askMode so it can be tested without the
// provider's hook machinery (router, capabilities, object index).
describe("nextBeakerBotShortcutState (Cmd+J BeakerBot shortcut)", () => {
  it("opens in Ask mode when the palette is closed", () => {
    expect(nextBeakerBotShortcutState(false, "search")).toEqual({
      open: true,
      askMode: "ask",
    });
  });

  it("flips Search -> Ask when the palette is already open in Search", () => {
    expect(nextBeakerBotShortcutState(true, "search")).toEqual({
      open: true,
      askMode: "ask",
    });
  });

  it("toggles closed (and resets to Search) when already open in Ask", () => {
    expect(nextBeakerBotShortcutState(true, "ask")).toEqual({
      open: false,
      askMode: "search",
    });
  });

  it("opens in Ask from a closed-but-stale Ask mode (closed wins)", () => {
    // A closed palette whose last mode was Ask should still OPEN in Ask, not
    // toggle off, because it is not currently open.
    expect(nextBeakerBotShortcutState(false, "ask")).toEqual({
      open: true,
      askMode: "ask",
    });
  });
});
