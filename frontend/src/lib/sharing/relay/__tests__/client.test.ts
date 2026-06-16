// Cross-boundary sharing, relay client unit tests (Phase 2b).
//
// These exercise the client orchestration with fetch mocked and the heavy
// dependencies (identity storage, bundle engine, sealed-box crypto) stubbed, so
// the test stays unit level with no IndexedDB, no real zip, and no network. The
// one piece that is NOT mocked is signRelayRequest's signing, we let it sign for
// real and verify the signature round-trips through buildRelayPayload + ed25519,
// which is the load-bearing contract with the server.

import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildRelayPayload } from "../auth";

// A deterministic identity. The signing key is real so the sign/verify
// round-trip is meaningful, the encryption key is only handed to the mocked
// openSealed so any 32 bytes work.
const SIGNING_PRIV = new Uint8Array(32).fill(9);
const SIGNING_PUB = ed25519.getPublicKey(SIGNING_PRIV);
const ENCRYPTION_PRIV = new Uint8Array(32).fill(3);

const loadIdentity = vi.fn();
vi.mock("@/lib/sharing/identity/storage", () => ({
  loadIdentity: () => loadIdentity(),
}));

const buildBundle = vi.fn();
const readBundle = vi.fn();
vi.mock("@/lib/sharing/bundle", () => ({
  buildBundle: (...a: unknown[]) => buildBundle(...a),
  readBundle: (...a: unknown[]) => readBundle(...a),
}));

const sealToRecipient = vi.fn();
const openSealed = vi.fn();
vi.mock("@/lib/sharing/encryption", () => ({
  sealToRecipient: (...a: unknown[]) => sealToRecipient(...a),
  openSealed: (...a: unknown[]) => openSealed(...a),
}));

// decodePublicKey is pure (hex to bytes), keep the real one so a bad hex would
// surface, but the recipient pubkey value is irrelevant since sealToRecipient is
// mocked.

import {
  ackShare,
  listInbox,
  receiveShare,
  RecipientNotFoundError,
  RelayError,
  sendShare,
} from "../client";

const SENDER_EMAIL = "sender@example.com";
const RECIPIENT_EMAIL = "recipient@example.com";
const RECIPIENT_X25519 = "00".repeat(32); // valid hex, decoded then handed to the mock

/** A fetch-Response stub for a JSON body. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A fetch-Response stub for a binary body (the presigned GET download). */
function binaryResponse(status: number, bytes: Uint8Array): Response {
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => buf,
  } as unknown as Response;
}

