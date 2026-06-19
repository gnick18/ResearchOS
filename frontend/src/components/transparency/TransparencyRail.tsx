"use client";

/**
 * Grouped navigation rail for the /transparency page. The twelve validated
 * domains are organized into six named groups (sequence analysis, lab
 * calculators, cloning, statistics, phylogenetics, published references) so the
 * reader scans the families of checks instead of one long row of tabs.
 *
 * Each item shows a status dot (green when every comparison is exact or passing,
 * amber when anything sits within a documented tolerance or larger), the domain
 * title, and a mono pass count. The selected item is highlighted with the
 * brand-action accent.
 *
 * On desktop the rail is a sticky left column. On phones it collapses to a
 * horizontal scroll strip of chips so it stays usable without a dropdown.
 *
 * No inline SVG: the status dot is a colored span, per the house icon rule.
 */

import type { DomainReport } from "@/lib/transparency/types";

/**
 * Group order and membership. Keyed by group label, listing the domain ids in
 * display order. Easy to tweak. Any domain id missing from this map falls back
 * to its own single-item group so a new domain is never silently dropped.
 */
const GROUPS: { label: string; ids: string[] }[] = [
  { label: "Sequence analysis", ids: ["tm", "alignment", "digest", "translation", "protein", "domains"] },
  { label: "Lab calculators", ids: ["calculators"] },
  { label: "Cloning", ids: ["cloning"] },
  { label: "Statistics", ids: ["datahub-stats"] },
  { label: "Phylogenetics", ids: ["phylo", "phylo-published"] },
  { label: "Published references", ids: ["published"] },
];

function total(domain: DomainReport): number {
  return domain.totals.pass + domain.totals.warn + domain.totals.fail;
}

/**
 * Green when every gated comparison is exact or passing (no warn, no fail),
 * amber otherwise. A domain that is all passing but with a few within-tolerance
 * offsets still reads green here, because the rail dot answers "did the build
 * pass", and the panel verdict draws the finer distinction.
 */
function dotClass(domain: DomainReport): string {
  const clean = domain.totals.warn === 0 && domain.totals.fail === 0;
  return clean ? "bg-emerald-500" : "bg-amber-500";
}

/**
 * Resolve the ordered groups against the domains actually present, appending a
 * one-item fallback group for any domain id not covered by GROUPS.
 */
function resolveGroups(domains: DomainReport[]): { label: string; items: DomainReport[] }[] {
  const byId = new Map(domains.map((d) => [d.id, d]));
  const used = new Set<string>();
  const out: { label: string; items: DomainReport[] }[] = [];

  for (const group of GROUPS) {
    const items: DomainReport[] = [];
    for (const id of group.ids) {
      const d = byId.get(id);
      if (d) {
        items.push(d);
        used.add(id);
      }
    }
    if (items.length > 0) out.push({ label: group.label, items });
  }

  for (const d of domains) {
    if (!used.has(d.id)) out.push({ label: d.title, items: [d] });
  }

  return out;
}

function RailButton({
  domain,
  selected,
  onSelect,
}: {
  domain: DomainReport;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(domain.id)}
      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
        selected
          ? "border-brand-action/40 bg-brand-action/10 text-brand-ink"
          : "border-transparent text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
      }`}
    >
      <span aria-hidden className={`h-2 w-2 flex-none rounded-full ${dotClass(domain)}`} />
      <span className={`flex-1 truncate text-meta font-medium ${selected ? "text-brand-ink" : ""}`}>
        {domain.title}
      </span>
      <span
        className={`flex-none font-mono text-[11px] tabular-nums ${
          selected ? "text-brand-action" : "text-foreground-muted"
        }`}
      >
        {domain.totals.pass}/{total(domain)}
      </span>
    </button>
  );
}

export default function TransparencyRail({
  domains,
  activeId,
  onSelect,
}: {
  domains: DomainReport[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const groups = resolveGroups(domains);

  return (
    <nav role="tablist" aria-label="Validated calculations" aria-orientation="vertical">
      {/* Desktop / tablet: a vertical grouped rail. */}
      <div className="hidden sm:block space-y-5">
        {groups.map((group) => (
          <div key={group.label}>
            <h3 className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
              {group.label}
            </h3>
            <div className="space-y-0.5">
              {group.items.map((d) => (
                <RailButton key={d.id} domain={d} selected={d.id === activeId} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Phone: a horizontal scroll strip of chips, grouped labels inline. */}
      <div className="sm:hidden -mx-4 overflow-x-auto px-4 pb-1">
        <div className="flex w-max gap-4">
          {groups.map((group) => (
            <div key={group.label} className="flex-none">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
                {group.label}
              </h3>
              <div className="flex gap-1.5">
                {group.items.map((d) => {
                  const selected = d.id === activeId;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => onSelect(d.id)}
                      className={`flex flex-none items-center gap-2 rounded-full border px-3 py-1.5 transition ${
                        selected
                          ? "border-brand-action/40 bg-brand-action/10 text-brand-ink"
                          : "border-border bg-surface-raised text-foreground-muted"
                      }`}
                    >
                      <span aria-hidden className={`h-2 w-2 flex-none rounded-full ${dotClass(d)}`} />
                      <span className="text-meta font-medium">{d.title}</span>
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          selected ? "text-brand-action" : "text-foreground-muted"
                        }`}
                      >
                        {d.totals.pass}/{total(d)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
