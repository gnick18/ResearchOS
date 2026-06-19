// Operator storage inventory. Walks the R2 buckets and aggregates object counts
// and bytes into a two-level prefix tree, so the /admin Storage inventory section
// can show exactly what is stored on the .com side: the icon library, each lab's
// hosted site assets, the sharing relay, and anything else, broken down by the
// key prefix each lane writes under.
//
// It builds its OWN S3 client from the shared R2_ env (R2_ACCOUNT_ID /
// R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY), the same account-scoped credentials
// the relay and the asset library already use, so it can reach both the app
// bucket (R2_BUCKET) and the public asset bucket (ASSET_R2_BUCKET). Each bucket
// is walked independently and a single unreachable bucket degrades to
// reachable:false with the error, never sinking the whole report.
//
// Walking a bucket is a full ListObjectsV2 pagination (the asset bucket alone is
// ~28k objects), so the result is cached in module scope for a few minutes. The
// operator can force a fresh walk with ?refresh=1 on the API route.

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

/** A second-level prefix under a top-level one (e.g. a single lab under lab-sites). */
export interface SubPrefixUsage {
  prefix: string;
  objects: number;
  bytes: number;
}

/** A top-level key prefix within a bucket, with its child breakdown. */
export interface PrefixUsage {
  prefix: string;
  objects: number;
  bytes: number;
  /** Second-level breakdown (e.g. per lab), sorted by bytes, capped + rolled up. */
  children: SubPrefixUsage[];
}

export interface BucketInventory {
  bucket: string;
  /** Human label for the section (what this bucket holds). */
  label: string;
  reachable: boolean;
  error?: string;
  totalObjects: number;
  totalBytes: number;
  /** Top-level prefixes, sorted by bytes descending. */
  prefixes: PrefixUsage[];
}

export interface StorageInventory {
  buckets: BucketInventory[];
  generatedAtMs: number;
}

const ROOT = "(root)";
const MAX_TOP_PREFIXES = 40;
const MAX_CHILDREN = 60;

let s3Singleton: S3Client | null = null;

