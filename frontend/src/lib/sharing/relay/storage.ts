// Cross-boundary sharing, relay object storage on Cloudflare R2 (Phase 2a-ii).
//
// The relay is a blind store-and-forward mailbox. It moves sealed (end-to-end
// encrypted) bundles between two registered users who do not share a folder. The
// bytes that pass through here are opaque ciphertext the server can never read,
// and they live in R2 only until the recipient acknowledges pickup or the 30-day
// TTL sweeps them. The client uploads and downloads the bytes directly to and
// from R2 using short-lived presigned URLs, so the sealed payload never transits
// our serverless functions (which also sidesteps the Vercel body-size cap).
//
// This module is a thin adapter over the AWS S3 SDK pointed at the R2 endpoint,
// kept deliberately narrow (presign up, presign down, delete) so the storage
// backend is swappable later without touching the routes. The S3 client is built
// lazily inside a singleton from the R2_ env vars, so importing this module
// during a build or a tsc pass requires no credentials.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let s3Singleton: S3Client | null = null;

/** Default presigned-URL lifetime, five minutes, long enough for one transfer. */
const DEFAULT_PRESIGN_TTL_SECONDS = 300;

/**
 * Lazily constructs the S3 client aimed at the account's R2 endpoint. R2 speaks
 * the S3 API but requires region "auto" and the account-scoped endpoint. Throws
 * a clear error if any R2_ credential is missing so a misconfigured deployment
 * fails at request time rather than producing an opaque signing error.
 */
function getS3(): S3Client {
  if (s3Singleton) return s3Singleton;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set. The relay cannot reach R2 without them.",
    );
  }
  s3Singleton = new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Singleton;
}

/**
 * Returns the configured bucket name, or throws if R2_BUCKET is unset. Read
 * lazily here for the same reason as the credentials.
 */
function getBucket(): string {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error("R2_BUCKET is not set. The relay has no bucket to use.");
  }
  return bucket;
}

/**
 * Presigns a one-shot PUT URL the client uses to upload the sealed bundle bytes
 * for the given object key. The URL expires after ttlSeconds. The relay never
 * sees the bytes, only the key.
 */
export async function presignUpload(
  key: string,
  ttlSeconds: number = DEFAULT_PRESIGN_TTL_SECONDS,
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(getS3(), command, { expiresIn: ttlSeconds });
}

/**
 * Presigns a one-shot GET URL the recipient uses to download the sealed bundle
 * bytes for the given object key. The URL expires after ttlSeconds.
 */
export async function presignDownload(
  key: string,
  ttlSeconds: number = DEFAULT_PRESIGN_TTL_SECONDS,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(getS3(), command, { expiresIn: ttlSeconds });
}

/**
 * Deletes the object for the given key. Called on pickup acknowledgement and
 * when a route encounters an expired entry. R2 delete is idempotent, deleting a
 * missing key is not an error, so a double-ack or a delete-after-sweep is safe.
 */
export async function deleteObject(key: string): Promise<void> {
  await getS3().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  );
}
