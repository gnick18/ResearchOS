"use client";

// Onboarding tutor — per-surface preloaded page bodies.
//
// Each deep-demo beat shows a small, recognizable mock of THAT ResearchOS surface
// (Data Hub = a table that becomes a figure, Phylo = a little tree, Sequences = a
// base strip, etc.) instead of one generic "sample item" list, so the popup reads
// like the real page Beaker is showing. The `revealed` flag drives the result the
// demo produces (the figure, the annotation, the reorder), which fades in on the
// choreography's reveal step. Pure presentational, sample data only.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { Surface } from "@/lib/onboarding/reel-director";

// The header action the presenter cursor heads to, per surface (the verb that
// matches the choreography line).
export function surfaceControl(surface: Surface): string {
  switch (surface) {
    case "datahub":
      return "Make figure";
    case "phylo":
      return "Export";
    case "methods":
      return "View on phone";
    case "sequences":
      return "Annotate";
    case "chemistry":
      return "Render";
    case "inventory":
      return "Reorder";
    case "people":
      return "Lab overview";
    default:
      return "Open";
  }
}

const FG = "text-[var(--fg,#1f2421)]";
const MUTED = "text-[var(--muted,#6b716a)]";
const LINE = "border-[var(--line,#e3e5e0)]";

function revealCls(revealed: boolean): string {
  return `transition-all duration-700 ${revealed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`;
}

