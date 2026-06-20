// Multi-lab P2: runLabViewPullForSession unit tests.
//
// Covers:
//   - early exit when the session is not live (no network, no write).
//   - early exit when the relay has no lab record (null) - nothing to pull yet.
//   - happy path: roster owners -> pullLabView (decrypted under the SESSION key)
//     -> materialize. The session labKey + signing keys are forwarded to the
//     pull, proving decryption happens under the in-memory session key.
//   - residency union: pullLabView returns own + shared-with-me; the runner
//     materializes ONLY the shared-with-me half, leaving own records local.
//   - per-record sharing is enforced by pullLabView (not re-derived here): the
//     runner forwards the roster owners verbatim and adds no role-based read.
//   - P3 hardening: verifyMembershipLog is called over the relay record BEFORE
//     the roster owners are trusted; a forged roster (verify fails) is refused
//     and nothing is pulled or materialized.
//   - P3 roster: after the record pull, the ROSTER is materialized (presence +
//     settings + colors) over the VERIFIED record.
//
// All effects are injected; no real relay, crypto, or OPFS is touched.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { runLabViewPullForSession } from "../lab-view-pull-runner";
import type { LabSessionState } from "../lab-session";
import type { LabViewRecord } from "../lab-read";

const LAB_KEY = new Uint8Array(32).fill(7);
const SIGN_PRIV = new Uint8Array(32).fill(1);
const SIGN_PUB = new Uint8Array(32).fill(2);

function makeLiveSession(): LabSessionState {
  return {
    kind: "live",
    labId: "lab1",
    labKey: LAB_KEY,
    signingKeyPair: { ed25519Priv: SIGN_PRIV, ed25519Pub: SIGN_PUB },
    member: { username: "morgan", labId: "lab1" },
    graceUntil: null,
  };
}

function viewRecord(over: Partial<LabViewRecord>): LabViewRecord {
  return {
    key: over.key ?? "lab1/alex/note/1",
    owner: over.owner ?? "alex",
    recordType: over.recordType ?? "note",
    recordId: over.recordId ?? "1",
    plaintext: over.plaintext ?? new TextEncoder().encode("{}"),
    isOwn: over.isOwn ?? false,
    sharedWithViewer: over.sharedWithViewer ?? true,
  };
}

function remoteWith(owners: string[]) {
  return {
    record: {
      labId: "lab1",
      head: { username: owners[0] },
      members: owners.map((u) => ({ username: u })),
      keyGeneration: 1,
      log: [],
    },
    envelopes: [],
  } as never;
}

// The runner now verifies the membership log and materializes the roster. The
// record stubs above are NOT real signed records, so the happy-path tests inject
// a passing verify + a no-op roster materialize. Dedicated tests below exercise
// the real verify gate and the roster wiring separately.
const okVerify = vi.fn(() => ({ ok: true, reason: "" })) as never;
const noopRoster = vi.fn(async () => ({
  presenceWritten: [],
  settingsWritten: [],
  metadataAdded: [],
  viewer: "morgan",
})) as never;

describe("runLabViewPullForSession — early exits", () => {
  it("does nothing when the session is not live", async () => {
    const getRemoteImpl = vi.fn();
    const pullImpl = vi.fn();
    const materializeImpl = vi.fn();
    const result = await runLabViewPullForSession(
      { kind: "locked" },
      { getRemoteImpl, pullImpl, materializeImpl },
    );
    expect(result.ran).toBe(false);
    expect(result.reason).toBe("session not live");
    expect(getRemoteImpl).not.toHaveBeenCalled();
    expect(pullImpl).not.toHaveBeenCalled();
    expect(materializeImpl).not.toHaveBeenCalled();
  });

  it("does nothing when the relay has no lab record (null)", async () => {
    const getRemoteImpl = vi.fn(async () => null);
    const pullImpl = vi.fn();
    const materializeImpl = vi.fn();
    const result = await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl,
      materializeImpl,
    });
    expect(result.ran).toBe(false);
    expect(result.reason).toBe("no lab record");
    expect(pullImpl).not.toHaveBeenCalled();
    expect(materializeImpl).not.toHaveBeenCalled();
  });
});

