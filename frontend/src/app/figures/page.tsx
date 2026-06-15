"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import AppShell from "@/components/AppShell";
import {
  listFigurePages,
  createFigurePageDoc,
} from "@/lib/figure/figure-page-store";
import type { FigurePage } from "@/lib/figure/figure-page";

export default function FiguresHome() {
  const router = useRouter();
  const [pages, setPages] = useState<FigurePage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void listFigurePages().then((p) => {
      if (live) {
        setPages(p);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const create = async () => {
    const page = await createFigurePageDoc("Untitled figure", null);
    router.push(`/figures/${page.id}`);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl p-8 overflow-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Figures</h1>
          <p className="text-body text-foreground-muted">
            Multi-panel publication pages, composed from your plots, trees, and maps.
          </p>
        </div>
        <button
          type="button"
          onClick={create}
          className="flex items-center gap-1.5 rounded-lg bg-brand-action px-3 py-2 text-meta font-semibold text-white hover:opacity-90"
        >
          <Icon name="plus" className="h-3.5 w-3.5" /> New figure page
        </button>
      </div>

      {loading && <p className="text-body text-foreground-muted">Loading...</p>}
      {!loading && pages.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-body text-foreground-muted">
          No figure pages yet. Create one to arrange several figures on a publication page.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => router.push(`/figures/${p.id}`)}
            className="rounded-xl border border-border p-4 text-left hover:border-brand-action"
          >
            <div className="mb-2 flex aspect-[4/3] items-center justify-center rounded-md bg-surface-sunken text-meta text-foreground-faint">
              {p.panels.length} panel{p.panels.length === 1 ? "" : "s"}
            </div>
            <p className="truncate text-body font-medium">{p.name}</p>
          </button>
        ))}
      </div>
      </div>
    </AppShell>
  );
}
