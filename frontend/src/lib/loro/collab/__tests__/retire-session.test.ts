// Loro Phase 3, chunk 5b: retire collab session with provenance.
// Updated (storage-migration phase 1, chunk 2) for the plaintext provider:
// frames no longer carry a per-frame sender pubkey, so onFirstRemotePeer
// reports the PeerID only and attribution resolves the name from context.
//
// Tests:
//   1. onFirstRemotePeer fires with the correct PeerID on the first remote doc
//      frame, and does NOT fire for the local peer.
//   2. onFirstRemotePeer fires at most once per remote peer.
//   3. The local peer's own id does not trigger onFirstRemotePeer.
//   4. Writing a "collab-session-ended" commit appears in listVersions.
//   5. The collab-session-ended commit is attributed to the retiring peer.
//
// The onFirstRemotePeer mechanism uses ImportStatus.success to detect new peer
// IDs after doc.import (not subscribeFirstCommitFromPeer, which fires only on
// local commits, not imports).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { LoroDoc, EphemeralStore } from "loro-crdt";
import { createCollabProvider, type CollabTransport } from "../relay-provider";
import { seedNoteDoc } from "../../seed";
import { listVersions } from "../../history";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function fixtureNote(): Note {
  return {
    id: 1,
    title: "LC-MS setup",
    description: "Column equilibration notes",
    is_running_log: false,
    is_shared: false,
    created_at: "2026-06-01T09:00:00Z",
    entries: [
      {
        id: "entry-1",
        title: "Run 1",
        date: "2026-06-01",
        content: "Buffer A: 0.1% FA in water.",
        created_at: "2026-06-01T09:00:00Z",
        updated_at: "2026-06-01T09:30:00Z",
      },
    ],
  } as Note;
}

// Minimal symmetric in-memory relay (same shape as relay-provider.test.ts).
interface InMemoryRelayFull {
  transportA: CollabTransport;
  transportB: CollabTransport;
  triggerOpenA(): void;
  triggerOpenB(): void;
}

function makeRelay(): InMemoryRelayFull {
  let cbA: ((f: Uint8Array) => void) | null = null;
  let cbB: ((f: Uint8Array) => void) | null = null;
  let openA: (() => void) | null = null;
  let openB: (() => void) | null = null;

  const transportA: CollabTransport = {
    send(f) { cbB?.(f); },
    onMessage(cb) { cbA = cb; },
    onOpen(cb) { openA = cb; },
    close() {},
  };
  const transportB: CollabTransport = {
    send(f) { cbA?.(f); },
    onMessage(cb) { cbB = cb; },
    onOpen(cb) { openB = cb; },
    close() {},
  };

  return {
    transportA,
    transportB,
    triggerOpenA() { openA?.(); },
    triggerOpenB() { openB?.(); },
  };
}

// ---------------------------------------------------------------------------
// Tests: onFirstRemotePeer attribution.
// ---------------------------------------------------------------------------

