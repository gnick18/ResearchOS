// Perf-layer feature flags.
//
// HOVER_PREFETCH_ENABLED gates the intent-scoped hover-prefetch layer
// (docs/proposals/HOVER_PREFETCH.md). When on, resting the pointer on a list
// row warms the heavy data behind its detail popup (the Loro document for notes
// and experiments) so the popup opens with content already resident.
//
// Default off. Dogfood without touching committed code by setting
// NEXT_PUBLIC_HOVER_PREFETCH=1 in frontend/.env.local (mirrors the other
// NEXT_PUBLIC_* dev toggles), then restart the dev server.
export const HOVER_PREFETCH_ENABLED =
  process.env.NEXT_PUBLIC_HOVER_PREFETCH === "1";
