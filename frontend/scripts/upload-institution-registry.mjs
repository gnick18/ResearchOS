// Upload the built ROR institution registry to Cloudflare R2 (gzipped).
//
// The registry asset is NOT committed to git (too large) and is NOT served from
// public/ (Vercel functions cannot fs-read public/). It lives in R2 and is
// fetched + cached server-side by src/lib/social/institution-registry.ts.
//
// Usage (run with the prod R2 creds in the environment):
//   node scripts/upload-institution-registry.mjs
//   node scripts/upload-institution-registry.mjs --in public/institution-registry.json --key institution-registry/current.json.gz
//
// Env required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// (the same vars the relay already uses). Key defaults to the value the resolver
// reads (INSTITUTION_REGISTRY_R2_KEY or "institution-registry/current.json.gz").
//
// ROR data is CC0 1.0 (https://ror.org). Re-run after rebuilding the asset from a
// new ROR release; the resolver reads the same key, so a re-upload is a live swap.

import fs from "node:fs";
import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inPath = arg("--in", "public/institution-registry.json");
const key = arg(
  "--key",
  process.env.INSTITUTION_REGISTRY_R2_KEY ||
    "institution-registry/current.json.gz",
);

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } =
  process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error(
    "Missing R2 env. Need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.",
  );
  process.exit(1);
}
if (!fs.existsSync(inPath)) {
  console.error(
    `Input not found: ${inPath}. Build it first: node scripts/build-institution-registry.mjs --download`,
  );
  process.exit(1);
}

const raw = fs.readFileSync(inPath);
const gz = gzipSync(raw, { level: 9 });
console.log(
  `[upload] ${inPath}: ${(raw.length / 1e6).toFixed(1)} MB raw -> ${(gz.length / 1e6).toFixed(1)} MB gzipped -> r2://${R2_BUCKET}/${key}`,
);

const s3 = new S3Client({
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  region: "auto",
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

await s3.send(
  new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: gz,
    ContentType: "application/gzip",
  }),
);
console.log("[upload] done. The resolver will pick it up on the next load.");
