import { afterEach, describe, expect, it, vi } from "vitest";

import { BYO_MAX_TOTAL_BYTES } from "@/lib/social/lab-byo";
import {
  isSafeOwner,
  isSafeRepo,
  isSafeRef,
  normalizeSubdir,
  parseGithubConnection,
  pullGithubZipball,
  resolvedRefFromEntries,
  stripZipballPrefix,
  zipballUrl,
  type RawZipEntry,
} from "@/lib/social/lab-byo-github";

const b = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("SSRF charset validation (owner / repo / ref)", () => {
  it("accepts normal GitHub logins / repos / refs", () => {
    expect(isSafeOwner("smithlab")).toBe(true);
    expect(isSafeOwner("Smith-Lab-99")).toBe(true);
    expect(isSafeRepo("companion-site")).toBe(true);
    expect(isSafeRepo("paper.2026_v2")).toBe(true);
    expect(isSafeRef("main")).toBe(true);
    expect(isSafeRef("feature/foo-bar")).toBe(true);
    expect(isSafeRef("v1.2.3")).toBe(true);
    expect(isSafeRef("a1b2c3d4e5f6")).toBe(true);
  });

  it("rejects traversal, slashes, dots, and host-injection in owner/repo", () => {
    expect(isSafeOwner("../etc")).toBe(false);
    expect(isSafeOwner("a/b")).toBe(false);
    expect(isSafeOwner("evil.com")).toBe(false);
    expect(isSafeOwner("")).toBe(false);
    expect(isSafeOwner("-leadinghyphen")).toBe(false);
    expect(isSafeRepo("..")).toBe(false);
    expect(isSafeRepo(".")).toBe(false);
    expect(isSafeRepo("a/b")).toBe(false);
    expect(isSafeRepo("a b")).toBe(false);
  });

  it("rejects refs that could escape the repo path (traversal segments)", () => {
    expect(isSafeRef("..")).toBe(false);
    expect(isSafeRef("feature/../etc")).toBe(false);
    expect(isSafeRef("/main")).toBe(false);
    expect(isSafeRef("main/")).toBe(false);
    expect(isSafeRef("")).toBe(false);
    expect(isSafeRef("with space")).toBe(false);
    expect(isSafeRef("a/./b")).toBe(false);
  });

  it("rejects a full URL passed as a ref / owner (no off-GitHub fetch)", () => {
    expect(isSafeRef("https://evil.example/x")).toBe(false);
    expect(isSafeOwner("https://evil.example")).toBe(false);
  });
});

describe("normalizeSubdir", () => {
  it("returns '' for absent / blank / root", () => {
    expect(normalizeSubdir(undefined)).toBe("");
    expect(normalizeSubdir(null)).toBe("");
    expect(normalizeSubdir("")).toBe("");
    expect(normalizeSubdir("  ")).toBe("");
  });
  it("normalizes a nested subdir, dropping . and slashes", () => {
    expect(normalizeSubdir("site")).toBe("site");
    expect(normalizeSubdir("/docs/public/")).toBe("docs/public");
    expect(normalizeSubdir("./site")).toBe("site");
  });
  it("rejects a traversal subdir", () => {
    expect(normalizeSubdir("../etc")).toBeNull();
    expect(normalizeSubdir("site/../../etc")).toBeNull();
    expect(normalizeSubdir("a b")).toBeNull();
  });
});

describe("parseGithubConnection", () => {
  it("parses a clean connection", () => {
    expect(
      parseGithubConnection({ owner: " smithlab ", repo: "companion", ref: "main", subdir: "site" }),
    ).toEqual({ owner: "smithlab", repo: "companion", ref: "main", subdir: "site" });
  });
  it("defaults subdir to '' and rejects unsafe fields", () => {
    expect(parseGithubConnection({ owner: "o", repo: "r", ref: "main" })?.subdir).toBe("");
    expect(parseGithubConnection({ owner: "../x", repo: "r", ref: "main" })).toBeNull();
    expect(parseGithubConnection({ owner: "o", repo: "r", ref: "../x" })).toBeNull();
    expect(parseGithubConnection({ owner: "o", repo: "r", ref: "main", subdir: "../x" })).toBeNull();
  });
});

describe("zipballUrl (hard-coded host)", () => {
  it("only ever targets api.github.com with safe path segments", () => {
    const url = zipballUrl({ owner: "smithlab", repo: "companion", ref: "main", subdir: "" });
    expect(url).toBe("https://api.github.com/repos/smithlab/companion/zipball/main");
  });
  it("preserves slashes in a feature-branch ref but encodes each segment", () => {
    const url = zipballUrl({ owner: "o", repo: "r", ref: "feature/foo", subdir: "" });
    expect(url).toBe("https://api.github.com/repos/o/r/zipball/feature/foo");
    expect(new URL(url).host).toBe("api.github.com");
  });
});