export default function SurfacePage({
  surface,
  revealed,
}: {
  surface: Surface;
  revealed: boolean;
}) {
  if (surface === "datahub") {
    return (
      <div className="flex items-start gap-4 p-4">
        <div className={`flex-1 overflow-hidden rounded-lg border ${LINE}`}>
          {["Strain  MIC  Result", "WT  2.0  S", "mutA  16  R", "mutB  64  R"].map(
            (r, i) => (
              <div
                key={r}
                className={`grid grid-cols-3 gap-2 px-3 py-1.5 text-[11.5px] ${i === 0 ? `bg-[var(--sunken,#f1f2ef)] font-semibold ${MUTED}` : `${FG} border-t ${LINE}`}`}
              >
                {r.split(/\s+/).map((c, j) => (
                  <span key={j}>{c}</span>
                ))}
              </div>
            ),
          )}
        </div>
        {/* reveal: the table becomes a figure (mini bar chart) */}
        <div className={`flex-none ${revealCls(revealed)}`}>
          <div className={`flex h-28 w-32 items-end gap-2 rounded-lg border-2 border-[var(--brand,#1d9e75)] bg-[var(--brand-soft,#e7f6ef)] p-3`}>
            {[40, 90, 64].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-[var(--brand,#1d9e75)]"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className={`mt-1 text-center text-[10.5px] ${MUTED}`}>figure</div>
        </div>
      </div>
    );
  }

  if (surface === "sequences") {
    const bases = "ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTT".split("");
    const color: Record<string, string> = {
      A: "#1d9e75",
      T: "#d85a30",
      G: "#2563eb",
      C: "#b9770f",
    };
    return (
      <div className="p-4">
        <div className="flex flex-wrap gap-[1px] font-mono text-[12px]">
          {bases.map((b, i) => (
            <span key={i} style={{ color: color[b] }}>
              {b}
            </span>
          ))}
        </div>
        {/* reveal: a feature annotation + a primer Tm chip */}
        <div className={`mt-3 ${revealCls(revealed)}`}>
          <div className="flex items-center gap-2">
            <div className="h-5 w-40 rounded bg-[var(--brand,#1d9e75)]" />
            <span className={`text-[11px] ${FG}`}>GFP</span>
          </div>
          <div className={`mt-2 inline-block rounded-md border-2 border-[var(--brand,#1d9e75)] bg-[var(--brand-soft,#e7f6ef)] px-2 py-1 text-[11px] font-semibold ${FG}`}>
            primer Tm 61.4 C
          </div>
        </div>
      </div>
    );
  }

  if (surface === "phylo") {
    return (
      <div className="relative p-4">
        <div className="relative h-40">
          {/* simple cladogram: a spine + three tips */}
          <div className={`absolute left-4 top-4 h-28 w-px bg-[var(--line2,#d2d5cd)]`} />
          {[12, 56, 100].map((top, i) => (
            <div key={i} className="absolute left-4" style={{ top }}>
              <div className={`h-px w-24 bg-[var(--line2,#d2d5cd)]`} />
              <span className={`absolute left-28 -top-2 text-[11px] ${FG}`}>
                {["S. cerevisiae", "C. albicans", "A. nidulans"][i]}
              </span>
            </div>
          ))}
          {/* reveal: an export frame sized to the figure */}
          <div
            className={`absolute inset-x-2 inset-y-0 rounded-lg border-2 border-dashed border-[var(--brand,#1d9e75)] ${revealCls(revealed)}`}
          >
            <span className={`absolute -top-2 left-3 bg-[var(--surface,#fff)] px-1 text-[10px] font-semibold ${FG}`}>
              3.5 in figure
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (surface === "methods") {
    return (
      <div className="flex items-start gap-4 p-4">
        <ol className="flex-1 space-y-2">
          {["Resuspend cells in lysis buffer", "Incubate 30 min at 37 C", "Spin 12,000 g, 10 min", "Collect supernatant"].map(
            (s, i) => (
              <li key={s} className={`flex gap-2 text-[12px] ${FG}`}>
                <span className={`flex-none font-semibold ${MUTED}`}>{i + 1}.</span>
                {s}
              </li>
            ),
          )}
        </ol>
        {/* reveal: the protocol on a phone at the bench */}
        <div className={`flex-none ${revealCls(revealed)}`}>
          <div className={`h-32 w-20 rounded-xl border-2 border-[var(--brand,#1d9e75)] bg-[var(--surface,#fff)] p-2`}>
            <div className={`mb-1 text-[8px] font-semibold ${MUTED}`}>STEP 1 OF 4</div>
            <div className={`text-[9px] ${FG}`}>Resuspend cells in lysis buffer</div>
          </div>
        </div>
      </div>
    );
  }

  if (surface === "chemistry") {
    return (
      <div className="flex items-center gap-4 p-4">
        <div className="flex-1">
          <div className={`text-[10.5px] ${MUTED}`}>SMILES</div>
          <div className={`mt-1 rounded-lg border ${LINE} bg-[var(--sunken,#f1f2ef)] px-3 py-2 font-mono text-[12px] ${FG}`}>
            CC(=O)Oc1ccccc1C(=O)O
          </div>
        </div>
        {/* reveal: the structure draws itself (a hexagon ring) */}
        <div className={`flex-none ${revealCls(revealed)}`}>
          <div className="relative flex h-28 w-28 items-center justify-center rounded-lg border-2 border-[var(--brand,#1d9e75)] bg-[var(--brand-soft,#e7f6ef)]">
            <div
              className="h-12 w-12 border-2 border-[var(--fg,#1f2421)]"
              style={{ clipPath: "polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)" }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (surface === "inventory") {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[
          { name: "Taq polymerase", loc: "Freezer A", qty: "12 vials", low: false },
          { name: "Agarose", loc: "Shelf 3", qty: "2 left", low: true },
          { name: "EtBr", loc: "Cabinet 1", qty: "5 bottles", low: false },
        ].map((row) => (
          <div
            key={row.name}
            className={`flex items-center gap-3 rounded-lg border ${LINE} px-3 py-2`}
          >
            <div className="flex-1">
              <div className={`text-[13px] font-semibold ${FG}`}>{row.name}</div>
              <div className={`text-[11.5px] ${MUTED}`}>{row.loc}</div>
            </div>
            <span
              className={`text-xs font-semibold ${row.low ? "text-[var(--coral,#d85a30)]" : MUTED}`}
            >
              {row.qty}
            </span>
            {/* reveal: a reordered badge on the low item */}
            {row.low ? (
              <span className={`rounded-md border-2 border-[var(--brand,#1d9e75)] bg-[var(--brand-soft,#e7f6ef)] px-2 py-0.5 text-[10.5px] font-semibold ${FG} ${revealCls(revealed)}`}>
                reordered
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  // people
  return (
    <div className="flex flex-col gap-2 p-4">
      {[
        { name: "Dr. Alex Rivera", role: "Postdoc", on: "Yeast stress" },
        { name: "Mira Chen", role: "Grad student", on: "CRISPR screen" },
        { name: "Sam Okafor", role: "Undergrad", on: "Plasmid library" },
      ].map((p, i) => (
        <div
          key={p.name}
          className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${i === 0 ? `border-2 border-[var(--brand,#1d9e75)] bg-[var(--brand-soft,#e7f6ef)] ${revealCls(revealed)}` : LINE}`}
        >
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--sunken,#f1f2ef)] text-[11px] font-semibold text-[var(--muted,#6b716a)]">
            {p.name.split(" ").slice(-1)[0].slice(0, 2).toUpperCase()}
          </span>
          <div className="flex-1">
            <div className={`text-[13px] font-semibold ${FG}`}>{p.name}</div>
            <div className={`text-[11.5px] ${MUTED}`}>
              {p.role} · {p.on}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