/** An empty ok Response (the presigned PUT upload). */
function okEmpty(): Response {
  return { ok: true, status: 200 } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  loadIdentity.mockReset();
  buildBundle.mockReset();
  readBundle.mockReset();
  sealToRecipient.mockReset();
  openSealed.mockReset();

  loadIdentity.mockResolvedValue({
    keys: {
      encryption: {
        publicKey: new Uint8Array(32),
        privateKey: ENCRYPTION_PRIV,
      },
      signing: { publicKey: SIGNING_PUB, privateKey: SIGNING_PRIV },
    },
    deviceSalt: new Uint8Array(16),
  });

  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("signRelayRequest, via a real sendShare signature", () => {
  it("signs bytes that buildRelayPayload + ed25519.verify accept", async () => {
    buildBundle.mockResolvedValue(new Uint8Array([1, 2, 3]));
    sealToRecipient.mockReturnValue(new Uint8Array([4, 5, 6, 7]));

    let sendBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(
      async (url: string, init?: RequestInit): Promise<Response> => {
        if (url === "/api/directory/lookup") {
          return jsonResponse(200, {
            found: true,
            x25519PublicKey: RECIPIENT_X25519,
            ed25519PublicKey: "11".repeat(32),
            fingerprint: "abcd",
          });
        }
        if (url === "/api/relay/send") {
          sendBody = JSON.parse(init!.body as string);
          return jsonResponse(200, {
            bundleId: "bundle-1",
            uploadUrl: "https://r2.example/upload",
            expiresAt: "2026-07-03T00:00:00.000Z",
          });
        }
        return okEmpty(); // the PUT
      },
    );

    await sendShare({
      email: SENDER_EMAIL,
      recipientEmail: RECIPIENT_EMAIL,
      bundle: {
        shareUuid: "uuid-1",
        version: 1,
        modifiedAt: "2026-06-03T00:00:00.000Z",
        entityType: "note",
        entity: { title: "x" },
        attachments: [],
      },
    });

    expect(sendBody).not.toBeNull();
    const body = sendBody!;
    // Rebuild the exact canonical bytes from the posted fields and verify.
    const payload = buildRelayPayload({
      action: "send",
      email: body.email as string,
      issuedAt: body.issuedAt as string,
      recipientEmail: body.recipientEmail as string,
      sizeBytes: body.sizeBytes as number,
    });
    const ok = ed25519.verify(
      hexToBytes(body.signature as string),
      payload,
      SIGNING_PUB,
    );
    expect(ok).toBe(true);
    // sizeBytes must equal the sealed length (the mock returned 4 bytes).
    expect(body.sizeBytes).toBe(4);
  });
});

describe("sendShare order, lookup then send then PUT then confirm", () => {
  it("calls lookup, send, PUTs the sealed bytes, then confirms the upload", async () => {
    const sealed = new Uint8Array([9, 8, 7]);
    buildBundle.mockResolvedValue(new Uint8Array([1]));
    sealToRecipient.mockReturnValue(sealed);

    const calls: string[] = [];
    fetchMock.mockImplementation(
      async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/directory/lookup") {
          return jsonResponse(200, {
            found: true,
            x25519PublicKey: RECIPIENT_X25519,
            ed25519PublicKey: "11".repeat(32),
            fingerprint: "abcd",
          });
        }
        if (url === "/api/relay/send") {
          return jsonResponse(200, {
            bundleId: "bundle-9",
            uploadUrl: "https://r2.example/put-here",
            expiresAt: "2026-07-03T00:00:00.000Z",
          });
        }
        if (url === "/api/relay/confirm") {
          return jsonResponse(200, { ok: true });
        }
        return okEmpty();
      },
    );

    const result = await sendShare({
      email: SENDER_EMAIL,
      recipientEmail: RECIPIENT_EMAIL,
      bundle: {
        shareUuid: "uuid-2",
        version: 1,
        modifiedAt: "2026-06-03T00:00:00.000Z",
        entityType: "note",
        entity: {},
        attachments: [],
      },
    });

    // Confirm runs last, strictly after the PUT, so a failed upload never reaches it.
    // The best-effort phone-push notify is fire-and-forget and not part of the send
    // ordering contract, so it is filtered out before asserting the core sequence.
    const coreCalls = calls.filter(
      (c) => !c.includes("/capture/notify-recipient"),
    );
    expect(coreCalls).toEqual([
      "POST /api/directory/lookup",
      "POST /api/relay/send",
      "PUT https://r2.example/put-here",
      "POST /api/relay/confirm",
    ]);

    // The PUT body is the sealed bytes.
    const putCall = fetchMock.mock.calls.find(
      (c) => c[0] === "https://r2.example/put-here",
    );
    expect(putCall![1].method).toBe("PUT");
    expect(putCall![1].body).toBe(sealed);

    expect(result).toEqual({
      bundleId: "bundle-9",
      expiresAt: "2026-07-03T00:00:00.000Z",
    });
  });

  it("signs the confirm with the same bundleId and does not confirm when the PUT fails", async () => {
    buildBundle.mockResolvedValue(new Uint8Array([1]));
    sealToRecipient.mockReturnValue(new Uint8Array([4, 5, 6, 7]));

    // First, a successful send so we can inspect the confirm body.
    let confirmBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(
      async (url: string, init?: RequestInit): Promise<Response> => {
        if (url === "/api/directory/lookup") {
          return jsonResponse(200, {
            found: true,
            x25519PublicKey: RECIPIENT_X25519,
            ed25519PublicKey: "11".repeat(32),
            fingerprint: "abcd",
          });
        }
        if (url === "/api/relay/send") {
          return jsonResponse(200, {
            bundleId: "bundle-c",
            uploadUrl: "https://r2.example/put-here",
            expiresAt: "2026-07-03T00:00:00.000Z",
          });
        }
        if (url === "/api/relay/confirm") {
          confirmBody = JSON.parse(init!.body as string);
          return jsonResponse(200, { ok: true });
        }
        return okEmpty(); // the PUT
      },
    );

    await sendShare({
      email: SENDER_EMAIL,
      recipientEmail: RECIPIENT_EMAIL,
      bundle: {
        shareUuid: "uuid-c",
        version: 1,
        modifiedAt: "2026-06-03T00:00:00.000Z",
        entityType: "note",
        entity: {},
        attachments: [],
      },
    });

    expect(confirmBody).not.toBeNull();
    expect(confirmBody!.action).toBe("confirm");
    expect(confirmBody!.bundleId).toBe("bundle-c");
    const payload = buildRelayPayload({
      action: "confirm",
      email: confirmBody!.email as string,
      issuedAt: confirmBody!.issuedAt as string,
      bundleId: confirmBody!.bundleId as string,
    });
    expect(
      ed25519.verify(
        hexToBytes(confirmBody!.signature as string),
        payload,
        SIGNING_PUB,
      ),
    ).toBe(true);

    // Now a failing PUT must throw before confirm is ever called.
    const seen: string[] = [];
    fetchMock.mockImplementation(
      async (url: string): Promise<Response> => {
        seen.push(url);
        if (url === "/api/directory/lookup") {
          return jsonResponse(200, {
            found: true,
            x25519PublicKey: RECIPIENT_X25519,
            ed25519PublicKey: "11".repeat(32),
            fingerprint: "abcd",
          });
        }
        if (url === "/api/relay/send") {
          return jsonResponse(200, {
            bundleId: "bundle-f",
            uploadUrl: "https://r2.example/put-here",
            expiresAt: "2026-07-03T00:00:00.000Z",
          });
        }
        if (url === "https://r2.example/put-here") {
          return jsonResponse(403, { error: "blocked" }); // PUT fails (CSP/CORS)
        }
        throw new Error(`unexpected call to ${url}`);
      },
    );

    await expect(
      sendShare({
        email: SENDER_EMAIL,
        recipientEmail: RECIPIENT_EMAIL,
        bundle: {
          shareUuid: "uuid-f",
          version: 1,
          modifiedAt: "2026-06-03T00:00:00.000Z",
          entityType: "note",
          entity: {},
          attachments: [],
        },
      }),
    ).rejects.toBeInstanceOf(RelayError);

    expect(seen).not.toContain("/api/relay/confirm");
  });
});

