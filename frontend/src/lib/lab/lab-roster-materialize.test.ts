// frontend/src/lib/lab/lab-roster-materialize.test.ts
//
// Tests for the roster materialize + ghost-cleanup reconcile. The reconcile
// TOMBSTONES (not destroys) a previously-materialized co-member who has left the
// relay roster, never tombstones the viewer or the head, is idempotent across
// re-runs, and un-tombstones a re-added member. All effects are injected so the
// test runs in node with no browser / FSA.

import { describe, it, expect } from "vitest";
import {
  materializeLabRoster,
  type RosterFileIO,
} from "./lab-roster-materialize";
import type { LabMember, LabRecord } from "./lab-membership";

// ── Helpers ─────────────────────────────────────────────────────────────────

function member(username: string, role: LabMember["role"]): LabMember {
  return {
    username,
    role,
    // The fingerprint derivation tolerates a malformed key (returns null and
    // leaves displayName unset); these tests do not exercise the directory
    // fetch, so a non-hex placeholder is fine and keeps fetchProfile a no-op.
    ed25519PublicKey: "zz",
    x25519PublicKey: "zz",
  } as LabMember;
}

function record(head: string, members: string[]): LabRecord {
  const headMember = member(head, "head");
  return {
    head: headMember,
    members: [headMember, ...members.map((m) => member(m, "member"))],
  } as LabRecord;
}

interface EntryLike {
  color: string;
  created_at: string;
  deleted_at?: string;
  materialized_member?: boolean;
  [k: string]: unknown;
}
interface MetaLike {
  users: Record<string, EntryLike>;
  [k: string]: unknown;
}

/**
 * In-memory file IO. The metadata file lives in `store[METADATA_PATH]`; per-user
 * settings.json writes land in `store` too. ensureDir is a no-op (we only assert
 * on the metadata reconcile). A never-rejecting fetchProfile is injected via deps.
 */
function makeIO(initialMeta?: MetaLike): {
  io: RosterFileIO;
  meta: () => MetaLike | null;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  if (initialMeta) store.set("users/_user_metadata.json", initialMeta);
  const io: RosterFileIO = {
    ensureDir: async () => {},
    writeText: async (path, text) => {
      store.set(path, JSON.parse(text));
    },
    readJson: async <T>(path: string) => {
      const v = store.get(path);
      return (v === undefined ? null : v) as T | null;
    },
  };
  return {
    io,
    meta: () => (store.get("users/_user_metadata.json") as MetaLike) ?? null,
    store,
  };
}

