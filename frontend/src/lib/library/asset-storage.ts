// R2 storage adapter for the open asset library's COMMUNITY write path.
//
// The curated bundle (manifest.json + assets/<source>/*.svg) is produced by the
// ingest tooling and synced out-of-band; this module only ever touches the
// community side: it writes contributed SVGs to assets/community/<id>.svg and
// maintains a SEPARATE community-manifest.json, so user input never rewrites the
// trusted curated manifest. Served back read-only from assets.research-os.com.
//
// Reuses the same R2 account credentials as the relay storage adapter
// (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY), but targets the
// ASSET bucket (ASSET_R2_BUCKET, default "researchos-assets"). The S3 client is
// built lazily so importing this during a build / tsc pass needs no credentials.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { LibraryAsset, RemovedAsset } from "@/lib/figure/asset-library";

const COMMUNITY_MANIFEST_KEY = "community-manifest.json";
// Rejected community assets move here for the retention window (see asset-library
// REMOVAL_RETENTION_DAYS). Kept separate so the live manifest read path is clean.
const COMMUNITY_REMOVED_KEY = "community-removed.json";

let s3Singleton: S3Client | null = null;

function getS3(): S3Client {
  if (s3Singleton) return s3Singleton;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set. The asset library cannot reach R2 without them.",
    );
  }
  s3Singleton = new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Singleton;
}

/** The asset bucket name (defaults to the public researchos-assets bucket). */
function getBucket(): string {
  return process.env.ASSET_R2_BUCKET || "researchos-assets";
}

/** Write one sanitized community SVG to assets/community/<id>.svg. */
export async function putCommunitySvg(id: string, svg: string): Promise<string> {
  const svgPath = `assets/community/${id}.svg`;
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: svgPath,
      Body: svg,
      ContentType: "image/svg+xml",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return svgPath;
}

/** Read the community manifest. Returns [] when it does not exist yet. */
export async function readCommunityManifest(): Promise<LibraryAsset[]> {
  try {
    const out = await getS3().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: COMMUNITY_MANIFEST_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return [];
    const data = JSON.parse(text) as LibraryAsset[];
    return Array.isArray(data) ? data : [];
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
      ?.httpStatusCode;
    if (name === "NoSuchKey" || name === "NotFound" || status === 404) return [];
    throw err;
  }
}

/** Overwrite the community manifest with the given list. */
export async function writeCommunityManifest(list: LibraryAsset[]): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: COMMUNITY_MANIFEST_KEY,
      Body: JSON.stringify(list, null, 2),
      ContentType: "application/json",
      // The manifest changes on every contribution, so it must not be cached
      // immutably the way the per-asset SVGs are.
      CacheControl: "public, max-age=60",
    }),
  );
}

/** Read the removed (rejected, in-retention) manifest. [] when absent. */
export async function readRemovedManifest(): Promise<RemovedAsset[]> {
  try {
    const out = await getS3().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: COMMUNITY_REMOVED_KEY }),
    );
    const text = await out.Body?.transformToString();
    if (!text) return [];
    const data = JSON.parse(text) as RemovedAsset[];
    return Array.isArray(data) ? data : [];
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
      ?.httpStatusCode;
    if (name === "NoSuchKey" || name === "NotFound" || status === 404) return [];
    throw err;
  }
}

/** Overwrite the removed manifest. */
export async function writeRemovedManifest(list: RemovedAsset[]): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: COMMUNITY_REMOVED_KEY,
      Body: JSON.stringify(list, null, 2),
      ContentType: "application/json",
      CacheControl: "public, max-age=60",
    }),
  );
}

/** Hard-delete one asset SVG (used by the GC pass on expired removals). */
export async function deleteAssetSvg(svgPath: string): Promise<void> {
  await getS3().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: svgPath }),
  );
}

/**
 * GC pass: drop removed assets whose retention window has elapsed, hard-deleting
 * their SVGs. Best-effort per-SVG (a failed delete just orphans one file, which a
 * later pass or manual sweep can reap); the manifest is only rewritten when at
 * least one entry expired. Returns how many were purged. Lazily callable from the
 * read/revert endpoints so no cron is required.
 */
export async function purgeExpiredRemovals(
  now: number = Date.now(),
): Promise<{ purged: number }> {
  const removed = await readRemovedManifest();
  const survivors: RemovedAsset[] = [];
  const expired: RemovedAsset[] = [];
  for (const a of removed) {
    if (Date.parse(a.removal.autoExpiresAt) <= now) expired.push(a);
    else survivors.push(a);
  }
  if (expired.length === 0) return { purged: 0 };
  for (const a of expired) {
    try {
      await deleteAssetSvg(a.svgPath);
    } catch {
      /* best-effort GC: leave the orphaned SVG for a later sweep */
    }
  }
  await writeRemovedManifest(survivors);
  return { purged: expired.length };
}
