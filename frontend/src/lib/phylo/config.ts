// Phylogenetics feature flag (phylo Phase 0, 2026-06-12).
//
// Mirrors `lib/chemistry/config.ts` and `lib/datahub/config.ts`: a plain
// exported boolean const, default OFF, so partial chunks can land on `main`
// without exposing an unfinished feature. The whole user-facing surface (the
// `/phylo` hub, the Tree Builder wizard, the Tree Studio figure editor) gates on
// this one switch.
//
// Env-driven so dogfooding does not require hand-editing this const: set
// NEXT_PUBLIC_PHYLO_ENABLED=1 in frontend/.env.local (NEXT_PUBLIC_* is inlined at
// build, so restart the dev server after changing it). Default OFF when unset, so
// it stays dark on `main` and in prod until the page is complete and verified.
// Flipping prod ON is a deliberate Vercel env action (set NEXT_PUBLIC_PHYLO_ENABLED
// + redeploy), NOT a code change.
//
// Design: docs/proposals/2026-06-12-phylogenetics-page.md.
export const PHYLO_ENABLED =
  process.env.NEXT_PUBLIC_PHYLO_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_PHYLO_ENABLED === "true";
