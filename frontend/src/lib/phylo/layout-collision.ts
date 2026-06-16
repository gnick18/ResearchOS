// Phylo back-compat shim. The collision detector moved to
// lib/figure/layout-collision in Phase 5 (surface-agnostic across phylo + Data
// Hub + the composer). PhyloLayoutAdvisor and the phylo tests still import from
// here; this re-exports the shared module so those paths keep working unchanged.
//
// No em-dashes, no emojis, no mid-sentence colons.

export * from "@/lib/figure/layout-collision";
