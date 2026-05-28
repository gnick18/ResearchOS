import { describe, expect, it } from "vitest";
import { shouldShowLanding, type LandingGateState } from "../landing-gate";

/** A truly-new visitor: nothing in IndexedDB, never engaged the landing,
 *  no bypass. The only state for which the landing should render. */
const trulyNew: LandingGateState = {
  isConnected: false,
  currentUser: null,
  lastConnectedFolder: null,
  availableUsers: [],
  seen: false,
  connectBypass: false,
};

describe("shouldShowLanding", () => {
  it("shows the landing for a genuinely-new visitor", () => {
    expect(shouldShowLanding(trulyNew)).toBe(true);
  });

  it("skips when the folder is already connected (silent reconnect)", () => {
    expect(shouldShowLanding({ ...trulyNew, isConnected: true })).toBe(false);
  });

  it("skips when a current user is stored", () => {
    expect(shouldShowLanding({ ...trulyNew, currentUser: "alex" })).toBe(false);
  });

  it("skips when a folder handle exists but needs a permission re-grant", () => {
    // lastConnectedFolder is non-null when a handle persists in IndexedDB
    // even though the silent reconnect did not auto-grant. That visitor is
    // returning and should land on the reconnect screen, not the sell.
    expect(
      shouldShowLanding({ ...trulyNew, lastConnectedFolder: "my-lab" }),
    ).toBe(false);
  });

  it("skips when users were discovered on the folder", () => {
    expect(
      shouldShowLanding({ ...trulyNew, availableUsers: ["alex", "morgan"] }),
    ).toBe(false);
  });

  it("skips once the visitor has seen / dismissed the landing", () => {
    expect(shouldShowLanding({ ...trulyNew, seen: true })).toBe(false);
  });

  it("skips when the ?connect=1 bypass is present (capture + dev)", () => {
    expect(shouldShowLanding({ ...trulyNew, connectBypass: true })).toBe(false);
  });

  it("bypass wins even for an otherwise truly-new visitor", () => {
    // The fresh folder-connect screenshot is captured at /?connect=1 in a
    // fresh context (truly-new) and must reach the connect screen, not the
    // landing.
    expect(
      shouldShowLanding({
        isConnected: false,
        currentUser: null,
        lastConnectedFolder: null,
        availableUsers: [],
        seen: false,
        connectBypass: true,
      }),
    ).toBe(false);
  });

  it("a returning visitor with everything set never sees the landing", () => {
    expect(
      shouldShowLanding({
        isConnected: true,
        currentUser: "alex",
        lastConnectedFolder: "my-lab",
        availableUsers: ["alex", "morgan"],
        seen: false,
        connectBypass: false,
      }),
    ).toBe(false);
  });
});
