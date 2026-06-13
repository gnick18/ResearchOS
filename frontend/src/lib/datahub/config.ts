// Data Hub feature flag (datahub-tab-p1 sub-bot, 2026-06-10).
//
// Mirrors the `INVENTORY_ENABLED` pattern in `lib/inventory/config.ts`: a plain
// exported boolean const, default OFF, so a partial slice (the tab skeleton plus
// the Column-table data-entry loop) can land on `main` without exposing an
// unfinished feature. The whole `/datahub` route + its surfaces gate on this one
// switch; the compute engine and the cell-level Loro data model under
// `lib/datahub/` are already on main and are NOT gated (they have no user
// surface on their own).
//
// Env-driven so dogfooding does not require hand-editing this const: set
// NEXT_PUBLIC_DATAHUB_ENABLED=1 in frontend/.env.local. NEXT_PUBLIC_* is inlined
// at build, so restart the dev server after changing it. Default OFF when unset,
// so it stays dark on `main` and in prod until Data Hub is complete and verified.
// Flipping prod ON is a deliberate Vercel env action (set the var + redeploy),
// not a code change.
export const DATAHUB_ENABLED =
  process.env.NEXT_PUBLIC_DATAHUB_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_DATAHUB_ENABLED === "true";

// Large-dataset lane sub-capability (DataHub-largetables lane, 2026-06-13).
//
// The big-table lane (DuckDB-WASM columnar storage + queries, the dataset object
// type, the Parquet on-disk shape) is gated behind BOTH the DATAHUB_ENABLED tab
// flag AND this internal sub-capability switch, so the lane stays fully inert
// until it is verified end to end. Even with the Data Hub tab on, no DuckDB
// worker, no .wasm, and no new on-disk shape is ever touched while this is false.
//
// It is a plain code const (not env-driven) on purpose: this is an internal
// in-flight capability flag, flipped by a deliberate code change once the lane is
// built and verified, not something dogfooders toggle. Default OFF.
//
// Increment 1 (this commit) wires the storage + detection + ingest seam behind
// it; Increment 2 wires the UI (preview grid, status chip, manual switch). The
// whole lane is dark on main until BIGTABLE_ENABLED flips to true.
export const BIGTABLE_ENABLED = false;

/** True only when BOTH the Data Hub tab and the big-table lane are enabled. */
export function isBigTableEnabled(): boolean {
  return DATAHUB_ENABLED && BIGTABLE_ENABLED;
}
