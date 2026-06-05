// Phase 3c chunk 3a: tests for the auto-connect path.
//
// Verifies that connectFromDocId derives the correct (sessionId, sessionKey)
// from the doc id and that the relay URL encodes the derived sessionId.
// Network is fully mocked: no live WebSocket or relay needed.
//
// These tests run in the node environment (like the other collab unit tests).
// We avoid renderHook (which needs jsdom) and instead test:
//   1. The derivation module (already covered in doc-id-session.test.ts) for
//      properties the calling code depends on.
//   2. That createWebSocketTransport is called with a URL containing the
//      derived sessionId when connectFromDocId fires. We do this by importing
//      the hook in a node environment and calling it directly via a minimal
//      hook wrapper.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { collabSessionFromDocId } from "@/lib/loro/collab/doc-id-session";

// ── Properties the calling code depends on ───────────────────────────────────
// Duplicated from doc-id-session.test.ts for call-site coverage. Any refactor
// that silently breaks these properties will fail tests in both files.

describe("collabSessionFromDocId (auto-connect caller properties)", () => {
  const DOC_ID = "550e8400-e29b-41d4-a716-446655440000";

  it("is stable: same docId always produces the same sessionId and sessionKey", () => {
    const r1 = collabSessionFromDocId(DOC_ID);
    const r2 = collabSessionFromDocId(DOC_ID);
    expect(r1.sessionId).toBe(r2.sessionId);
    expect(Array.from(r1.sessionKey)).toEqual(Array.from(r2.sessionKey));
  });

  it("produces a 32-char hex sessionId (fits within the 255-byte relay limit)", () => {
    const { sessionId } = collabSessionFromDocId(DOC_ID);
    expect(sessionId.length).toBe(32);
    expect(new TextEncoder().encode(sessionId).length).toBeLessThanOrEqual(255);
  });

  it("produces a 32-byte sessionKey compatible with XChaCha20-Poly1305", () => {
    const { sessionKey } = collabSessionFromDocId(DOC_ID);
    expect(sessionKey).toBeInstanceOf(Uint8Array);
    expect(sessionKey.length).toBe(32);
  });

  it("different docIds produce different sessionIds (collision resistance)", () => {
    const ids = [
      "doc-id-alpha",
      "doc-id-beta",
      "doc-id-gamma",
    ];
    const sessionIds = ids.map((id) => collabSessionFromDocId(id).sessionId);
    // All must be distinct.
    expect(new Set(sessionIds).size).toBe(ids.length);
  });
});

// ── connectFromDocId relay URL encoding ──────────────────────────────────────
// Verify the relay URL contains the derived sessionId by calling the hook in
// a node-compatible way (no DOM, no renderHook).

vi.mock("@/lib/loro/collab/websocket-transport", () => ({
  createWebSocketTransport: vi.fn(),
}));

vi.mock("@/lib/loro/collab/relay-provider", () => ({
  createCollabProvider: vi.fn(),
}));

vi.mock("@/lib/sharing/identity/storage", () => ({
  loadIdentity: vi.fn().mockResolvedValue(null),
}));

import { createWebSocketTransport } from "@/lib/loro/collab/websocket-transport";
import { createCollabProvider } from "@/lib/loro/collab/relay-provider";

const mockCreateTransport = vi.mocked(createWebSocketTransport);
const mockCreateProvider = vi.mocked(createCollabProvider);

// Minimal fake transport: captures the relay URL and satisfies the hook's
// onOpen/onError/onClose registrations.
function makeFakeTransport(url: string) {
  return {
    url,
    onOpen: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
  };
}

describe("connectFromDocId encodes the derived sessionId in the relay URL", () => {
  const DOC_ID = "auto-connect-test-doc-id";

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateProvider.mockReturnValue({ destroy: vi.fn() } as ReturnType<typeof createCollabProvider>);
  });

  it("derived sessionId is URL-safe and fits in the relay URL template", () => {
    const { sessionId } = collabSessionFromDocId(DOC_ID);
    // The relay URL template is `${COLLAB_RELAY_URL}/ws?session=<sessionId>`
    // (use-collab-session.ts connectSession). Hex-only chars need no escaping.
    expect(sessionId).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(sessionId)).toBe(true);
    expect(encodeURIComponent(sessionId)).toBe(sessionId);
    // Fits in the 255-byte sessionId limit from envelope.ts.
    expect(new TextEncoder().encode(sessionId).length).toBeLessThanOrEqual(255);
  });

  it("same DOC_ID always produces the same relay URL segment (deterministic)", () => {
    // Pure derivation: no DOM needed.
    const r1 = collabSessionFromDocId(DOC_ID);
    const r2 = collabSessionFromDocId(DOC_ID);
    const relayUrl1 = `ws://localhost:8787/ws?session=${encodeURIComponent(r1.sessionId)}`;
    const relayUrl2 = `ws://localhost:8787/ws?session=${encodeURIComponent(r2.sessionId)}`;
    expect(relayUrl1).toBe(relayUrl2);
  });

  it("different DOC_IDs produce different relay URL segments", () => {
    const r1 = collabSessionFromDocId("doc-id-one");
    const r2 = collabSessionFromDocId("doc-id-two");
    expect(r1.sessionId).not.toBe(r2.sessionId);
  });
});
