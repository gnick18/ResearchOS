"use client";

// sequence editor master (Phase B). Gateway hero: the recombination crossover and
// the product/byproduct pair. The Gateway user's question is "which att sites
// reacted, what clone do I get, and what is the byproduct." NO engine change is
// needed: GatewayProduct already returns attSites (name/family/seq) + role and
// fragmentSpans. We draw the crossover as an X, the two substrate att sites
// crossing into the product att sites (e.g. attL1 x attR1 -> attB1 clone +
// attP1 byproduct), with the reaction direction shown and a clear what-in ->
// what-out. The byproduct is a secondary line. Pure presentation.
//
// No emojis (inline SVG only), no em-dashes, no mid-sentence colons.

import type { GatewayProduct, GatewayReaction } from "@/lib/sequences/cloning-gateway";

/** The substrate att families for a reaction (the "what reacted" inputs) and the
 *  human direction label. BP: attB x attP -> attL (clone) + attR (byproduct).
 *  LR: attL x attR -> attB (clone) + attP (byproduct). */
const REACTION_INFO: Record<
  GatewayReaction,
  { substrateA: string; substrateB: string; cloneFamily: string; byproductFamily: string }
> = {
  BP: { substrateA: "attB", substrateB: "attP", cloneFamily: "attL", byproductFamily: "attR" },
  LR: { substrateA: "attL", substrateB: "attR", cloneFamily: "attB", byproductFamily: "attP" },
};

interface Props {
  reaction: GatewayReaction;
  clone: GatewayProduct;
  byproduct: GatewayProduct | null;
  /** [insert/entry substrate name, donor/destination cassette name]. */
  substrateNames: [string, string];
}

/** A small att-site chip. */
function AttChip({ name, tone }: { name: string; tone: "substrate" | "clone" | "byproduct" }) {
  const cls =
    tone === "clone"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "byproduct"
        ? "bg-surface-sunken text-foreground-muted ring-border"
        : "bg-sky-50 text-sky-700 ring-sky-200";
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-meta font-medium ring-1 ${cls}`}>
      {name}
    </span>
  );
}

export default function GatewayCrossoverHero({ reaction, clone, byproduct, substrateNames }: Props) {
  const info = REACTION_INFO[reaction];
  // The product att-site names come straight from the engine (each product carries
  // its flanking [left, right] att pair). We label the crossover with those.
  const cloneAtts = clone.attSites.map((a) => a.name);
  const byproductAtts = byproduct?.attSites.map((a) => a.name) ?? [];
  // The substrate att labels are the reaction's input families at the same
  // specificity numbers the clone's product sites carry (att specificity is
  // conserved through recombination), so attB1+attP1 -> attL1, etc.
  const specs = clone.attSites.map((a) => a.specificity);
  const substrateA = specs.map((s) => `${info.substrateA}${s}`);
  const substrateB = specs.map((s) => `${info.substrateB}${s}`);

  return (
    <section
      className="rounded-md border border-border bg-surface-sunken/60 p-3"
      aria-label="Recombination crossover"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
          {reaction} recombination
        </h4>
        <span className="text-meta text-foreground-muted">
          {info.substrateA} x {info.substrateB} {"->"} {info.cloneFamily} + {info.byproductFamily}
        </span>
      </div>

      {/* The crossover X: two substrate att sites cross into the two product att
          sites. Drawn as an SVG so the crossing strokes read as a recombination. */}
      <div className="rounded-md border border-border bg-surface-raised p-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {/* Substrate column (what reacted, in). */}
          <div className="flex flex-col items-start gap-1.5">
            <span className="text-meta text-foreground-muted">in</span>
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 max-w-[8rem] truncate text-meta text-foreground-muted">{substrateNames[0]}</span>
              {substrateA.map((n, i) => (
                <AttChip key={i} name={n} tone="substrate" />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 max-w-[8rem] truncate text-meta text-foreground-muted">{substrateNames[1]}</span>
              {substrateB.map((n, i) => (
                <AttChip key={i} name={n} tone="substrate" />
              ))}
            </div>
          </div>

          {/* The crossing X. */}
          <svg viewBox="0 0 60 56" className="h-14 w-16 shrink-0" aria-hidden="true">
            <line x1="2" y1="14" x2="58" y2="42" stroke="#38bdf8" strokeWidth="2.5" />
            <line x1="2" y1="42" x2="58" y2="14" stroke="#94a3b8" strokeWidth="2.5" />
            <circle cx="30" cy="28" r="3.5" fill="#0ea5e9" />
          </svg>

          {/* Product column (what comes out). */}
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-meta text-foreground-muted">out</span>
            <div className="flex items-center gap-1.5">
              {cloneAtts.map((n, i) => (
                <AttChip key={i} name={n} tone="clone" />
              ))}
              <span className="text-meta font-medium text-emerald-700">clone</span>
            </div>
            {byproductAtts.length > 0 ? (
              <div className="flex items-center gap-1.5">
                {byproductAtts.map((n, i) => (
                  <AttChip key={i} name={n} tone="byproduct" />
                ))}
                <span className="text-meta text-foreground-muted">byproduct</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* What in -> what out, in words, with the transferred gene highlighted via
          the clone's first fragment span (the transferred insert). */}
      <div className="mt-2 text-meta text-foreground-muted">
        <span className="font-medium text-foreground">{substrateNames[0]}</span> + {" "}
        <span className="font-medium text-foreground">{substrateNames[1]}</span>{" "}
        <span className="text-foreground-muted">{"->"}</span>{" "}
        <span className="font-medium text-emerald-700">clone</span>
        {byproduct ? (
          <>
            {" "}+ <span className="text-foreground-muted">byproduct</span>
          </>
        ) : null}
        {clone.fragmentSpans && clone.fragmentSpans.length > 0 ? (
          <span className="text-foreground-muted">
            {" "}· transferred: {clone.fragmentSpans[0].name}
          </span>
        ) : null}
      </div>
    </section>
  );
}