describe("sendShare, recipient not on ResearchOS", () => {
  it("throws RecipientNotFoundError on a not-found lookup", async () => {
    fetchMock.mockImplementation(async (url: string): Promise<Response> => {
      if (url === "/api/directory/lookup") {
        return jsonResponse(200, { found: false });
      }
      throw new Error(`unexpected call to ${url}`);
    });

    await expect(
      sendShare({
        email: SENDER_EMAIL,
        recipientEmail: RECIPIENT_EMAIL,
        bundle: {
          shareUuid: "uuid-3",
          version: 1,
          modifiedAt: "2026-06-03T00:00:00.000Z",
          entityType: "note",
          entity: {},
          attachments: [],
        },
      }),
    ).rejects.toBeInstanceOf(RecipientNotFoundError);

    // It must short-circuit before building or sealing anything.
    expect(buildBundle).not.toHaveBeenCalled();
    expect(sealToRecipient).not.toHaveBeenCalled();
  });
});

describe("receiveShare, fetch then GET, no ack", () => {
  it("fetches, GETs the download URL, returns parsed content, and does NOT ack", async () => {
    const sealed = new Uint8Array([5, 5, 5]);
    const zipped = new Uint8Array([6, 6]);
    openSealed.mockReturnValue(zipped);
    readBundle.mockResolvedValue({
      valid: true,
      shareUuid: "uuid-7",
      version: 2,
      entityType: "note",
      entity: { title: "hello" },
      attachments: [{ name: "a.png", bytes: new Uint8Array([1]) }],
      metadata: {},
    });

    const calls: string[] = [];
    fetchMock.mockImplementation(
      async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/relay/fetch") {
          return jsonResponse(200, {
            downloadUrl: "https://r2.example/download",
          });
        }
        if (url === "https://r2.example/download") {
          return binaryResponse(200, sealed);
        }
        throw new Error(`unexpected call to ${url}`);
      },
    );

    const result = await receiveShare({
      email: SENDER_EMAIL,
      bundleId: "bundle-7",
    });

    expect(calls).toEqual([
      "POST /api/relay/fetch",
      "GET https://r2.example/download",
    ]);
    // openSealed got the downloaded bytes and the local encryption private key.
    expect(openSealed).toHaveBeenCalledWith(sealed, ENCRYPTION_PRIV);
    expect(readBundle).toHaveBeenCalledWith(zipped);
    // No ack route was touched.
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/relay/ack"),
    ).toBe(false);

    expect(result).toEqual({
      valid: true,
      shareUuid: "uuid-7",
      version: 2,
      entityType: "note",
      entity: { title: "hello" },
      attachments: [{ name: "a.png", bytes: new Uint8Array([1]) }],
    });
  });
});

