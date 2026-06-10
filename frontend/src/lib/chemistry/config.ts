// Chemistry feature flag (chemistry-workbench Phase 0, 2026-06-10).
//
// Mirrors `lib/inventory/config.ts`: a plain exported boolean const, default
// OFF, so partial chunks can land on `main` without exposing an unfinished
// feature. Phase 0 is the seam + types only (no UI), so this flag does NOT gate
// the API itself; it exists so the eventual `/chemistry` hub, the structure
// editor, the literature companion, and the project "Molecules" section gate on
// one switch. Per the design doc
// (docs/proposals/CHEMISTRY_WORKBENCH_PROPOSAL.md section 6) the whole
// user-facing surface lands behind this flag.
//
// Env-driven so dogfooding does not require hand-editing this const: set
// NEXT_PUBLIC_CHEMISTRY_ENABLED=1 in frontend/.env.local (NEXT_PUBLIC_* is
// inlined at build, so restart the dev server after changing it). Default OFF
// when unset, so it stays dark on `main` and in prod until the workbench is
// complete and verified. Flipping prod ON is a deliberate Vercel env action
// (set NEXT_PUBLIC_CHEMISTRY_ENABLED + redeploy), NOT a code change.
export const CHEMISTRY_ENABLED =
  process.env.NEXT_PUBLIC_CHEMISTRY_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_CHEMISTRY_ENABLED === "true";