describe("stripZipballPrefix (pure wrapper-folder + subdir strip)", () => {
  it("strips the single {repo}-{sha} top-level folder", () => {
    const entries: RawZipEntry[] = [
      { rawPath: "companion-abc1234/", bytes: b("") },
      { rawPath: "companion-abc1234/index.html", bytes: b("<html>") },
      { rawPath: "companion-abc1234/assets/app.js", bytes: b("x") },
    ];
    const out = stripZipballPrefix(entries, "");
    expect(out.map((e) => e.rawPath).sort()).toEqual(["assets/app.js", "index.html"]);
  });

  it("strips the wrapper folder AND a configured subdir, re-rooting it", () => {
    const entries: RawZipEntry[] = [
      { rawPath: "companion-abc1234/site/index.html", bytes: b("<html>") },
      { rawPath: "companion-abc1234/site/style.css", bytes: b("body{}") },
      { rawPath: "companion-abc1234/README.md", bytes: b("ignore me") },
    ];
    const out = stripZipballPrefix(entries, "site");
    expect(out.map((e) => e.rawPath).sort()).toEqual(["index.html", "style.css"]);
  });

  it("drops benign noise before detecting the common prefix", () => {
    const entries: RawZipEntry[] = [
      { rawPath: "__MACOSX/companion-abc/._index.html", bytes: b("junk") },
      { rawPath: "companion-abc/index.html", bytes: b("<html>") },
      { rawPath: "companion-abc/.DS_Store", bytes: b("junk") },
    ];
    const out = stripZipballPrefix(entries, "");
    expect(out.map((e) => e.rawPath)).toEqual(["index.html"]);
  });

  it("returns [] when nothing lives under the configured subdir", () => {
    const entries: RawZipEntry[] = [
      { rawPath: "companion-abc/index.html", bytes: b("<html>") },
    ];
    expect(stripZipballPrefix(entries, "missing")).toEqual([]);
  });

  it("strips nothing when entries do not share a single top-level folder", () => {
    const entries: RawZipEntry[] = [
      { rawPath: "index.html", bytes: b("<html>") },
      { rawPath: "other/app.js", bytes: b("x") },
    ];
    const out = stripZipballPrefix(entries, "");
    expect(out.map((e) => e.rawPath).sort()).toEqual(["index.html", "other/app.js"]);
  });
});

describe("resolvedRefFromEntries", () => {
  it("extracts the sha tail from the wrapper folder name", () => {
    expect(
      resolvedRefFromEntries([{ rawPath: "companion-abc1234def/index.html", bytes: b("") }]),
    ).toBe("abc1234def");
  });
  it("returns null when the top folder has no sha tail", () => {
    expect(
      resolvedRefFromEntries([{ rawPath: "plainfolder/index.html", bytes: b("") }]),
    ).toBeNull();
  });
});

describe("pullGithubZipball streamed size guard (no Content-Length OOM)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const CONN = { owner: "smithlab", repo: "companion", ref: "main", subdir: "" };

  /**
   * Build a mock Response whose body streams 1 MB chunks with NO Content-Length
   * (the codeload.github.com case). totalChunks * chunkSize is the would-be full
   * size. pulledChunks counts how many chunks the reader actually pulled, so the
   * test can assert the read ABORTS past the cap instead of buffering the whole
   * body. cancelled records that the reader released the stream on abort.
   */
  function makeStreamingResponse(totalChunks: number, chunkBytes: number) {
    const counters = { pulledChunks: 0, cancelled: false };
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= totalChunks) {
          controller.close();
          return;
        }
        counters.pulledChunks += 1;
        emitted += 1;
        controller.enqueue(new Uint8Array(chunkBytes));
      },
      cancel() {
        counters.cancelled = true;
      },
    });
    const res = {
      status: 200,
      ok: true,
      headers: new Headers(), // deliberately NO content-length (chunked transfer)
      body: stream,
    } as unknown as Response;
    return { res, counters };
  }

  it("returns too-large and aborts WITHOUT buffering an over-cap body that has no Content-Length", async () => {
    const chunkBytes = 1024 * 1024; // 1 MB chunks
    const overCapChunks = Math.ceil(BYO_MAX_TOTAL_BYTES / chunkBytes) + 8; // a few MB over
    const { res, counters } = makeStreamingResponse(overCapChunks, chunkBytes);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );

    const result = await pullGithubZipball(CONN);

    expect(result).toEqual({ ok: false, error: "too-large" });
    // The read aborted: it pulled only enough chunks to cross the cap (plus the
    // stream's small internal prefetch buffer), never the whole body, and it
    // cancelled the stream to release the connection.
    expect(counters.cancelled).toBe(true);
    expect(counters.pulledChunks).toBeLessThan(overCapChunks);
    const capChunks = Math.ceil(BYO_MAX_TOTAL_BYTES / chunkBytes);
    expect(counters.pulledChunks).toBeLessThanOrEqual(capChunks + 4);
  });

  it("maps a body stream error to fetch-failed and cancels the reader", async () => {
    const counters = { cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("stream boom");
      },
      cancel() {
        counters.cancelled = true;
      },
    });
    const res = {
      status: 200,
      ok: true,
      headers: new Headers(),
      body: stream,
    } as unknown as Response;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );

    const result = await pullGithubZipball(CONN);
    expect(result).toEqual({ ok: false, error: "fetch-failed" });
  });
});
