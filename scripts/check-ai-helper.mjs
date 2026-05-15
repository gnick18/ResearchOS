#!/usr/bin/env node
/**
 * scripts/check-ai-helper.mjs
 *
 * AI Helper drift detector. Compares the schema_hash recorded in
 * `frontend/public/ai-helper/manifest.json` against a freshly-computed
 * hash of `frontend/src/lib/types.ts`. Exits 0 on match, 1 on drift.
 *
 * Wired into `frontend/package.json`'s `prebuild` so Vercel deploys
 * (and local `npm run build`) refuse to ship a stale prompt bundle.
 *
 * Run via:
 *   npm run --prefix frontend ai-helper:check
 *
 * Owned by: AI Helper chip 1 (sub-bot).
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
process.chdir(REPO_ROOT);

const MANIFEST_PATH = "frontend/public/ai-helper/manifest.json";
const TYPES_PATH = "frontend/src/lib/types.ts";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(
      `[check-ai-helper] AI Helper prompts have never been built.\n` +
        `  Run \`npm run --prefix frontend ai-helper:build\` to generate them.`,
    );
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch (err) {
    console.error(`[check-ai-helper] manifest is unreadable (${err.message}).`);
    process.exit(1);
  }

  const typesTs = await readFile(TYPES_PATH, "utf8");
  // Mirror the schemasSection construction in build-ai-helper.mjs so the
  // hashes stay in lockstep.
  const schemasSection =
    `## §4 Entity schemas\n\nVerbatim copy of \`${TYPES_PATH}\`. ` +
    `Comments in the source file are the authoritative documentation for each field.\n\n` +
    `\`\`\`typescript\n${typesTs.trimEnd()}\n\`\`\`\n`;
  const liveHash = sha256(schemasSection);

  if (liveHash === manifest.schema_hash) {
    console.log(
      `[check-ai-helper] OK (schema_hash matches, helper_version=${manifest.helper_version})`,
    );
    process.exit(0);
  }

  console.error(
    `[check-ai-helper] AI Helper prompts are stale relative to ${TYPES_PATH}.\n` +
      `  Recorded schema_hash: ${manifest.schema_hash}\n` +
      `  Live schema_hash:     ${liveHash}\n` +
      `  Run \`npm run --prefix frontend ai-helper:refresh\` to rebuild and commit.`,
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
