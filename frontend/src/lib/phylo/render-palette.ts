// Phylo Tree Studio, the shared categorical palette constant.
//
// Pulled out of render.ts so both render.ts and color-scale.ts can read the same
// brand-led categorical hues without a circular import (render.ts imports the
// scale builder, the scale builder needs the categorical palette). Pure data.
//
// No em-dashes, no emojis, no mid-sentence colons.

/** Deterministic categorical palette (brand-led), cycled for many categories. */
export const CATEGORY_PALETTE = [
  "#1AA0E6",
  "#5B47D6",
  "#16a34a",
  "#b45309",
  "#dc2626",
  "#0891b2",
  "#94a3b8",
  "#7c3aed",
];
