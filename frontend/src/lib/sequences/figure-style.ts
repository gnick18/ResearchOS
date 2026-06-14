// The canonical figure-style spec for a sequence map, saved on the sequence
// (SequenceMeta.figure) like phylo's PhyloMeta.figure. A neutral leaf module (no
// imports) so both lib/types.ts and the renderer can reference it without a cycle.
//
// No em-dashes, no emojis, no mid-sentence colons.

/** Per-element + global styling for a rendered sequence map. */
export interface SequenceMapStyle {
  /** Block thickness multiplier (arc width / arrow height). Default 1. */
  featureScale?: number;
  /** Draw the bp coordinate ring (circular) / ruler ticks (linear). Default true. */
  showTicks?: boolean;
  /** Draw feature labels. Default true. */
  showLabels?: boolean;
  /** Per-feature overrides, keyed by featureKey(f). */
  perFeature?: Record<string, { color?: string; hidden?: boolean }>;
}

/** A stable key for a feature, used to address per-feature style overrides. */
export function featureKey(f: { name: string; start: number; end: number }): string {
  return `${f.name}:${f.start}:${f.end}`;
}

/**
 * Layer one style over another: per-feature overrides deep-merge (the top color /
 * hidden wins per feature), scalar options the top value wins when set. Pure.
 * Used to apply a figure-local panel override on top of the sequence's canonical
 * figure style.
 */
export function mergeMapStyle(
  base: SequenceMapStyle | undefined,
  over: SequenceMapStyle | undefined,
): SequenceMapStyle {
  const b = base ?? {};
  const o = over ?? {};
  const keys = new Set([...Object.keys(b.perFeature ?? {}), ...Object.keys(o.perFeature ?? {})]);
  const perFeature: SequenceMapStyle["perFeature"] = {};
  for (const k of keys) {
    perFeature[k] = { ...b.perFeature?.[k], ...o.perFeature?.[k] };
  }
  return {
    featureScale: o.featureScale ?? b.featureScale,
    showTicks: o.showTicks ?? b.showTicks,
    showLabels: o.showLabels ?? b.showLabels,
    perFeature: keys.size ? perFeature : undefined,
  };
}
