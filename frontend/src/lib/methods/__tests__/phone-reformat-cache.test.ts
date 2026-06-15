import { afterEach, describe, expect, it, vi } from "vitest";

// Mock filesApi so the read/write helpers can be exercised without a real store.
const readFile = vi.fn();
const writeFile = vi.fn();
vi.mock("@/lib/local-api", () => ({
  filesApi: {
    readFile: (...a: unknown[]) => readFile(...a),
    writeFile: (...a: unknown[]) => writeFile(...a),
  },
}));

import {
  phoneReformatPath,
  encodePhoneReformat,
  decodePhoneReformat,
  readFreshPhoneReformat,
  writePhoneReformat,
} from "../phone-reformat-cache";

afterEach(() => {
  readFile.mockReset();
  writeFile.mockReset();
});

describe("phoneReformatPath", () => {
  it("maps a .md source to a .phone.md sidecar", () => {
    expect(phoneReformatPath("methods/foo.md")).toBe("methods/foo.phone.md");
  });
  it("appends for a non-.md path", () => {
    expect(phoneReformatPath("methods/foo")).toBe("methods/foo.phone.md");
  });
  it("returns null for a scheme path or empty", () => {
    expect(phoneReformatPath("pcr://protocol/1")).toBeNull();
    expect(phoneReformatPath(null)).toBeNull();
    expect(phoneReformatPath(undefined)).toBeNull();
  });
});

describe("encode/decode round trip", () => {
  it("round-trips the sha and body", () => {
    const encoded = encodePhoneReformat("abc123", "1. Do the thing\n2. Done");
    const decoded = decodePhoneReformat(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.srcSha).toBe("abc123");
    expect(decoded!.body).toBe("1. Do the thing\n2. Done");
  });
  it("returns null for content lacking the marker", () => {
    expect(decodePhoneReformat("just some markdown\nno marker")).toBeNull();
  });
});

describe("readFreshPhoneReformat", () => {
  it("returns the body on a fresh hit (sha matches)", async () => {
    readFile.mockResolvedValueOnce({
      content: encodePhoneReformat("sha-1", "1. Reformatted"),
      sha: "ignored",
    });
    const out = await readFreshPhoneReformat("methods/foo.md", "sha-1");
    expect(out).toBe("1. Reformatted");
    expect(readFile).toHaveBeenCalledWith("methods/foo.phone.md");
  });

  it("returns null when the sidecar sha is stale", async () => {
    readFile.mockResolvedValueOnce({
      content: encodePhoneReformat("sha-OLD", "1. Reformatted"),
      sha: "ignored",
    });
    const out = await readFreshPhoneReformat("methods/foo.md", "sha-NEW");
    expect(out).toBeNull();
  });

  it("returns null (not throw) when there is no sidecar", async () => {
    readFile.mockRejectedValueOnce(new Error("not found"));
    const out = await readFreshPhoneReformat("methods/foo.md", "sha-1");
    expect(out).toBeNull();
  });

  it("returns null for a scheme source path without touching the store", async () => {
    const out = await readFreshPhoneReformat("pcr://x", "sha-1");
    expect(out).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("writePhoneReformat", () => {
  it("writes the encoded sidecar and returns true", async () => {
    writeFile.mockResolvedValueOnce({ path: "methods/foo.phone.md", sha: "x" });
    const ok = await writePhoneReformat("methods/foo.md", "sha-1", "1. Step");
    expect(ok).toBe(true);
    const [path, content] = writeFile.mock.calls[0];
    expect(path).toBe("methods/foo.phone.md");
    expect(decodePhoneReformat(content as string)).toEqual({
      srcSha: "sha-1",
      body: "1. Step",
    });
  });

  it("returns false on a scheme path", async () => {
    const ok = await writePhoneReformat("pcr://x", "sha-1", "body");
    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
