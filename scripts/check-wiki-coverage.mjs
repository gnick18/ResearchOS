#!/usr/bin/env node
/**
 * Wiki coverage check.
 *
 * Scans `frontend/src/app/` for top-level routes with a `page.tsx` file
 * and compares them against the canonical `APP_ROUTE_TO_WIKI` map in
 * `frontend/src/lib/wiki/nav.ts`. Reports three kinds of drift:
 *
 *   - UNMAPPED  — app route exists, no wiki entry
 *   - STALE     — wiki entry exists, no app route
 *   - ORPHANED  — wiki entry points at a `/wiki/...` page that doesn't
 *                 exist on disk
 *
 * Two modes:
 *
 *   - `node scripts/check-wiki-coverage.mjs` (default) — prints a report
 *     and exits 0. Useful for spot-checks or as a printable coverage
 *     summary.
 *   - `node scripts/check-wiki-coverage.mjs --ci` — exits 1 if any
 *     UNMAPPED or ORPHANED routes are found. Wired as a `prebuild`
 *     step so Vercel deploys + local `npm run build` both fail when
 *     the map drifts from reality.
 *
 * Routes intentionally excluded from the check (alternate entry points,
 * server-only paths, Next.js internals, the wiki itself):
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(REPO_ROOT, "frontend", "src", "app");
const NAV_FILE = path.join(REPO_ROOT, "frontend", "src", "lib", "wiki", "nav.ts");
const WIKI_DIR = path.join(REPO_ROOT, "frontend", "src", "app", "wiki");

/** Routes that should never be in the wiki map. */
const EXCLUDED_PREFIXES = [
  "/wiki", // the wiki itself is the docs; doesn't need its own wiki page
  "/api", // server-only proxy routes
  "/demo", // alternate entry, documented under /wiki/getting-started/demo-mode
  "/results", // redirect-only transitional route → /workbench (page killed per RESULTS_PAGE_PROPOSAL.md)
  "/experiments", // redirect-only stub → /workbench (no AppShell, so the ? icon never renders here)
  "/pcr", // redirect-only stub → /methods (PCR fully managed under /methods; repair button moved to Settings)
  "/lab-inbox", // redirect-only stub → /lab-overview (legacy bookmark target after the 2026-05-23 rename)
  "/showcase", // hidden, unlinked BeakerBot showcase Easter egg (URL / brand-mark unlock only, never in nav); not a documented feature
  "/sequences", // pending wiki page (sequence editor Phase 4)
  "/open-source", // "Built on open source" credits + attribution page (legal/informational, no AppShell, not a documented app feature; like /welcome)
  "/thanks", // "Sponsors and thanks": GitHub Sponsors tiers + open-source thank-you (marketing/brand page, no AppShell, not a documented app feature; like /open-source). Indexed on purpose, no robots noindex
  "/sponsors", // redirect-only alias → /thanks (client-side router.replace stub, like /pcr)
  "/transparency", // "Transparency of tests": bioinformatic-tool comparisons vs Biopython/primer3, build-time computed + vitest-gated (trust/informational, no AppShell, not a documented app feature; like /open-source)
  "/pricing", // public pricing page (two-part model + competitor savings + plan builders + cost math); marketing/informational, no AppShell, not a documented app feature (like /welcome and /transparency)
  "/about", // public marketing About page (origin story + mission, from the footer/nav IA split); marketing/informational, no AppShell, not a documented app feature (like /pricing and /transparency)
  "/sharing-setup-test", // dev-only test harness for the cross-boundary sharing setup wizard (NODE_ENV=development gated, renders "not available" in prod); not a user feature
  "/privacy", // privacy policy (legal/informational, no AppShell, not a documented app feature; like /open-source). OAuth providers require a privacy-policy URL
  "/terms", // terms of service (legal/informational, no AppShell, not a documented app feature; like /privacy and /open-source)
  "/welcome-preview", // internal design preview for the welcome page redesign, not a documented user feature
  "/dev-gate", // dev-only lab-flow entry route (IS_DEV gated, not a documented user feature; like /sharing-setup-test)
  "/dev-join", // dev-only lab-flow entry route (IS_DEV gated, not a documented user feature; like /sharing-setup-test)
  "/dev-lab", // dev-only lab-flow entry route (IS_DEV gated, not a documented user feature; like /sharing-setup-test)
  "/researchers", // opt-in researcher directory (browse + standalone shareable profile pages); a sharing-network surface, documented under the sharing wiki, not its own page
  "/admin", // operator-only metrics dashboard (gated on ADMIN_EMAILS, data 404s for non-admins); internal tool, not a documented user feature
  "/business", // operator-only LLC business tracker (moved here from /admin/business 2026-06-10; same ADMIN_EMAILS gate, data 404s for non-admins); internal tool, not a documented user feature
  "/buisness", // redirect-only alias → /business (common misspelling), no UI
  "/maintenance", // flag-gated "under construction" holding page (src/proxy.ts); shown only during maintenance windows, not a documented app feature (like /welcome)
  "/profile", // pending wiki page (Profile "your stuff": appearance + researcher profile, split out of Settings)
  "/supplies", // pending wiki page (Supplies v2 unified page; replaces split Inventory + Purchases routes)
  "/ai", // public BeakerBot marketing page (sells the AI assistant; no AppShell, like /pricing and /welcome, not a documented in-app feature)
  "/chemistry-embed-check", // dev-only Ketcher/RDKit embed probe (not a documented user feature; like /sharing-setup-test)
  "/phylo", // pending wiki page (phylogenetics page; the wiki page + APP_ROUTE_TO_WIKI entry land with the BeakerBot/embeds phase). Like /sequences.
  "/people", // pending wiki page (PI Mode People roster, PE-1; real PI-only AppShell page, wiki page + mapping land with the PI-experience lane). Like /phylo.
  "/lab-work", // pending wiki page (PI Mode Lab Work hub, LW-1..3; real PI-only AppShell page, wiki page lands with the PI-experience lane). Like /people.
  "/funding", // pending wiki page (PI Mode funding surface; real PI-only AppShell page, wiki page lands with the PI-experience lane). Like /people.
  "/activity", // pending wiki page (PI Mode activity feed; real AppShell page, wiki page lands with the PI-experience lane). Like /people.
  "/approvals", // pending wiki page (PI Mode Approvals queue, AP-1..3; real AppShell page, wiki page lands with the PI-experience lane). Like /people.
  "/department", // flag-gated org tier (DEPT/INSTITUTION_TIER_ENABLED, dark in beta); org/billing hierarchy above labs, wiki page lands when the dept/institution tier ships. Like /people.
  "/institution", // flag-gated org tier (DEPT/INSTITUTION_TIER_ENABLED, dark in beta); top-of-hierarchy org/billing surface, wiki page lands when the dept/institution tier ships. Like /department.
];

