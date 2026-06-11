// Custom Calculator Builder feature flag (Phase 1, 2026-06-10).
//
// Mirrors `lib/chemistry/config.ts`: a plain exported boolean const, default
// OFF, so the engine + storage + template-library slices can land on `main`
// without exposing the unfinished builder UI. The whole builder surface (the
// two-pane modal rail, My calculators, Build your own, and the Template
// library) gates on this one switch. When OFF the calculators modal looks
// exactly as it does today (the eight built-in tabs only).
//
// Env-driven so dogfooding does not require hand-editing this const: set
// NEXT_PUBLIC_CALC_BUILDER=1 in frontend/.env.local (NEXT_PUBLIC_* is inlined
// at build, so restart the dev server after changing it). Default OFF when
// unset, so it stays dark on `main` and in prod until the builder is complete
// and verified. Flipping prod ON is a deliberate Vercel env action
// (set NEXT_PUBLIC_CALC_BUILDER + redeploy), NOT a code change.
export const CALC_BUILDER_ENABLED =
  process.env.NEXT_PUBLIC_CALC_BUILDER === "1" ||
  process.env.NEXT_PUBLIC_CALC_BUILDER === "true";