describe("runLabViewPullForSession — happy path + crypto", () => {
  it("decrypts under the in-memory SESSION lab key + signing keys", async () => {
    const getRemoteImpl = vi.fn(async () => remoteWith(["morgan", "alex"]));
    const pullImpl = vi.fn(async () => [] as LabViewRecord[]);
    const materializeImpl = vi.fn(async () => ({
      written: [],
      skippedOwn: 0,
      skippedUnknownType: [],
    }));

    await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
      verifyImpl: okVerify,
      materializeRosterImpl: noopRoster,
    });

    expect(pullImpl).toHaveBeenCalledTimes(1);
    const arg = (pullImpl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.labId).toBe("lab1");
    expect(arg.viewer).toBe("morgan");
    // Owners forwarded verbatim from the head-signed roster.
    expect(arg.owners).toEqual(["morgan", "alex"]);
    // The SESSION key (not some other key) is what decrypts.
    expect(arg.labKey).toBe(LAB_KEY);
    expect(arg.signerEd25519Priv).toBe(SIGN_PRIV);
    expect(arg.signerEd25519Pub).toBe(SIGN_PUB);
  });

  it("forwards the FULL roster owners and adds no role-based read", async () => {
    const getRemoteImpl = vi.fn(async () =>
      remoteWith(["morgan", "alex", "sam"]),
    );
    const pullImpl = vi.fn(async () => [] as LabViewRecord[]);
    const materializeImpl = vi.fn(async () => ({
      written: [],
      skippedOwn: 0,
      skippedUnknownType: [],
    }));
    const result = await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
      verifyImpl: okVerify,
      materializeRosterImpl: noopRoster,
    });
    // The runner does not filter the roster by role; pullLabView enforces each
    // record's shared_with gate. owners are passed through unchanged.
    expect(result.owners).toEqual(["morgan", "alex", "sam"]);
  });
});

describe("runLabViewPullForSession — Stage 1 viewer x25519 threading", () => {
  const X25519_PRIV = new Uint8Array(32).fill(9);

  it("reads the viewer x25519 priv from the session identity and threads it into the pull", async () => {
    const getRemoteImpl = vi.fn(async () => remoteWith(["morgan", "alex"]));
    const pullImpl = vi.fn(async () => [] as LabViewRecord[]);
    const materializeImpl = vi.fn(async () => ({
      written: [],
      skippedOwn: 0,
      skippedUnknownType: [],
    }));
    // The injected identity stands in for getSessionIdentity(); per decision 1 the
    // runner reads keys.encryption.privateKey at call time (no new long-lived ref).
    const getIdentityImpl = vi.fn(
      () =>
        ({
          keys: {
            encryption: { privateKey: X25519_PRIV, publicKey: new Uint8Array(32) },
            signing: { privateKey: new Uint8Array(32), publicKey: new Uint8Array(32) },
          },
          deviceSalt: new Uint8Array(0),
        }) as never,
    );

    await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
      verifyImpl: okVerify,
      materializeRosterImpl: noopRoster,
      getIdentityImpl: getIdentityImpl as never,
    });

    const arg = (pullImpl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.viewerX25519Priv).toBe(X25519_PRIV);
  });

  it("threads undefined when the identity is locked (no key), so a subkeyed record skips cleanly", async () => {
    const getRemoteImpl = vi.fn(async () => remoteWith(["morgan", "alex"]));
    const pullImpl = vi.fn(async () => [] as LabViewRecord[]);
    const materializeImpl = vi.fn(async () => ({
      written: [],
      skippedOwn: 0,
      skippedUnknownType: [],
    }));
    const getIdentityImpl = vi.fn(() => null) as never;

    await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
      verifyImpl: okVerify,
      materializeRosterImpl: noopRoster,
      getIdentityImpl,
    });

    const arg = (pullImpl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.viewerX25519Priv).toBeUndefined();
  });
});