/** Next.js conventions to ignore when walking app/. */
const IGNORED_SEGMENTS = new Set(["api"]);

const isCi = process.argv.includes("--ci");

/* ---------- find app routes ----------------------------------------- */

/** Walk `frontend/src/app/` and yield every top-level directory that
 *  carries a `page.tsx`. Treats `app/page.tsx` itself as the `/` route. */
function discoverAppRoutes() {
  const routes = new Set();
  if (existsSync(path.join(APP_DIR, "page.tsx"))) routes.add("/");
  for (const entry of readdirSync(APP_DIR)) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    if (IGNORED_SEGMENTS.has(entry)) continue;
    // Skip parameterized / catch-all segments like `[id]` and `[[...slug]]` —
    // those aren't a single concrete route.
    if (entry.startsWith("[")) continue;
    const full = path.join(APP_DIR, entry);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(path.join(full, "page.tsx"))) routes.add("/" + entry);
  }
  return routes;
}

function isExcluded(route) {
  return EXCLUDED_PREFIXES.some(
    (prefix) => route === prefix || route.startsWith(prefix + "/"),
  );
}

/** A canonical-map key can deliberately anchor a NESTED or DYNAMIC route
 *  that discoverAppRoutes (top-level + concrete only) never enumerates.
 *  The prime example is "/workbench/projects": there is no bare index
 *  page there, only the dynamic "/workbench/projects/[id]/page.tsx", and
 *  the map key exists so getWikiForRouteWithPrefix resolves every
 *  "/workbench/projects/<id>" up to the projects wiki page. Treat such a
 *  key as live (not STALE) when its app/ directory exists and either it
 *  carries a page.tsx itself or has a dynamic child segment ([id],
 *  [[...slug]]) that carries one. */
function appRouteDirIsLive(route) {
  const dir = path.join(APP_DIR, ...route.split("/").filter(Boolean));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  if (existsSync(path.join(dir, "page.tsx"))) return true;
  for (const child of readdirSync(dir)) {
    if (!child.startsWith("[")) continue;
    const childDir = path.join(dir, child);
    if (
      statSync(childDir).isDirectory() &&
      existsSync(path.join(childDir, "page.tsx"))
    ) {
      return true;
    }
  }
  return false;
}

