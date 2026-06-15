"use client";

// The /figures entry point. There is no separate landing hub any more: the file
// list lives in the composer's left rail. So this route opens straight into the
// most recent figure page, or shows a one-button empty state when there are none.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import AppShell from "@/components/AppShell";
import { listFigurePages, createFigurePageDoc } from "@/lib/figure/figure-page-store";

export default function FiguresHome() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "empty">("loading");

  useEffect(() => {
    let live = true;
    void listFigurePages().then((pages) => {
      if (!live) return;
      if (pages.length > 0) {
        router.replace(`/figures/${pages[0].id}`);
      } else {
        setState("empty");
      }
    });
    return () => {
      live = false;
    };
  }, [router]);

  const create = async () => {
    const page = await createFigurePageDoc("Untitled figure", null);
    router.replace(`/figures/${page.id}`);
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        {state === "loading" ? (
          <p className="text-body text-foreground-muted">Opening your figures...</p>
        ) : (
          <>
            <Icon name="figure" className="h-10 w-10 text-foreground-faint" />
            <div>
              <h1 className="text-heading font-semibold text-foreground">Make your first figure</h1>
              <p className="mt-1 max-w-sm text-body text-foreground-muted">
                Arrange your plots, trees, sequences, and icons on one publication page, then export
                a single clean vector.
              </p>
            </div>
            <button
              type="button"
              onClick={create}
              className="flex items-center gap-1.5 rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white hover:opacity-90"
              data-testid="figure-create-first"
            >
              <Icon name="plus" className="h-3.5 w-3.5" /> New figure
            </button>
          </>
        )}
      </div>
    </AppShell>
  );
}
