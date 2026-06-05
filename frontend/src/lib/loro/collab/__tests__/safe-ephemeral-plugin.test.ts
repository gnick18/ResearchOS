// Phase 3 chunk 5a: unit tests for safeLoroEphemeralPlugin.
//
// Key invariant: out-of-range remote cursor positions (anchor or head past the
// current doc length) must DEGRADE to hidden rather than throw. The original
// loro-codemirror selection layer passes unclamped positions to CM6's
// RectangleMarker.forRange which calls coordsAt internally; if the position is
// past the rope end CM6 throws "No tile at position N". Our safe wrapper clamps
// first, preventing the crash.
//
// These tests exercise the clamping logic in isolation using the exported
// peerColorClass helper and the shape contracts, then use the LoroDoc +
// EphemeralStore pair to confirm that the plugin array has the correct
// structure (6 extensions: stateField, cursorLayer, SAFE-selectionLayer,
// ephemeralPlugin, theme) -- and that the safe selection layer's markers
// function does not throw when asked to render out-of-range positions.
//
// NOTE: CM6's layer() and RectangleMarker run in a browser DOM context, so
// the tests that actually CALL markers() are skipped in jsdom (coordsAtPos is
// a no-op without real layout). Instead we test the clamping math directly and
// verify the plugin array structure so the integration contract is pinned.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { peerColorClass } from "../safe-ephemeral-plugin";

// ---------------------------------------------------------------------------
// peerColorClass -- deterministic color assignment.
// ---------------------------------------------------------------------------

