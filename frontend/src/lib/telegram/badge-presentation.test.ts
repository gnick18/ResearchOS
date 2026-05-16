// frontend/src/lib/telegram/badge-presentation.test.ts
//
// Unit tests for the header badge's pure presentation resolver. The
// stale-overlay rule is the load-bearing branch — these tests pin
// "yellow not red, only when ok + stale, never when something more
// specific is going on" so a future tweak can't silently regress
// Grant's feedback (banner-color shift was the whole reason this
// resolver exists). Other branches are smoke-checked to lock in the
// emerald-glow steady-state and the unpaired idle fallback.

import { describe, expect, it } from "vitest";

import { resolveBadgePresentation } from "./badge-presentation";

describe("resolveBadgePresentation", () => {
  it("paired + ok + not stale → emerald breathing glow", () => {
    const p = resolveBadgePresentation({
      paired: true,
      health: "ok",
      isStale: false,
    });
    expect(p.dot).toBe("bg-emerald-500");
    expect(p.tone).toBe("ok");
    expect(p.glow).toBe(true);
  });

  it("paired + ok + stale → flat amber dot, warn tone, no glow", () => {
    const p = resolveBadgePresentation({
      paired: true,
      health: "ok",
      isStale: true,
    });
    expect(p.dot).toBe("bg-amber-400");
    expect(p.tone).toBe("warn");
    expect(p.glow).toBe(false);
    // Grant explicitly: "not red — that indicates fail which this is
    // not quite that." Pin it.
    expect(p.dot).not.toMatch(/red/);
  });

  it("paired + retrying overrides the stale overlay (more specific)", () => {
    // Stale only modifies `ok`. `retrying` carries its own recovery
    // semantics (transient network blip), so the existing animated
    // amber dot + "retrying" label win.
    const p = resolveBadgePresentation({
      paired: true,
      health: "retrying",
      isStale: true,
    });
    expect(p.label).toBe("retrying");
    expect(p.dot).toContain("animate-pulse");
  });

  it("paired + auth_error overrides the stale overlay (more severe)", () => {
    const p = resolveBadgePresentation({
      paired: true,
      health: "auth_error",
      isStale: true,
    });
    expect(p.dot).toBe("bg-red-500");
    expect(p.tone).toBe("error");
    expect(p.label).toBe("re-pair needed");
  });

  it("unpaired → idle, regardless of health or stale signal", () => {
    const p = resolveBadgePresentation({
      paired: false,
      health: "ok",
      isStale: true,
    });
    expect(p.dot).toBe("bg-gray-300");
    expect(p.tone).toBe("idle");
    expect(p.glow).toBe(false);
  });
});
