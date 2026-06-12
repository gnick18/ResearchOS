"use client";

// Markdown embed hybrid, Phase 7 (P7-4). Citation card renderer.
//
// Renders a rich citation card for a DOI or PMID embed. Fetches metadata from
// Europe PMC (CORS-open, no key required). The result is cached into the note
// sidecar so the card renders offline and the export bibliography can read from it.
//
// Display layout mirrors the molecule embed card: icon + title header row, then
// a metadata row, then an Open link. Authors are truncated to the first two (et al.)
// so long author strings do not overflow the card on narrow screens.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { getExternalCache, putExternalCache, type CiteCache } from "@/lib/embeds/external-cache";
import { fetchCiteMetadata } from "@/lib/embeds/external-fetch";
import type { ExternalCardProps } from "./ExternalEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "ok"; data: CiteCache }
  | { k: "error" };

/** Truncate the author string to the first two surnames plus "et al." when there
 *  are more, so a 20-author paper does not overflow the card. Splits on comma and
 *  trims whitespace. */
function truncateAuthors(authors: string): string {
  if (!authors) return "";
  const parts = authors.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return authors;
  return `${parts[0]}, ${parts[1]} et al.`;
}

export default function CiteCard({ descriptor, caption, sidecarPath }: ExternalCardProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });

    (async () => {
      // Try the sidecar cache first so the card renders offline.
      if (sidecarPath) {
        const cached = await getExternalCache(sidecarPath, descriptor.url);
        if (!cancelled && cached?.kind === "cite") {
          setState({ k: "ok", data: cached });
          return;
        }
      }

      // Cache miss: fetch from Europe PMC.
      if (!descriptor.doiOrPmid) {
        if (!cancelled) setState({ k: "error" });
        return;
      }
      const data = await fetchCiteMetadata(descriptor.doiOrPmid, descriptor.isPmid ?? false);
      if (cancelled) return;
      if (!data) {
        setState({ k: "error" });
        return;
      }
      setState({ k: "ok", data });
      // Persist to cache, best-effort (do not await in the main render path).
      if (sidecarPath) {
        putExternalCache(sidecarPath, descriptor.url, data).catch(() => {});
      }
    })();

    return () => { cancelled = true; };
  }, [descriptor.url, descriptor.doiOrPmid, descriptor.isPmid, sidecarPath]);

  if (state.k === "loading") {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
          <Icon name="book" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-foreground-muted">Citation</p>
          <p className="text-meta text-foreground-muted">loading…</p>
        </div>
      </div>
    );
  }

  if (state.k === "error") {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
          <Icon name="book" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-foreground">
            {caption || descriptor.doiOrPmid || "Citation"}
          </p>
          <p className="text-meta text-foreground-muted">
            Could not load citation metadata.{" "}
            <a
              href={descriptor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Open source
            </a>
          </p>
        </div>
      </div>
    );
  }

  const d = state.data;
  const metaParts = [d.journal, d.year].filter(Boolean).join(" · ");
  const authorsShort = truncateAuthors(d.authors);

  return (
    <div>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
          <Icon name="book" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-foreground leading-snug">
            {d.title || caption}
          </p>
          {authorsShort ? (
            <p className="mt-0.5 truncate text-meta text-foreground-muted">{authorsShort}</p>
          ) : null}
          {metaParts ? (
            <p className="truncate text-meta text-foreground-muted">{metaParts}</p>
          ) : null}
        </div>
        <a
          href={d.url || descriptor.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open paper ${d.title || caption || descriptor.doiOrPmid || "citation"}`}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:border-brand-action hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
      {d.doi ? (
        <div className="border-t border-border px-4 py-1.5">
          <span className="text-meta text-foreground-muted">
            DOI:{" "}
            <a
              href={`https://doi.org/${d.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:text-foreground"
            >
              {d.doi}
            </a>
          </span>
        </div>
      ) : null}
    </div>
  );
}
