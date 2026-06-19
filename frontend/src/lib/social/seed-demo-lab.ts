// Demo lab deploy seeder (demo-lab-network Phase 1, social lane).
//
// seedDemoLab() provisions the seeded "demo lab" showcase: it reserves the demo
// slug in slug_registry as kind=lab under the NON-BILLING sentinel owner key,
// creates the lab_sites row, upserts + publishes the three native pages (with
// their frozen baked-figure snapshots), and uploads the checked-in BYO static-site
// bundle to R2 plus the lab_byo_sites manifest. Idempotent, in the same style as
// seedReservedSlugs / seedExistingHandles / seedInstitutionSlugs: every underlying
// write is an upsert / ON CONFLICT, so re-running on every deploy is a no-op.
//
// This is the IO layer (Neon + R2 + fs). The pure content lives in demo-lab.ts so
// the shapes are unit-testable without infrastructure. Every dependency is
// injectable (DemoSeedDeps) so a test can run the whole seed against an in-memory
// fake and assert idempotency without a database.
//
// HOLD: this seeder is NOT wired to any route or deploy step here. Running it is
// Phase 3 (prod activation), held for Grant. It needs a populated Neon
// DATABASE_URL and configured R2_* in the target environment.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { BakedEmbed } from "@/lib/export/bake-embeds";
import {
  DEMO_BYO_FILES,
  DEMO_LAB_OWNER_KEY,
  DEMO_LAB_SLUG,
  DEMO_NATIVE_PAGES,
  type DemoFigure,
} from "./demo-lab";
import {
  byoLabFragment,
  contentTypeForPath,
  serializeByoManifest,
  validateByoEntries,
  type ByoSiteManifest,
} from "./lab-byo";
import { upsertByoSite, type LabByoSiteRow } from "./lab-byo-db";
import { putByoFile } from "./lab-site-asset-store";
import {
  createSite,
  publishPage,
  upsertPage,
  type LabSitePageRow,
  type LabSiteRow,
} from "./lab-site-db";
import {
  serializeSnapshotBundle,
  type SnapshotBundle,
} from "./lab-site-snapshots";
import { reserveSlug, type ReserveResult } from "./slug-registry-db";

/**
 * The IO surface the seed touches, injectable so a unit test can drive the whole
 * seed against an in-memory fake (no Neon, no R2, no fs) and assert idempotency.
 * Defaults bind to the real DB / R2 helpers.
 */
export interface DemoSeedDeps {
  reserveSlug: typeof reserveSlug;
  createSite: typeof createSite;
  upsertPage: typeof upsertPage;
  publishPage: typeof publishPage;
  putByoFile: typeof putByoFile;
  upsertByoSite: typeof upsertByoSite;
  /** Read one BYO bundle file's bytes by its relative path (defaults to the
   *  checked-in fixtures/demo-byo-site/ folder). */
  readBundleFile: (relPath: string) => Promise<Uint8Array>;
  /** Read one figure's SVG artwork by file name (defaults to the checked-in
   *  fixtures/figures/ folder). The seeder turns it into the baked snapshot. */
  readFigureSvg: (svgFile: string) => Promise<string>;
}

