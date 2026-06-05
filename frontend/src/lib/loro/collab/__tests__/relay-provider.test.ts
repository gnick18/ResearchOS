// Loro Phase 3, chunk 3: relay provider unit tests.
//
// All tests run in-process with NO real WebSocket. Two in-memory CollabTransport
// implementations are wired together into a tiny fan-out relay that mirrors the
// relay DO's blind-forward mechanic (frame sent on A is delivered to B and vice
// versa) but operates synchronously inside the test process.
//
// Test coverage:
//   1. Convergence A -> B: edit doc A, assert doc B converges.
//   2. Convergence B -> A: edit doc B, assert doc A converges.
//   3. Catch-up on open: doc A has content before B connects; B's onOpen sends
//      A's full snapshot to B, so B converges.
//   4. Ephemeral relay: A sets an EphemeralStore key, B receives it.
//   5. Tamper drop: a corrupted frame is silently dropped; the receiver stays clean.
//   6. No echo loop: applying a remote update on B does not bounce it back to A
//      in an infinite loop (message count stays bounded).

import { describe, it, expect, vi } from "vitest";
import { LoroDoc, EphemeralStore } from "loro-crdt";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generateSessionKey } from "../envelope";
import { createCollabProvider, type CollabTransport } from "../relay-provider";
import { seedNoteDoc, } from "../../seed";
import { listEntries, setEntryContent } from "../../note-doc";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Minimal Note fixture for seeding a realistic note doc. */
function fixtureNote(): Note {
  return {
    id: 1,
    title: "PCR setup QC",
    description: "Thermocycler lane checks",
    is_running_log: true,
    is_shared: false,
    created_at: "2026-05-01T09:00:00Z",
    entries: [
      {
        id: "entry-1",
        title: "Run A",
        date: "2026-05-01",
        content: "Template: pUC19. Tm 60C.",
        created_at: "2026-05-01T09:00:00Z",
        updated_at: "2026-05-01T09:30:00Z",
      },
    ],
  } as Note;
}

