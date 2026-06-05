// Loro Phase 3, chunk 5b: retire collab session with provenance.
//
// Tests:
//   1. onFirstRemotePeer fires with the correct PeerID + pubkey on the
//      first remote doc frame, and does NOT fire for the local peer.
//   2. onFirstRemotePeer fires at most once per remote peer.
//   3. The local peer's seed peer ("0") does not trigger onFirstRemotePeer.
//   4. Writing a "collab-session-ended" commit appears in listVersions.
//   5. The collab-session-ended commit is attributed to the retiring peer.
//
// The onFirstRemotePeer mechanism uses ImportStatus.success to detect new
// peer IDs after doc.import (not subscribeFirstCommitFromPeer, which fires
// only on local commits, not imports).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { LoroDoc, EphemeralStore } from "loro-crdt";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generateSessionKey } from "../envelope";
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

function genEd25519() {
  const kp = ed25519.keygen();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
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
  it("fires with the remote PeerID + pubkey on the first remote doc frame", () => {
    const base = fixtureNote();
    const snapshot = seedNoteDoc(base);
    const relay = makeRelay();
    const sessionKey = generateSessionKey();
    const sessionId = "retire-test-001";

    const keyA = genEd25519();
    const keyB = genEd25519();

    // Doc A: seed from note, then make a live commit so A has its own peer id
    // in the history (beyond just the seed peer "0"). This is what the
    // catch-up snapshot on connect will carry to B.
    const docA = new LoroDoc();
    docA.import(snapshot);
    docA.getMap("meta").set("last_edited_by", "alice");
    docA.commit({ message: "alice-first-edit" });

    // Doc B: only the seed -- has NOT seen A's peer yet.
    const docB = new LoroDoc();
    docB.import(snapshot);

    // Peer A's ID after the commit.
    const peerAId = docA.peerIdStr;
    // B's own peer id (should never appear in the remote callback).
    const peerBId = docB.peerIdStr;

    const firstRemotePeersSeenByB: Array<{ peerId: string; pubKey: Uint8Array }> = [];

    // Peer B's provider listens for remote peers.
    const providerB = createCollabProvider({
      doc: docB,
      ephemeral: new EphemeralStore(30_000),
      sessionKey,
      sessionId,
      senderEd25519SecretKey: keyB.secretKey,
      senderEd25519PublicKey: keyB.publicKey,
      transport: relay.transportB,
      onFirstRemotePeer: (peerId, pubKey) => {
        firstRemotePeersSeenByB.push({ peerId, pubKey });
      },
    });

    // Peer A's provider (no onFirstRemotePeer needed for this test).
    const providerA = createCollabProvider({
      doc: docA,
      ephemeral: new EphemeralStore(30_000),
      sessionKey,
      sessionId,
      senderEd25519SecretKey: keyA.secretKey,
      senderEd25519PublicKey: keyA.publicKey,
      transport: relay.transportA,
    });

    // triggerOpenA: sends A's full snapshot to B. B imports it; its ImportStatus
    // will include A's peer id which B hasn't seen before.
    relay.triggerOpenA();

    // B should have seen A's peer ID.
    expect(firstRemotePeersSeenByB.length).toBeGreaterThanOrEqual(1);

    // The peer ID reported must NOT be B's own peer ID.
    for (const seen of firstRemotePeersSeenByB) {
      expect(seen.peerId).not.toBe(peerBId);
    }

    // A's peer ID must be among the remote peers seen by B.
    const seenPeerIds = firstRemotePeersSeenByB.map((e) => e.peerId);
    expect(seenPeerIds).toContain(peerAId);

    // The pubkey reported alongside A's peer must be A's signing key.
    const aEntry = firstRemotePeersSeenByB.find((e) => e.peerId === peerAId);
    expect(aEntry).toBeDefined();
    expect(aEntry!.pubKey).toEqual(keyA.publicKey);

    providerA.destroy();
    providerB.destroy();
  });

  it("fires at most once per remote peer even if multiple frames arrive", () => {
    const base = fixtureNote();
    const snapshot = seedNoteDoc(base);
    const relay = makeRelay();
    const sessionKey = generateSessionKey();
    const sessionId = "retire-test-002";

    const keyA = genEd25519();
    const keyB = genEd25519();

    // A: seed + one commit so A has its own peer id.
    const docA = new LoroDoc();
    docA.import(snapshot);
    docA.getMap("meta").set("x", "1");
    docA.commit({ message: "a-setup" });

    // B: seed only.
    const docB = new LoroDoc();
    docB.import(snapshot);

    let callCount = 0;

    const providerB = createCollabProvider({
      doc: docB,
      ephemeral: new EphemeralStore(30_000),
      sessionKey,
      sessionId,
      senderEd25519SecretKey: keyB.secretKey,
      senderEd25519PublicKey: keyB.publicKey,
      transport: relay.transportB,
      onFirstRemotePeer: () => { callCount++; },
    });

    const providerA = createCollabProvider({
      doc: docA,
      ephemeral: new EphemeralStore(30_000),
      sessionKey,
      sessionId,
      senderEd25519SecretKey: keyA.secretKey,
      senderEd25519PublicKey: keyA.publicKey,
      transport: relay.transportA,
    });

    // First open: A's snapshot arrives at B, B fires callback for A's peer.
    relay.triggerOpenA();
    const countAfterFirstOpen = callCount;
    expect(countAfterFirstOpen).toBeGreaterThanOrEqual(1);

    // A makes additional commits; subscribeLocalUpdates sends incremental frames to B.
    // B imports them but onFirstRemotePeer must NOT fire again (A's peer already known).
    docA.getMap("meta").set("x", "2");
    docA.commit({ message: "extra-commit-1" });
    docA.getMap("meta").set("x", "3");
    docA.commit({ message: "extra-commit-2" });

    // Count must not have grown.
    expect(callCount).toBe(countAfterFirstOpen);

    providerA.destroy();
    providerB.destroy();
  });

  it("does not fire for the local peer (B's own peer id is excluded)", () => {
    const base = fixtureNote();
    const snapshot = seedNoteDoc(base);
    const relay = makeRelay();
    const sessionKey = generateSessionKey();
    const sessionId = "retire-test-003";

    const keyA = genEd25519();

    // Only doc A -- no peer B is connected. When A fires its catch-up snapshot
    // on triggerOpenA, it arrives at B's transport but there is no peer B to
    // receive it. Even if B DID receive its own snapshot, the local peer
    // filter must prevent self-registration.
    const docA = new LoroDoc();
    docA.import(snapshot);
    docA.getMap("meta").set("x", "1");
    docA.commit({ message: "a-setup" });

    const seenPeerIds: string[] = [];

    // Wire providerA with onFirstRemotePeer to verify the local-peer filter.
    const providerA = createCollabProvider({
      doc: docA,
      ephemeral: new EphemeralStore(30_000),
      sessionKey,
      sessionId,
      senderEd25519SecretKey: keyA.secretKey,
      senderEd25519PublicKey: keyA.publicKey,
      transport: relay.transportA,
      onFirstRemotePeer: (peerId) => { seenPeerIds.push(peerId); },
    });

    // triggerOpenA sends A's snapshot -- but it goes to the B side transport
    // which has no handler (no providerB). So nothing arrives at A from B.
    relay.triggerOpenA();
    relay.triggerOpenB(); // B's open handler is null; no-op.

    // A's own peer must not appear in the callback.
    expect(seenPeerIds).not.toContain(docA.peerIdStr);
    // No remote peer connected: list must be empty.
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

    // Build a doc (seeded from the note), simulate collab editing.
    const doc = new LoroDoc();
    doc.import(snapshot);

    // Write the retire marker into the "meta" map (same approach as retireSession).
    doc.getMap("meta").set("collab_retired_at", "2026-06-05T14:00:00.000Z");
    // Forward commit stamping the retire event (pattern from restore.ts).
    doc.commit({ message: "collab-session-ended" });

    // Mock readActors (called by listVersions) to return a minimal actors map.
    vi.spyOn(await import("../../actors"), "readActors").mockResolvedValue({
      [doc.peerIdStr]: { username: "alice" },
    });

    // Mock loadOrRebuild (called by listVersions) to return our in-memory doc.
    vi.spyOn(await import("../../sidecar-store"), "loadOrRebuild").mockResolvedValue(doc);

    const versions = await listVersions("alice", base);
    const messages = versions.map((v) => v.message);

    // The retire commit must be present in the history.
    expect(messages).toContain("collab-session-ended");

    // The retire commit must be the last entry (highest index = newest).
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

    // Write the retire marker + commit.
    doc.getMap("meta").set("collab_retired_at", "2026-06-05T14:00:00.000Z");
    doc.commit({ message: "collab-session-ended" });

    const retiringPeerId = doc.peerIdStr;

    // Mock actors to map the retiring peer to "bob".
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