describe("ackShare", () => {
  it("POSTs a signed ack to /api/relay/ack with the bundleId", async () => {
    let ackBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(
      async (url: string, init?: RequestInit): Promise<Response> => {
        expect(url).toBe("/api/relay/ack");
        ackBody = JSON.parse(init!.body as string);
        return jsonResponse(200, { ok: true });
      },
    );

    await ackShare({ email: SENDER_EMAIL, bundleId: "bundle-7" });

    expect(ackBody).not.toBeNull();
    expect(ackBody!.action).toBe("ack");
    expect(ackBody!.bundleId).toBe("bundle-7");
    const payload = buildRelayPayload({
      action: "ack",
      email: ackBody!.email as string,
      issuedAt: ackBody!.issuedAt as string,
      bundleId: ackBody!.bundleId as string,
    });
    expect(
      ed25519.verify(
        hexToBytes(ackBody!.signature as string),
        payload,
        SIGNING_PUB,
      ),
    ).toBe(true);
  });
});

describe("listInbox", () => {
  it("returns the items array from the inbox route", async () => {
    const items = [
      {
        bundleId: "b1",
        senderEmailHash: "h1",
        sizeBytes: 10,
        createdAt: "2026-06-03T00:00:00.000Z",
        expiresAt: "2026-07-03T00:00:00.000Z",
      },
    ];
    fetchMock.mockImplementation(async (url: string): Promise<Response> => {
      expect(url).toBe("/api/relay/inbox");
      return jsonResponse(200, { items });
    });

    const result = await listInbox({ email: SENDER_EMAIL });
    expect(result).toEqual(items);
  });
});

describe("RelayError on a non-ok relay response", () => {
  it("throws RelayError carrying the HTTP status", async () => {
    fetchMock.mockImplementation(async (): Promise<Response> => {
      return jsonResponse(429, { error: "rate limited" });
    });

    await expect(listInbox({ email: SENDER_EMAIL })).rejects.toMatchObject({
      name: "RelayError",
      status: 429,
    });
    await expect(
      listInbox({ email: SENDER_EMAIL }),
    ).rejects.toBeInstanceOf(RelayError);
  });
});