/** Read a checked-in BYO bundle file from fixtures/demo-byo-site/<relPath>. */
async function readFixtureFile(relPath: string): Promise<Uint8Array> {
  const dir = fileURLToPath(new URL("./fixtures/demo-byo-site/", import.meta.url));
  const buf = await readFile(`${dir}${relPath}`);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Read a checked-in figure SVG from the fixtures/figures/ folder by file name. */
async function readFigureFile(svgFile: string): Promise<string> {
  const dir = fileURLToPath(new URL("./fixtures/figures/", import.meta.url));
  return readFile(`${dir}${svgFile}`, "utf8");
}

const DEFAULT_DEPS: DemoSeedDeps = {
  reserveSlug,
  createSite,
  upsertPage,
  publishPage,
  putByoFile,
  upsertByoSite,
  readBundleFile: readFixtureFile,
  readFigureSvg: readFigureFile,
};

/** Build the frozen snapshot bundle for one figure from its SVG artwork. The
 *  baked image renders through `<img src={dataUrl}>`, which accepts an SVG data
 *  URL, so the figure shows on the public page without a real canvas bake. Keyed
 *  by the figure href, the key the public render resolves the embed by. */
function buildFigureBundle(figure: DemoFigure, svg: string): SnapshotBundle {
  const baked: BakedEmbed = {
    kind: "image",
    dataUrl: `data:image/svg+xml,${encodeURIComponent(svg.trim())}`,
    width: figure.width,
    height: figure.height,
    caption: figure.caption,
    label: null,
  };
  return { version: 1, snapshots: { [figure.href]: baked } };
}

/** A short summary of what the seed wrote, for the deploy log. */
export interface DemoSeedResult {
  slug: string;
  slugReserved: boolean | "already";
  siteOk: boolean;
  pagesPublished: number;
  byoFilesUploaded: number;
  byoTotalBytes: number;
  byoManifestStored: boolean;
}

/**
 * Idempotently seed the demo lab. Safe to call on every deploy.
 *
 * Steps (each idempotent):
 *   1. reserve DEMO_LAB_SLUG as kind=lab under DEMO_LAB_OWNER_KEY (ON CONFLICT
 *      DO NOTHING, so a re-run reports "already" not an error).
 *   2. create the lab_sites row (upsert on owner key).
 *   3. upsert + publish the three native pages, storing each page's frozen
 *      snapshot bundle.
 *   4. validate the checked-in BYO bundle, upload each file to R2, and upsert the
 *      lab_byo_sites manifest.
 *
 * Returns a summary. Throws only on a genuine IO failure (a missing DATABASE_URL
 * or a failed write surfaces, so a broken seed is loud).
 */
export async function seedDemoLab(
  deps: Partial<DemoSeedDeps> = {},
): Promise<DemoSeedResult> {
  const d: DemoSeedDeps = { ...DEFAULT_DEPS, ...deps };

  // 1. Reserve the slug as kind=lab under the sentinel owner key.
  const reserve: ReserveResult = await d.reserveSlug(
    DEMO_LAB_SLUG,
    "lab",
    DEMO_LAB_OWNER_KEY,
    DEMO_LAB_SLUG,
  );
  if (!reserve.ok && reserve.reason === "invalid") {
    throw new Error(`Demo lab slug is invalid: ${reserve.error}`);
  }
  const slugReserved: boolean | "already" = reserve.ok ? true : "already";

  // 2. Create (or confirm) the site row under the sentinel owner key.
  const site = await d.createSite(DEMO_LAB_OWNER_KEY, DEMO_LAB_SLUG);
  const siteOk = site !== null && site.labSlug === DEMO_LAB_SLUG;

  // 3. Upsert + publish each native page with its frozen snapshot bundle (built
  //    from the checked-in figure SVG).
  let pagesPublished = 0;
  for (const page of DEMO_NATIVE_PAGES) {
    await d.upsertPage({
      labOwnerKey: DEMO_LAB_OWNER_KEY,
      path: page.path,
      title: page.title,
      bodyMd: page.bodyMd,
    });
    let snapshotsJson: string | null = null;
    if (page.figure) {
      const svg = await d.readFigureSvg(page.figure.svgFile);
      snapshotsJson = serializeSnapshotBundle(buildFigureBundle(page.figure, svg));
    }
    const published = await d.publishPage(
      DEMO_LAB_OWNER_KEY,
      page.path,
      snapshotsJson,
      null,
    );
    if (published && published.status === "published") pagesPublished += 1;
  }

  // 4. BYO bundle: read the checked-in files, validate, upload to R2, store the
  //    manifest. The validation is the SAME pure path a real upload takes.
  const rawEntries = await Promise.all(
    DEMO_BYO_FILES.map(async (relPath) => ({
      rawPath: relPath,
      bytes: await d.readBundleFile(relPath),
    })),
  );
  const validated = validateByoEntries(rawEntries);
  if (!validated.ok) {
    throw new Error(`Demo BYO bundle failed validation: ${validated.error}`);
  }
  const manifest: ByoSiteManifest = validated.manifest;
  const fragment = byoLabFragment(DEMO_LAB_OWNER_KEY);
  let byoFilesUploaded = 0;
  for (const file of validated.files) {
    const ok = await d.putByoFile(
      fragment,
      file.path,
      file.bytes,
      contentTypeForPath(file.path),
    );
    if (ok) byoFilesUploaded += 1;
  }
  const manifestJson = serializeByoManifest(manifest);
  let byoManifestStored = false;
  if (manifestJson) {
    const row: LabByoSiteRow | null = await d.upsertByoSite({
      labOwnerKey: DEMO_LAB_OWNER_KEY,
      manifestJson,
      totalBytes: manifest.totalBytes,
    });
    byoManifestStored = row !== null;
  }

  return {
    slug: DEMO_LAB_SLUG,
    slugReserved,
    siteOk,
    pagesPublished,
    byoFilesUploaded,
    byoTotalBytes: manifest.totalBytes,
    byoManifestStored,
  };
}

/** Re-exported so a typed caller (test, script) can reference the row types. */
export type { LabSitePageRow, LabSiteRow };
