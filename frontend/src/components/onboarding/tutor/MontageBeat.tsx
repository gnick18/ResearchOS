"use client";

// Onboarding tutor — the montage beat.
//
// A fast flyover of the surfaces NOT shown deep, so nothing is invisible (the
// "everything else" answer). Each card flashes for a few seconds, no presenter
// cursor, factual one-line copy. Auto-advances through the list then onDone.
// Surfaces are shown with a small colored initial badge (no emoji, no inline
// svg). No em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import type { Surface } from "@/lib/onboarding/reel-director";

export interface MontageBeatProps {
  surfaces: Surface[];
  onDone: () => void;
}

const CARD: Record<Surface, { title: string; line: string; tint: string }> = {
  datahub: { title: "Data Hub", line: "Tables, one-click figures, validated stats.", tint: "#1d9e75" },
  phylo: { title: "Phylogenetics", line: "Build, style, and export trees.", tint: "#7c4dca" },
  methods: { title: "Methods", line: "Protocols, checklists, phone projection.", tint: "#2563eb" },
  sequences: { title: "Sequences", line: "Import, annotate, find primers, Tm.", tint: "#b9770f" },
  chemistry: { title: "Chemistry", line: "Structures, reactions, stoichiometry.", tint: "#0f6e56" },
  inventory: { title: "Inventory", line: "Stock, reorder, barcode scan.", tint: "#c0392b" },
  people: { title: "People", line: "Roster, workload, development plans.", tint: "#5b34a0" },
};

const PER_CARD_MS = 2600;

export default function MontageBeat({ surfaces, onDone }: MontageBeatProps) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (surfaces.length === 0) {
      onDone();
      return;
    }
    if (i >= surfaces.length) {
      onDone();
      return;
    }
    const id = setTimeout(() => setI((n) => n + 1), PER_CARD_MS);
    return () => clearTimeout(id);
  }, [i, surfaces.length, onDone]);

  const surface = surfaces[Math.min(i, surfaces.length - 1)];
  const card = surface ? CARD[surface] : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--surface,#fff)] px-6">
      <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--faint,#9aa097)]">
        A quick look at the rest
      </div>
      {card ? (
        <div
          key={i}
          className="flex w-full max-w-sm items-center gap-3 rounded-xl border-2 bg-[var(--surface,#fff)] px-4 py-3"
          style={{ borderColor: card.tint }}
        >
          <span
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: card.tint }}
          >
            {card.title.charAt(0)}
          </span>
          <div>
            <div className="text-sm font-bold">{card.title}</div>
            <div className="text-xs text-[var(--muted,#6b716a)]">{card.line}</div>
          </div>
        </div>
      ) : null}
      <div className="mt-4 flex gap-1.5">
        {surfaces.map((_, n) => (
          <span
            key={n}
            className="h-1 w-5 rounded"
            style={{ background: n <= i ? "var(--brand,#1d9e75)" : "var(--line2,#d2d5cd)" }}
          />
        ))}
      </div>
    </div>
  );
}