/* ---------- parse the canonical map --------------------------------- */

/** Pulls keys out of the `APP_ROUTE_TO_WIKI: Record<string, string>`
 *  block in nav.ts via regex. We don't need a real TS parser — the map
 *  literal has a stable shape (each key on its own line, double-quoted)
 *  and the cost of pulling in tsx / typescript just to read 12 keys
 *  isn't worth it. */
function parseAppRouteToWiki() {
  const source = readFileSync(NAV_FILE, "utf8");
  const start = source.indexOf("APP_ROUTE_TO_WIKI");
  if (start === -1) throw new Error("Couldn't find APP_ROUTE_TO_WIKI in nav.ts");
  const openBrace = source.indexOf("{", start);
  const closeBrace = source.indexOf("};", openBrace);
  if (openBrace === -1 || closeBrace === -1) {
    throw new Error("Couldn't locate APP_ROUTE_TO_WIKI braces");
  }
  const body = source.slice(openBrace + 1, closeBrace);
  const pairs = new Map();
  for (const match of body.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) {
    pairs.set(match[1], match[2]);
  }
  return pairs;
}

/* ---------- check wiki target exists -------------------------------- */

function wikiPageExists(wikiHref) {
  // /wiki/features/gantt -> frontend/src/app/wiki/features/gantt/page.tsx
  // /wiki -> frontend/src/app/wiki/page.tsx
  const rel = wikiHref.replace(/^\/wiki/, "");
  const candidate = path.join(WIKI_DIR, rel, "page.tsx");
  return existsSync(candidate);
}

/* ---------- main ---------------------------------------------------- */

function main() {
  const appRoutes = discoverAppRoutes();
  const map = parseAppRouteToWiki();

  const unmapped = [];
  for (const route of appRoutes) {
    if (isExcluded(route)) continue;
    if (!map.has(route)) unmapped.push(route);
  }

  const stale = [];
  for (const route of map.keys()) {
    if (appRoutes.has(route)) continue; // concrete top-level route
    if (appRouteDirIsLive(route)) continue; // nested / dynamic-parent anchor
    stale.push(route);
  }

  const orphaned = [];
  for (const [route, wikiHref] of map.entries()) {
    if (!wikiPageExists(wikiHref)) orphaned.push({ route, wikiHref });
  }

  const okCount =
    map.size - stale.length - orphaned.length;

  // -------- report --------------------------------------------------

  const lines = [];
  lines.push("Wiki coverage report");
  lines.push("=".repeat(40));
  lines.push(`App routes scanned:        ${appRoutes.size}`);
  lines.push(`Routes in canonical map:   ${map.size}`);
  lines.push(`OK (mapped + wiki exists): ${okCount}`);
  lines.push(`UNMAPPED (gap):            ${unmapped.length}`);
  lines.push(`STALE (map → missing app): ${stale.length}`);
  lines.push(`ORPHANED (map → missing wiki page): ${orphaned.length}`);
  lines.push("");

  if (unmapped.length) {
    lines.push("UNMAPPED app routes (add an entry to APP_ROUTE_TO_WIKI):");
    for (const r of unmapped) lines.push(`  - ${r}`);
    lines.push("");
  }
  if (stale.length) {
    lines.push("STALE map entries (route no longer exists in app/):");
    for (const r of stale) lines.push(`  - ${r}`);
    lines.push("");
  }
  if (orphaned.length) {
    lines.push("ORPHANED map entries (wiki page doesn't exist):");
    for (const { route, wikiHref } of orphaned) {
      lines.push(`  - ${route} -> ${wikiHref}`);
    }
    lines.push("");
  }

  process.stdout.write(lines.join("\n") + "\n");

  if (isCi && (unmapped.length || orphaned.length)) {
    process.stderr.write(
      "\n✗ Wiki coverage check failed. " +
        "Add the missing entries to APP_ROUTE_TO_WIKI in " +
        "frontend/src/lib/wiki/nav.ts, or extend EXCLUDED_PREFIXES " +
        "in scripts/check-wiki-coverage.mjs if the route is intentionally undocumented.\n",
    );
    process.exit(1);
  }

  if (isCi && stale.length) {
    // STALE alone shouldn't block CI — it's typically caused by a route
    // being renamed or moved and the map entry not getting updated. Worth
    // a warning so it doesn't sit forever, but a build failure would be
    // user-hostile.
    process.stderr.write(
      "\n⚠ STALE map entries present (warning only — not blocking CI). " +
        "Remove them from APP_ROUTE_TO_WIKI when convenient.\n",
    );
  }

  process.exit(0);
}

main();
