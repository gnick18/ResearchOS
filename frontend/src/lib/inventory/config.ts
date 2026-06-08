// Inventory feature flag (inventory-chunk1 sub-bot of HR, 2026-06-07).
//
// Mirrors the `LORO_PILOT_ENABLED` pattern in `lib/loro/config.ts`: a plain
// exported boolean const, default OFF, so partial chunks can land on `main`
// without exposing an unfinished feature. Chunk 1 is the data layer only (no
// UI), so this flag does NOT gate the API itself — it exists so chunk 2's
// `/inventory` route, surfaces, and dashboard health strip can gate on one
// switch. Per the build plan (docs/proposals/INVENTORY_V1_BUILD_PLAN.md rule
// 5) the whole user-facing surface lands behind this flag.
//
// Env-driven so dogfooding no longer requires hand-editing this const: set
// NEXT_PUBLIC_INVENTORY_ENABLED=1 in frontend/.env.local (NEXT_PUBLIC_* is
// inlined at build, so restart the dev server after changing it). Default OFF
// when unset, so it stays dark on `main` and in prod until inventory v1 is
// complete and verified. Flipping prod ON is a deliberate, post-bug-fix Vercel
// env action (set NEXT_PUBLIC_INVENTORY_ENABLED + redeploy), NOT a code change.
export const INVENTORY_ENABLED =
  process.env.NEXT_PUBLIC_INVENTORY_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_INVENTORY_ENABLED === "true";
