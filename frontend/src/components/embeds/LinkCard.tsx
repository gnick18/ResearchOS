"use client";

// Markdown embed hybrid, Phase 7 (P7-4). Link-preview card renderer.
//
// The fallback for any bare external URL that is not a DOI, PMID, or PubChem link.
// Fetches the page title and favicon. Because most external pages block CORS on
// fetch(), the fetch will usually fail; we degrade gracefully to just the domain
// name + a /favicon.ico image (which the <img> element can load without CORS).
// Cached into the note sidecar so the card renders offline.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { getExternalCache, putExternalCache, type LinkCache } from "@/lib/embeds/external-cache";
import { fetchLinkPreview, extractDomain } from "@/lib/embeds/external-fetch";
import type { ExternalCardProps } from "./ExternalEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "ok"; data: LinkCache };

export default function LinkCard({ descriptor, caption, sidecarPath }: ExternalCardProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });

    (async () => {
      // Try the sidecar cache first.
      if (sidecarPath) {
        const cached = await getExternalCache(sidecarPath, descriptor.url);
        if (!cancelled && cached?.kind === "link") {
          setState({ k: "ok", data: cached });
          return;
        }
      }

      const data = await fetchLinkPreview(descriptor.url);
      if (cancelled) return;
      setState({ k: "ok", data });
      if (sidecarPath) {
        putExternalCache(sidecarPath, descriptor.url, data).catch(() => {});
      }
    })();

    return () => { cancelled = true; };
  }, [descriptor.url, sidecarPath]);

  // While loading, show a minimal card with the URL domain.
  const domain = extractDomain(descriptor.url) ?? descriptor.url;

  if (state.k === "loading") {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
          <Icon name="share" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-foreground">{caption || domain}</p>
          <p className="text-meta text-foreground-muted">{domain}</p>
        </div>
        <a
          href={descriptor.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open link: ${caption || domain}`}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:border-brand-action hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
    );
  }

  const d = state.data;
  const title = caption || d.title || d.domain;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {d.faviconUrl ? (
        // Favicon via <img>, no CORS restriction.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={d.faviconUrl}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-lg object-contain"
          onError={(e) => {
            // Swap to the generic icon if /favicon.ico returns a 404.
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
          <Icon name="share" className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">{title}</p>
        <p className="truncate text-meta text-foreground-muted">{d.domain}</p>
      </div>
      <a
        href={descriptor.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open link: ${title}`}
        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:border-brand-action hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
      >
        Open
      </a>
    </div>
  );
}
