// Server-init seed runner (demo-lab-network Phase 3, social lane).
//
// Next.js calls register() once when each server instance boots (every cold
// start, so once per deploy per instance), in the Node server runtime only. We
// use it as the deploy/server-init hook to provision the seeded demo lab, the
// same role the slug-registry handoff reserves for the idempotent slug seeders
// (seedReservedSlugs / seedExistingHandles / seedInstitutionSlugs). seedDemoLab()
// upserts every row and every R2 object (ON CONFLICT DO NOTHING / upsert), so a
// re-run on every deploy is a safe no-op after the first.
//
// Guards (all required):
//   1. Runtime. Only the Node.js server runtime (NEXT_RUNTIME === "nodejs").
//      seedDemoLab() reads checked-in fixtures via node:fs and talks to Neon plus
//      R2, so it must never run in the Edge runtime. register() itself never runs
//      in the browser, so the seed code stays server-only.
//   2. Flag. Only when isLabSitesEnabled() (the SERVER gate, LAB_SITES_ENABLED) is
//      true. With the flag off this is a complete no-op AND the DB/R2 code is never
//      imported: the seed-demo-lab module (which pulls in the Neon plus R2 clients)
//      is loaded by a dynamic import that sits BEHIND the flag check, so flag-off
//      boots never touch persistence. Only the flag helper (which imports nothing)
//      is loaded eagerly.
//   3. Once per process. A module-level latch means at most one seed attempt per
//      server instance, even if register() is somehow invoked more than once.
//   4. Fail soft. Any throw (transient DB, or an environment where the flag is on
//      but DATABASE_URL / R2_* is not wired) is logged and swallowed, so a seed
//      failure can never crash server boot.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

let seedStarted = false;

export async function register(): Promise<void> {
  // 1. Node.js server runtime only. The Edge runtime cannot run node:fs or the
  //    Neon / R2 clients, and register() never runs client-side.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 2. Flag gate, read lazily. Only the flag helper is imported here (it pulls in
  //    no DB or R2 code), so a flag-off boot returns before any persistence module
  //    is loaded.
  const { isLabSitesEnabled } = await import("@/lib/social/config");
  if (!isLabSitesEnabled()) return;

  // 3. Once per process. seedDemoLab is idempotent at the DB/R2 layer too, but
  //    there is no need to re-run within a single live instance.
  if (seedStarted) return;
  seedStarted = true;

  try {
    // Imported behind the flag check so the Neon / R2 clients load only when the
    // feature is actually on.
    const { seedDemoLab } = await import("@/lib/social/seed-demo-lab");
    const result = await seedDemoLab();
    console.log("[demo-lab-seed] demo lab seeded", result);
  } catch (err) {
    // 4. Fail soft. A seed failure must never abort server boot.
    console.error("[demo-lab-seed] seed failed (continuing boot):", err);
  }
}
