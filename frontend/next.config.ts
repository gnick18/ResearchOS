import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * Resolve the current ResearchOS commit SHA at build time so the AI Helper
 * settings card can compare it against the SHA stamped in
 * `public/ai-helper/manifest.json` and surface a freshness callout when
 * the prompts are older than the running app.
 *
 * Order of preference:
 *  1. `VERCEL_GIT_COMMIT_SHA` — set automatically on Vercel deploys.
 *  2. `RESEARCHOS_COMMIT_SHA` — explicit override (CI, custom hosts).
 *  3. `git rev-parse HEAD` — falls back to the local checkout's HEAD.
 *
 * Returns `undefined` if none resolve (rare; e.g. building from a tarball
 * with no git binary). The Settings card treats `undefined` as "skip the
 * freshness comparison" rather than producing a false-positive callout.
 */
function resolveCommitSha(): string | undefined {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.RESEARCHOS_COMMIT_SHA) return process.env.RESEARCHOS_COMMIT_SHA;
  try {
    const sha = execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return sha || undefined;
  } catch {
    return undefined;
  }
}

const COMMIT_SHA = resolveCommitSha();

const nextConfig: NextConfig = {
  env: {
    // Exposed to the browser as `process.env.NEXT_PUBLIC_RESEARCHOS_COMMIT`
    // and inlined at build time. Used by the AI Helper settings section to
    // detect stale prompt manifests.
    NEXT_PUBLIC_RESEARCHOS_COMMIT: COMMIT_SHA ?? "",
  },
};

export default nextConfig;
