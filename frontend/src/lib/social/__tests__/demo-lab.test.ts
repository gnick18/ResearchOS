// Demo lab seed + content tests (demo-lab-network Phase 1).
//
// Two concerns:
//   1. SHAPES. The seeded native-page snapshot bundles validate through
//      parseSnapshotBundle, and the BYO bundle validates through validateByoEntries
//      / parseByoManifest, so what the seeder stores is exactly what the public
//      route parses back.
//   2. IDEMPOTENCY. seedDemoLab() run twice against an in-memory fake store never
//      duplicates a row (one slug, one site, three pages, one BYO manifest, three
//      R2 objects), matching the deploy-time "safe to re-run" contract.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEMO_BYO_FILES,
  DEMO_LAB_OWNER_KEY,
  DEMO_LAB_SLUG,
  DEMO_NATIVE_PAGES,
  isDemoLabSlug,
} from "../demo-lab";
import {
  byoLabFragment,
  parseByoManifest,
  validateByoEntries,
} from "../lab-byo";
import { parseSnapshotBundle } from "../lab-site-snapshots";
import {
  normalizeSlug,
  RESERVED_SLUGS,
  validateSlug,
} from "../slug-registry";
import { seedDemoLab, type DemoSeedDeps } from "../seed-demo-lab";

describe("demo lab slug", () => {
  it("is a valid, non-reserved, normalized slug", () => {
    expect(normalizeSlug(DEMO_LAB_SLUG)).toBe(DEMO_LAB_SLUG);
    expect(validateSlug(DEMO_LAB_SLUG)).toBeNull();
    expect(RESERVED_SLUGS.has(DEMO_LAB_SLUG)).toBe(false);
  });

  it("isDemoLabSlug matches the slug (raw + normalized) and nothing else", () => {
    expect(isDemoLabSlug(DEMO_LAB_SLUG)).toBe(true);
    expect(isDemoLabSlug("  FakeYeast-Lab ")).toBe(true);
    expect(isDemoLabSlug("smithlab")).toBe(false);
    expect(isDemoLabSlug(null)).toBe(false);
    expect(isDemoLabSlug("")).toBe(false);
  });
});

describe("native page figures", () => {
  it("home + paper companion carry a figure, people does not", () => {
    const withFigure = DEMO_NATIVE_PAGES.filter((p) => p.figure);
    expect(withFigure.length).toBe(2);
    for (const page of withFigure) {
      expect(page.figure?.href).toBeTruthy();
      expect(page.figure?.svgFile).toMatch(/\.svg$/);
      // The lone block-embed link in the body uses the figure href, so the public
      // render resolves the frozen snapshot the seeder stores under that key.
      expect(page.bodyMd).toContain(page.figure!.href);
    }
  });

  it("the home page is at path '' and the order is home, people, paper", () => {
    expect(DEMO_NATIVE_PAGES.map((p) => p.path)).toEqual([
      "",
      "people",
      "papers/fakeyeast-2026",
    ]);
  });
});

describe("BYO bundle shapes", () => {
  function bundleEntries() {
    return DEMO_BYO_FILES.map((relPath) => ({
      rawPath: relPath,
      bytes: new TextEncoder().encode(`/* ${relPath} */`),
    }));
  }

  it("validates with a root index.html and round-trips through parseByoManifest", () => {
    const result = validateByoEntries(bundleEntries());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.indexPath).toBe("index.html");
    expect(result.manifest.files.map((f) => f.path).sort()).toEqual(
      [...DEMO_BYO_FILES].sort(),
    );
    const parsed = parseByoManifest(JSON.stringify(result.manifest));
    expect(parsed.files.length).toBe(DEMO_BYO_FILES.length);
    expect(parsed.totalBytes).toBe(result.manifest.totalBytes);
  });

  it("declares a root index.html in the file list", () => {
    expect(DEMO_BYO_FILES).toContain("index.html");
  });
});

// ---------------------------------------------------------------------------
// In-memory fake store for the idempotency test (no Neon, no R2, no fs).
// ---------------------------------------------------------------------------

