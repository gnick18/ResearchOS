// Lab companion-site hosted-asset R2 client (lab-domains Phase 4a, social lane).
//
// The social lane's OWN S3 client over Cloudflare R2, used to host the Parquet
// bytes behind a public, login-free interactive dataset viewer. The author's
// browser uploads the Parquet directly to R2 via a short-lived presigned PUT URL
// minted here (server-side, gated); the public reader fetches the bytes back
// through the same-origin read endpoint, which streams the object from R2 so the
// reader needs no creds and no presigned URL ever leaks to the public.
//
// PROVENANCE / BOUNDARY. The S3 client construction is the SAME pattern as
// lib/social/institution-registry.ts: a fresh S3Client built over the shared R2_
// env (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET). This
// module deliberately does NOT import lib/sharing/relay/storage.ts (the sharing
// lane's own R2 client) per the lane boundary; it only imports the public AWS SDK
// packages (@aws-sdk/client-s3 + @aws-sdk/s3-request-presigner), which are plain
// dependencies. The two lanes use different key prefixes so their objects never
// collide.
//
// Node-only (aws-sdk), so importing this from a client component fails the build,
// which is the intended guard. Every export returns null / throws cleanly when R2
// is not configured, so a deployment without R2_ env degrades to "no live asset"
// rather than a 500.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { hostedAssetKey } from "./lab-site-hosted";

/** The Content-Type stored for a hosted Parquet object. */
const PARQUET_CONTENT_TYPE = "application/vnd.apache.parquet";

/** Presigned PUT URL lifetime. Short, because the author uploads immediately
 *  after the presign call (it is a single round trip in the publish flow). */
const PRESIGN_PUT_TTL_SECONDS = 5 * 60;

/**
 * Build the social-lane R2 S3 client from the shared R2_ env, or null when any
 * required var is missing. Mirrors institution-registry.ts getR2() exactly.
 */
function getR2(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
  });
}

/** The configured bucket, or null. */
function getBucket(): string | null {
  return process.env.R2_BUCKET ?? null;
}

/** True when R2 is fully configured (creds + bucket). The endpoints check this to
 *  return a clean 503 "hosting unavailable" instead of attempting a doomed call. */
export function isAssetStoreConfigured(): boolean {
  return getR2() !== null && getBucket() !== null;
}

/**
 * Mint a short-lived presigned PUT URL the AUTHOR'S BROWSER uses to upload the
 * Parquet bytes for one assetId directly to R2. Returns null when R2 is not
 * configured. The Content-Type is pinned to the Parquet type and the client MUST
 * send the same header on its PUT (presigned URLs sign the headers), so a wrong
 * content-type fails the upload rather than storing mislabeled bytes.
 */
export async function presignAssetPut(assetId: string): Promise<string | null> {
  const s3 = getR2();
  const bucket = getBucket();
  if (!s3 || !bucket) return null;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: hostedAssetKey(assetId),
    ContentType: PARQUET_CONTENT_TYPE,
  });
  return getSignedUrl(s3, command, { expiresIn: PRESIGN_PUT_TTL_SECONDS });
}

/** The Content-Type the client MUST set on the presigned PUT, exported so the
 *  upload helper and the endpoint agree on one value. */
export const ASSET_PUT_CONTENT_TYPE = PARQUET_CONTENT_TYPE;

/**
 * Read a hosted asset's bytes from R2 as a Uint8Array, or null when R2 is not
 * configured or the object is gone (a deleted / GC'd / never-uploaded asset). The
 * public read endpoint calls this and streams the bytes to the browser, so the
 * public reader never sees R2 directly and no presigned URL is exposed.
 *
 * Returns null (not throw) on a missing object so the read endpoint can answer a
 * clean 404 and the public viewer falls back to the baked snapshot.
 */
export async function readAssetBytes(assetId: string): Promise<Uint8Array | null> {
  const s3 = getR2();
  const bucket = getBucket();
  if (!s3 || !bucket) return null;
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: hostedAssetKey(assetId) }),
    );
    if (!res.Body) return null;
    return await res.Body.transformToByteArray();
  } catch {
    // Missing key, access error, or transient R2 failure: treat as "gone" so the
    // public viewer degrades to the baked snapshot rather than a 500.
    return null;
  }
}

