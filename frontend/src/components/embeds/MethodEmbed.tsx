"use client";

// Markdown embed hybrid, Phase 1. The method block-embed renderer.
//
// Loaded lazily by ObjectEmbed when a `[caption](/methods/ID#ros=card)` embed
// is on screen. Reads the method with a plain effect. For markdown methods
// with a source_path, optionally reads the first ~140 chars of the body as a
// preview. A deleted or unreadable method degrades to the calm generic card.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { methodsApi, filesApi } from "@/lib/local-api";
import type { Method } from "@/lib/types";
import { objectDeepLink, splitMethodRefId } from "@/lib/references";
import { ObjectEmbedCard, UnavailableEmbedCard, type EmbedRendererProps } from "./ObjectEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; method: Method; bodyExcerpt: string | null };

/** Human-readable label for each method type. Returns null for types we do
 *  not need to label (null method_type is also handled gracefully). */
function methodTypeLabel(method_type: Method["method_type"]): string | null {
  if (!method_type) return null;
  switch (method_type) {
    case "markdown": return "Markdown";
    case "pdf": return "PDF";
    case "pcr": return "PCR";
    case "lc_gradient": return "LC Gradient";
    case "plate": return "Plate";
    case "cell_culture": return "Cell Culture";
    case "mass_spec": return "Mass Spec";
    case "compound": return "Compound";
    case "coding_workflow": return "Coding Workflow";
    case "qpcr_analysis": return "qPCR Analysis";
    default: return null;
  }
}

export default function MethodEmbed({ descriptor, caption }: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });

    // A public-method reference carries a "public:" scope prefix on its id so it
    // routes to the public store, not a same-id private method (private resolves
    // first otherwise). A bare numeric id resolves private-first, as before.
    const { id, owner } = splitMethodRefId(descriptor.id);

    methodsApi
      .get(id, owner)
      .then(async (m) => {
        if (cancelled) return;
        if (!m) {
          setState({ k: "missing" });
          return;
        }

        // For markdown methods, try to read the first ~140 chars of the body
        // as a preview excerpt. Failure is non-fatal, we just show no excerpt.
        let bodyExcerpt: string | null = null;
        if (m.method_type === "markdown" && m.source_path) {
          try {
            const file = await filesApi.readFile(m.source_path);
            const text = file.content?.trim() ?? "";
            if (text) bodyExcerpt = text.slice(0, 140);
          } catch {
            // Non-fatal, excerpt stays null.
          }
        }

        if (!cancelled) {
          setState({ k: "ok", method: m, bodyExcerpt });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ k: "missing" });
      });

    return () => {
      cancelled = true;
    };
  }, [descriptor.id]);

  if (state.k === "loading") {
    return <ObjectEmbedCard descriptor={descriptor} caption={caption} loading />;
  }
  if (state.k === "missing") {
    return <UnavailableEmbedCard descriptor={descriptor} caption={caption} />;
  }

  const { method, bodyExcerpt } = state;
  const title = method.name || caption;
  const typeLabel = methodTypeLabel(method.method_type);
  const href = objectDeepLink("method", descriptor.id);

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        {typeLabel ? (
          <span className="shrink-0 rounded px-1.5 py-0.5 text-meta font-medium bg-surface-sunken border border-border text-foreground-muted">
            {typeLabel}
          </span>
        ) : null}
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open method ${title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
      {bodyExcerpt ? (
        <div className="px-3 py-2">
          <p className="line-clamp-2 text-meta text-foreground-muted">{bodyExcerpt}</p>
        </div>
      ) : null}
    </div>
  );
}
