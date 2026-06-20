// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock next-auth's client signOut so the test never touches the network.
const signOutMock = vi.fn(async (..._args: unknown[]) => ({ url: "/" }));
vi.mock("next-auth/react", () => ({
  signOut: (...args: unknown[]) => signOutMock(...args),
}));

import { fullSignOut } from "./full-sign-out";

describe("fullSignOut", () => {
  let assignMock: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    signOutMock.mockClear();
    assignMock = vi.fn();
    originalLocation = window.location;
    // jsdom's location.assign is non-configurable, so swap the whole location
    // object for a stub carrying our spy.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: assignMock },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("clears the session without next-auth's own redirect, then hard-navigates to /", async () => {
    await fullSignOut();
    // The cookie clear must run with redirect:false so next-auth does not do its
    // own (race-prone) navigation that this fix replaces.
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
    // A single deterministic hard navigation to the front door.
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith("/");
  });

  it("forgets the connected folder before navigating, in order", async () => {
    const calls: string[] = [];
    signOutMock.mockImplementationOnce(async () => {
      calls.push("signOut");
      return { url: "/" };
    });
    const disconnect = vi.fn(async () => {
      calls.push("disconnect");
    });
    assignMock.mockImplementation(() => {
      calls.push("assign");
    });

    await fullSignOut({ disconnect });

    expect(disconnect).toHaveBeenCalledTimes(1);
    // Session clear -> folder forget -> hard reload. The folder must be forgotten
    // before the reload so "/" cannot auto-reconnect into the app.
    expect(calls).toEqual(["signOut", "disconnect", "assign"]);
  });

  it("still forgets the folder and navigates when the session clear throws", async () => {
    signOutMock.mockRejectedValueOnce(new Error("network"));
    const disconnect = vi.fn(async () => {});

    await fullSignOut({ disconnect });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith("/");
  });

  it("still navigates when disconnect throws", async () => {
    const disconnect = vi.fn(async () => {
      throw new Error("forget failed");
    });

    await fullSignOut({ disconnect });

    expect(assignMock).toHaveBeenCalledWith("/");
  });
});
