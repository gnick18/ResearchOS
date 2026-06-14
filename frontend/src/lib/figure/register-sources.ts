// One place to register every FigureSource the composer can pull panels from.
// Called once (idempotent) before the composer or its add-figure picker runs.
// New surfaces (phylo, sequences, chemistry) add their registration here as their
// adapter lands, the only file that knows the full set.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { registerDataHubFigureSource } from "@/lib/datahub/figure-source";

let registered = false;

export function registerFigureSources(): void {
  if (registered) return;
  registered = true;
  registerDataHubFigureSource();
  // Phylo / sequence / chemistry adapters register here as they ship.
}
