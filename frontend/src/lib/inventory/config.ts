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
// To dogfood in Grant's working tree, flip this to `true` locally. It is left
// at `false` on `main` until inventory v1 is complete and verified.
export const INVENTORY_ENABLED = false;