describe("runLabViewPullForSession — residency union", () => {
  it("materializes the shared-with-me half while own records stay local", async () => {
    const getRemoteImpl = vi.fn(async () => remoteWith(["morgan", "alex"]));

    // pullLabView returns own (morgan) + shared-with-me (alex). The runner hands
    // the WHOLE set to materialize, which is responsible for skipping own. Here
    // we assert the runner passes both records through and reports the pull count.
    const own = viewRecord({ owner: "morgan", isOwn: true, recordId: "100" });
    const shared = viewRecord({ owner: "alex", isOwn: false, recordId: "1" });
    const pullImpl = vi.fn(async () => [own, shared]);

    // A realistic materialize fake that applies the residency rule.
    const materializeImpl = vi.fn(async (records: LabViewRecord[]) => {
      const written = records
        .filter((r) => !r.isOwn)
        .map((r) => `users/${r.owner}/notes/${r.recordId}.json`);
      const skippedOwn = records.filter((r) => r.isOwn).length;
      return { written, skippedOwn, skippedUnknownType: [] };
    });

    const result = await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
      verifyImpl: okVerify,
      materializeRosterImpl: noopRoster,
    });

    expect(result.ran).toBe(true);
    expect(result.pulled).toBe(2); // own + shared returned by the pull
    expect(result.materialized?.skippedOwn).toBe(1); // own NOT written back
    expect(result.materialized?.written).toEqual(["users/alex/notes/1.json"]);
    // The whole pulled set reached materialize (own filtering happens there).
    const passed = (materializeImpl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(passed).toEqual([own, shared]);
  });
});

describe("runLabViewPullForSession — P3 verify gate", () => {
  it("refuses to pull when verifyMembershipLog fails (forged roster)", async () => {
    const getRemoteImpl = vi.fn(async () => remoteWith(["morgan", "mallory"]));
    const pullImpl = vi.fn();
    const materializeImpl = vi.fn();
    const materializeRosterImpl = vi.fn();
    // A forged roster fails the signed-log check.
    const verifyImpl = vi.fn(() => ({ ok: false, reason: "bad signature" }));

    const result = await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
      verifyImpl: verifyImpl as never,
      materializeRosterImpl: materializeRosterImpl as never,
    });

    expect(result.ran).toBe(false);
    expect(result.reason).toContain("membership log invalid");
    // A forged roster must NOT expand the enumerate set: no pull, no write.
    expect(pullImpl).not.toHaveBeenCalled();
    expect(materializeImpl).not.toHaveBeenCalled();
    expect(materializeRosterImpl).not.toHaveBeenCalled();
  });

  it("verifies the record BEFORE building the owners list", async () => {
    const remote = remoteWith(["morgan", "alex"]);
    const getRemoteImpl = vi.fn(async () => remote);
    const pullImpl = vi.fn(async () => [] as LabViewRecord[]);
    const materializeImpl = vi.fn(async () => ({
      written: [],
      skippedOwn: 0,
      skippedUnknownType: [],
    }));
    const verifyImpl = vi.fn(() => ({ ok: true, reason: "" }));

    await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
      verifyImpl: verifyImpl as never,
      materializeRosterImpl: noopRoster,
    });

    // verify ran over the SAME record whose members became the owners list.
    expect(verifyImpl).toHaveBeenCalledTimes(1);
    expect(verifyImpl).toHaveBeenCalledWith((remote as never as { record: unknown }).record);
  });
});

describe("runLabViewPullForSession — P3 roster materialize", () => {
  it("materializes the roster over the VERIFIED record after the record pull", async () => {
    const remote = remoteWith(["morgan", "alex"]);
    const getRemoteImpl = vi.fn(async () => remote);
    const pullImpl = vi.fn(async () => [] as LabViewRecord[]);
    const materializeImpl = vi.fn(async () => ({
      written: [],
      skippedOwn: 0,
      skippedUnknownType: [],
    }));
    const materializeRosterImpl = vi.fn(async () => ({
      presenceWritten: ["alex"],
      settingsWritten: ["alex"],
      metadataAdded: ["alex"],
      viewer: "morgan",
    }));

    const result = await runLabViewPullForSession(makeLiveSession(), {
      getRemoteImpl: getRemoteImpl as never,
      pullImpl: pullImpl as never,
      materializeImpl,
      verifyImpl: okVerify,
      materializeRosterImpl: materializeRosterImpl as never,
    });

    expect(materializeRosterImpl).toHaveBeenCalledTimes(1);
    const [recArg, viewerArg] = (
      materializeRosterImpl as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    // The roster materialize receives the VERIFIED record + the viewer.
    expect(recArg).toBe((remote as never as { record: unknown }).record);
    expect(viewerArg).toBe("morgan");
    expect(result.roster?.presenceWritten).toEqual(["alex"]);
  });
});
