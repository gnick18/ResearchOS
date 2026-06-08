// Cross-boundary sharing, relay R2 storage adapter, size-binding + HEAD readback.
//
// Pins the P1-B storage-layer primitives without a live R2, the AWS S3 SDK and
// the presigner are mocked. presignUpload must bake the declared size into the
// signed PUT as a required Content-Length (so the real upload cannot exceed or
// fall short of what was budgeted), and headObjectSize must return the true
// object size, mapping a missing object (404 / NotFound) to null while rethrowing
// any real fault.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sendMock: vi.fn(),
  signCaptured: { command: null as { input?: Record<string, unknown> } | null },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (_s3: unknown, command: { input?: Record<string, unknown> }) => {
    h.signCaptured.command = command;
    return "https://signed.example/put";
  },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Cmd {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    PutObjectCommand: Cmd,
    HeadObjectCommand: Cmd,
    GetObjectCommand: Cmd,
    DeleteObjectCommand: Cmd,
    ListObjectsV2Command: Cmd,
    S3Client: class {
      send = h.sendMock;
    },
  };
});

process.env.R2_ACCOUNT_ID = "acct";
process.env.R2_ACCESS_KEY_ID = "akid";
process.env.R2_SECRET_ACCESS_KEY = "secret";
process.env.R2_BUCKET = "bucket";

import { headObjectSize, presignUpload } from "../storage";

beforeEach(() => {
  h.sendMock.mockReset();
  h.signCaptured.command = null;
});

describe("presignUpload size binding", () => {
  it("bakes the declared size into the PUT as a required Content-Length", async () => {
    const url = await presignUpload("k1", 4096);
    expect(url).toBe("https://signed.example/put");
    expect(h.signCaptured.command?.input).toMatchObject({
      Bucket: "bucket",
      Key: "k1",
      ContentLength: 4096,
    });
  });

  it("omits Content-Length when no size is supplied", async () => {
    await presignUpload("k2");
    expect(h.signCaptured.command?.input).toMatchObject({
      Bucket: "bucket",
      Key: "k2",
    });
    expect(h.signCaptured.command?.input?.ContentLength).toBeUndefined();
  });

  it("binds a zero size explicitly (it is a real, distinct binding)", async () => {
    await presignUpload("k3", 0);
    expect(h.signCaptured.command?.input?.ContentLength).toBe(0);
  });
});

describe("headObjectSize", () => {
  it("returns the true object Content-Length", async () => {
    h.sendMock.mockResolvedValueOnce({ ContentLength: 777 });
    expect(await headObjectSize("k1")).toBe(777);
  });

  it("returns null for a NotFound object", async () => {
    h.sendMock.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { name: "NotFound" }),
    );
    expect(await headObjectSize("k1")).toBeNull();
  });

  it("returns null for a 404 status without a mapped name", async () => {
    h.sendMock.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await headObjectSize("k1")).toBeNull();
  });

  it("rethrows a real fault (credentials / network) rather than masking it", async () => {
    h.sendMock.mockRejectedValueOnce(
      Object.assign(new Error("bad creds"), { name: "CredentialsError" }),
    );
    await expect(headObjectSize("k1")).rejects.toThrow("bad creds");
  });
});
