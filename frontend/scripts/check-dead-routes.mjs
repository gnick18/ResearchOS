#!/usr/bin/env node
//
// Dead-route guard. Cross-references every STATIC internal link target in
// frontend/src against the real Next.js route tree (frontend/src/app) and fails
// when a link points at a route that does not exist.
//
// Why this exists: a hardcoded href / router.push to a path with no page 404s at
// runtime, and the top-level [labSlug] lab-companion route MASKS it (it matches
// any single-segment path, then notFound()s when no lab by that name exists). So
// a plain "page is missing" link silently becomes a 404 instead of a build error.
// This guard surfaces them. See fix(routes) 12491525c for the first sweep.
//
// Contract (mirrors icon-guard-precommit.mjs): exit 0 = clean, exit 1 = a real
// dead link (block the commit), exit 2 = a tooling error (fail OPEN, never wedge
// a commit). Run manually with `node frontend/scripts/check-dead-routes.mjs`.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

// Paths are resolved from THIS file so the check runs from any cwd (the hook
// invokes it from the repo root).
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const APP = join(SRC, "app");

// Link targets that are deliberately resolved at runtime (not a static page) and
// must not be flagged. Keep this tiny and justified. Empty today.
const ALLOW = new Set([]);

function main() {
  function walk(dir, acc = []) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, acc);
      else acc.push(p);
    }
    return acc;
  }

  // 1. Route set from app/**/page.* (strip (route groups), keep dynamic segments).
  const routes = walk(APP)
    .filter((f) => /\/page\.(tsx|ts|jsx|js)$/.test(f))
    .map((f) => {
      const r = "/" +
        relative(APP, f)
          .replace(/\/page\.(tsx|ts|jsx|js)$/, "")
          .split("/")
          .filter((seg) => !/^\(.*\)$/.test(seg))
          .join("/");
      return r === "/" ? "/" : r.replace(/\/$/, "");
    });

  // A route whose FIRST segment is dynamic (e.g. /[labSlug]) matches ANY single
  // path and would hide every dead link, so it never validates a static target.
  const firstSegDynamic = (r) => {
    const s = r.split("/").filter(Boolean);
    return s.length > 0 && /^\[.*\]$/.test(s[0]);
  };
  const matchers = routes
    .filter((r) => r !== "/" && !firstSegDynamic(r))
    .map((r) => {
      let out = "";
      for (const seg of r.split("/")) {
        if (seg === "") continue;
        if (/^\[\[\.\.\..+\]\]$/.test(seg)) out += "(?:/.*)?"; // optional catch-all
        else if (/^\[\.\.\..+\]$/.test(seg)) out += "/.*"; // catch-all
        else if (/^\[.+\]$/.test(seg)) out += "/[^/]+"; // dynamic
        else out += "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      return new RegExp("^" + (out || "/") + "/?$");
    });
  const isLive = (p) => p === "/" || matchers.some((m) => m.test(p));

  // 2. Static internal link targets across the source tree.
  const files = walk(SRC).filter(
    (f) => /\.(tsx|ts|jsx|js)$/.test(f) && !/\.test\./.test(f) && !/\.d\.ts$/.test(f),
  );
  const linkRe =
    /(?:href=|router\.(?:push|replace)\(|redirect\(|permanentRedirect\(|\bnavigate\()\s*\{?\s*["'`](\/[^"'`${}\s]*)["'`]/g;
  const hits = new Map();
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      let m;
      linkRe.lastIndex = 0;
      while ((m = linkRe.exec(line))) {
        let path = m[1].split("#")[0].split("?")[0];
        if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
        // Skip API routes, asset files, the root, and template-y junk.
        if (path.startsWith("/api/") || /\.[a-z0-9]{2,4}$/i.test(path)) continue;
        if (path === "/" || path.includes("...") || ALLOW.has(path)) continue;
        if (!hits.has(path)) hits.set(path, []);
        hits.get(path).push(`${relative(SRC, f)}:${i + 1}`);
      }
    });
  }

  // 3. Report.
  const dead = [...hits.entries()].filter(([p]) => !isLive(p)).sort();
  if (dead.length === 0) {
    return 0;
  }
  console.error(
    `\n[dead-routes] ${dead.length} internal link(s) point at a route that does not exist:\n`,
  );
  for (const [p, locs] of dead) {
    console.error(`  ${p}`);
    for (const l of locs.slice(0, 8)) console.error(`      ${l}`);
    if (locs.length > 8) console.error(`      ... +${locs.length - 8} more`);
  }
  console.error(
    "\nFix the link to a real route, or if it is a genuine runtime-resolved path,\n" +
      "add it to ALLOW in frontend/scripts/check-dead-routes.mjs with a reason.\n",
  );
  return 1;
}

try {
  process.exit(main());
} catch (err) {
  // Fail OPEN on a tooling error so a hook can never wedge a commit.
  console.error("[dead-routes] check skipped (tooling error):", err && err.message);
  process.exit(2);
}