function getS3(): S3Client | null {
  if (s3Singleton) return s3Singleton;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  s3Singleton = new S3Client({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Singleton;
}

/** The buckets we inventory and how to label them. */
function bucketTargets(): { bucket: string; label: string }[] {
  const targets: { bucket: string; label: string }[] = [];
  const appBucket = process.env.R2_BUCKET;
  if (appBucket) {
    targets.push({ bucket: appBucket, label: "App data (lab sites + sharing relay)" });
  }
  const assetBucket = process.env.ASSET_R2_BUCKET || "researchos-assets";
  // Avoid double-listing if the two ever point at the same bucket.
  if (assetBucket && assetBucket !== appBucket) {
    targets.push({ bucket: assetBucket, label: "Icon library (public assets)" });
  }
  return targets;
}

/** Split a key into [top, second] path segments. */
export function segments(key: string): [string, string | null] {
  const slash = key.indexOf("/");
  if (slash < 0) return [ROOT, null];
  const top = key.slice(0, slash);
  const rest = key.slice(slash + 1);
  const slash2 = rest.indexOf("/");
  const second = slash2 < 0 ? (rest || null) : rest.slice(0, slash2);
  return [top || ROOT, second];
}

interface MutPrefix {
  objects: number;
  bytes: number;
  children: Map<string, { objects: number; bytes: number }>;
}

/**
 * Pure aggregation: fold a flat list of {key, size} objects into the two-level
 * prefix tree with totals. Separated from the S3 walk so it is unit-testable.
 */
export function aggregateObjects(
  items: { key: string; size: number }[],
): { totalObjects: number; totalBytes: number; prefixes: PrefixUsage[] } {
  const tops = new Map<string, MutPrefix>();
  let totalObjects = 0;
  let totalBytes = 0;
  for (const { key, size } of items) {
    totalObjects += 1;
    totalBytes += size;
    const [top, second] = segments(key);
    let node = tops.get(top);
    if (!node) {
      node = { objects: 0, bytes: 0, children: new Map() };
      tops.set(top, node);
    }
    node.objects += 1;
    node.bytes += size;
    if (second) {
      const child = node.children.get(second) ?? { objects: 0, bytes: 0 };
      child.objects += 1;
      child.bytes += size;
      node.children.set(second, child);
    }
  }
  return { totalObjects, totalBytes, prefixes: rollup(tops) };
}

async function inventoryBucket(
  s3: S3Client,
  bucket: string,
  label: string,
): Promise<BucketInventory> {
  const base: BucketInventory = {
    bucket,
    label,
    reachable: false,
    totalObjects: 0,
    totalBytes: 0,
    prefixes: [],
  };
  try {
    const items: { key: string; size: number }[] = [];
    let token: string | undefined;
    do {
      const out = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
      );
      for (const obj of out.Contents ?? []) {
        items.push({ key: obj.Key ?? "", size: obj.Size ?? 0 });
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);

    const { totalObjects, totalBytes, prefixes } = aggregateObjects(items);
    return { ...base, reachable: true, totalObjects, totalBytes, prefixes };
  } catch (err) {
    return {
      ...base,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Sort + cap the prefix tree, rolling the tail into a single "(other)" bucket. */
function rollup(tops: Map<string, MutPrefix>): PrefixUsage[] {
  const entries = [...tops.entries()]
    .map(([prefix, n]) => ({ prefix, ...n }))
    .sort((a, b) => b.bytes - a.bytes);

  const capped = capList(
    entries,
    MAX_TOP_PREFIXES,
    (e) => ({ prefix: e.prefix, objects: e.objects, bytes: e.bytes, children: e.children }),
    (objects, bytes) => ({ prefix: "(other)", objects, bytes, children: new Map() }),
  );

  return capped.map((e) => {
    const childList = [...e.children.entries()]
      .map(([prefix, c]) => ({ prefix, objects: c.objects, bytes: c.bytes }))
      .sort((a, b) => b.bytes - a.bytes);
    const children = capList(
      childList,
      MAX_CHILDREN,
      (c) => c,
      (objects, bytes) => ({ prefix: "(other)", objects, bytes }),
    );
    return { prefix: e.prefix, objects: e.objects, bytes: e.bytes, children };
  });
}

/** Keep the top `max` by bytes, fold the remainder into one rollup row. */
function capList<T, R>(
  sorted: T[],
  max: number,
  pick: (t: T) => R,
  rollupRow: (objects: number, bytes: number) => R,
): R[] {
  if (sorted.length <= max) return sorted.map(pick);
  const kept = sorted.slice(0, max).map(pick);
  let objects = 0;
  let bytes = 0;
  for (const t of sorted.slice(max)) {
    const anyT = t as unknown as { objects: number; bytes: number };
    objects += anyT.objects;
    bytes += anyT.bytes;
  }
  kept.push(rollupRow(objects, bytes));
  return kept;
}

let cache: { at: number; data: StorageInventory } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The full inventory across all configured buckets. Cached for CACHE_TTL_MS so a
 * dashboard load does not re-walk tens of thousands of objects; pass force=true
 * to bypass the cache.
 */
export async function getStorageInventory(force = false): Promise<StorageInventory> {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_TTL_MS) return cache.data;

  const s3 = getS3();
  const targets = bucketTargets();
  let buckets: BucketInventory[];
  if (!s3) {
    buckets = targets.map((t) => ({
      bucket: t.bucket,
      label: t.label,
      reachable: false,
      error: "R2 credentials are not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).",
      totalObjects: 0,
      totalBytes: 0,
      prefixes: [],
    }));
  } else {
    buckets = await Promise.all(targets.map((t) => inventoryBucket(s3, t.bucket, t.label)));
  }

  const data: StorageInventory = { buckets, generatedAtMs: now };
  cache = { at: now, data };
  return data;
}