const noProfile = async () => null;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("materializeLabRoster — base materialize", () => {
  it("flags newly-materialized co-member entries as materialized_member", async () => {
    const { io, meta } = makeIO();
    const result = await materializeLabRoster(
      record("pi", ["alice", "bob"]),
      "alice", // viewer
      { fileIO: io, fetchProfile: noProfile },
    );
    const m = meta()!;
    // viewer alice is skipped; pi + bob get flagged entries.
    expect(m.users.pi.materialized_member).toBe(true);
    expect(m.users.bob.materialized_member).toBe(true);
    expect(m.users.alice).toBeUndefined();
    expect(result.metadataAdded.sort()).toEqual(["bob", "pi"]);
    expect(result.tombstoned).toEqual([]);
  });

  it("never writes a metadata entry for the viewer", async () => {
    const { io, meta } = makeIO();
    await materializeLabRoster(record("pi", ["alice"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    expect(meta()!.users.alice).toBeUndefined();
  });
});

describe("materializeLabRoster — ghost-cleanup reconcile", () => {
  it("tombstones a materialized co-member who left the roster", async () => {
    const { io, meta } = makeIO();
    // First run: pi + alice(viewer) + bob + carol.
    await materializeLabRoster(record("pi", ["alice", "bob", "carol"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    expect(meta()!.users.bob.deleted_at).toBeUndefined();

    // Second run: carol removed from the roster.
    const result = await materializeLabRoster(
      record("pi", ["alice", "bob"]),
      "alice",
      { fileIO: io, fetchProfile: noProfile },
    );
    const m = meta()!;
    expect(m.users.carol.deleted_at).toBeTruthy();
    expect(m.users.bob.deleted_at).toBeUndefined();
    expect(result.tombstoned).toEqual(["carol"]);
    // Trash not destroy: the entry is still present (reversible), just tombstoned.
    expect(m.users.carol.color).toBeTruthy();
  });

  it("NEVER tombstones the viewer", async () => {
    // Seed a metadata entry for the viewer that is (wrongly) flagged
    // materialized_member to prove the viewer guard wins regardless.
    const seed: MetaLike = {
      users: {
        alice: {
          color: "#3b82f6",
          created_at: "2026-01-01T00:00:00.000Z",
          materialized_member: true,
        },
      },
    };
    const { io, meta } = makeIO(seed);
    // alice is the viewer and is NOT on the roster members below.
    await materializeLabRoster(record("pi", ["bob"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    expect(meta()!.users.alice.deleted_at).toBeUndefined();
  });

  it("NEVER tombstones the head (head is always on the roster)", async () => {
    const { io, meta } = makeIO();
    await materializeLabRoster(record("pi", ["alice", "bob"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    // Re-run with bob removed; pi (head) must stay live.
    await materializeLabRoster(record("pi", ["alice"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    expect(meta()!.users.pi.deleted_at).toBeUndefined();
    expect(meta()!.users.bob.deleted_at).toBeTruthy();
  });

  it("NEVER tombstones a genuine local user (no materialized_member flag)", async () => {
    // A real co-located local user this viewer created: entry exists, no flag.
    const seed: MetaLike = {
      users: {
        labmate: {
          color: "#ef4444",
          created_at: "2026-01-01T00:00:00.000Z",
          // no materialized_member flag
        },
      },
    };
    const { io, meta } = makeIO(seed);
    // labmate is not on the relay roster, but is a real local user.
    await materializeLabRoster(record("pi", ["alice"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    expect(meta()!.users.labmate.deleted_at).toBeUndefined();
  });

  it("is idempotent — re-running after a removal does not re-tombstone", async () => {
    const { io, meta } = makeIO();
    await materializeLabRoster(record("pi", ["alice", "bob", "carol"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    const r1 = await materializeLabRoster(
      record("pi", ["alice", "bob"]),
      "alice",
      { fileIO: io, fetchProfile: noProfile },
    );
    const firstStamp = meta()!.users.carol.deleted_at;
    expect(r1.tombstoned).toEqual(["carol"]);

    const r2 = await materializeLabRoster(
      record("pi", ["alice", "bob"]),
      "alice",
      { fileIO: io, fetchProfile: noProfile },
    );
    // Second reconcile must NOT re-tombstone (already tombstoned) and must not
    // bump the timestamp.
    expect(r2.tombstoned).toEqual([]);
    expect(meta()!.users.carol.deleted_at).toBe(firstStamp);
  });

  it("un-tombstones a re-added member and re-materializes them", async () => {
    const { io, meta } = makeIO();
    await materializeLabRoster(record("pi", ["alice", "bob", "carol"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    // Remove carol -> tombstoned.
    await materializeLabRoster(record("pi", ["alice", "bob"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    expect(meta()!.users.carol.deleted_at).toBeTruthy();

    // Re-add carol.
    const r = await materializeLabRoster(
      record("pi", ["alice", "bob", "carol"]),
      "alice",
      { fileIO: io, fetchProfile: noProfile },
    );
    expect(meta()!.users.carol.deleted_at).toBeUndefined();
    expect(meta()!.users.carol.materialized_member).toBe(true);
    expect(r.unTombstoned).toEqual(["carol"]);
    expect(r.tombstoned).toEqual([]);
  });

  it("preserves a re-added member's chosen color when un-tombstoning", async () => {
    const seed: MetaLike = {
      users: {
        carol: {
          color: "#84cc16", // a color carol picked
          created_at: "2026-01-01T00:00:00.000Z",
          deleted_at: "2026-02-01T00:00:00.000Z",
          materialized_member: true,
        },
      },
    };
    const { io, meta } = makeIO(seed);
    await materializeLabRoster(record("pi", ["alice", "carol"]), "alice", {
      fileIO: io,
      fetchProfile: noProfile,
    });
    expect(meta()!.users.carol.deleted_at).toBeUndefined();
    expect(meta()!.users.carol.color).toBe("#84cc16");
  });
});