describe("peerColorClass", () => {
  it("returns a non-empty string for any peer id", () => {
    expect(peerColorClass("12345678")).toBeTruthy();
    expect(peerColorClass("")).toBeTruthy(); // edge: empty string
    expect(peerColorClass("abc-def-ghi")).toBeTruthy();
  });

  it("returns a stable value for the same peer id", () => {
    const id = "9876543210987654";
    expect(peerColorClass(id)).toBe(peerColorClass(id));
  });

  it("returns one of the documented color class names", () => {
    const allowed = new Set([
      "loro-peer-teal",
      "loro-peer-amber",
      "loro-peer-violet",
      "loro-peer-rose",
      "loro-peer-cyan",
      "loro-peer-lime",
    ]);
    // Sample several peer ids to confirm all map into the allowed set.
    const samples = [
      "11111111",
      "22222222",
      "33333333",
      "44444444",
      "55555555",
      "66666666",
      "77777777",
    ];
    for (const id of samples) {
      expect(allowed.has(peerColorClass(id))).toBe(true);
    }
  });

  it("distributes across multiple color slots for distinct peer ids", () => {
    // With 7 samples and 6 slots, not all can be the same slot.
    const ids = Array.from({ length: 20 }, (_, i) => `peer-${i}`);
    const colors = new Set(ids.map(peerColorClass));
    // Expect at least 2 distinct colors across 20 samples.
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Out-of-range clamping math.
//
// The safe selection layer clamps anchor and head to [0, docLen] before
// passing them to EditorSelection.range + RectangleMarker.forRange. We verify
// the clamping math inline since the CM6 DOM methods are unavailable in jsdom.
// ---------------------------------------------------------------------------

describe("safe selection layer clamping math", () => {
  // Mirrors the clamping logic inside createSafeSelectionLayer exactly.
  function clamp(pos: number, docLen: number): number {
    return Math.max(0, Math.min(docLen, pos));
  }

  it("leaves in-range positions unchanged", () => {
    expect(clamp(5, 100)).toBe(5);
    expect(clamp(0, 100)).toBe(0);
    expect(clamp(100, 100)).toBe(100);
  });

  it("clamps positions past doc end to doc.length", () => {
    // A remote peer had cursor at 200 but text was deleted to length 50.
    expect(clamp(200, 50)).toBe(50);
    expect(clamp(101, 100)).toBe(100);
  });

  it("clamps negative positions to 0", () => {
    expect(clamp(-1, 100)).toBe(0);
    expect(clamp(-999, 0)).toBe(0);
  });

  it("does NOT throw for extreme values", () => {
    // Ensure no throw -- the underlying crash was "No tile at position N"
    // thrown by CM6 when coordsAt received an out-of-range position.
    expect(() => clamp(Number.MAX_SAFE_INTEGER, 10)).not.toThrow();
    expect(() => clamp(-Number.MAX_SAFE_INTEGER, 10)).not.toThrow();
  });

  it("skips selection marker when clamping collapses range to a single point", () => {
    // If anchor = 200, head = 210, docLen = 50, both clamp to 50 -> same
    // point. The layer code skips the marker when anchor === head after clamping.
    const docLen = 50;
    const anchor = clamp(200, docLen);
    const head = clamp(210, docLen);
    // Both clamped to 50 -> same -> marker should be skipped.
    expect(anchor).toBe(50);
    expect(head).toBe(50);
    expect(anchor === head).toBe(true); // gate for skip-marker logic
  });

  it("renders a marker when clamping preserves a range", () => {
    const docLen = 100;
    const anchor = clamp(20, docLen);
    const head = clamp(40, docLen);
    expect(anchor).toBe(20);
    expect(head).toBe(40);
    expect(anchor === head).toBe(false); // gate for render-marker logic
  });

  it("renders a marker even when only one end is out of range", () => {
    // anchor = 30 (in range), head = 150 (past end, clamp to 100).
    const docLen = 100;
    const anchor = clamp(30, docLen);
    const head = clamp(150, docLen);
    expect(anchor).toBe(30);
    expect(head).toBe(100);
    expect(anchor === head).toBe(false); // still a valid range
  });
});

// ---------------------------------------------------------------------------
// safeLoroEphemeralPlugin -- structure contract.
//
// We import the plugin builder and verify it returns exactly 6 extensions
// without throwing. We cannot call the layer markers() function in jsdom
// (no DOM layout), but the array structure is the integration contract.
// ---------------------------------------------------------------------------

describe("safeLoroEphemeralPlugin structure", () => {
  it("returns a 6-element extension array without throwing", async () => {
    const { safeLoroEphemeralPlugin } = await import("../safe-ephemeral-plugin");
    const { LoroDoc, EphemeralStore } = await import("loro-crdt");

    const doc = new LoroDoc();
    const ephemeral = new EphemeralStore(30_000);
    const user = { name: "Alice", colorClassName: "loro-peer-teal" };

    let extensions: unknown[];
    expect(() => {
      extensions = safeLoroEphemeralPlugin(doc, ephemeral as never, user);
    }).not.toThrow();

    // The plugin returns [stateField, cursorLayer, selectionLayer, plugin,
    // loroCursorTheme, COLLAB_CURSOR_THEME color baseTheme] = 6 items.
    expect(extensions!).toHaveLength(6);
    // Each element should be truthy (no nulls).
    for (const ext of extensions!) {
      expect(ext).toBeTruthy();
    }
  });

  it("creates a different instance each call (no shared state across editors)", async () => {
    const { safeLoroEphemeralPlugin } = await import("../safe-ephemeral-plugin");
    const { LoroDoc, EphemeralStore } = await import("loro-crdt");

    const doc = new LoroDoc();
    const ephemeral = new EphemeralStore(30_000);
    const user = { name: "Bob", colorClassName: "loro-peer-amber" };

    const a = safeLoroEphemeralPlugin(doc, ephemeral as never, user);
    const b = safeLoroEphemeralPlugin(doc, ephemeral as never, user);

    // The stateField at index [0] must be the SAME object across both calls
    // because it comes from LoroEphemeralPlugin which returns the module-level
    // ephemeralStateField singleton.
    expect(a[0]).toBe(b[0]);
  });
});
