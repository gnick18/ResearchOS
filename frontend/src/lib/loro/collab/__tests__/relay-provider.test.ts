// Relay provider unit tests (storage-migration phase 1, chunk 2: plaintext).
//
// All tests run in-process with NO real WebSocket. An in-memory CollabTransport
// pair is wired into a tiny fan-out relay that mirrors the relay DO's forward
// mechanic (a frame sent on A is delivered to B and vice versa) synchronously.
//
// The provider now speaks the plaintext typed protocol (0x01 doc update, 0x02
// ephemeral) instead of the sealed envelope, matching relay/src/worker.ts.
//
// Test coverage:
//   1. Convergence A -> B: edit doc A, assert doc B converges.
//   2. Convergence B -> A: edit doc B, assert doc A converges.
//   3. Catch-up on open: doc A has content before B connects; A's onOpen push
//      delivers its state to B, so B converges.
//   4. Ephemeral relay: A sets an EphemeralStore key, B receives it.
//   5. Corrupt-frame drop: a corrupted frame is dropped; the receiver stays clean.
//   6. No echo loop: applying a remote update on B does not bounce it back to A.

import { describe, it, expect } from "vitest";
import { LoroDoc, EphemeralStore } from "loro-crdt";
import { createCollabProvider, type CollabTransport } from "../relay-provider";
import { seedNoteDoc } from "../../seed";
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

// ---------------------------------------------------------------------------
// In-memory fan-out relay: a frame sent on A is forwarded to B and vice versa,
// synchronously. triggerOpenA/B simulate the ws "open" event.
// ---------------------------------------------------------------------------

interface InMemoryRelay {
  transportA: CollabTransport & { messagesSent: number };
  transportB: CollabTransport & { messagesSent: number };
  triggerOpenA(): void;
  triggerOpenB(): void;
}