/** Generate a fresh Ed25519 signing keypair. */
function genEd25519() {
  const kp = ed25519.keygen();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

// ---------------------------------------------------------------------------
// In-memory fan-out relay.
//
// A tiny symmetric relay: two slots (A and B). Any frame sent on A is forwarded
// to B's onMessage handler, and vice versa. This mirrors the relay DO's blind
// fan-out without any network or async. Transports are returned ready to pass
// to createCollabProvider.
// ---------------------------------------------------------------------------

interface InMemoryRelay {
  transportA: CollabTransport & { messagesSent: number };
  transportB: CollabTransport & { messagesSent: number };
}

function makeInMemoryRelay(): InMemoryRelay {
  let cbA: ((frame: Uint8Array) => void) | null = null;
  let cbB: ((frame: Uint8Array) => void) | null = null;
  let openA: (() => void) | null = null;
  let openB: (() => void) | null = null;

  let sentA = 0;
  let sentB = 0;

  const transportA: CollabTransport & { messagesSent: number } = {
    get messagesSent() { return sentA; },
    send(frame) {
      sentA++;
      cbB?.(frame);
    },
    onMessage(cb) { cbA = cb; },
    onOpen(cb) { openA = cb; },
    close() {},
  };

  const transportB: CollabTransport & { messagesSent: number } = {
    get messagesSent() { return sentB; },
    send(frame) {
      sentB++;
      cbA?.(frame);
    },
    onMessage(cb) { cbB = cb; },
    onOpen(cb) { openB = cb; },
    close() {},
  };

  return { transportA, transportB };
}

/** Fire the onOpen callbacks of both transports (simulates the ws "open" event). */
function fireOpen(relay: InMemoryRelay) {
  // Accessing the registered open callbacks directly is awkward; instead we
  // store them in the relay object. Re-implement with mutable closures:
  // the makeInMemoryRelayWithOpen variant below is used by tests that need it.
  void relay;
}

// Revised relay that exposes triggerOpenA / triggerOpenB so tests can simulate
// connection events explicitly.
interface InMemoryRelayFull {
  transportA: CollabTransport & { messagesSent: number };
  transportB: CollabTransport & { messagesSent: number };
  triggerOpenA(): void;
  triggerOpenB(): void;
}

function makeRelay(): InMemoryRelayFull {
  let cbA: ((frame: Uint8Array) => void) | null = null;
  let cbB: ((frame: Uint8Array) => void) | null = null;
  let openA: (() => void) | null = null;
  let openB: (() => void) | null = null;

  let sentA = 0;
  let sentB = 0;

  const transportA: CollabTransport & { messagesSent: number } = {
    get messagesSent() { return sentA; },
    send(frame) { sentA++; cbB?.(frame); },
    onMessage(cb) { cbA = cb; },
    onOpen(cb) { openA = cb; },
    close() {},
  };

  const transportB: CollabTransport & { messagesSent: number } = {
    get messagesSent() { return sentB; },
    send(frame) { sentB++; cbA?.(frame); },
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
// Session helpers: build two providers sharing one session.
// ---------------------------------------------------------------------------

interface PeerSetup {
  doc: LoroDoc;
  ephemeral: EphemeralStore;
  providerHandle: { destroy(): void };
}

function setupTwoPeers(relay: InMemoryRelayFull): { a: PeerSetup; b: PeerSetup } {
  const sessionKey = generateSessionKey();
  const sessionId = "test-session-" + Math.random().toString(36).slice(2);

  const keyA = genEd25519();
  const keyB = genEd25519();

  const docA = new LoroDoc();
  const ephA = new EphemeralStore<Record<string, string>>(30_000);

  const docB = new LoroDoc();
  const ephB = new EphemeralStore<Record<string, string>>(30_000);

  const providerA = createCollabProvider({
    doc: docA,
    ephemeral: ephA,
    sessionKey,
    sessionId,
    senderEd25519SecretKey: keyA.secretKey,
    senderEd25519PublicKey: keyA.publicKey,
    expectedPeerEd25519PublicKey: keyB.publicKey,
    transport: relay.transportA,
  });

  const providerB = createCollabProvider({
    doc: docB,
    ephemeral: ephB,
    sessionKey,
    sessionId,
    senderEd25519SecretKey: keyB.secretKey,
    senderEd25519PublicKey: keyB.publicKey,
    expectedPeerEd25519PublicKey: keyA.publicKey,
    transport: relay.transportB,
  });

  return {
    a: { doc: docA, ephemeral: ephA, providerHandle: providerA },
    b: { doc: docB, ephemeral: ephB, providerHandle: providerB },
  };
}

// ---------------------------------------------------------------------------
// 1. Convergence A -> B.
// ---------------------------------------------------------------------------

describe("relay provider convergence A to B", () => {
  it("edit on doc A propagates to doc B", () => {
    const relay = makeRelay();

    // Seed both docs from the same note so they share the same base state.
    const note = fixtureNote();
    const snapshot = seedNoteDoc(note);
    const docA = new LoroDoc();
    docA.import(snapshot);
    const docB = new LoroDoc();
    docB.import(snapshot);

    const sessionKey = generateSessionKey();
    const sessionId = "convergence-a-b";
    const keyA = genEd25519();
    const keyB = genEd25519();

    const ephA = new EphemeralStore(30_000);
    const ephB = new EphemeralStore(30_000);

    const providerA = createCollabProvider({
      doc: docA, ephemeral: ephA, sessionKey, sessionId,
      senderEd25519SecretKey: keyA.secretKey,
      senderEd25519PublicKey: keyA.publicKey,
      expectedPeerEd25519PublicKey: keyB.publicKey,
      transport: relay.transportA,
    });

    const providerB = createCollabProvider({
      doc: docB, ephemeral: ephB, sessionKey, sessionId,
      senderEd25519SecretKey: keyB.secretKey,
      senderEd25519PublicKey: keyB.publicKey,
      expectedPeerEd25519PublicKey: keyA.publicKey,
      transport: relay.transportB,
    });

    // Both peers connect.
    relay.triggerOpenA();
    relay.triggerOpenB();

    // Edit doc A's first entry content.
    setEntryContent(docA, 0, "Updated by peer A: new PCR result.");
    docA.commit();

    // doc B should have converged.
    const entriesB = listEntries(docB);
    expect(entriesB[0]?.content).toBe("Updated by peer A: new PCR result.");

    providerA.destroy();
    providerB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. Convergence B -> A.
// ---------------------------------------------------------------------------

describe("relay provider convergence B to A", () => {
  it("edit on doc B propagates to doc A", () => {
    const relay = makeRelay();

    const note = fixtureNote();
    const snapshot = seedNoteDoc(note);
    const docA = new LoroDoc();
    docA.import(snapshot);
    const docB = new LoroDoc();
    docB.import(snapshot);

    const sessionKey = generateSessionKey();
    const sessionId = "convergence-b-a";
    const keyA = genEd25519();
    const keyB = genEd25519();

    const ephA = new EphemeralStore(30_000);
    const ephB = new EphemeralStore(30_000);

    const providerA = createCollabProvider({
      doc: docA, ephemeral: ephA, sessionKey, sessionId,
      senderEd25519SecretKey: keyA.secretKey,
      senderEd25519PublicKey: keyA.publicKey,
      expectedPeerEd25519PublicKey: keyB.publicKey,
      transport: relay.transportA,
    });

    const providerB = createCollabProvider({
      doc: docB, ephemeral: ephB, sessionKey, sessionId,
      senderEd25519SecretKey: keyB.secretKey,
      senderEd25519PublicKey: keyB.publicKey,
      expectedPeerEd25519PublicKey: keyA.publicKey,
      transport: relay.transportB,
    });

    relay.triggerOpenA();
    relay.triggerOpenB();

    setEntryContent(docB, 0, "Updated by peer B: gel band at 500bp.");
    docB.commit();

    const entriesA = listEntries(docA);
    expect(entriesA[0]?.content).toBe("Updated by peer B: gel band at 500bp.");

    providerA.destroy();
    providerB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Catch-up on open.
//
// Doc A already has content. Doc B is fresh (empty). When B connects (its onOpen
// fires), it should receive A's full snapshot and converge.
// ---------------------------------------------------------------------------

describe("relay provider catch-up on open", () => {
  it("B receives A state when B connects after A already has content", () => {
    const relay = makeRelay();

    const note = fixtureNote();
    const snapshot = seedNoteDoc(note);
    const docA = new LoroDoc();
    docA.import(snapshot);

    // Peer A: edit BEFORE B connects.
    setEntryContent(docA, 0, "Pre-connection data from A.");
    docA.commit();

    const sessionKey = generateSessionKey();
    const sessionId = "catch-up";
    const keyA = genEd25519();
    const keyB = genEd25519();

    const docB = new LoroDoc();
    const ephA = new EphemeralStore(30_000);
    const ephB = new EphemeralStore(30_000);

    const providerA = createCollabProvider({
      doc: docA, ephemeral: ephA, sessionKey, sessionId,
      senderEd25519SecretKey: keyA.secretKey,
      senderEd25519PublicKey: keyA.publicKey,
      expectedPeerEd25519PublicKey: keyB.publicKey,
      transport: relay.transportA,
    });

    const providerB = createCollabProvider({
      doc: docB, ephemeral: ephB, sessionKey, sessionId,
      senderEd25519SecretKey: keyB.secretKey,
      senderEd25519PublicKey: keyB.publicKey,
      expectedPeerEd25519PublicKey: keyA.publicKey,
      transport: relay.transportB,
    });

    // A connects first, then B. A's onOpen fires and sends A's full snapshot
    // to B. B's onOpen fires and sends its (empty) state to A.
    relay.triggerOpenA();
    relay.triggerOpenB();

    // B should have received A's full snapshot and converged.
    const entriesB = listEntries(docB);
    expect(entriesB[0]?.content).toBe("Pre-connection data from A.");

    providerA.destroy();
    providerB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Ephemeral relay.
//
// A sets an EphemeralStore key; B's EphemeralStore should receive it.
// ---------------------------------------------------------------------------

describe("relay provider ephemeral relay", () => {
  it("ephemeral set on A propagates to B", () => {
    const relay = makeRelay();

    const docA = new LoroDoc();
    const docB = new LoroDoc();

    const sessionKey = generateSessionKey();
    const sessionId = "ephemeral-test";
    const keyA = genEd25519();
    const keyB = genEd25519();

    const ephA = new EphemeralStore<Record<string, string>>(30_000);
    const ephB = new EphemeralStore<Record<string, string>>(30_000);

    const providerA = createCollabProvider({
      doc: docA, ephemeral: ephA as unknown as EphemeralStore, sessionKey, sessionId,
      senderEd25519SecretKey: keyA.secretKey,
      senderEd25519PublicKey: keyA.publicKey,
      expectedPeerEd25519PublicKey: keyB.publicKey,
      transport: relay.transportA,
    });

    const providerB = createCollabProvider({
      doc: docB, ephemeral: ephB as unknown as EphemeralStore, sessionKey, sessionId,
      senderEd25519SecretKey: keyB.secretKey,
      senderEd25519PublicKey: keyB.publicKey,
      expectedPeerEd25519PublicKey: keyA.publicKey,
      transport: relay.transportB,
    });

    relay.triggerOpenA();
    relay.triggerOpenB();

    // A sets a cursor position in the ephemeral store.
    ephA.set("cursor", "line:5,col:12");

    // B's ephemeral store should have received the encoded update.
    const states = ephB.getAllStates();
    // The key may be scoped by peer id in the ephemeral store's state tree.
    // We verify that the value appeared somewhere in B's states or that
    // ephB.get("cursor") returns the value.
    // EphemeralStore tracks state per-peer; getAllStates returns { [peerId]: T }.
    // The value set by A will appear under A's peer key.
    const allValues = Object.values(states as Record<string, string>);
    expect(allValues.some((v) => v === "line:5,col:12")).toBe(true);

    providerA.destroy();
    providerB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Tamper drop.
//
// A corrupted frame must be silently dropped. The receiver must not crash and
// its doc must remain unchanged.
// ---------------------------------------------------------------------------

describe("relay provider tamper drop", () => {
  it("a corrupted frame is dropped and the receiver does not crash", () => {
    // Build a one-directional tamper transport: every frame A sends to B is
    // corrupted (a byte flip mid-frame). B's transport only receives corrupted
    // frames, so no update should ever apply to docB.
    //
    // We do NOT trigger onOpen here because the catch-up snapshot and the edit
    // both need to be corrupted. We bypass the catch-up by never calling openA;
    // instead we only wire up the corrupt A->B path and trigger the edit.
    const callbacks = {
      cbB: null as ((frame: Uint8Array) => void) | null,
      openA: null as (() => void) | null,
      openB: null as (() => void) | null,
    };

    const transportA: CollabTransport = {
      send(frame) {
        if (callbacks.cbB) {
          // Always corrupt every frame from A to B.
          const corrupt = new Uint8Array(frame);
          corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
          callbacks.cbB(corrupt);
        }
      },
      onMessage() {},
      onOpen(cb) { callbacks.openA = cb; },
      close() {},
    };

    const transportB: CollabTransport = {
      send() {},
      onMessage(cb) { callbacks.cbB = cb; },
      onOpen(cb) { callbacks.openB = cb; },
      close() {},
    };

    const note = fixtureNote();
    const snapshot = seedNoteDoc(note);
    const docA = new LoroDoc();
    docA.import(snapshot);
    const docB = new LoroDoc();
    docB.import(snapshot);

    const sessionKey = generateSessionKey();
    const sessionId = "tamper-test";
    const keyA = genEd25519();
    const keyB = genEd25519();

    const ephA = new EphemeralStore(30_000);
    const ephB = new EphemeralStore(30_000);

    const providerA = createCollabProvider({
      doc: docA, ephemeral: ephA, sessionKey, sessionId,
      senderEd25519SecretKey: keyA.secretKey,
      senderEd25519PublicKey: keyA.publicKey,
      expectedPeerEd25519PublicKey: keyB.publicKey,
      transport: transportA,
    });

    const providerB = createCollabProvider({
      doc: docB, ephemeral: ephB, sessionKey, sessionId,
      senderEd25519SecretKey: keyB.secretKey,
      senderEd25519PublicKey: keyB.publicKey,
      expectedPeerEd25519PublicKey: keyA.publicKey,
      transport: transportB,
    });

    // Trigger A's onOpen (sends a corrupted catch-up snapshot to B -- should be
    // dropped) and then send an edit (also corrupted -- should be dropped too).
    callbacks.openA?.();

    setEntryContent(docA, 0, "Tampered content that should not arrive.");
    docA.commit();

    // B must still have the original seeded content because every frame from A
    // was corrupted and dropped by openFrame.
    const entriesB = listEntries(docB);
    expect(entriesB[0]?.content).toBe("Template: pUC19. Tm 60C.");

    providerA.destroy();
    providerB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 6. No echo loop.
//
// When B applies an inbound update from A, it must NOT re-broadcast it back to
// A. We verify by capping the total message count after a single edit.
// ---------------------------------------------------------------------------

describe("relay provider no echo loop", () => {
  it("applying a remote update on B does not trigger re-broadcast back to A", () => {
    const relay = makeRelay();

    const note = fixtureNote();
    const snapshot = seedNoteDoc(note);
    const docA = new LoroDoc();
    docA.import(snapshot);
    const docB = new LoroDoc();
    docB.import(snapshot);

    const sessionKey = generateSessionKey();
    const sessionId = "no-echo";
    const keyA = genEd25519();
    const keyB = genEd25519();

    const ephA = new EphemeralStore(30_000);
    const ephB = new EphemeralStore(30_000);

    const providerA = createCollabProvider({
      doc: docA, ephemeral: ephA, sessionKey, sessionId,
      senderEd25519SecretKey: keyA.secretKey,
      senderEd25519PublicKey: keyA.publicKey,
      expectedPeerEd25519PublicKey: keyB.publicKey,
      transport: relay.transportA,
    });

    const providerB = createCollabProvider({
      doc: docB, ephemeral: ephB, sessionKey, sessionId,
      senderEd25519SecretKey: keyB.secretKey,
      senderEd25519PublicKey: keyB.publicKey,
      expectedPeerEd25519PublicKey: keyA.publicKey,
      transport: relay.transportB,
    });

    relay.triggerOpenA();
    relay.triggerOpenB();

    // Reset counters after the connect-phase snapshots exchange.
    const beforeA = relay.transportA.messagesSent;
    const beforeB = relay.transportB.messagesSent;

    // One edit on A.
    setEntryContent(docA, 0, "Echo loop check content.");
    docA.commit();

    const deltaSentByA = relay.transportA.messagesSent - beforeA;
    const deltaSentByB = relay.transportB.messagesSent - beforeB;

    // A sent exactly 1 frame (the incremental update).
    // B received it, applied it, and sent 0 frames back (no echo).
    expect(deltaSentByA).toBe(1);
    expect(deltaSentByB).toBe(0);

    providerA.destroy();
    providerB.destroy();
  });
});
