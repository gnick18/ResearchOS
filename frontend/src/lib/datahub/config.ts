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