function makeRelay(): InMemoryRelay {
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

/** Build a pair of providers sharing one in-memory relay, each over its own doc. */
function setupPeers(relay: InMemoryRelay, docA: LoroDoc, docB: LoroDoc) {
  const ephA = new EphemeralStore(30_000);
  const ephB = new EphemeralStore(30_000);
  const providerA = createCollabProvider({ doc: docA, ephemeral: ephA, transport: relay.transportA });
  const providerB = createCollabProvider({ doc: docB, ephemeral: ephB, transport: relay.transportB });
  return { ephA, ephB, providerA, providerB };
}

// ---------------------------------------------------------------------------
// 1. Convergence A -> B.
// ---------------------------------------------------------------------------

describe("relay provider convergence A to B", () => {
  it("edit on doc A propagates to doc B", () => {
    const relay = makeRelay();
    const snapshot = seedNoteDoc(fixtureNote());
    const docA = new LoroDoc(); docA.import(snapshot);
    const docB = new LoroDoc(); docB.import(snapshot);

    const { providerA, providerB } = setupPeers(relay, docA, docB);
    relay.triggerOpenA();
    relay.triggerOpenB();

    setEntryContent(docA, 0, "Updated by peer A: new PCR result.");
    docA.commit();

    expect(listEntries(docB)[0]?.content).toBe("Updated by peer A: new PCR result.");

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
    const snapshot = seedNoteDoc(fixtureNote());
    const docA = new LoroDoc(); docA.import(snapshot);
    const docB = new LoroDoc(); docB.import(snapshot);

    const { providerA, providerB } = setupPeers(relay, docA, docB);
    relay.triggerOpenA();
    relay.triggerOpenB();

    setEntryContent(docB, 0, "Updated by peer B: gel band at 500bp.");
    docB.commit();

    expect(listEntries(docA)[0]?.content).toBe("Updated by peer B: gel band at 500bp.");

    providerA.destroy();
    providerB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. Catch-up on open: A has content before B connects; A's onOpen push
//    delivers its state to B.
// ---------------------------------------------------------------------------

describe("relay provider catch-up on open", () => {
  it("B receives A state when B connects after A already has content", () => {
    const relay = makeRelay();
    const snapshot = seedNoteDoc(fixtureNote());
    const docA = new LoroDoc(); docA.import(snapshot);
    setEntryContent(docA, 0, "Pre-connection data from A.");
    docA.commit();

    const docB = new LoroDoc();
    const { providerA, providerB } = setupPeers(relay, docA, docB);

    // A connects (pushes its full state to B), then B connects.
    relay.triggerOpenA();
    relay.triggerOpenB();

    expect(listEntries(docB)[0]?.content).toBe("Pre-connection data from A.");

    providerA.destroy();
    providerB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. Ephemeral relay.
// ---------------------------------------------------------------------------

describe("relay provider ephemeral relay", () => {
  it("ephemeral set on A propagates to B", () => {
    const relay = makeRelay();
    const docA = new LoroDoc();
    const docB = new LoroDoc();

    const ephA = new EphemeralStore<Record<string, string>>(30_000);
    const ephB = new EphemeralStore<Record<string, string>>(30_000);

    const providerA = createCollabProvider({
      doc: docA, ephemeral: ephA as unknown as EphemeralStore, transport: relay.transportA,
    });
    const providerB = createCollabProvider({
      doc: docB, ephemeral: ephB as unknown as EphemeralStore, transport: relay.transportB,
    });

    relay.triggerOpenA();
    relay.triggerOpenB();

    ephA.set("cursor", "line:5,col:12");

    const states = ephB.getAllStates();
    const allValues = Object.values(states as Record<string, string>);
    expect(allValues.some((v) => v === "line:5,col:12")).toBe(true);

    providerA.destroy();
    providerB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. Corrupt-frame drop: every A->B frame is byte-flipped; B must stay clean.
// ---------------------------------------------------------------------------

describe("relay provider corrupt-frame drop", () => {
  it("a corrupted frame is dropped and the receiver does not crash", () => {
    const callbacks = {
      cbB: null as ((frame: Uint8Array) => void) | null,
      openA: null as (() => void) | null,
    };

    const transportA: CollabTransport = {
      send(frame) {
        if (callbacks.cbB) {
          // Corrupt the payload (leave the type byte intact so it still routes
          // to the doc-import path, which must then reject the bad bytes).
          const corrupt = new Uint8Array(frame);
          if (corrupt.length > 2) corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
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
      onOpen() {},
      close() {},
    };

    const snapshot = seedNoteDoc(fixtureNote());
    const docA = new LoroDoc(); docA.import(snapshot);
    const docB = new LoroDoc(); docB.import(snapshot);

    const ephA = new EphemeralStore(30_000);
    const ephB = new EphemeralStore(30_000);

    const providerA = createCollabProvider({ doc: docA, ephemeral: ephA, transport: transportA });
    const providerB = createCollabProvider({ doc: docB, ephemeral: ephB, transport: transportB });

    callbacks.openA?.(); // corrupted catch-up push, must be dropped

    setEntryContent(docA, 0, "Tampered content that should not arrive.");
    docA.commit();

    // B keeps the original seeded content; every A->B frame was corrupt.
    expect(listEntries(docB)[0]?.content).toBe("Template: pUC19. Tm 60C.");

    providerA.destroy();
    providerB.destroy();
  });
});

// ---------------------------------------------------------------------------
// 6. No echo loop.
// ---------------------------------------------------------------------------

describe("relay provider no echo loop", () => {
  it("applying a remote update on B does not trigger re-broadcast back to A", () => {
    const relay = makeRelay();
    const snapshot = seedNoteDoc(fixtureNote());
    const docA = new LoroDoc(); docA.import(snapshot);
    const docB = new LoroDoc(); docB.import(snapshot);

    const { providerA, providerB } = setupPeers(relay, docA, docB);
    relay.triggerOpenA();
    relay.triggerOpenB();

    const beforeA = relay.transportA.messagesSent;
    const beforeB = relay.transportB.messagesSent;

    setEntryContent(docA, 0, "Echo loop check content.");
    docA.commit();

    // A sent exactly 1 frame (the incremental update); B applied it and sent 0
    // back (no echo).
    expect(relay.transportA.messagesSent - beforeA).toBe(1);
    expect(relay.transportB.messagesSent - beforeB).toBe(0);

    providerA.destroy();
    providerB.destroy();
  });
});
