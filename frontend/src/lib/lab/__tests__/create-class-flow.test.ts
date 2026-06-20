// Tests for lib/lab/create-class-flow.ts (Class Mode CM-P2A).
//
// runCreateClass must:
//  - resolve the account, ensure a local identity (minting one when absent),
//    read the OAuth email, then call provisionClassFolder with the composed
//    class name and return its switch + durability result,
//  - short-circuit with a typed reason when the account, identity, or email is
//    missing, and never call the provisioner in those cases,
//  - surface a provisioner failure verbatim,
//  - compose the class name with an optional term.
//
// All dependencies are injected, so no real session / identity / OPFS runs.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import {
  runCreateClass,
  composeClassName,
  type CreateClassFlowDeps,
} from "../create-class-flow";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import type { ProvisionClassFolderResult } from "../provision-class-folder";

const fakeIdentity = { username: "prof" } as unknown as StoredIdentity;

/** A happy-path deps set: account present, identity present, email present, the
 *  provisioner succeeds (persisted true). Each field is overridable per test. */
function makeDeps(
  over: Partial<CreateClassFlowDeps> = {},
): CreateClassFlowDeps {
  const okResult: ProvisionClassFolderResult = {
    ok: true,
    folderId: "folder-1",
    labId: "lab-1",
    persisted: true,
  };
  return {
    getCurrentUser: vi.fn(async () => "prof"),
    getSessionIdentity: vi.fn(() => fakeIdentity),
    ensureLocalIdentity: vi.fn(async () => undefined),
    getOauthEmail: vi.fn(async () => "prof@uni.edu"),
    provisionClassFolder: vi.fn(async () => okResult),
    ...over,
  };
}

describe("composeClassName", () => {
  it("returns the trimmed name alone when no term", () => {
    expect(composeClassName("  Genetics 410  ", "")).toBe("Genetics 410");
  });

  it("appends the term when present", () => {
    expect(composeClassName("Genetics 410", "Spring 2026")).toBe(
      "Genetics 410 Spring 2026",
    );
  });

  it("returns empty when the name is blank", () => {
    expect(composeClassName("   ", "Spring")).toBe("");
  });
});

describe("runCreateClass", () => {
  it("provisions with the composed class name and returns the switch result", async () => {
    const deps = makeDeps();
    const res = await runCreateClass(
      { name: "Genetics 410", term: "Spring 2026" },
      deps,
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.folderId).toBe("folder-1");
      expect(res.labId).toBe("lab-1");
      expect(res.persisted).toBe(true);
    }
    expect(deps.provisionClassFolder).toHaveBeenCalledTimes(1);
    expect(deps.provisionClassFolder).toHaveBeenCalledWith({
      username: "prof",
      identity: fakeIdentity,
      oauthEmail: "prof@uni.edu",
      className: "Genetics 410 Spring 2026",
    });
  });

  it("mints an identity when none is in the session, then provisions", async () => {
    let minted = false;
    const getSessionIdentity = vi.fn(() => (minted ? fakeIdentity : null));
    const ensureLocalIdentity = vi.fn(async () => {
      minted = true;
    });
    const deps = makeDeps({ getSessionIdentity, ensureLocalIdentity });

    const res = await runCreateClass({ name: "Bio 101", term: "" }, deps);

    expect(ensureLocalIdentity).toHaveBeenCalledWith("prof");
    expect(res.ok).toBe(true);
    expect(deps.provisionClassFolder).toHaveBeenCalledTimes(1);
  });

  it("returns no-account and never provisions when there is no account", async () => {
    const deps = makeDeps({ getCurrentUser: vi.fn(async () => null) });
    const res = await runCreateClass({ name: "X", term: "" }, deps);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-account");
    expect(deps.provisionClassFolder).not.toHaveBeenCalled();
  });

  it("returns no-identity and never provisions when no key can be obtained", async () => {
    const deps = makeDeps({
      getSessionIdentity: vi.fn(() => null),
      ensureLocalIdentity: vi.fn(async () => undefined),
    });
    const res = await runCreateClass({ name: "X", term: "" }, deps);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-identity");
    expect(deps.provisionClassFolder).not.toHaveBeenCalled();
  });

  it("returns no-email and never provisions when the session has no email", async () => {
    const deps = makeDeps({ getOauthEmail: vi.fn(async () => "") });
    const res = await runCreateClass({ name: "X", term: "" }, deps);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-email");
    expect(deps.provisionClassFolder).not.toHaveBeenCalled();
  });

  it("surfaces a provisioner failure verbatim", async () => {
    const failResult: ProvisionClassFolderResult = {
      ok: false,
      reason: "no-opfs",
      message: "This browser has no OPFS, so a managed class folder cannot be created.",
    };
    const deps = makeDeps({
      provisionClassFolder: vi.fn(async () => failResult),
    });
    const res = await runCreateClass({ name: "X", term: "" }, deps);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("provision-failed");
      expect(res.message).toBe(failResult.message);
    }
  });

  it("reports persisted:false so the caller can warn about durability", async () => {
    const notPersisted: ProvisionClassFolderResult = {
      ok: true,
      folderId: "folder-2",
      labId: "lab-2",
      persisted: false,
    };
    const deps = makeDeps({
      provisionClassFolder: vi.fn(async () => notPersisted),
    });
    const res = await runCreateClass({ name: "Chem 200", term: "" }, deps);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.persisted).toBe(false);
  });
});
