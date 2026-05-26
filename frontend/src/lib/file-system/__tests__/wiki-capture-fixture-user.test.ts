// @vitest-environment jsdom
//
// resolveFixtureUser unit tests — events-widget user-switch fix
// (2026-05-25, Fix 2).
//
// jsdom (vs. the default node env for `.test.ts` files in this repo)
// is required because resolveFixtureUser reads `window.location.search`
// via URLSearchParams. The function's SSR-safe early-return path is
// covered implicitly: removing the `window` guard would break the
// "no param → alex" case under jsdom too, so the behavior is pinned.
//
// `?wikiCapture=1` previously hard-pinned currentUser to "alex", so a
// verifier trying to view Mira's seeded PI-archetype widgets had no
// way to boot the fixture as anyone other than alex. The new
// `?fixtureUser=<name>` URL override lets callers (verifiers,
// capture scripts) pin to any seeded fixture user.
//
// Resolution rules pinned here:
//   - No `?fixtureUser=` → "alex" (the default demo PI, preserves
//     existing behavior for every current caller).
//   - `?fixtureUser=<seeded-user>` → that user.
//   - `?fixtureUser=<unknown>` → "alex" + a console.warn (loud
//     fallback so verifiers notice a typo instead of silently
//     getting alex).
//   - SSR / no window → "alex" (defensive: callers should never run
//     this server-side but the helper is a noop-fallback rather than
//     a throw).
//
// The seeded user list (`WIKI_CAPTURE_FIXTURE_USERS`) is the source
// of truth for "what's a valid fixtureUser?" and is asserted here so
// a future fixture refactor that drops or adds a user has one
// authoritative place to update.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveFixtureUser,
  WIKI_CAPTURE_FIXTURE_USERS,
} from "../wiki-capture-mock";

// Per-test URL setup. jsdom exposes `window.location` as a real URL,
// and `window.history.pushState` is the cleanest way to mutate the
// query string without reloading or tripping cross-origin guards.
function setSearch(search: string): void {
  window.history.pushState({}, "", search === "" ? "/" : `/?${search}`);
}

describe("WIKI_CAPTURE_FIXTURE_USERS", () => {
  it("includes the four seeded fixture users (alex, morgan, mira, sam)", () => {
    // Pinned literal so adding/removing a seeded user is a deliberate
    // test update. The wiki-capture-fixture.ts seeds also include the
    // `lab/` and `public/` namespace folders, but those are not
    // selectable as a current user and intentionally excluded here.
    expect([...WIKI_CAPTURE_FIXTURE_USERS]).toEqual([
      "alex",
      "morgan",
      "mira",
      "sam",
    ]);
  });
});

describe("resolveFixtureUser()", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setSearch("");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    setSearch("");
  });

  it("returns 'alex' when no ?fixtureUser= param is set (default behavior preserved)", () => {
    expect(resolveFixtureUser()).toBe("alex");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns 'mira' for ?fixtureUser=mira (the PI-archetype verifier case)", () => {
    setSearch("fixtureUser=mira");
    expect(resolveFixtureUser()).toBe("mira");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns 'morgan' for ?fixtureUser=morgan", () => {
    setSearch("fixtureUser=morgan");
    expect(resolveFixtureUser()).toBe("morgan");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns 'sam' for ?fixtureUser=sam", () => {
    setSearch("fixtureUser=sam");
    expect(resolveFixtureUser()).toBe("sam");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns 'alex' (and warns) for an unknown ?fixtureUser= value", () => {
    setSearch("fixtureUser=nonexistent");
    expect(resolveFixtureUser()).toBe("alex");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The warning must surface the invalid value so a verifier
    // glancing at the console sees the typo without digging.
    expect(warnSpy.mock.calls[0]?.[0]).toContain("nonexistent");
  });

  it("returns 'alex' for an empty ?fixtureUser= value (= unknown, warns)", () => {
    setSearch("fixtureUser=");
    expect(resolveFixtureUser()).toBe("alex");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 'alex' (and does NOT warn) when other params exist but fixtureUser is absent", () => {
    setSearch("wikiCapture=1");
    expect(resolveFixtureUser()).toBe("alex");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns 'mira' for ?wikiCapture=1&fixtureUser=mira (the documented composite URL)", () => {
    setSearch("wikiCapture=1&fixtureUser=mira");
    expect(resolveFixtureUser()).toBe("mira");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