/**
 * Delete a hosted asset object from R2 (best effort). Used when an asset is
 * removed (re-publish dropped the embed) or by the Phase 4b GC. Returns true on a
 * successful delete, false when R2 is unconfigured or the delete failed. Deleting
 * a missing key is a no-op success on R2.
 *
 * NOTE: Phase 4a only deletes an asset that is being REPLACED in place (the PUT
 * overwrites the same key, so a true delete is rarely needed here). The lifecycle
 * GC / reclaim of orphaned assets after a lab's subscription lapses is Phase 4b.
 */
export async function deleteAsset(assetId: string): Promise<boolean> {
  const s3 = getR2();
  const bucket = getBucket();
  if (!s3 || !bucket) return false;
  try {
    await s3.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: hostedAssetKey(assetId) }),
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// BYO ("bring your own") static-site files (lab-domains BYO Slice 1).
//
// A BYO site is a set of static files stored under a PER-LAB key prefix, distinct
// from the hosted-Parquet keys above so the two uses never collide. The server
// uploads each unzipped file here (the bytes DO transit this server, unlike the
// Parquet presign flow, because the server unzips + sanitizes the archive first),
// and the public serve route reads one file back at a time and streams it. R2 keeps
// the Content-Type per object, so the serve route reads it back.
// ---------------------------------------------------------------------------

/** The R2 key prefix for ALL BYO static-site files. Kept distinct from the hosted
 *  Parquet prefix + the institution-registry prefix so the social-lane R2 uses
 *  never collide. Overridable via env for a preview deployment. */
export const BYO_SITE_KEY_PREFIX =
  process.env.LAB_BYO_SITE_R2_PREFIX ?? "byo-sites";

/** Build the R2 object key for one BYO file: `<prefix>/<labFragment>/<relPath>`.
 *  labFragment namespaces per lab; relPath is the ALREADY-SANITIZED relative path
 *  (the caller passes a path that has been through sanitizeZipEntryPath, so this is
 *  a flat, safe join). */
export function byoFileKey(labFragment: string, relPath: string): string {
  return `${BYO_SITE_KEY_PREFIX}/${labFragment}/${relPath}`;
}

/**
 * Store one BYO file's bytes to R2 with its Content-Type. Returns true on success,
 * false when R2 is unconfigured or the put failed. The caller has already
 * sanitized relPath and chosen contentType per extension.
 */
export async function putByoFile(
  labFragment: string,
  relPath: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<boolean> {
  const s3 = getR2();
  const bucket = getBucket();
  if (!s3 || !bucket) return false;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: byoFileKey(labFragment, relPath),
        // Copy into a fresh buffer so a pooled view is not retained by the SDK.
        Body: bytes.slice(),
        ContentType: contentType,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** One BYO file read back from R2: its bytes + the stored Content-Type. */
export interface ByoFileBytes {
  bytes: Uint8Array;
  contentType: string | null;
}

/**
 * Read one BYO file's bytes (and stored Content-Type) from R2, or null when R2 is
 * unconfigured or the object is gone. The public serve route streams these bytes;
 * a null result is a clean 404.
 */
export async function readByoFile(
  labFragment: string,
  relPath: string,
): Promise<ByoFileBytes | null> {
  const s3 = getR2();
  const bucket = getBucket();
  if (!s3 || !bucket) return null;
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: byoFileKey(labFragment, relPath) }),
    );
    if (!res.Body) return null;
    const bytes = await res.Body.transformToByteArray();
    return { bytes, contentType: res.ContentType ?? null };
  } catch {
    return null;
  }
}

/**
 * Delete ALL BYO files under one lab's prefix (best effort). Called before storing
 * a fresh upload so a re-upload never leaves orphaned files from the previous site
 * (a removed page would otherwise stay reachable). Returns true on success, false
 * when R2 is unconfigured or a delete failed. Lists + deletes in pages of 1000.
 */
export async function deleteByoSite(labFragment: string): Promise<boolean> {
  const s3 = getR2();
  const bucket = getBucket();
  if (!s3 || !bucket) return false;
  const prefix = `${BYO_SITE_KEY_PREFIX}/${labFragment}/`;
  try {
    let token: string | undefined;
    do {
      const list = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      const keys = (list.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => typeof k === "string");
      for (const key of keys) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
    return true;
  } catch {
    return false;
  }
}
