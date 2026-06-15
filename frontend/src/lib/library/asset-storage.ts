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
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { LibraryAsset } from "@/lib/figure/asset-library";

const COMMUNITY_MANIFEST_KEY = "community-manifest.json";

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