function makeFakeDeps() {
  const slugs = new Map<string, { kind: string; ownerKey: string | null }>();
  const sites = new Map<string, { labOwnerKey: string; labSlug: string }>();
  const pages = new Map<
    string,
    { labOwnerKey: string; path: string; title: string; bodyMd: string; status: string; version: number }
  >();
  const byoSites = new Map<string, { labOwnerKey: string; manifestJson: string; totalBytes: number }>();
  const r2 = new Map<string, Uint8Array>();
  const snapshotsByPath = new Map<string, string | null>();

  const deps: DemoSeedDeps = {
    reserveSlug: async (slug, kind, ownerKey = null) => {
      const s = normalizeSlug(slug);
      if (slugs.has(s)) return { ok: false, reason: "taken" } as const;
      slugs.set(s, { kind, ownerKey });
      return {
        ok: true,
        row: { slug: s, kind, ownerKey, ref: null, createdAt: "now" },
      } as const;
    },
    createSite: async (labOwnerKey, labSlug) => {
      sites.set(labOwnerKey, { labOwnerKey, labSlug });
      return { labOwnerKey, labSlug, createdAt: "now", badgeSnapshotJson: null };
    },
    upsertPage: async ({ labOwnerKey, path, title, bodyMd }) => {
      const key = `${labOwnerKey}::${path}`;
      const prev = pages.get(key);
      const version = prev ? prev.version : 1;
      const row = { labOwnerKey, path, title, bodyMd, status: "draft", version };
      pages.set(key, row);
      return {
        ...row,
        status: "draft" as const,
        updatedAt: "now",
        snapshotsJson: null,
        hostedJson: null,
        blocksJson: null,
      };
    },
    publishPage: async (labOwnerKey, path, snapshotsJson = null, hostedJson = null) => {
      const key = `${labOwnerKey}::${normalizeSlug(path) === path ? path : path}`;
      const prev = pages.get(`${labOwnerKey}::${path}`);
      if (!prev) return null;
      prev.status = "published";
      prev.version += 1;
      pages.set(`${labOwnerKey}::${path}`, prev);
      snapshotsByPath.set(path, snapshotsJson);
      void key;
      return {
        labOwnerKey,
        path,
        title: prev.title,
        bodyMd: prev.bodyMd,
        status: "published" as const,
        version: prev.version,
        updatedAt: "now",
        snapshotsJson,
        hostedJson,
        blocksJson: null,
      };
    },
    putByoFile: async (fragment, relPath, bytes) => {
      r2.set(`${fragment}/${relPath}`, bytes);
      return true;
    },
    upsertByoSite: async ({ labOwnerKey, manifestJson, totalBytes }) => {
      byoSites.set(labOwnerKey, { labOwnerKey, manifestJson, totalBytes });
      return {
        labOwnerKey,
        manifest: parseByoManifest(manifestJson),
        totalBytes,
        updatedAt: "now",
      };
    },
    readBundleFile: async (relPath) =>
      new TextEncoder().encode(`/* demo ${relPath} */\n<!-- index.html -->`),
    // Read the REAL checked-in figure artwork so the test exercises the same SVG
    // the seeder bakes (and so no raw inline SVG lives in this scanned test file).
    readFigureSvg: async (svgFile) => {
      const dir = fileURLToPath(
        new URL("../fixtures/figures/", import.meta.url),
      );
      return readFile(`${dir}${svgFile}`, "utf8");
    },
  };

  return { deps, slugs, sites, pages, byoSites, r2, snapshotsByPath };
}

describe("seedDemoLab idempotency", () => {
  it("seeds the demo lab and re-running never duplicates a row", async () => {
    const store = makeFakeDeps();

    const first = await seedDemoLab(store.deps);
    expect(first.slug).toBe(DEMO_LAB_SLUG);
    expect(first.slugReserved).toBe(true);
    expect(first.siteOk).toBe(true);
    expect(first.pagesPublished).toBe(DEMO_NATIVE_PAGES.length);
    expect(first.byoFilesUploaded).toBe(DEMO_BYO_FILES.length);
    expect(first.byoManifestStored).toBe(true);

    const second = await seedDemoLab(store.deps);
    // The slug is already reserved on the second pass (ON CONFLICT DO NOTHING).
    expect(second.slugReserved).toBe("already");
    expect(second.siteOk).toBe(true);
    expect(second.pagesPublished).toBe(DEMO_NATIVE_PAGES.length);

    // No duplication: exactly one slug, one site, three pages, one BYO manifest,
    // three R2 objects, all under the sentinel owner key.
    expect(store.slugs.size).toBe(1);
    expect(store.slugs.get(DEMO_LAB_SLUG)?.kind).toBe("lab");
    expect(store.slugs.get(DEMO_LAB_SLUG)?.ownerKey).toBe(DEMO_LAB_OWNER_KEY);
    expect(store.sites.size).toBe(1);
    expect(store.pages.size).toBe(DEMO_NATIVE_PAGES.length);
    expect(store.byoSites.size).toBe(1);
    expect(store.r2.size).toBe(DEMO_BYO_FILES.length);

    // Every R2 key is under the sentinel lab fragment.
    const fragment = byoLabFragment(DEMO_LAB_OWNER_KEY);
    for (const key of store.r2.keys()) {
      expect(key.startsWith(`${fragment}/`)).toBe(true);
    }

    // The seeded snapshot the home page published is a real frozen image bundle,
    // keyed by the page's figure href (the key the public render resolves by).
    const homeFigure = DEMO_NATIVE_PAGES.find((p) => p.path === "")?.figure;
    expect(homeFigure).toBeTruthy();
    const homeSnapshotJson = store.snapshotsByPath.get("");
    expect(homeSnapshotJson).toBeTruthy();
    const homeBundle = parseSnapshotBundle(homeSnapshotJson ?? null);
    expect(homeBundle.snapshots[homeFigure!.href]?.kind).toBe("image");
    // The text-only people page stored no snapshot.
    expect(store.snapshotsByPath.get("people")).toBeNull();
  });
});