describe("onFirstRemotePeer attribution", () => {
  it("fires with the remote PeerID on the first remote doc frame", () => {
    const snapshot = seedNoteDoc(fixtureNote());
    const relay = makeRelay();

    // Doc A: seed, then a live commit so A has its own peer id in the history.
    const docA = new LoroDoc();
    docA.import(snapshot);
    docA.getMap("meta").set("last_edited_by", "alice");
    docA.commit({ message: "alice-first-edit" });

    // Doc B: only the seed -- has NOT seen A's peer yet.
    const docB = new LoroDoc();
    docB.import(snapshot);

    const peerAId = docA.peerIdStr;
    const peerBId = docB.peerIdStr;

    const firstRemotePeersSeenByB: string[] = [];

    const providerB = createCollabProvider({
      doc: docB,
      ephemeral: new EphemeralStore(30_000),
      transport: relay.transportB,
      onFirstRemotePeer: (peerId) => { firstRemotePeersSeenByB.push(peerId); },
    });

    const providerA = createCollabProvider({
      doc: docA,
      ephemeral: new EphemeralStore(30_000),
      transport: relay.transportA,
    });

    // triggerOpenA: pushes A's full state to B. B imports it; its ImportStatus
    // includes A's peer id which B has not seen before.
    relay.triggerOpenA();

    expect(firstRemotePeersSeenByB.length).toBeGreaterThanOrEqual(1);
    // The reported peer must not be B's own peer id.
    for (const seen of firstRemotePeersSeenByB) {
      expect(seen).not.toBe(peerBId);
    }
    // A's peer id must be among the remote peers seen by B.
    expect(firstRemotePeersSeenByB).toContain(peerAId);

    providerA.destroy();
    providerB.destroy();
  });

  it("fires at most once per remote peer even if multiple frames arrive", () => {
    const snapshot = seedNoteDoc(fixtureNote());
    const relay = makeRelay();

    const docA = new LoroDoc();
    docA.import(snapshot);
    docA.getMap("meta").set("x", "1");
    docA.commit({ message: "a-setup" });

    const docB = new LoroDoc();
    docB.import(snapshot);

    let callCount = 0;

    const providerB = createCollabProvider({
      doc: docB,
      ephemeral: new EphemeralStore(30_000),
      transport: relay.transportB,
      onFirstRemotePeer: () => { callCount++; },
    });

    const providerA = createCollabProvider({
      doc: docA,
      ephemeral: new EphemeralStore(30_000),
      transport: relay.transportA,
    });

    // First open: A's state arrives at B; B fires the callback for A's peer.
    relay.triggerOpenA();
    const countAfterFirstOpen = callCount;
    expect(countAfterFirstOpen).toBeGreaterThanOrEqual(1);

    // A makes additional commits; incremental frames flow to B. B imports them
    // but onFirstRemotePeer must NOT fire again (A's peer already known).
    docA.getMap("meta").set("x", "2");
    docA.commit({ message: "extra-commit-1" });
    docA.getMap("meta").set("x", "3");
    docA.commit({ message: "extra-commit-2" });

    expect(callCount).toBe(countAfterFirstOpen);

    providerA.destroy();
    providerB.destroy();
  });

  it("does not fire for the local peer (own peer id is excluded)", () => {
    const snapshot = seedNoteDoc(fixtureNote());
    const relay = makeRelay();

    // Only doc A -- no peer B connected. The local-peer filter must prevent
    // self-registration even though A's own onOpen push routes to the B side.
    const docA = new LoroDoc();
    docA.import(snapshot);
    docA.getMap("meta").set("x", "1");
    docA.commit({ message: "a-setup" });

    const seenPeerIds: string[] = [];

    const providerA = createCollabProvider({
      doc: docA,
      ephemeral: new EphemeralStore(30_000),
      transport: relay.transportA,
      onFirstRemotePeer: (peerId) => { seenPeerIds.push(peerId); },
    });

    relay.triggerOpenA();
    relay.triggerOpenB(); // B's open handler is null; no-op.

    expect(seenPeerIds).not.toContain(docA.peerIdStr);
    expect(seenPeerIds).toHaveLength(0);

    providerA.destroy();
  });
});

// ---------------------------------------------------------------------------
// Tests: retire commit in version history.
// ---------------------------------------------------------------------------

describe("retire commit in Loro version history", () => {
  it("collab-session-ended commit appears in listVersions after a retire write", async () => {
    const base = fixtureNote();
    const snapshot = seedNoteDoc(base);

    const doc = new LoroDoc();
    doc.import(snapshot);

    doc.getMap("meta").set("collab_retired_at", "2026-06-05T14:00:00.000Z");
    doc.commit({ message: "collab-session-ended" });

    vi.spyOn(await import("../../actors"), "readActors").mockResolvedValue({
      [doc.peerIdStr]: { username: "alice" },
    });
    vi.spyOn(await import("../../sidecar-store"), "loadOrRebuild").mockResolvedValue(doc);

    const versions = await listVersions("alice", base);
    const messages = versions.map((v) => v.message);

    expect(messages).toContain("collab-session-ended");
    const lastVersion = versions[versions.length - 1];
    expect(lastVersion.message).toBe("collab-session-ended");

    vi.restoreAllMocks();
  });

  it("collab-session-ended commit is attributed to the retiring peer's username", async () => {
    const base = fixtureNote();
    const snapshot = seedNoteDoc(base);

    const doc = new LoroDoc();
    doc.setPeerId(BigInt(42));
    doc.import(snapshot);

    doc.getMap("meta").set("collab_retired_at", "2026-06-05T14:00:00.000Z");
    doc.commit({ message: "collab-session-ended" });

    const retiringPeerId = doc.peerIdStr;

    vi.spyOn(await import("../../actors"), "readActors").mockResolvedValue({
      [retiringPeerId]: { username: "bob" },
    });
    vi.spyOn(await import("../../sidecar-store"), "loadOrRebuild").mockResolvedValue(doc);

    const versions = await listVersions("bob", base);
    const retireVersion = versions.find((v) => v.message === "collab-session-ended");
    expect(retireVersion).toBeDefined();
    expect(retireVersion!.username).toBe("bob");
    expect(retireVersion!.peer).toBe(retiringPeerId);

    vi.restoreAllMocks();
  });
});
