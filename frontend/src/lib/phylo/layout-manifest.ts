// Phylo back-compat shim. The layout manifest moved to lib/figure/layout-manifest
// in Phase 5 (the collision-aware advisor went surface-agnostic across phylo +
// Data Hub + the composer). render.ts and the phylo tests still import from here;
// this re-exports the shared module so those paths keep working unchanged.
//
// No em-dashes, no emojis, no mid-sentence colons.

export * from "@/lib/figure/layout-manifest";
